# unit-and-host

## 职责

三组不点鼠标的用例：`internals` 的纯函数、宿主路由、以及 `english_reader` 工具本身。它们便宜、精确，是面板用例之前的第一道网：断句、合并、墓碑、每个路由一条、每个动作一条。

## 位置

- `test/internals.test.mjs` :: `splitSentences`, `parseDialogue`, `titleFor`, `wordsOf`, `normalizeWord`, `hashText`, `buildTimings`, `mergeStates`
- `test/host.test.mjs` :: `apply`, `registerRoutes`, `ask`, `callHandler`, `withUpstream`, `revisionOfAnswer`
- `test/tool.test.mjs` :: `ACTIONS`, `englishReaderTool`, `mountTool`, `scratch`, `stored`, `seed`, `fakeContext`, `run`

## 输入 → 输出

| 文件 | 条数 | 管什么 |
| --- | --- | --- |
| `test/internals.test.mjs` | 18 | `splitSentences` 4 条（标点、缩写、小数、后引号）、`parseDialogue` 4 条（换行接回、有标签、无标签、散文里的单独标签）、`titleFor` 1、`wordsOf`/`normalizeWord` 1、`hashText` 1、`buildTimings` 2（有 marks / 无 marks）、`mergeStates` 5（并集、跨端一致、空库、词墓碑、对话墓碑） |
| `test/host.test.mjs` | 19 | 契约 2（路由齐不齐、模块指向的文件在不在）、词典解析 7（中文按词性分组、所有格、Datamuse、Wiktionary 去标签、查不到、非单词、未知源）、密钥 1（只报有没有）、路由状态 2（翻译选项、本地引擎）、库 3（共享、拒收、墓碑）、合并与指纹 4（移动存活、`revisionOf`、修订路由、`changed`） |
| `test/tool.test.mjs` | 20 | 定义与挂载 4、单词 2（去重 + 墓碑、保留未知字段）、对话 2、设置 2（读写、查词）、错误 2（未知动作、跑不动且不写）、跨半边 1（面板存一次 + 工具写一次共用一个库）、清洗 1、夹子与批量 6（`list_folders`、按名建夹、批量、对话归档、建夹幂等、移动存活） |

几个值得记住的用例名：

- 「the browser and the host settle a filing the same way」：同一组 `folderAt` 输入同时喂给宿主的 `mergeStore` 与浏览器的 `mergeStates`，6 组必须给出同一个答案——这是两条实现唯一的逐例对账。
- 「every route the panel calls exists on the host」「every module points at files that exist」：不跑逻辑，只比对字符串，却抓到过 worker 路径写错（每句都 502）。
- 「a move survives a save that never saw it」：移动靠 `folderAt` 而不是 `addedAt`/`updatedAt`，同一毫秒的平局取后写的一方。
- 「a saved word is listed, deduplicated and then gone with a tombstone」：断言落在**落盘的 `library.json`** 上（`stored(home)`），不只断言返回值。
- 「the plugin still loads when a host has no tool registry」：`tools` 软依赖的守护。

三组各自怎么起：

- `internals`：从 `harness` 拿 `internals` 解构，一个 DOM 都不建。
- `host`：`registerRoutes()` 用假 `ctx`（`effect`、`get`、`webServer.register`）跑一遍 `index.js` 的 `apply`，得到 `Map<path, route>`；`ask` 走 `route.resource(new Request(...))`，`callHandler` 造一对假 req/res 走 `route.handler`；上游用 `withUpstream` 临时替换 `globalThis.fetch`。
- `tool`：`scratch()` 每条用例换一个 `DSH_HOME`，`stored(home)` 直接读 `library.json` 校验落盘，`seed(home, state)` 手写一份「旧面板留下的」库，`fakeContext` 提供 `effect` 与 `inject` 的可测形状。

## 不变量

- **三组都不起 HTTP 服务器**：路由就是 URL 上的纯函数，`Request` 是合成的。
- **`DSH_HOME` 必须在 import 宿主模块之前指走**：两个文件都在顶部先 `mkdtemp`，再动态 import 宿主模块；顺序反了就会读到用户真实的库与密钥。
- **上游必须打桩**：用例不能依赖网络；`define_word` 的 miss 用例正是靠「没有网，词典返回 null」来断言「报告没查到」。
- **能用落盘结果断言的，就别只断言返回值**：返回值对了但文件不对，是这一层最想抓的错。
- **新增路由/动作要两条**：契约一条（存在性）+ 行为一条（做了什么）。

守护关系：这三份就是 `20-routes`、`30-store`、`60-tool` 各篇里「守护」那行的落点。

## 相邻模块

- `harness`：`internals` 从哪来、宿主假在哪。
- `60-tool/tool-definition` 与 `60-tool/word-actions`、`dialogue-actions`、`settings-actions`：`tool.test.mjs` 守的就是它们。
- `20-routes/route-table`、`30-store/merge-rules`、`30-store/revision`：`host.test.mjs` 守的就是它们。
- `50-dictionary`：打桩的上游与解析结果。

## 改这里时

- **加路由**：`host.test.mjs` 里加一条 happy path + 一种拒绝（405/400）；契约用例只查路径存在，不查行为。
- **加动作**：`tool.test.mjs` 正向一条、报错一条；要验墓碑就 `stored(home)` 读文件。
- **改合并规则**：先改跨端一致性那条，再改两边实现——它会同时跑 `mergeStore` 与 `mergeStates`。
- **发现用例在动真实库**：检查 `DSH_HOME` 是不是在 import 之后才设。
- **改断句/标题**：`internals` 与 `10-panel/text-pipeline` 的用例要一起改，别只改一边。

## 读代码顺序

1. `internals.test.mjs` 顶部的解构（一次看完 `client.js` 导出了什么）。
2. 断句四条 → `parseDialogue` 四条。
3. `buildTimings` 两条（marks 有/无）。
4. `mergeStates` 五条（并集、跨端、空库、两种墓碑）。
5. `host.test.mjs` 的 `registerRoutes` / `ask` / `callHandler`。
6. `tool.test.mjs` 的 `scratch` / `stored` / 四条定义与挂载用例。