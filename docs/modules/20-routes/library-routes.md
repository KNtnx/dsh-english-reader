# library-routes

## 职责

共享库的两个入口：`/store` 读/写整份库（写之前先与磁盘上的合并），`/store/revision` 只回一个指纹让面板每两秒问一次。本模块是「面板」与「宿主」之间唯一的库通道，也是 `changed` 这个语义的产地。

## 位置

- `host/routes.js` :: `handleStore`, `sharedState`, `handleStoreRevision`, `sendJson`, `readBody`
- `host/files.js` :: `readStore`, `writeStore`, `mergeStore`, `sameList`, `revisionOf`
- `host/constants.js` :: `MAX_STORE_BYTES`, `PATHS`

## 输入 → 输出

| 路由 | 输入 | 输出 |
| --- | --- | --- |
| `GET /store` | 无 | `{ok:true, state, revision}`；宿主上还没文件时 `state` 是 `null`、`revision` 是 `''` |
| `POST /store` | JSON `{state: {...}}` | `{ok:true, savedAt, revision, changed}` |
| `GET /store/revision` | 无 | `{ok:true, revision, savedAt}` |

`POST` 的失败码：方法既不是 GET 也不是 POST 时 405 `method not allowed`；超 `MAX_STORE_BYTES` 413 `tooLarge`；读体失败 400 `unreadable`；JSON 坏 400 `badJson`；`sharedState` 判为不像一份库则 400 `badState`；落盘异常 500（带 `error` 文本）。

`sharedState` 的白名单（**只有这些字段会进库**）：

| 字段 | 规则 |
| --- | --- |
| `savedAt` | 有限数字则保留，否则 `Date.now()` |
| `items` | `slice(0, 500)`，必须是数组，否则整份 `state` 判为非法 |
| `words` | `slice(0, 2000)`，同上 |
| `folders` | `slice(0, 200)`，缺失当 `[]` |
| `settings` | 只有是普通对象时才带；**不带就沿用宿主已有的**（工具写过设置不会被擦掉） |
| `removed` | 墓碑，`slice(-500)` 取最新 500 条 |

其余一切都丢掉：`activeId`、`index`、宽度字号、播放位置、词卡缓存都是**本机状态**，进库会让两台浏览器互相打架。

## 不变量

- **`changed` 必须诚实**：它等于「合并后的四个列表与面板发来的四个列表是否有差异」（`sameList` 逐个比 `items`/`words`/`folders`/`removed`）。宿主丢掉了一个面板还留着的词、或补进了一个面板没见过的词，都必须说 `changed: true`，让面板立刻回读。**删除被正常应用不算纠正**——面板发来的状态本来就少了那个词，还带着墓碑，合并结果与它一致。
- **先合并再写**：`POST` 从不直接覆盖文件，`mergeStore(await readStore(), stored)` 之后才 `writeStore`。所以「后保存的删掉先保存的」不可能发生。
- **`revision` 回的是刚写下去那一版**：面板据此把自己这次写认识成「自己人」，不会拉回来再合并一遍（除非 `changed`）。
- **GET 原样返回，不做迁移**：`state` 就是 `readStore()` 的结果，形状清洗在 `30-store/library-file` 里；面板必须容忍 `null`。
- **顺序不影响 `sameList`**：它按 id 排序后比较，面板发来同样条目但顺序不同不会被当成改动——否则每次保存都会谎报 `changed`。
- **错误一律 JSON**：这一组用 `sendJson`，所以面板可以无条件 `response.json()`；别在这里改成 `text/plain`。

## 相邻模块

- 上游调用者：`10-panel/host-sync`（600ms 防抖保存 + 2s 轮询指纹）、`10-panel/shared-store`（`persist` / `adopt`）。
- 下游实现：`30-store/library-file`（读写的原子性）、`30-store/merge-rules`（合并规则）、`30-store/revision`（指纹算法）。
- 另一个写者：`60-tool` 直接调 `mergeStore` + `writeStore`，**绕过本路由**；所以面板只能靠 `revision` 察觉工具写过。

## 改这里时

- **加一个共享字段**（例如词的笔记）：`sharedState` 白名单 + `30-store/library-file` 的 `readStore` 默认值 + `30-store/merge-rules` 的并集规则 + 面板 `persist` 的 payload，四处缺一处就会「刷新后丢失」。
- **改上限**：`500` / `2000` / `200` / `-500` 在 `sharedState` 与 `mergeStore` 里各出现一次，两边必须同步；只改一边等于上限失效。
- **改 `changed` 的判定**：先想清楚「宿主纠正」与「宿主接受」的边界，再改 `sameList` 的比较范围；多比一项、回读更频繁，少比一项、就可能漏掉一次纠正（面板会一直显示一个别人没有的库）。
- **让 `POST` 返回整份库**：现在只回 `savedAt`/`revision`/`changed`，是为了让保存轻。要回整库就得让面板跳过下一次 `GET`，否则等于两次传输。
- **加一条 DELETE 语义**：现在删除靠墓碑（`removed`）传播，不要加「删文件」或「清空库」的路由——一次误删无法由任何副本恢复。

## 读代码顺序

1. `handleStore` 的 GET：三行，看清 `state` 可能是 `null`。
2. `handleStore` 的 POST：读体 → 解析 → `sharedState` → `mergeStore` → `writeStore` → 算 `changed`。
3. `sharedState` 的白名单表（尤其 `settings` 的条件展开）。
4. `mergeStore` 与 `sameList`（在 `host/files.js`）：`changed` 到底比的是什么。
5. `handleStoreRevision`：为什么只回指纹，以及 `savedAt` 缺省为 `0`。