# local-model

## 职责

本机 Kokoro 模型的「有没有、能不能用、到哪一步了」：磁盘探测、用户目录校验、下载与加载的状态机、面板要的状态对象；以及 `/tts` 在本地 provider 上提前拒绝的那些条件。

## 位置

- `host/speech.js` :: `hasModel`, `checkModelPath`, `resolveModelPath`, `localStatus`, `startInstall`, `local`, `applyEvent`
- `host/constants.js` :: `modelDir`, `MODEL_ID`, `MODEL_DTYPE`, `MODEL_BYTES_APPROX`, `LOCAL_VOICES`

## 输入 → 输出

| 符号 | 输入 | 输出 |
| --- | --- | --- |
| `hasModel()` | — | `boolean`；看 `<modelDir>/<MODEL_ID>/onnx` 下有没有 `.onnx`；结果缓存在 `local.onDisk` |
| `checkModelPath(path)` | 面板给的绝对目录 | `{ ok: true }` 或 `{ ok:false, code }`：`pathNotAbsolute` / `pathMissing` / `pathNotFolder` / `configMissing` / `onnxMissing` |
| `resolveModelPath(path)` | 同上 | 目录（`ok`）或 `null`；路由用它把坏路径变成 400 `bad-model-path` |
| `localStatus()` | — | 面板状态，见下表 |
| `startInstall()` | — | `void`；把 `phase` 推到 `downloading`，再发 `preload`（30 分钟超时） |

```
absent ──install──► downloading ──► ready
   │                    └─ onDisk 为 false 时，loading 事件也归到 downloading
   └─ hasModel 发现盘上有权重 ──► cached ──再加载──► loading ──► ready
   （任何一步失败 → error；再点 install 重来）
```

`localStatus()` 的字段：`phase`、`progress`（0 到 1，总量未知时为 0）、`loadedBytes`、`totalBytes`、`approximateBytes`、`file`、`error`、`model`、`dtype`、`dir`、`voices`、`installed`。`installed` 为 `ready` / `cached` / `loading` / `downloading` 之一——含义是「不用再点下载」，`error` 不算。

状态机由 worker 事件喂：`progress` 一律写成 `downloading` 并累加字节；`phase: loading` 看 `onDisk` 决定显示「加载」还是「下载」；`phase: ready` 置 `ready`、`onDisk = true`、清零计数并清空错误；`phase: error` 写 `error`。宿主启动时收到的 `{event:'ready'}` 若发现 `phase === 'absent'` 且盘上有权重，就把状态改成 `cached`。

## 不变量

- **下载只有一个入口**：`startInstall` 发 `preload`，永远下到 `modelDir()/<MODEL_ID>`；用户选的目录只用于加载，不会往里写。
- **`startInstall` 幂等**：`downloading` / `loading` / `ready` 直接返回；`cached` 会真的走一遍加载（因为引擎还没起）。
- **`checkModelPath` 的判定是「引擎能读」**：绝对路径、是目录、有 `config.json`、且有 `onnx/` 或任一 `.onnx`。四道缺一不可。
- **`hasModel` 只读一次盘**：`local.onDisk` 一旦不是 `null` 就永远返回它；运行中删掉权重不会被发现，只能重启宿主。
- **进度只信 worker**：宿主不估算下载量，`progress` 是 `loaded / total` 四舍五入到三位；`total` 为 0 时进度是 0。
- **本地合成的三道拒绝在上游**：`20-routes/speech-routes` 的 `ttsRefusal` 用这里的函数判定——下载中回 503 `preparing`、坏路径回 400 `bad-model-path`、没装回 503 `not-installed`。
- **返回形状以代码为准**：`checkModelPath` 的 JSDoc 还写着 `string|null`，实际返回的是判定对象；改签名时先改 JSDoc。

## 相邻模块

- 上游/对端：`20-routes/speech-routes` 的 `handleStatus`、`handleInstall`、`handleValidate`；`10-panel/panel-shell` 的下载进度轮询。
- 下游：`kokoro-engine`（真正加载模型与读 env）、`worker-protocol`（`preload` 与事件）。
- 路由：`20-routes/speech-routes` 是这些拒绝码的唯一出口。

## 改这里时

- **换模型 / 精度**：`MODEL_ID`、`MODEL_DTYPE`、`MODEL_BYTES_APPROX` 在 `host/constants.js`；worker 侧通过 `ER_MODEL_*` 环境变量读同一组值，改完要重启宿主（worker 是懒重建，但老进程还在）。
- **加一个 `phase`**：`local.phase` 的联合注释、`applyEvent`、`localStatus().installed`、面板文案四处都要加，否则新状态会被当成「未安装」。
- **想在校验里加文件**：`checkModelPath` 的返回码是面板文案的键；新增码要同步面板与 `20-routes/speech-routes` 的 `handleValidate`（它原样 `sendJson`）。
- **下载断点续传**：worker 的 `downloads` 是按文件聚合的，宿主只收总量；要做「剩余时间」得在 worker 侧加字段，别在宿主估算。

## 读代码顺序

1. `local` 的字段与五态注释。
2. `hasModel`：为什么只读一次盘。
3. `checkModelPath` / `resolveModelPath`：四道判定。
4. `applyEvent`：三类事件怎么改 `local`。
5. `localStatus`：面板看到的每个字段，尤其 `installed`。
6. `startInstall` 与 `20-routes/speech-routes` 的 `ttsRefusal`。