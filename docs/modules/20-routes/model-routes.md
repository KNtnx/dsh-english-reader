# model-routes

## 职责

本地语音模型这两条路由：`/local/status` 回答「现在到哪一步了」（有没有装、下到多少、错在哪），`/local/install` 只负责**点火**——立刻返回，进度靠面板轮询状态。下载本身在语音子进程里跑，宿主不阻塞。

## 位置

- `host/routes.js` :: `handleStatus`, `handleInstall`
- `host/speech.js` :: `hasModel`, `localStatus`, `startInstall`, `local`, `ask`
- `host/constants.js` :: `modelDir`, `MODEL_ID`, `MODEL_DTYPE`, `MODEL_BYTES_APPROX`, `LOCAL_VOICES`

## 输入 → 输出

| 路由 | 输入 | 输出 |
| --- | --- | --- |
| `GET /local/status` | 无（`handleStatus` 连 request 都不接） | `localStatus()` 的整份快照，200，`cache-control: no-store` |
| `POST /local/install` | 空 body（不读） | `202 {started: true}`；非 POST 是 `405 text/plain` |

`localStatus()` 的字段：`phase`、`progress`（0–1，保留三位）、`loadedBytes`、`totalBytes`、`approximateBytes`、`file`、`error`、`model`、`dtype`、`dir`、`voices`、`installed`。

`phase` 的取值来自 `local.phase`：`absent`（没装）→ `downloading`（`progress` 事件推进）→ `loading`（权重已在盘上，等 worker 预热）→ `ready`；另有 `cached`（盘上有、worker 没热）与 `error`（连 `error` 一起给）。`installed` 是 `ready`/`cached`/`loading`/`downloading` 四态之一，即「有东西可用或马上可用」。

## 不变量

- **状态路由永不失败**：`handleStatus` 先 `await hasModel()` 再返回快照，没有 try/catch——因为 `hasModel` 自己吞掉 `readdir` 的异常并把 `onDisk` 记成 `false`。面板因此可以无条件轮询（`test/host.test.mjs`「the local engine reports its state instead of failing the panel」）。
- **安装是幂等的**：`startInstall` 在 `downloading`/`loading`/`ready` 时直接 return；路由仍然答 202。所以 **202 的意思是「有一个下载在跑」，不是「这次新起了一个」**。
- **失败只从状态里看**：`ask({op:'preload'}, …)` 的 reject 被写进 `local.phase = 'error'` 与 `local.error`；安装响应早在下载开始前就已经发出去了。
- **进度只在子进程里产生**：宿主只接收 `progress` / `phase` / `ready` 事件（`applyEvent`）并覆盖字段，自己不算字节。
- **`onDisk` 是记忆化的**：`hasModel` 一旦得出结论就不再 `readdir`，所以运行中删掉模型目录，状态仍会停在 `cached`/`ready`，直到插件重载。

## 相邻模块

- 上游：`10-panel` 的设置/模型卡片（轮询 `/local/status`，点按钮打 `/local/install`）。
- 下游实现：`40-speech` 的 worker 协议（`op: 'preload'`、`progress`/`phase`/`ready` 事件）；`worker.mjs` 把 `ER_MODEL_DIR` 交给 transformers 当缓存目录，下载就发生在那里。
- 交叉：`20-routes/speech-routes` 在 `phase === 'downloading'` 时让 `/tts` 答 503 `preparing`，读的是同一份 `local`。
- 路径与体积常量：`30-store/paths-and-limits`（`modelDir`、`MODEL_ID`、`MODEL_DTYPE`、`MODEL_BYTES_APPROX`）。

## 改这里时

- **加一个 phase**：`applyEvent` 认它、`localStatus` 的 `installed` 判断带上它、面板那侧的文案与按钮一起改；漏一处就是「状态永远显示未知」。
- **让安装可取消**：现在没有取消路由。要加就得同时处理 worker 侧的下载中断与 `pending` 表的清理（`apply` 的卸载 effect 已经会 reject 所有 pending）。
- **改轮询节奏**：这是面板侧的决定（`host-sync` 是库的轮询，模型是另一条）；不要改成宿主推送——`handleStatus` 只读状态、不触发下载。
- **改安装超时**：30 分钟写在 `startInstall` 里，慢网下才需要动它；改小会让下载被误判成 `error`。
- **多模型共存**：`modelDir` 与 `MODEL_ID` 现在是一对一，加第二个模型要先把目录结构与 `hasModel` 的检查改成按模型 id 查。

## 读代码顺序

1. `handleStatus`（三行，看清「先探测再回答」）。
2. `localStatus`：返回快照的每个字段从哪来。
3. `handleInstall`：为什么只答 202。
4. `startInstall`：幂等判断 + `ask({op:'preload'})` + 失败写入 `local`。
5. `applyEvent`：`progress` / `phase` / `ready` 三种事件怎么改 `local`，以及 `cached` 何时出现。
6. `hasModel`：记忆化的 `onDisk` 与 `phase` 的联动。