# engine-install

## 职责

把「本地引擎」从用户必须自己动手的 peer 依赖，变成点一下就能装上的东西，同时不把 120 MB 和 CUDA 探测塞回插件安装：面板先说明将执行什么，宿主用 `pnpm add --ignore-scripts` 装一次，worker 照常解析，模型下载接着开始。卸载时反过来——插件被删掉以后，模型与引擎这两个可重建的大件要跟着走，而单词库、来源与词典设置是用户数据，必须留下。

## 位置

- `host/engine.js` :: `engineRoot`, `engineReady`, `engineStatus`, `installCommand`, `installInto`, `registryRetryable`, `withOfficialRegistry`, `startEngineInstall`, `denyEngineBuilds`, `engine`, `ENGINE_SPEC`, `ENGINE_BYTES_APPROX`, `OFFICIAL_REGISTRY`
- `host/routes.js` :: `handleEngineInstall`, `scheduleUninstallReap`
- `host/uninstall.js` :: `pluginDirectory`, `removalCommand`, `removeModels`, `removeEngine`, `reapNow`, `scheduleUninstallReap`
- `host/constants.js` :: `PATHS.engine`
- `host/speech.js` :: `localStatus`, `startEngineInstall`, `startInstall`, `engineFailureOf`
- `client.js` :: `installModel`, `installEngine`, `cancelEngine`, `renderEnginePrompt`, `engineInstalling`

## 输入 → 输出

| 触发 | 行为 | 结果 |
| --- | --- | --- |
| `POST /local/engine` | `startEngineInstall()` 起一次后台安装（已在装则忽略），落地后丢掉旧 worker | 202 `{started:true}`；进度看 `/local/status` 的 `engine.phase` |
| `GET /local/status` | 检查 `engineRoot()` 下四个包是否齐全 | `engine: {phase: missing/installing/ready/error, error, log}` |
| 面板「安装引擎并下载」 | 先弹确认（命令、约 120 MB、只装一次） | 取消：不发请求；确认：POST engine → 轮询 → `ready` 后 POST `/local/install` |
| 插件被卸载 | dispose 时留下一个观察者（5s / 20s / 60s 各看一次包目录还在不在） | 包目录消失 = 卸载：删 `models/` 与 `pnpm remove kokoro-js`；包目录还在 = 热重载或停用：什么都不做 |

## 不变量

- **一律 `--ignore-scripts`**：装的是包内的 CPU 二进制；`onnxruntime-node` 的 postinstall 在 CUDA 13 上必然失败，跑一次就会把包弄没。
- **安装位置跟着解析走**：普通安装装进 profile 根（worker 在 `node_modules` 里向上解析得到它）；`link:` 检出装进插件目录（profile 解析不到它）。`engineRoot()` 从插件目录向上找 `pnpm-workspace.yaml`，找不到就退回插件目录；`ER_ENGINE_ROOT` 只给测试用。
- **状态以磁盘为准**：`engineStatus()` 每次都检查 `kokoro-js`、`@huggingface/transformers`、`onnxruntime-node`、`sharp` 四件套；`engine.phase` 只是安装中的临时标记，安装失败后用户手动修好，下一次 status 也会自愈。
- **清单存在不等于装好**：`engineReady` 按 Node 的规则从 `exports['.']`／`main`／`index.js` 解出入口文件，再确认它真的存在。`pnpm add` 会先把每个 `package.json` 写下来再解包，只看清单会把半成品判成 `ready`，于是 worker 在没有 `dist/` 的引擎上启动。
- **引擎变了就换 worker**：worker 的解析结果绑在它自己那个进程上，起在引擎之前或装到一半的那个进程会一直复读同一个失败。所以 `handleEngineInstall` 在安装落地后 `stopWorker()`，`startInstall` 的失败回调也会对 `engineFailureOf(error)` 为真的情况丢掉 worker；只有模型/ONNX 这类失败才保留它。
- **只装一次**：`startEngineInstall` 在 `installing` 时直接返回，确认框关闭后不会自己再弹；重启宿主后磁盘仍是唯一依据。
- **镜像缺版本就用官方源重试一次**：`pnpm add` 在 profile 里解析的是**整棵依赖树**，包括插件自己（`dsh-english-reader@<版本>`）。国内镜像常常晚几分钟到几小时才同步新版本，于是引擎安装会以 `No matching version` 失败——明明 `kokoro-js` 在镜像上是有的。`installInto` 认出这类解析失败（`registryRetryable`）后带 `--config.registry=https://registry.npmjs.org/` 重试一次；`--ignore-scripts` 保留，所以 CUDA 补丁仍然不会跑。
- **失败可解释**：命令的非零退出、超时与 ENOENT 都写进 `engine.error`，面板展示并保留 README 里的手动命令。
- **顺手关掉后续审批**：`denyEngineBuilds` 把 `onnxruntime-node@版本`、`sharp@版本` 写成 `false`，否则以后普通 `pnpm install` 会再问一次构建，批准就会把包丢掉；YAML 形状不认识时原样不动。
- **只碰安装面**：会改 profile 的 `package.json`/lockfile（`pnpm add` 的副作用）与 `pnpm-workspace.yaml`；不碰 `$DSH_HOME` 的库、密钥与模型。
- **卸载带走可重建的，留下用户数据**：`models/`（约 113 MB）与 `pnpm remove kokoro-js`（连同它拖进来的 `onnxruntime-node`/`sharp`/`transformers` 约 120 MB）跟着插件走；`library.json`、`sources.json`、`dictionary.json` 一个字节不动，重装后原样接上。
- **「卸载」只能事后判定**：DSH 与 pnpm 都没有卸载钩子——`pnpm remove` 只删包，不跑被删包的脚本（实测）。所以判定靠观察包目录是否消失，且必须在 dispose 之后再等一会儿：dispose 发生在停用之后、`pnpm remove` 之前。
- **热重载不能被误判**：包目录还在就立刻收手，观察者不产生任何副作用；`unref` 保证它不会拖住宿主退出。宿主提前退出，文件就留着——尽力而为，不是保证。

## 相邻模块

- 上游：`00-loading/bundle-manifest`（为什么引擎是可选 peer）、`40-speech/README`（语音总览）。
- 下游：`worker.mjs` / `kokoro-engine`（解析同一棵树）、`local-model`（模型下载与状态机）、`20-routes/speech-routes`（路由参数与形状）。
- 面板：`10-panel/views` 的设置卡片与 `renderAddDialog`、`10-panel/copy` 的确认文案。
- 测试：`test/host.test.mjs`（检测、命令、审批）、`test/panel.settings.test.mjs`（确认 → 安装 → 下载）。

## 改这里时

- **换安装命令**：`installCommand` 与 README 的命令必须一起改；`--ignore-scripts` 不能丢。
- **加一个装引擎的入口**：面板继续调 `installModel` 即可，确认框集中在 `renderEnginePrompt`；不要在别处直接 POST 引擎路由。
- **改状态字段**：`engineStatus` 的 phase、`client.js` 的 `engineInstalling`、设置卡与添加来源对话框三处一起改，否则会「装着装着又变回未安装」。
- **改审批策略**：`denyEngineBuilds` 针对 `onnxruntime-node` 与 `sharp` 两个版本化键；上游升级版本后要重新跑一次。
- **改卸载范围**：要删什么、留什么只在 `host/uninstall.js` 里改；`removalCommand` 只删 `kokoro-js`（其余是它的传递依赖，跟着走）——别把整棵 `node_modules` 交给它。

## 读代码顺序

1. `engineRoot` / `engineReady`：装在哪、怎么算装好。
2. `installCommand` / `runInstall`：执行什么、日志与超时怎么处理。
3. `startEngineInstall` 的状态机与 `engineStatus` 的磁盘判定。
4. `denyEngineBuilds` 的 YAML 编辑。
5. `client.js` 的 `installModel` → `renderEnginePrompt` → resume effect。
6. `localStatus` 如何把引擎状态带给面板。
7. `host/uninstall.js`：为什么不删库、为什么用观察者而不是钩子、三个时间点各看什么。