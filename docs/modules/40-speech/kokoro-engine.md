# kokoro-engine

## 职责

worker 里的本地路径：加载 Kokoro-82M（或用用户选定的目录）、把 float32 采样封成 16 位 WAV、把下载/加载进度报给宿主，并把本地推理排成一条队列。

## 位置

- `worker.mjs` :: `loadKokoro`, `toWav16`, `onProgress`, `downloads`, `localQueue`, `MODEL_ID`, `MODEL_DIR`, `MODEL_DTYPE`, `kokoro`, `kokoroPending`

## 输入 → 输出

| 宿主请求 | worker 行为 | 回复 |
| --- | --- | --- |
| `{op:'local', text, voice, modelPath?}` | `loadKokoro(modelPath)` → `generate(text, {voice})` → `toWav16` | `{ok:true, type:'audio/wav', audio:'<base64>'}`（没有 marks） |
| `{op:'preload', modelPath?}` | `loadKokoro(modelPath)`，只为把权重下下来/载入 | `{ok:true}`；过程中推 `progress` / `phase` / `cache` 事件 |

环境变量在模块加载时读一次，默认值写在 `worker.mjs` 顶部：

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `ER_MODEL_DIR` | `''` | `env.cacheDir`；为空就用引擎自己的缓存目录 |
| `ER_MODEL_ID` | `onnx-community/Kokoro-82M-v1.0-ONNX` | `from_pretrained` 的源 |
| `ER_MODEL_DTYPE` | `q8` | 量化精度（`q8` ≈ 89MB） |

## 不变量

- **必须在子进程里跑**：插件宿主把 CommonJS 依赖求值成空 `exports`，`kokoro-js` 与 `@huggingface/transformers` 在那里根本拿不到构造函数；普通 Node 进程有正常模块系统，并且把推理的 CPU 关在宿主事件循环之外。
- **`cacheDir` 必须设在 `@huggingface/transformers` 的 `env` 上**：`kokoro-js` 重新导出的 `env` 不是引擎真正读的那个，设了等于没设。代码先试 transformers 的 `env`，找不到才退回。
- **选目录就离线**：`modelPath !== ''` 时 `allowRemoteModels = false`，并设 `localModelPath = modelPath`；不选时允许远程，首次使用自动下载到 `cacheDir`。
- **一个引擎只属于一个来源**：`kokoroSource` 记住当前加载的是哪个 id/目录；来源变了就重载，`kokoroPending` 保证并发请求只触发一次加载。
- **加载失败要报事件**：`catch` 里推 `{event:'phase', phase:'error', error}` 再抛出；宿主据此把 `local.phase` 改成 `error`。
- **`toWav16` 是自制的 44 字节 WAV 头**：PCM16、单声道、`sampleRate * 2` 的 byteRate；负样本乘 `0x8000`、正样本乘 `0x7fff`（不对称，防溢出）。
- **本地推理串行**：`localQueue` 把 `local` / `preload` 排成一条链；Edge 不排队，长下载不会卡住在线朗读。
- **本地没有 marks**：`handle` 的 local 分支不回 marks，面板只能按句长均分估算。

## 相邻模块

- 上游：`worker-protocol`（stdin 循环、`handle`）、`local-model`（`startInstall` 发 `preload`、`hasModel` 判磁盘）。
- 下游：`synthesis-entry` 的 `synthesize`（`op:'local'`、超时 180 秒）。
- 消费方：`10-panel/playback`（`audio/wav` 一样能播）。

## 改这里时

- **换模型 / dtype**：改 `host/constants.js` 的 `MODEL_ID`、`MODEL_DTYPE` 与 `MODEL_BYTES_APPROX`；worker 通过 env 收到，宿主不重启就仍是老进程。
- **换 WAV 格式**（例如 float32）：`toWav16` 的头字段与写入循环一起改；面板只看 `content-type` 与浏览器能不能解。
- **加 GPU**：`device: 'cpu'` 是硬编码；改成可配置时注意 `dtype` 与设备要匹配，并且 worker 崩溃会连累下一次 `ask`（懒重建）。
- **改进度聚合**：`onProgress` 只认 `progress` / `download` / `initiate`，其它状态（`done` 等）被忽略；`downloads` 在加载成功后清空，重下才重新计数。

## 读代码顺序

1. `loadKokoro` 的 `source` 与缓存判断（`kokoro` + `kokoroSource` + `kokoroPending`）。
2. `env` 的寻找顺序与三行配置（`cacheDir`、`allowLocalModels`、`allowRemoteModels`）。
3. `from_pretrained` 的参数与 `progress_callback`。
4. `toWav16` 的 44 字节头。
5. `handle` 的 `op === 'local'` / `op === 'preload'`。
6. `localQueue` 与 stdin 循环里的入队条件。