# styles

## 职责

整份面板样式，作为 `Styles()` 组件渲染成一个 `<style>` 元素——面板卸载时样式跟着消失，不会污染宿主页面。没有任何外部 CSS 文件，也没有 CSS-in-JS 库。

## 位置

- `client.js` :: `Styles`, `ICON`, `glyph`, `glyphLine`, `HEADSET_BOX`, `GuideGlyph`, `PanelIcon`, `Launcher`

## 输入 → 输出

- `Styles()` 返回 `h('style', null, css)`，由 `ReaderBody` 挂在 `.er-root` 里。
- 类名前缀统一 `er-`：`er-root`（外层）、`er-column`（阅读栏）、`er-entry`（对话行）、`er-wrow`（单词行）、`er-folders` / `er-folder-chip`（夹子条）、`er-card`（卡片）、`er-seg` / `er-seg-btn`（分段控件）、`er-glyph`（图标按钮）。
- 主题：颜色全部走宿主变量 `--dsw-alias-*`、字号走 `--dsh-*-font-size`，都带兜底值（`var(--dsw-alias-bg-base, #fff)`）。
- 字体：`.er-root` 用 `var(--dsw-font-family, inherit)` 跟随 DSH 正文字体（也跟随用户在设置里选的文本字体、以及 claude-style 的类型选择）；阅读行的译文 `.er-trans` 用 `inherit`，不写死字族。词典卡片与单词列表的中文仍用宋体栈（`er-wordcard-tr`、`er-wrow-zh`），那是有意的排版。
- 缩放：`ReaderBody` 在 `.er-root` 上写 `--er-scale`，样式里用 `calc` 乘出来，字号只在这一处生效。
- 图标：`ICON` 是 24×24 的 path 表；`glyph()` 用 `fill` 画**闭合**路径，`glyphLine()` 用描边画线稿——两者不能混用。

## 不变量

- **只用宿主主题变量，不写死颜色**：写死了，暗色主题下就有一块白。
- **正文字体只继承，不写死字族**：`.er-trans` 曾经钉了 `Georgia/Songti/SimSun` 栈，结果 claude-style 和系统字体都跟不动；现在两端都继承 `--dsw-font-family`（`test/copy.test.mjs` 守着）。
- **`glyph()` 只填充**：给一个开放路径会得到 0 面积（跟随图标曾经就是这样"消失"的）。线稿图标必须走 `glyphLine`。
- **类名是契约**：测试直接按 `.er-wrow`、`.er-folder-chip[data-folder]` 之类的选择器取元素；改类名要同步改 `test/panel.*.test.mjs`。
- **所有类都带 `er-` 前缀**：面板挂在宿主页面里，不加前缀会撞宿主的样式。
- **不在样式里写 `@media` 断点依赖**：宽度是面板自己量的（`pageBox` / `columnActual`），不是视口。

## 相邻模块

- 上游：`10-panel/panel-shell`（渲染 `<style>` 并写 `--er-scale`）。
- 下游：`10-panel/views`（视图只写类名，不写内联样式，除少数几何值）。
- 邻居：`00-loading/client-registration`（`PanelIcon` / `Launcher` 的图标也在这里定义）。

## 改这里时

- **改配色**：只换 `var(...)` 的兜底值，主色仍然跟随宿主。
- **加一个类**：写进 `Styles()` 的字符串里，同时保证前缀 `er-`；需要被测试选中时，配一个 `data-*` 属性更稳。
- **加一个图标**：`ICON` 里加路径 → 检查是否闭合（填充）或用 `glyphLine`；`test/copy.test.mjs` 会检查图标表存在且路径里有 `z`（闭合标记）。

## 读代码顺序

1. `Styles()` 开头 5 行（`.er-root` 与主题变量）。
2. `--er-scale` 的用法（`calc`）。
3. 分段控件 `.er-seg` 与卡片 `.er-card`（最常被复制的一段）。
4. `ICON` 表与 `glyph` / `glyphLine` 的差别。
5. `PanelIcon` / `Launcher`（宿主列表与输入框里的小图标）。