# merge-rules

## 职责

把「磁盘上那一份」与「刚送来的那一份」并成第三份：按 id 并集、时间戳新的赢、墓碑比它旧的副本不能复活、归类只由 `folderAt` 决定。它是一个纯函数，不读盘也不写盘——所以两个写者（面板与 `english_reader` 工具）能共用同一套规则而不共享代码路径。

## 位置

- `host/files.js` :: `mergeStore`, `placements`, `placed`, `sameList`, `union`, `gone`
- `host/constants.js` :: `MAX_STORE_BYTES`

## 输入 → 输出

`mergeStore(current, incoming)` → 一份新的库对象：`{savedAt, items, words, folders, removed, ...未知键}`。

| 阶段 | 规则 |
| --- | --- |
| 墓碑表 `gone` | 两边的 `removed` 合成 `kind:id → at`，取**最大** `at`；条目必须是对象且有字符串 `id` |
| 并集 `union` | 依次遍历 current、incoming；id 取 `entry.id ?? entry.word`，空 id 丢弃；`at >= entry[stamp]` 的副本直接跳过（删除赢同刻） |
| 谁赢 | 同一 id 比 `entry[stamp]`，`>=` 时后遍历的赢——即**平局时 incoming 赢** |
| 归类 | `placements` 取每份列表里最大的 `folderAt` → `placed` 把胜出的 `folderId` 写回合并结果 |
| 墓碑重建 | `gone` 展平回 `{kind, id, at}`，按 `at` 升序排序，`slice(-500)` 留最新 500 条 |
| 上限 | `items` 500、`words` 2000、`folders` 200（都在 `sharedState` 之外再截一次） |
| `savedAt` | 两边取最大，永不倒退 |
| 未知键 | `{...current, ...incoming}` 里凡不在 `merged` 的键原样带上，incoming 优先 |

四类条目的时间戳字段固定：对话用 `updatedAt`、词用 `addedAt`、夹子用 `createdAt`、而**归类**只看 `folderAt`。前三个回答「内容新旧」，`folderAt` 回答「最后被谁放进哪个夹子」——移动只改 `folderId` 与 `folderAt`，不动前三个。

## 不变量

- **删除是记录，不是缺失**：墓碑进 `removed`，合并时按 `at` 比较。少写一条墓碑，另一台浏览器下次保存就把词带回来（`test/internals.test.mjs`「a deleted word stays deleted when a stale copy arrives」）。
- **归类不能靠 `addedAt`/`updatedAt`**：一次移动不改它们，用它们判归属会让「没看见移动的副本」把移动擦掉（历史 bug：用户得刷新，有时刷新也不够；`test/host.test.mjs`「a move survives a save that never saw it」）。
- **平局有明确赢家**：两个写者同一毫秒落笔时，后合并进来的（incoming）赢。合并顺序因此有意义，不能把参数换成集合。
- **墓碑比较是 `>=`**：与删除同一刻的副本也算已删；只有时间戳严格更晚的写入才是「新条目」，可以复活同名 id。
- **归档到「未分类」也是一次移动**：`folderId: ''` + 更大的 `folderAt` 必须能覆盖旧的 `'f1'`；从未归类的条目不会被凭空安上 `folderId`。
- **纯函数**：不读文件、不取时间（`savedAt` 由调用方给）、不打日志——所以 `test/host.test.mjs` 可以直接喂两个对象断言结果。

## 相邻模块

- 上游写者一：`20-routes/library-routes` 的 `handleStore`（`sharedState` 白名单 → `mergeStore` → `writeStore`）。
- 上游写者二：`60-tool`（直接 `mergeStore(current, {savedAt: Date.now(), ...change})` 再 `writeStore`，**不走 HTTP**，因此不受 `sharedState` 白名单约束）。
- 浏览器对端：`10-panel/shared-store` 的 `mergeStates` 是同一套规则的第二份实现（在 `client.js` 里，不能 import）。改这边必须改那边。
- 配合：`30-store/revision`（合并后的对象被哈希）、`30-store/library-file`（合并结果落盘）。

## 改这里时

- **加一类共享数据**：`union` 调用处加一类、墓碑 `kind` 起名、`placed` 判断要不要归类、上限加一条、面板 `mergeStates` 同步。五处缺一，症状都是「同步后随机丢失」。
- **改归类规则**：先改用例（`test/host.test.mjs`「a move survives a save that never saw it」里的几段：移动赢过旧副本、归档回未分类、同毫秒 incoming 赢、没归过类不长 `folderId`），再动 `placements`/`placed`。
- **改墓碑比较符**：`>=` 改成 `>` 会让「同一毫秒删除 + 旧副本」复活被删条目；这是刻意的，别顺手改。
- **改上限**：这儿的 `slice` 是字面量，`sharedState` 里还有一套；两边一起改，否则请求能进来、列表仍被砍。
- **让合并变「聪明」**（例如按内容 diff）：先把两个写者的时序想清楚——工具写盘与 HTTP 写盘没有锁，任何依赖「我知道对方刚写了什么」的规则都会在并发下错。

## 读代码顺序

1. `gone` 表：墓碑怎么被收集，为什么取最大 `at`。
2. `union` 闭包：id 归一、墓碑过滤、时间戳比较——三件事挤在十行里。
3. `mergeStore` 里 `removed` 的重建与排序（`slice(-500)` 为什么在升序数组上取尾部）。
4. `placements` 与 `placed`：为什么归类要单独一趟，且必须晚于并集。
5. `mergeStore` 末尾的未知键补写。
6. `sameList`：它不参与合并，只服务 `changed` 的判断（见 `20-routes/library-routes`）。