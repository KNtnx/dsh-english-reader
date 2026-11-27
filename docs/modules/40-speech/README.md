# 40 语音

**一句话**：一句话进来、一段音频出去——Edge 走微软在线朗读（握手必须在子进程里做），Kokoro 在本机跑 82M 的量化 ONNX；两条路都从 `host/speech.js` 的 `synthesize` 进，区别只在最后一步是 `ask` worker 还是 `fetch` 你自己配的端点。

## 一句话

- **负责**：provider 调度（`edge` / `local` / `custom`）、语音子进程的生命周期与协议、三种在线端点协议（OpenAI 兼容 / Azure / DashScope）、本地模型的下装与状态机、片段缓存与「上次哪个地址通了」的记忆。
- **不负责**：HTTP 路由与参数校验（`20-routes/speech-routes`）、面板的播放状态机与逐词高亮（`10-panel/playback`）、源记录与密钥怎么落盘（`30-store/secrets`）。

## 代码入口

| 文件 | 关键符号 | 一句话 |
| --- | --- | --- |
| `host/speech.js` | `synthesize`、`synthesizeApi`、`cache`、`local` | 调度、缓存、本地模型状态；自带端点也在这里 |
| `worker.mjs` | `handle`、`loadEdge`、`loadKokoro`、`toWav16`、`isEngineMissing`、`classifyEngineFailure` | 子进程：两个引擎，一行一个 JSON |
| `host/constants.js` | `MODEL_ID`、`MODEL_DTYPE`、`CACHE_LIMIT`、`LOCAL_VOICES`、`EDGE_VOICE`、`PROTOCOLS` | 模型、上限、音色、协议白名单 |
| `host/routes.js` | `handleTts`、`handleStatus`、`handleInstall` | 路由层：参数、拒绝码、`x-er-marks` 响应头 |
| `client.js` | `clipFor`、`speak`、`installModel` | 面板：一句一请求；本地模型轮询状态 |

## 小模块索引

| 小模块 | 一句话 | 文档 |
| --- | --- | --- |
| worker-protocol | 宿主与 `worker.mjs` 之间「一行一个 JSON」的契约 | [worker-protocol.md](./worker-protocol.md) |
| synthesis-entry | `synthesize` 怎么落到一个真能出声的引擎 | [synthesis-entry.md](./synthesis-entry.md) |
| custom-endpoints | OpenAI 兼容 / Azure / DashScope 三种自带端点 | [custom-endpoints.md](./custom-endpoints.md) |
| local-model | 本地模型：装没装、路径能不能用、下载到哪一步 | [local-model.md](./local-model.md) |
| edge-engine | worker 侧 Edge：音频流与 WordBoundary marks | [edge-engine.md](./edge-engine.md) |
| kokoro-engine | worker 侧 Kokoro：加载、WAV 封装、环境变量 | [kokoro-engine.md](./kokoro-engine.md) |
| clip-cache | 片段缓存 + 「上次哪个地址通了」的记忆 | [clip-cache.md](./clip-cache.md) |

## 数据流

```
client.js  clipFor(sentence)
  └─ GET /tts?provider=edge|local|custom&voice=…&text=…
        └─ host/routes.js handleTts：参数与拒绝（not-installed / preparing / bad-model-path）
              └─ host/speech.js synthesize(provider, text, voice, custom, modelPath)
                    ├─ cache 命中 ──► { body, type, marks }
                    ├─ edge / local ──► ask({ op, text, voice, modelPath })
                    │                        └─ worker.mjs
                    │                              ├─ op edge：msedge-tts → 音频 + marks
                    │                              └─ op local：kokoro-js → PCM → toWav16
                    └─ custom ──► synthesizeApi → openai / azure / dashscope（宿主内 fetch）
```

音频以 `Response` 回去，marks 走响应头 `x-er-marks`（base64 JSON）；面板解码后交给 `10-panel/word-alignment`。

本地分支还多一种结局：可选 peer 里的引擎没装（默认就是没装，见 `00-loading/bundle-manifest`）时 worker 回 `code:'engine-missing'`，`/tts` 变 503 而不是 502，面板显示「本地语音引擎未安装」并给出安装命令，Edge 不受影响。

## 常见改动

| 需求 | 改哪里 | 顺手补什么 |
| --- | --- | --- |
| 加一个 provider | `synthesis-entry` 的 `synthesize` 分派 + `20-routes/speech-routes` | 面板的来源选项、`test/panel.playback.test.mjs` |
| 换本地模型或精度 | `local-model` 与 `kokoro-engine` 引用的常量 | `MODEL_BYTES_APPROX`——面板显示的就是它 |
| 端点地址总配不对 | `custom-endpoints` 的 `endpointCandidates` / `firstThatAnswers` | 面板「验证」按钮走的 `endpointVerdict` |
| 同一句被反复合成 | `clip-cache` 的键与 `CACHE_LIMIT` | `test/panel.playback.test.mjs`（同句只请求一次） |
| 本地引擎装不上 / 只要 Edge | 见 `00-loading/bundle-manifest` 与 README 的「本地引擎与构建脚本」：`kokoro-js` 留在可选 peer | `test/install.test.mjs` 两条 |
| 逐词高亮错位 | `edge-engine` 的 marks 单位 + `10-panel/word-alignment` | 面板对 marks 缺失时的均分估算 |

## 风险与历史坑

- **子进程路径是 `../worker.mjs`**：它相对 `host/speech.js` 解析。拆分 `host/` 之后写成 `./worker.mjs`，结果是每句都 502 而路由测试全绿；现在由 `test/host.test.mjs` 的「every module points at files that exist」守着。
- **子进程不是性能优化，是硬需求**：插件宿主把 CommonJS 依赖求值成空 `exports`，两个引擎包只能在普通 Node 进程里加载（见 `kokoro-engine`）。
- **本地引擎是可选 peer，别挪回 `dependencies` 或 `optionalDependencies`**：`kokoro-js` → `@huggingface/transformers` → `onnxruntime-node` 的 postinstall 会探测 CUDA，版本不认识时安装失败；硬依赖会拖垮安装，`optionalDependencies` 仍会默认安装，等于换汤不换药（历史事故，`test/install.test.mjs` 守着）。
- **首次使用要下 ~89MB**：下载期间 `/tts` 对 local 回 503 `preparing`，面板应当轮询 `/local/status` 而不是重试合成；点「下载」走的 `startInstall` 会等 30 分钟。
- **`hasModel` 有进程内记忆**：一旦读过一次磁盘就不再问；运行中删掉模型，状态仍会说已装，直到宿主重启。
- **缓存键不含 model / protocol / key**：同一个源改这些设置后，同一句、同一音色仍会命中旧片段（见 `clip-cache`）。
- **自定义端点的音色按句传**：`synthesize` 收的是面板这次请求的 `voice`；曾经从源记录里读 `voiceA/voiceB`，导致角色 B 永远用同一个音色。
- **本地引擎不报 marks**：`handle` 的 local 分支只回音频，面板用平均时长估时间轴；Edge 的 marks 是毫秒（源数据单位是 100ns）。