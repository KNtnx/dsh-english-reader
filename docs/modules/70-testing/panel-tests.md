# panel-tests

## 职责

七组「像用户那样操作」的用例：真 `client.js`、真 React、真事件，只把浏览器换成 jsdom、把宿主换成 `createHost`。它们管状态机、竞态、事件与视图收值——也就是「组件能渲染」之外的那一半。

## 位置

- `test/panel.smoke.test.mjs` :: `launchPanel`, `FIXTURE_STATE`, `assertHealthy`, `SAVED`
- `test/panel.dict.test.mjs` :: `wordSpan`, `expandSavedWord`, `SAVED_DREAM`, `TACKLE_ROW`
- `test/panel.translate.test.mjs` :: `stateWith`, `LINES`, `shownLines`, `translateCalls`, `internals`
- `test/panel.playback.test.mjs` :: `playButton`, `ttsCalls`
- `test/panel.settings.test.mjs` :: `openSettings`, `sectionToggle`, `SOURCE_STATE`, `assertHealthy`
- `test/panel.folders.test.mjs` :: `openLibrary`, `openWords`, `chips`, `chipTexts`, `chip`, `createFolder`, `moveRow`, `rowTitles`, `wordTitles`
- `test/panel.sync.test.mjs` :: `openWords`, `storeReads`, `HOST_STATE`, `internals`

## 输入 → 输出

| 组 | 条数 | 管什么 |
| --- | --- | --- |
| `panel.smoke` | 10 | 装载与导航：保存的对话能显示、上一句/下一句、位置被记住、词表过滤、库列表并打开、设置卡开合与 Esc、空面板进编辑器、引擎段、中文界面、自定义宽度 |
| `panel.dict` | 19 | 右键词卡：取词、保存、展开已存词、慢答案不覆盖新查询、钉住的查词卡、拖动、中/双语/模型缓存键、词卡位置、标点词的存取、列表自动补释义 |
| `panel.translate` | 4 | 译文来源：别人的来源被替换、同来源复用、切源替换屏幕、隐藏时按新源取 |
| `panel.playback` | 6 | 播放：请求当前句、换句合成、502 上报、片段缓存、换音色重读、跟随开关 |
| `panel.settings` | 6 | 设置卡里的延迟分支：自定义字号、四段各开一次、重命名音源、Collins key、目录选择器、从词表页开卡 |
| `panel.folders` | 7 | 夹子：新夹进过滤条、两类条目归档后的 All/未分类、删夹回未分类、孤儿夹、刷新后仍在、确认删除可撤销 |
| `panel.sync` | 5 | 宿主变了：新增/删除不刷新即见、自己的写不回头、被纠正立刻读回、宿主词典设置回填 |

共同手法：

- `assertHealthy(api, where)`：DOM 里没有 `failed to render`，`api.errors` 为空。
- 一切操作走 `api.click`/`rightClick`/`type`/`key`/`choose`，每一步都在 `act` 里派发真实事件，然后 `settle`。
- 时间用 `waitFor(条件)`（默认 3 秒）与 `idle(ms)`；`panel.sync` 在文件顶部把 `internals.sync.pollMs` 改成 20ms。
- 断言尽量落在用户能看见的东西上：`aria-label`、可见文字、`aria-checked`/`aria-pressed`。

## 不变量

- **一个历史 bug 一条守护用例，用例名写用户看到的现象**：`panel.dict` 里「the card opens at the word that was clicked」「a slow answer never lands on top of a newer lookup」「Chinese-only mode never prints an English gloss in the list」；文件头的注释写明这条是哪里报的。
- **每条用例自己 `unmount`**（放在 `finally`）：React 根、`console.error`、DOM 容器都靠它清干净。
- **不断言布局**：jsdom 没有排版引擎，只能断言算出来的 `style.left`/`style.top`；「放不放得下」仍然要人看。
- **假宿主只答它认识的路由**：新请求会 404，先补 `createHost`，否则失败点会落在很远处。
- **同步组用 `host.write` 制造「别人改了库」**：直接改 `api.host.store` 不推 revision，面板不会察觉。
- **轮询是全局状态**：`panel.sync` 在文件顶部把 `internals.sync.pollMs` 改成 20ms；单条用例临时改，就在 `finally` 里恢复原值（文件里最后一条这么做了）。

## 相邻模块

- `harness`：`launchPanel`、`createHost`、`api` 与 `internals` 都从那里来。
- 被测模块：`smoke` → `10-panel/views` + `panel-shell`；`dict` → `10-panel/word-card`；`translate` → `10-panel/text-pipeline` + `50-dictionary/translate-providers`；`playback` → `10-panel/playback`；`settings` → `10-panel/views`；`folders` → `10-panel/shared-store`；`sync` → `10-panel/host-sync`。
- `docs/TESTING.zh.md` 的「历史 bug 与守护用例」表：更全的对照。
- `60-tool`：`sync` 组的「模型写了库」就是 `english_reader` 的形状。

## 改这里时

- **加一个视图**：`panel.smoke` 里点进去、断言一个可见文本；再跑 `views.test.mjs` 确认新视图收到的值都在 `ui` 里。
- **修一个面板 bug**：先写一条会红的用例，名字用用户的原话（注释里写 "reported from the browser: …"）。
- **加一条同步路径**：`panel.sync` 加一条，并在 `finally` 里把 `pollMs` 恢复。
- **要复现竞态**：`host.latency` 给某个词加延迟，配 `api.idle` 推进时间；不要用固定 `sleep` 猜。
- **测试要变快**：优先等条件（`waitFor`），不要加大固定等待。

## 读代码顺序

1. `panel.smoke` 的 `assertHealthy` 与第一条装载用例。
2. `panel.dict` 的 `expandSavedWord`（怎么去词表页再回来）。
3. `panel.sync` 的 `storeReads` 与 `host.write`。
4. `panel.folders` 的 `createFolder`/`moveRow`（夹子怎么被操作）。
5. `panel.settings` 的 `openSettings`。
6. `panel.translate` 的 `stateWith` 与 `panel.playback` 的 `ttsCalls`。