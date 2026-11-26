# harness

## 职责

把「真面板 + 真 React + 假宿主」组装起来。`launchPanel` 通过 `__ModuleLoader__` 加载真正的 `client.js`，`createHost` 接管 `fetch` 回答面板的每个请求，`internals` 是 `client.js` 专门为测试导出的纯函数集合；`test/dom.mjs` 负责在那之前把浏览器全局装好。

## 位置

- `test/harness.mjs` :: `launchPanel`, `createHost`, `FIXTURE_STATE`, `FIXTURE_DICT`, `internals`, `wordSpan`, `mergeStore`, `sameIds`, `loadPanelModule`
- `test/dom.mjs` :: `dom`, `window`, `GLOBALS`

## 输入 → 输出

`launchPanel(options)` 的选项与回报：

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `state` | `FIXTURE_STATE` | 写进 `localStorage` 的 `dsh-english-reader:state:v2`，面板启动时从这里读 |
| `host` | `{}` | 透传给 `createHost`：`store`、`dict`、`latency`、`tts:'fail'`、`validate`、`collinsKey` |
| `locale` | `'en'` | 假 `ctx.locale.getLocale()` 的答案，用来测中文界面 |
| `pickDirectory` | `async () => null` | 「选择文件夹」是宿主能力而不是路由，测试直接传一个函数进去 |

回报 `api`：`q`/`qa`/`text`/`texts`（只查面板容器）、`click`/`rightClick`/`type`/`key`/`choose`（每个都在 `act` 里派发真实事件并 `settle`）、`waitFor`/`idle`/`settle`（时间）、`host`（假库与请求记录）、`errors`（`console.error` 的收集）、`unmount`（卸载并把 `console.error` 还回去）。

`createHost(options)` 的要点：

- 每次 `fetch` 都记进 `host.calls`：`method`、`path`、`search`、`body`——「面板到底请求了什么」靠它断言。
- `/store` GET 回 `state` + `revision`；POST 用本文件里的 `mergeStore` 合并，把 `revision` 推到 `r{n}`，再用 `sameIds` 比出 `changed`。
- `host.write(state)` 直接改假库并推 revision——这就是「模型刚调了工具」「另一个窗口刚保存」的模拟。
- 其它分支：`/tts/sources`、`/local/status`、`/translate/options`、`/translate/models`、`/dict`、`/dict/ai`、`/dict/key`、`/tts/validate`、`/translate`、`/tts`（可回 502 纯文本）。
- 没写分支的路径回 404 `no mock for METHOD path`：**面板新增一个请求，先在这里加一条**。

`mergeStore` / `sameIds` 是本文件内的私有 helper：

- `mergeStore` 是宿主合并的**近似**：按 id 并集，`items` 比 `updatedAt`、`words` 比 `addedAt`、`folders` 比 `createdAt`；墓碑表 `kind:id → at` 覆盖更旧的副本；`settings` 有就收。真规则在 `host/files.js`，由 `host.test.mjs` 守。
- `sameIds` 只比「排序后的 id 集合」：宿主判 `changed` 时不管顺序，因为浏览器自己会排序。

`internals` 是 `client.js` 末尾导出的 `{ parseDialogue, splitSentences, hashText, titleFor, EDGE_VOICES, LOCAL_VOICES, SPEEDS, DICT, buildTimings, wordsOf, normalizeWord, mergeStates, sameLibrary, sync }`；`sync` 是同一个对象，所以测试能把 `pollMs` 改小。配套的 `wordSpan(api, token)` 按小写文本在 `.er-w` 里找那一个词，右键用例都从它开始。

`test/dom.mjs` 做的事：

- jsdom（`url: 'http://127.0.0.1/'`，`pretendToBeVisual`）建一个带 `#root` 的文档。
- 把 `GLOBALS` 里的构造器与函数装到 `globalThis`；先 `bind` 再**给构造函数换回真类**，否则 React 的 `new window.HTMLElement` 会炸。
- `self`/`window`/`document`、`innerWidth`/`innerHeight`、`IS_REACT_ACT_ENVIRONMENT = true`。
- `requestAnimationFrame` 用 `setTimeout` 顶上；`scrollTo`/`scrollIntoView`/`play`/`pause`/`load` 变空操作；`ResizeObserver` 固定报 900×700。

## 不变量

- **浏览器假设只写一处**：面板要用一个新 API 时，先加进 `test/dom.mjs`——测试会在宿主之前报错。
- **面板只能看见假 `fetch`**：`launchPanel` 把 `globalThis.fetch` 换成 `host.fetch`；`unmount` 只还原 `console.error`，下一个 `launchPanel` 会重新覆盖 `fetch`。
- **挂载入口必须对得上**：注册表里找不到 `sidebar.right.pane.tab:dsh-english-reader` 就直接抛错——注册名一改就红。
- **`host` 扮演「另一个写者」**：面板启动只读 `localStorage`，假宿主默认是空的；要模拟工具或第二个面板，用 `host.write`，不要手改 `store`。
- **`errors` 必须为空**：面板用例里的 `assertHealthy` 就是两条——DOM 里没有 `failed to render`，`console.error` 一条都没有。

## 相邻模块

- 上游：`10-panel/panel-shell`（`props` 来自 `descriptor.inject()`）、`00-loading/client-registration`（`__ModuleLoader__` 与注册名）。
- 下游：`70-testing/panel-tests`（所有面板用例都从这里开始）、`70-testing/unit-and-host`（`internals` 也从这里拿）。
- 对端：`20-routes/route-table`（`createHost` 的分支要和真实路由同名）、`30-store/library-file`（`mergeStore` 的真身）。

## 改这里时

- **面板新增一个请求**：在 `createHost` 里加同名分支，否则用例会失败在 404 上，看起来像面板的错。
- **面板新增一个宿主能力**（不是路由，比如目录选择器）：加进 `launchPanel` 的选项与假 `ctx`。
- **要模拟「别人改了库」**：用 `host.write`；直接改 `api.host.store` 不会推 revision，同步逻辑看不见。
- **改 `FIXTURE_STATE`**：它是许多用例的地基，改之前先 grep 谁在 `{...FIXTURE_STATE}` 上叠数据。
- **要复现竞态**：`latency` 给某个词加延迟、`api.idle` 推进真实时间；别用固定 `sleep` 猜。

## 读代码顺序

1. `test/dom.mjs` 的 `GLOBALS`（面板能看见哪些全局）。
2. `loadPanelModule`（`__ModuleLoader__` 的捕获与 cache-bust 查询串）。
3. `internals` 的导出。
4. `mergeStore` / `sameIds`。
5. `createHost` 的分支，尤其 `/store` 与 `/dict`。
6. `launchPanel` 的假 `ctx`、`props` 与 `api`。