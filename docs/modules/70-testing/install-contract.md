# install-contract

## 职责

把安装期的两个承诺变成会红的用例：本地引擎是**可选 peer**（默认安装里只有 `msedge-tts`，`kokoro-js` 及其 120 MB 原生依赖树一个都不进来），以及没有引擎时 worker 仍要活着、把原因说成 `engine-missing` 而不是普通失败。它存在的理由是一次真实事故：`kokoro-js` 带进来的 `onnxruntime-node` 在 CUDA 13 机器上 postinstall 失败，pnpm 把已经解包的插件整笔回滚，只想用 Edge 的人连插件都装不上。

## 位置

- `test/install.test.mjs` :: `MANIFEST`, `talkToWorker`
- `package.json` :: `dependencies`, `peerDependencies`, `peerDependenciesMeta`
- `worker.mjs` :: `ENGINE_MISSING`, `isEngineMissing`, `classifyEngineFailure`, `loadKokoro`
- `host/speech.js` :: `ask`, `applyEvent`, `localStatus`
- `host/routes.js` :: `speechFailure`
- `client.js` :: `clipFor`, `playAt`, `local.engineMissing`

## 输入 → 输出

| 用例 | 输入 | 断言 |
| --- | --- | --- |
| 清单那条 | `package.json` | `kokoro-js` 在 `peerDependencies`、`peerDependenciesMeta.optional === true`，且不在 `dependencies` / `optionalDependencies`；`msedge-tts` 仍是硬依赖 |
| worker 那条 | 复制到空目录的 `worker.mjs`，三条请求：`local`、未知 op、`probe` | `local` 回 `{ok:false, code:'engine-missing'}`，消息含 `optional peer dependency` 与包名；未知 op 没有 `code`；`probe` 仍 `ok` |

## 不变量

- **空目录现在就是默认状态**：`kokoro-js` 是可选 peer，pnpm 在 `autoInstallPeers: false`（DSH profile 一直这么配）下不会装它；复制 worker 到空目录正好复现「用户还没装引擎」。不要在仓库内建这个目录——仓库自己的 `node_modules` 会让引擎被解析到。
- **两条用例都必须能红**：把 `kokoro-js` 挪回 `dependencies` 或 `optionalDependencies`，第一条红；去掉 `classifyEngineFailure` 写的 `code`，第二条红。
- **它不负责运行时安装本身**：peer 是否被自动安装取决于 profile 的 `autoInstallPeers`；用户点「下载」后的 `pnpm add --ignore-scripts` 由 `40-speech/engine-install` 负责（`host.test.mjs` 三条用例钉命令与审批）。本文件只钉「清单形状」与「缺引擎时的运行时」。
- **最便宜的一层**：不启动宿主、不下载模型、不建 DOM，两条用例合计不到 100ms。

## 相邻模块

- 上游：`00-loading/bundle-manifest`（清单字段与可选 peer 的理由）、`40-speech/kokoro-engine`（`engine-missing` 怎么产生）、`40-speech/local-model`（状态里的 `code`）。
- 对端：`20-routes/speech-routes` 的 503 `{code}`、`10-panel/playback` 的 `EngineMissingError` 与提示文案、`40-speech/engine-install`（确认后由宿主安装引擎）。
- 兄弟：`70-testing/contract-tests`（只读源码的扫描器）、`70-testing/unit-and-host`。

## 改这里时

- **改依赖归属**：先改 `package.json` 再跑这个文件；它红了就是安装契约被破坏，同时回写 `AGENTS.md` 的硬约束 11。记住 `optionalDependencies` 不是「可选」——它仍会被默认安装。
- **改错误归类**：`isEngineMissing` 要同时覆盖「模块解析不到」与「原生绑定装不起来」两类；新增一类失败时补一条请求，别只放宽正则。
- **改错误码或提示**：`ENGINE_MISSING` 的值要同步 `speechFailure`、`clipFor`、`add-source` 对话框里的提示与两条界面文案（`local.engineMissing`、`error.engineMissing`）。
- **改安装命令**：README 的「本地引擎与构建脚本」是唯一出处；面板文案只给短版命令，两处要一起改。

## 读代码顺序

1. `test/install.test.mjs` 的清单断言（先看契约是什么）。
2. `talkToWorker`：为什么复制到空目录、为什么等 `ready` 再收答复。
3. `worker.mjs` 的 `isEngineMissing` → `classifyEngineFailure` → `loadKokoro` 的 catch。
4. `host/routes.js` 的 `speechFailure`：503 与 502 的分界。
5. `client.js` 的 `clipFor` → `playAt`：一个 `code` 怎么变成一句人话。