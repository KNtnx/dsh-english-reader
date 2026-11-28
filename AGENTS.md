# AGENTS.md — dsh-english-reader 维护入口

这是一份**目录**，不是手册。DSH 会把仓库根目录的 `AGENTS.md` 作为会话指令读入，所以它必须短：细节全在 [`docs/modules/`](./docs/modules/README.md)。

## 这是什么

一个 DSH 插件，装起来以后在右侧栏给中文用户朗读英文文章/对话，并带一个可共享的单词库。它由**两个半边**组成，写同一份数据：

- **浏览器半边** `client.js`（4,853 行，单 `__ModuleLoader__` 工厂，无构建步骤）；
- **宿主半边** `index.js` → `host/*.js`（16 条 HTTP 路由 + 一个模型工具 + 一个语音子进程 `worker.mjs`）。

三处入口：右侧栏页签、左侧栏整页视图、输入框上方的小按钮。用户数据在宿主 `$DSH_HOME/dsh-english-reader/library.json`，界面状态在本机 `localStorage`。

## 五分钟上手

```bash
npm install                                    # react / react-dom / jsdom
timeout 300 node --test test/                  # 全量，约 3 秒，147 项
node --test test/panel.dict.test.mjs           # 单文件
node --test --test-name-pattern "gloss" test/  # 单用例
```

- 改完想让 DSH 吃到新代码：用 `plugin_manager` 把 `include:english-reader` 关掉再打开；**客户端改动还要刷新页面**（bundle 由浏览器缓存）。
- 浏览器复核流程与历史 bug 清单：`docs/TESTING.zh.md`。
- 行为承诺（用户视角）在 `docs/DETAIL.zh.md`；本目录的模块文档解释**代码怎么做到**。

## 任务 → 读什么

| 我要改 / 想知道 | 先读 |
| --- | --- |
| 插件的两个半边怎么被加载、怎么注册 | [00-loading](./docs/modules/00-loading/README.md) |
| 加一条界面文案、改按钮文字 | [10-panel/copy](./docs/modules/10-panel/copy.md) + `locale/*.json`（插件列表文案） |
| 断句、文章/对话判定、标题 | [10-panel/text-pipeline](./docs/modules/10-panel/text-pipeline.md) |
| 逐词高亮、语音 marks 对不齐 | [10-panel/word-alignment](./docs/modules/10-panel/word-alignment.md) |
| 归类被覆盖、墓碑、旧数据迁移 | [10-panel/shared-store](./docs/modules/10-panel/shared-store.md) + [30-store/merge-rules](./docs/modules/30-store/merge-rules.md) |
| 面板不刷新、同步延迟、保存回环 | [10-panel/host-sync](./docs/modules/10-panel/host-sync.md) + [20-routes/library-routes](./docs/modules/20-routes/library-routes.md) |
| 播放：缓存、跳句、换音色重读 | [10-panel/playback](./docs/modules/10-panel/playback.md) |
| 右键词卡、查词顺序、收藏开关 | [10-panel/word-card](./docs/modules/10-panel/word-card.md) |
| 加一个页面或一个控件 | [10-panel/views](./docs/modules/10-panel/views.md) + [10-panel/panel-shell](./docs/modules/10-panel/panel-shell.md) |
| 样式、图标、主题变量 | [10-panel/styles](./docs/modules/10-panel/styles.md) |
| 加/改一条宿主路由 | [20-routes/route-table](./docs/modules/20-routes/route-table.md) |
| 库文件读写、原子写、版本指纹 | [30-store](./docs/modules/30-store/README.md) |
| 语音引擎、worker 协议、本地模型下载 | [40-speech](./docs/modules/40-speech/README.md) |
| 词典源（iciba / WordNet / Collins） | [50-dictionary](./docs/modules/50-dictionary/README.md) |
| 翻译来源、模型翻译 | [50-dictionary/translate-providers](./docs/modules/50-dictionary/translate-providers.md) |
| `english_reader` 工具的动作 | [60-tool](./docs/modules/60-tool/README.md) |
| 写测试、跑测试、为什么有这些用例 | [70-testing](./docs/modules/70-testing/README.md) + `docs/TESTING.zh.md` |
| 插件自己更新、插件页没有更新按钮 | [00-loading/self-update](./docs/modules/00-loading/self-update.md) |
| 插件装不上、本地引擎缺失、安装期依赖报错 | [70-testing/install-contract](./docs/modules/70-testing/install-contract.md) + README 的安装与排错段 |

## 模块地图

| 前缀 | 大模块 | 一句话 |
| --- | --- | --- |
| `00` | [装载与契约](./docs/modules/00-loading/README.md) | 清单、入口、5 处客户端注册 |
| `10` | [面板（浏览器半边）](./docs/modules/10-panel/README.md) | 文案、解析、三个 hook、14 个视图 |
| `20` | [宿主路由](./docs/modules/20-routes/README.md) | 16 条路由，前端调用落到哪个函数 |
| `30` | [存储与合并](./docs/modules/30-store/README.md) | 一份 `library.json`，两个写者 |
| `40` | [语音](./docs/modules/40-speech/README.md) | Edge 在线 / Kokoro 本地，都在子进程 |
| `50` | [词典与翻译](./docs/modules/50-dictionary/README.md) | 4 个词典源、5 个翻译源 |
| `60` | [模型工具](./docs/modules/60-tool/README.md) | `english_reader` 的 17 个动作 |
| `70` | [测试与验收](./docs/modules/70-testing/README.md) | 五层用例 + 静态契约扫描 |

## 硬约束（破坏其中一条就别提交）

1. **`client.js` 没有构建步骤**：它是单文件单工厂，`import`/`export` 都会被浏览器直接拒绝。能拆的只有函数，不是文件。
2. **`ReaderBody` 不能自己调 hook**：它被当普通函数调用（为了错误边界），新状态请放进三个 hook 之一。
3. **宿主 `tools` 是软依赖**：`mountTool` 必须继续在 `ctx.inject(['tools'], …)` 里注册，没有工具注册表时插件仍要能加载。
4. **归类由 `folderAt` 决定，删除写成墓碑**：宿主 `mergeStore` 与浏览器 `mergeStates` 是同一套规则，改一边必须改另一边。
5. **密钥只在宿主**：`sources.json`、`dictionary.json` 是 0600，前端永远只拿到「有没有」。
6. **语音子进程路径是 `../worker.mjs`**：拆分后写错过一次，结果是每句都 502。
7. **`POST /store` 的 `changed` 必须诚实**：宿主纠正过一次保存就要说 `changed: true`，否则浏览器会一直显示一个别人没有的库。
8. **文案有两处**：界面文案在 `client.js` 的 `DICT`，插件列表文案在 `locale/*.json`，key 两端必须一致。
9. **测试必须绿**，而且新逻辑要有一条「回退它就变红」的用例；只跑 jsdom 不算验证过浏览器。
10. **改代码必须改文档**：本文件保持目录地位，细节写进对应小模块文档。
11. **本地引擎是可选的 peer**：`kokoro-js` 只能待在 `peerDependencies` + `peerDependenciesMeta.optional`，不能回到 `dependencies`，也不能放 `optionalDependencies`（后者仍会被默认安装）。它带入的 `onnxruntime-node` 在 CUDA 13 上装不上，默认安装必须只有 `msedge-tts`；缺引擎时 worker 回 `engine-missing`；用户点「下载」时由 `host/engine.js` 确认后按需安装（`test/install.test.mjs` 与 `host.test.mjs` 守着）。卸载由 `host/uninstall.js` 事后收走 `models/` 与 `kokoro-js`，库/来源/词典设置必须保留。

## 一次改动的流程

1. 用上面的表定位到**小模块文档**，读「不变量」与「改这里时」两节。
2. 顺着「相邻模块」看一遍上下游（尤其跨半边的：`10-panel` ↔ `30-store`）。
3. 改代码，同时加一条会失败的新用例；`timeout 300 node --test test/` 全绿。
4. 回写文档：更新受影响的「职责/不变量/位置」，并跑 `node --test test/docs.test.mjs`（链接、引用符号、必需小节）。

## 文档规则

- 小模块文档固定 7 节：职责 / 位置 / 输入 → 输出 / 不变量 / 相邻模块 / 改这里时 / 读代码顺序。
- 大模块 README 固定 6 节：一句话 / 代码入口 / 小模块索引 / 数据流 / 常见改动 / 风险与历史坑。
- **只引用 `文件` :: `符号`，不写行号**——行号会漂，符号名可以 grep，契约用例会检查它是否存在。
- 单篇小模块 ≤ 90 行；本文件 ≤ 350 行（用例检查）。
- 新增一个小模块：建文件 → 登记进大模块 README 的索引 → 跑文档用例。

## 术语

| 词 | 意思 |
| --- | --- |
| 两个半边 | 浏览器 `client.js` 与宿主 `index.js`+`host/*`，写同一份库 |
| `folderAt` | 「最后一次移动归类」的时间戳，合并时由它决定条目在哪个夹子 |
| 墓碑 | `removed: [{kind, id, at}]`，删除的传播方式；比它旧的副本不能复活 |
| marks | 语音引擎逐词回调的边界时间，用来做句内高亮 |
| 半边/小模块 | 本文件用的两个粒度：大模块（一层职责）与不可拆小模块（一篇文档） |
| 版本指纹 | `revisionOf(库)`，十来个字节，面板据此判断「宿主变了没有」 |