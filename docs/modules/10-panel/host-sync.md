# host-sync

## 职责

让打开着的面板跟上宿主：每两秒问一次「库变了没有」，变了才拉整库回来合并；自己刚写的那次不算「别人变了」，但被宿主纠正过的写要立刻读回。

## 位置

- `client.js` :: `STORE_PATH`, `STORE_REVISION`, `SYNC`, `sendStore`, `adopt`, `syncRef`, `revisionRef`, `liveRef`, `ReaderBoot`

## 输入 → 输出

| 符号 | 作用 |
| --- | --- |
| `sendStore(payload)` | 600ms 防抖 `POST /store`；响应里的 `revision` 记进 `revisionRef`（**除非**响应说 `changed: true`） |
| `adopt(remote)` | 把宿主状态并进当前状态：逐列表比对后只 `set` 真正变的那几个；宿主带了词典设置就回填 |
| 轮询 effect | `setTimeout(loop, SYNC.pollMs)`（2000ms）；`document.visibilityState === 'hidden'` 时跳过；`focus` / `visibilitychange` 立刻问一次 |
| `revisionRef` | 本浏览器「已经知道的宿主版本号」，启动时由 `ReaderBoot` 从 GET `/store` 的响应里种下 |

流程：

```
保存一次 ──► POST /store ──► { revision, changed }
                              │        └─ changed === true ──► syncRef.current()（立刻重读）
                              └─ 记进 revisionRef（下次轮询见到同号就安静）

每 2s ──► GET /store/revision ──► 与 revisionRef 不同 ──► GET /store ──► adopt
```

## 不变量

- **`changed: true` 必须回读**。宿主合并后可能丢掉了面板手里的词（已被墓碑删除），也可能多了面板没见过的词。不回读，浏览器会一直显示一个别人都没有的库，直到刷新。宿主的 `20-routes/library-routes` 负责诚实上报这个标志。
- **只有内容真变了才 `setState`**：`sameLibrary` 就是为此存在。无脑 `set` 会让保存 effect 再次触发，形成「自己写 → 自己拉 → 自己写」的循环。
- **隐藏的页签不轮询**：省电，也避免后台标签堆请求；切回来会立刻补问一次。
- **轮询只拿指纹**：`/store/revision` 是十几个字节，整库有几十 KB；顺序不能反。

守护：`test/panel.sync.test.mjs` 四条（别人新增、别人删除、自己写不回头、被纠正立刻读回）。

## 相邻模块

- 上游：`10-panel/shared-store`（`persist` → `sendStore`；`adopt` 复用 `mergeStates`）、`10-panel/panel-shell`（`onHostSettings` 回填词典设置）。
- 下游/对端：`20-routes/library-routes`（`/store`、`/store/revision`）、`30-store/revision`（指纹怎么算）。
- 启动链路：`ReaderBoot` 先 GET 一次，拿到 `state` 与 `revision` 才渲染面板。

## 改这里时

- **改轮询间隔**：`SYNC.pollMs`；测试里把它设成 20ms（`internals.sync.pollMs`），真实值保持 2s 级。
- **加一次「立刻同步」**：`syncRef.current?.()` 就是那一发，注意它在 effect 之外是 `null`。
- **改保存防抖**：`sendStore` 里的 600ms 与 `persist` 的 350ms 是两层，改一个要说明另一个为什么不动。
- **换成推送（SSE）**：本模块是唯一入口；换实现时 `revisionRef` 的语义要保住（否则自写会回环）。

## 读代码顺序

1. `STORE_REVISION` / `SYNC` 常量。
2. `sendStore`（防抖 + 记录 revision + `changed` 分支）。
3. `adopt`（为什么先比对再 set）。
4. 轮询 `useEffect`（隐藏跳过、focus 唤醒、清理）。
5. `ReaderBoot` 里种 `revision` 的那一行。