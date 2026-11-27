# views

## 职责

一屏一个纯函数：`(ui) => React 元素`。视图只读 `ui`，不持有自己的状态（`editingWidth`、`folderFilter` 这类也在 `ui` 里），因此「状态在壳、渲染在视图」这条线是清楚的。

## 位置

- `client.js` :: `renderHeader`, `renderDisplayBar`, `renderList`, `renderTransport`, `renderErrorBar`, `renderEditor`, `renderLibraryPage`, `renderWordsPage`, `renderSettingsCard`, `renderAddDialog`, `renderEnginePrompt`, `renderWordCard`, `renderFolderBar`, `renderFolderPicker`

## 输入 → 输出

14 个函数，分成五组：

| 组 | 函数 | 负责 |
| --- | --- | --- |
| 外壳 | `renderHeader` | 标题、返回行、「对话库 / 我的单词」两个图标、设置胶囊 |
| 外壳 | `renderDisplayBar` | 宽度与字号的分段控件、自定义输入、「查单词」按钮 |
| 阅读页 | `renderList` | 句子列表（逐词 span、当前句高亮、右键词卡、跟随滚动） |
| 阅读页 | `renderTransport` | 播放条：上/下句、播放暂停、循环、连读、跟随、语速 |
| 阅读页 | `renderErrorBar` | 失败提示 + 重试 / 下载模型 |
| 编辑页 | `renderEditor` | 粘贴框、朗读方式、示例文本 |
| 两个列表页 | `renderLibraryPage` | 对话库：排序、置顶、编辑、重命名、删除、归类 |
| 两个列表页 | `renderWordsPage` | 我的单词：筛选框、展开释义、喇叭、归类、移除 |
| 共用控件 | `renderFolderBar` | 夹子条：全部 / 各夹 / 未分类 / 新建 |
| 共用控件 | `renderFolderPicker` | 行内的「移到哪个夹子」下拉 |
| 卡片 | `renderSettingsCard` | 四段设置（引擎/音色/字典/翻译） |
| 弹窗 | `renderAddDialog` | 添加音源对话框 |
| 弹窗 | `renderEnginePrompt` | 下载模型前确认安装本地引擎（命令、体积、只装一次） |
| 卡片 | `renderWordCard` | 右键词卡 |

调用点集中在 `ReaderBody` 的 `body` 一行：`view === 'words'` / `'library'` / `'editor'` 各走一个页面视图，其余走「列表 + 错误条 + 播放条」的阅读页。

## 不变量

- **视图不调 hook**：它们是普通函数，不符合 hook 规则就无法被条件调用；`renderSettingsCard` 曾经因为把 `field` helper 定义在自己内部，导致别的视图引用时崩（`field is not defined`）。
- **用到的每个值都必须在 `ui` 里**：`test/views.test.mjs` 静态比对「视图解构了什么 / `ui` 提供了什么」，漏传会立刻红——词卡 `cardHeight` 丢参就是这么被抓住的。
- **列表的 key 必须稳定**：句子用下标、词条用 `id`；漏 key 会触发 React 警告（`panel.smoke` 会红）。
- **一个视图一个职责**：设置卡片已经 286 行、圈复杂度 110，再往里塞功能前先拆成子视图。

## 相邻模块

- 上游：`10-panel/panel-shell`（唯一 `ui` 来源）、`10-panel/copy`（`t`）。
- 下游：无（视图不直接发请求，全部通过 `ui` 里的回调）。
- 相关：`10-panel/styles`（视图只写类名 `er-*`，样式全在 `Styles`）。

## 改这里时

- **加一个视图**：写 `renderX(ui)` → 在 `panel-shell` 的 `ui` 里补它要的值 → `body` 里接一个 `view` 分支 → `test/views.test.mjs` 会自动检查值是否传全。
- **改列表行的按钮**：注意「已武装的删除」有 `data-confirm-delete` 标记与 4 秒自动收回，别破坏（`test/panel.folders.test.mjs` 守着）。
- **加一个图标**：`ICON` 表里加路径，必须是**闭合**路径（`glyph()` 只填充不描边），并补 `test/copy.test.mjs` 的图标检查。

## 读代码顺序

1. `ReaderBody` 末尾的 `body` 一行（看清 13 个视图怎么被调用）。
2. `renderHeader` → `renderDisplayBar`（外壳）。
3. `renderList`（阅读页的核心）。
4. `renderTransport`（播放条）。
5. 列表页 `renderLibraryPage` / `renderWordsPage`（结构相似，对照读）。
6. `renderSettingsCard`（最大，按段读）。