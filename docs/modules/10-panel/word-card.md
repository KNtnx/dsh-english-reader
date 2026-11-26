# word-card

## 职责

右键正文任意一个词时出现的那张卡片：位置（跟随鼠标或被钉住）、请求令牌（后到的结果不能盖住新的）、词条从哪来（缓存 → 词典 → 翻译兜底）、收藏按钮与三个喇叭。

## 位置

- `client.js` :: `useWordCard`, `lookUp`, `openWordCard`, `openPinnedWord`, `closeCard`, `cardTokenRef`, `renderWordCard`, `startCardDrag`, `cardRef`

## 输入 → 输出

- `useWordCard({ resolveWord, translateSource, translateOptions, translateModel, t })` 返回 `{ card, cardRef, cardEntry, cardState, cardError, query, lookUp, openWordCard, openPinnedWord, closeCard }`。
- `card` 形状：`{ word, x, y, pinned }`——坐标是**视口坐标**，不是面板内坐标。
- `cardState` 五态：`idle` → `loading` → `ready` | `missing` | `failed`。
- 解析顺序：`resolveWord(word)`（缓存/词典，由 `panel-shell` 提供）→ 查不到就 `POST /translate` 兜一个译文 → 还是没有就 `missing`。
- 打开方式：`openWordCard`（右键，跟随指针）、`openPinnedWord`（顶部「查单词」框，钉在右上角）。

## 不变量

- **令牌递增**：每次 `lookUp` 先 `cardTokenRef.current += 1`，所有 `await` 之后比对；不等就丢弃。慢的旧请求绝不能落到新卡上。
- **坐标是视口的**：卡片用 `position: fixed` 渲染，所以 `cardHeight` 之类的尺寸必须传进视图——曾经因为漏传，`top` 变 `NaN`，卡片飞到了页面顶部。
- **一次只开一张卡**：`card` 是单值；右键另一处是替换，不是叠放。
- **收藏按钮是开关**：已收藏时文案变「已收藏」，再点一次取消收藏（走 `dropWord`），不是禁用。
- **卡片可拖**：拖动只能从卡片头部或左侧握把开始（`startCardDrag`），否则会抢走正文的选词。

守护：`test/panel.dict.test.mjs`（卡片位置、慢结果、展开不抢占、收藏去标点、列表跟随词典）、`test/views.test.mjs`。

## 相邻模块

- 上游：`10-panel/panel-shell`（提供 `resolveWord`、`t`、翻译来源）、`10-panel/shared-store`（`words` / `saveWord` / `dropWord`）。
- 下游：`20-routes/dictionary-routes`（`/dict`、`/dict/ai`）、`20-routes/translate-routes`（兜底翻译）、`10-panel/playback`（喇叭）。
- 视图：`10-panel/views` 的 `renderWordCard`。

## 改这里时

- **改解析顺序**（例如先翻译再词典）：只动 `lookUp`，并补一条「两边都查不到」的用例。
- **加一个卡片动作**（例如复制音标）：`renderWordCard` 加按钮 → `ui` 里补 handler → `copy` 加文案。
- **改卡片定位**：`openWordCard` / `openPinnedWord` 里的坐标与 `startCardDrag` 的边界钳制要一起看。

## 读代码顺序

1. `useWordCard` 的返回形状。
2. `lookUp`（令牌 → 词典 → 翻译兜底）。
3. `openWordCard` / `openPinnedWord`（两种坐标）。
4. `renderWordCard`（卡片长什么样、按钮怎么绑）。
5. `startCardDrag`（拖拽边界）。