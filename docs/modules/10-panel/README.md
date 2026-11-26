# 10 面板（浏览器半边）

**一句话**：`client.js` 是插件的整个浏览器半边——4,836 行、一个 `__ModuleLoader__` 工厂、没有构建步骤。它自己保存「本机状态」（宽度、字号、朗读位置），把「用户数据」（对话、单词、收藏夹）同时写进 localStorage 与宿主。

## 一句话

- **负责**：文案表、文本解析与断句、逐词对齐、三个 hook（共享库 / 播放 / 词卡）、13 个视图、面板外壳与手势、样式。
- **不负责**：路由怎么实现的（`20-routes`）、库怎么合并落盘（`30-store`）、语音怎么合成（`40-speech`）、词条从哪来（`50-dictionary`）。

## 代码入口

| 位置 | 符号 | 一句话 |
| --- | --- | --- |
| 文件头 26–45 行 | `STORAGE_KEY`、`TTS_PATH`、`STORE_PATH`、`STORE_REVISION`、`SYNC` | 常量与轮询间隔 |
| 113 / 356 行 | `DICT` | en / zh 两张文案表 |
| 601–860 行 | `fill`、`hashText`、`splitSentences`、`parseDialogue`、`wordsOf`、`buildTimings`、`sensesOf` | 纯函数区（无 React） |
| 919–1042 行 | `loadState`、`readFolders`、`mergeStates`、`sameLibrary` | 状态读取与合并 |
| 1134 / 1164 行 | `ReaderBoot`、`Reader` | 启动装载 + 错误边界 |
| 1183–2276 行 | 13 个 `renderX` | 视图 |
| 2276–2608 行 | `useWordCard`、`useSharedStore` | 词卡与共享库 |
| 2609–2930 行 | `usePlayback` | 播放 |
| 2931–4448 行 | `ReaderBody` | 面板外壳：状态 + `ui` 对象 |
| 4448–4836 行 | `Styles`、`PanelIcon`、`Launcher`、`apply` | 样式与注册 |

## 小模块索引

| 小模块 | 一句话 | 文档 |
| --- | --- | --- |
| copy | 两张文案表 + `t()` 取词 + `{n}` 占位 | [copy.md](./copy.md) |
| text-pipeline | 粘贴文本 → 句子数组 + 文章/对话判定 | [text-pipeline.md](./text-pipeline.md) |
| word-alignment | 句子 → 可点击词元；语音 marks → 逐词时间轴 | [word-alignment.md](./word-alignment.md) |
| shared-store | 本机状态与宿主共享库的读取、合并、落盘 | [shared-store.md](./shared-store.md) |
| host-sync | 每 2 秒比对一次库指纹，变了就拉回来合并 | [host-sync.md](./host-sync.md) |
| playback | 音频元素、片段缓存、逐句播放与逐词高亮 | [playback.md](./playback.md) |
| word-card | 右键词卡：位置、请求令牌、拖拽、收藏 | [word-card.md](./word-card.md) |
| views | 13 个 `renderX(ui)`：一屏一个函数 | [views.md](./views.md) |
| panel-shell | `ReaderBody`：全部 useState + `ui` 对象 + 手势与键盘 | [panel-shell.md](./panel-shell.md) |
| styles | `Styles()` 里的整份 CSS 与主题变量 | [styles.md](./styles.md) |

## 数据流

```
localStorage ──loadState──┐
                          ├─ mergeStates ──► items / words / folders / removed
宿主 GET /store ──────────┘                        │
                                                   ├─► renderX(ui)   （只读 ui）
                                                   └─► persist()     （350ms 防抖）
                                                          ├─ localStorage
                                                          └─ POST /store （600ms 防抖）

GET /store/revision（每 2s）──► 变了 ──► GET /store ──► adopt ──► 同样的 mergeStates
```

## 常见改动

| 需求 | 改哪个小模块 | 顺手补什么 |
| --- | --- | --- |
| 加一句提示 / 改按钮文字 | `copy` | `test/copy.test.mjs`（两端 key 必须一致） |
| 改断句规则 | `text-pipeline` | `test/internals.test.mjs` 的断句用例 |
| 加一种视图 | `views` + `panel-shell` 的 `view` 枚举 | `test/views.test.mjs`（新视图要收到它用的值） |
| 改同步频率 | `host-sync` 的 `SYNC.pollMs` | `test/panel.sync.test.mjs`（测试里把间隔调到 20ms） |
| 加一个设置项 | `panel-shell` 的状态 + `views` 的设置卡片 + `copy` | `test/panel.settings.test.mjs` |

## 风险与历史坑

- **单文件是刻意的**：没有构建步骤，拆文件就要引入打包（见 `AGENTS.md` 硬约束）。能拆的是**函数**：13 个视图与 3 个 hook 已经拆出去了。
- **`ReaderBody` 是 1,515 行、圈复杂度 370**，是整个仓库最重的一处（Archify 分析的第一条警告）；再往里加逻辑前，先考虑加视图或加 hook。
- **hook 不能乱调**：`ReaderBody` 是以普通函数被 `Reader` 调用的（为了错误边界），它自己不能再持有 hook。
- **文案两处**：界面文案在 `DICT`，插件列表文案在 `locale/*.json`——只改一处不会生效，见 `00-loading/locale-resources`。
- **历史坑**：`field is not defined`、`cardHeight` 丢参导致词卡飞到顶部、跟随图标不可见——都是「helper 放错作用域」或「值没传进视图」，现在由 `test/scope.test.mjs` 与 `test/views.test.mjs` 守着。