# worker-protocol

## 职责

宿主与语音子进程之间的进程契约：stdin/stdout 上一行一个 JSON，请求按 `id` 配对，事件不带 `id` 直接推；进程崩溃、超时、卸载时怎么收尾。

## 位置

- `host/speech.js` :: `startWorker`, `ask`, `applyEvent`, `pending`, `nextId`, `stdoutBuffer`, `workerStderr`, `worker`
- `worker.mjs` :: `emit`, `handle`, `localQueue`, `buffer`

## 输入 → 输出

| 方向 | 报文 | 说明 |
| --- | --- | --- |
| 宿主 → worker | `{"id":1,"op":"edge","text":"…","voice":"en-US-AriaNeural"}` | 合成一句（Edge） |
| 宿主 → worker | `{"id":2,"op":"local","text":"…","voice":"af_heart","modelPath":"…"}` | 合成一句（Kokoro） |
| 宿主 → worker | `{"id":3,"op":"preload"}` | 下载 / 加载模型，回 `{ok:true}` |
| 宿主 → worker | `{"id":4,"op":"probe"}` | `{ok:true, edge:bool, local:bool}`，只说明「加载过没有」 |
| worker → 宿主 | `{"id":1,"ok":true,"audio":"<base64>","type":"audio/mpeg","marks":[…]}` | 成功；`type` 可能是 `audio/wav` |
| worker → 宿主 | `{"id":2,"ok":false,"error":"…"}` | 失败，`ask` 把它变成 `Error` |
| worker → 宿主 | `{"event":"progress","loaded":1,"total":2,"file":"…"}` | 下载进度，交给 `applyEvent` |
| worker → 宿主 | `{"event":"phase","phase":"ready"}` | 加载状态；`cache` 事件带 `dir` |

```
startWorker ──spawn(process.execPath, [script])──► worker.mjs
     │  env: ER_MODEL_DIR / ER_MODEL_ID / ER_MODEL_DTYPE
     │  stdio: ['pipe','pipe','pipe']，认领 stdout/stderr
     ├─ ask() 写一行 JSON，登记 pending[id]
     └─ stdout 按 \n 切行 → JSON.parse
             ├─ 有 event 字段 → applyEvent（不进 pending）
             └─ 有 id 字段   → pending 里 resolve / reject
```

## 不变量

- **一行一个 JSON，且必须以 `\n` 结束**：`stdoutBuffer` 只按换行切；最后一行没有换行就永远不解析（进程退出时也不会补）。
- **`id` 由宿主分配，worker 原样回传**：`nextId` 只增不减；`pending` 是唯一的配对表，回不上的 `id` 静默丢弃。
- **事件与回复共用 stdout，靠字段区分**：`event` 优先判断；事件从不 resolve 请求，只喂 `applyEvent`。
- **每次 `ask` 自带超时**：`synthesize` 给 edge 45 秒、local 180 秒，`startInstall` 给 preload 30 分钟；超时即 reject 并从 `pending` 删除。
- **worker 退出 = 所有 pending 失败**：`child.on('exit')` 里把 `worker` 置空、逐个 reject（消息带退出码与 stderr 末尾 300 字），下一次 `ask` 懒重建——没有重启定时器、没有退避。
- **stderr 只留诊断**：保留最近 4000 字符，不解析；失败信息里那一段就是它。
- **local / preload 串行，其余并发**：worker 用 `localQueue` 把本地推理排成一条链，Edge 与 `probe` 不排队——否则一次长下载会卡住所有朗读。

## 相邻模块

- 上游：`synthesis-entry`（`synthesize` 调 `ask`）、`local-model`（`startInstall` 调 preload）。
- 下游/对端：`worker.mjs` 的 `handle` 与两个引擎（`edge-engine`、`kokoro-engine`）。
- 路由：`20-routes/speech-routes` 的 `handleTts` 拿到的是 `synthesize` 的结果，不经手协议；卸载清理在 `host/routes.js` 的 `apply`。

## 改这里时

- **加一个 `op`**：worker 的 `handle` 加分支、宿主加调用点与超时；两侧同时改——协议里没有版本号，老 worker 会把新 `op` 回成 `unknown op`。
- **改超时**：`synthesize` 里的 45000 / 180000 与 `startInstall` 的 30 分钟是三处独立数字；`collect` 在 worker 侧另有一个 30 秒的 Edge 超时。
- **要主动停 worker**：用 `host/speech.js` 的 `stopWorker()` 收口（卸载清理已经这么调）。别在别的模块对 `worker` 赋值——它是 ESM 的 import 绑定，`worker = null` 会在运行时抛 `TypeError: Assignment to constant variable`，而这条路径只有「合成过再卸载」才会走到，普通用例看不见。
- **换通信方式**（例如 socket）：`startWorker`、`ask`、stdout 循环三处是全部接口；`pending` 的语义（一请求一回复、可超时）必须保住。

## 读代码顺序

1. `worker.mjs` 顶部注释：请求/回复的四种形状。
2. `startWorker`：路径 `../worker.mjs`、env、stdio、stdout 切行、exit/error 收尾。
3. `ask`：id、`pending`、超时、写失败。
4. `applyEvent`：事件怎么折叠进 `local`。
5. `worker.mjs` 末尾的 stdin 循环与 `localQueue`。
6. `handle`：四个 `op` 的返回值。