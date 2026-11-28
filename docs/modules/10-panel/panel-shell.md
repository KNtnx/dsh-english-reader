# panel-shell

## 职责

`ReaderBody` 是面板的外壳：所有 `useState`／`useCallback` 在这里，`ui` 对象在这里组装，键盘、拖拽、尺寸测量也在这里。视图与 hook 都只是它的零件。

## 位置

- `client.js` :: `ReaderBody`, `ui`, `view`, `returnView`, `goView`, `onKeyDown`, `startCardDrag`, `rootRef`, `pageBox`, `effectiveScale`, `startResize`
- `client.js` :: `startReading`, `editActive`, `editItem`, `cancelEditor`（编辑器与保存）
- `client.js` :: `Reader`, `ReaderBoot`

## 输入 → 输出

- 输入：`boot`（`ReaderBoot` 读回来的共享状态）与 `props`（`localeSource`、`pickDirectory`）。
- 状态分四类：
  1. **库与位置**：`items`、`activeId`、`index`、`words`（来自 `useSharedStore`）；
  2. **播放设置**：`voiceA`、`voiceB`、`rate`、`loop`、`autoNext`、`autoScroll`、`provider`；
  3. **显示**：`columnWidth`、`fontScale`、`customPct`、`customPx`、`editingWidth`、`editingFont`；
  4. **界面**：`view`（`reader` / `editor` / `words` / `library`）、`settingsOpen`、`addOpen`、`card`、`folderFilter`、`openWordId`。
- 输出：`ui` 对象（200+ 个键）交给 13 个视图；`h('div', { className: 'er-root' }, …)` 一次性渲染整棵树。
- 尺寸测量：`ResizeObserver` 观察 `rootRef`，写入 `panelWidth` / `panelHeight`，再算出 `columnActual` 与 `pageBox`。
- 键盘：`onKeyDown` 绑在 `.er-root` 上——空格播放/暂停、左右方向键上一句/下一句；有卡片或弹窗打开时不抢键。
- 拖拽：`startCardDrag` 只在卡片头部/握把触发，边界钳制在视口内。

## 不变量

- **它自己不能调 hook**：`ReaderBody` 是被 `Reader` 当普通函数调用的（为了错误边界能抓住渲染异常），外壳里再加 `useState` 会违反 hook 规则。新增状态请放进 `useSharedStore` / `usePlayback` / `useWordCard`，或新建 hook。
- **`ui` 是唯一出口**：视图不许闭包捕获状态变量，所有 `setter` 与派生值都经 `ui` 传下去——这也是 `test/views.test.mjs` 能静态检查的前提。
- **`view` 切换不动数据**：`goView` 只换视图；`returnView` 记住「从哪个页进来的」，返回时回到原页。
- **编辑器只改正文，不改名字**：`startReading` 保存已有对话时沿用 `item.title`，只有本来没有标题的旧条目才用 `titleFor(draft)` 补一个。
- **一个 `<audio>` 元素挂在最外层**：跨视图保留，切页不断播。
- **`Reader` 是错误边界**：渲染抛错时显示堆栈，而不是白屏。

## 相邻模块

- 上游：`00-loading/client-registration`（`ReaderBoot` 被注册成面板体）、`10-panel/shared-store`、`10-panel/playback`、`10-panel/word-card`。
- 下游：`10-panel/views`（全部 13 个）、`10-panel/styles`。
- 邻居：`10-panel/host-sync`（`applyHostDictionary` 在壳里转交给设置状态）。

## 改这里时

- **加一个状态**：先判断它属于哪一类（库/播放/显示/界面）。库相关进 `useSharedStore`，播放相关进 `usePlayback`，只有纯界面状态才留在壳里。
- **加一个快捷键**：`onKeyDown` 的守卫顺序是「弹窗/卡片 → 输入框 → 播放键」；新键要放在同样的守卫之后。
- **改宽度/字号公式**：`columnActual`、`pageBox`、`effectiveScale` 三处是一个整体，`customPct` 是「占面板的百分比」，`customPx` 是「绝对字号」。
- **拆这个函数**：它是全仓库最重的一处（1,515 行 / 圈复杂度 370）。合并方向是「再抽 hook」或「再抽视图」，不要拆文件（单 bundle 无构建）。

## 读代码顺序

1. `ReaderBoot`（怎么拿到 `boot`）。
2. `Reader`（错误边界）。
3. `ReaderBody` 开头三行 hook 调用（`useWordCard` / `useSharedStore` / `usePlayback`）。
4. `ResizeObserver` 那段测量。
5. `onKeyDown`。
6. `startCardDrag`。
7. `const ui = {…}`（按字母扫一遍，找你要的值）。
8. 末尾的 `body` 与 return。