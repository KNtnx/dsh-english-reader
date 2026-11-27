# playback

## 职责

一个 `<audio>` 元素、一份内存片段缓存、一句一次的合成请求，以及「播哪句、下一句是谁、当前词高亮到哪」的全部状态机。

## 位置

- `client.js` :: `usePlayback`, `speak`, `clipFor`, `prefetch`, `playAt`, `toggle`, `step`, `cancelPlayback`, `applyWord`, `audioRef`, `cacheRef`, `inflightRef`, `tokenRef`

## 输入 → 输出

`usePlayback` 收到：`stateRef`（每帧刷新的快照）、`voiceFor`、`sentences`、`wordRefs`、`index`/`setIndex`、`rate`/`loop`/`autoNext`、`voiceA`/`voiceB`、`activeSource`、`provider`、`setNoticeKey`/`setErrorKind`、`refreshModel`。

返回：`audioRef`、`status`、`sayingKey`/`setSayingKey`、`playAt`、`step`、`toggle`、`speak`、`cancelPlayback`。

| 行为 | 事实 |
| --- | --- |
| 取音频 | `clipFor(sentence)`：先查 `cacheRef`，再查 `inflightRef`（同一句只发一次），最后 `fetch(TTS_PATH)` |
| 缓存键 | 由 provider / 音色 / 文本共同决定；换音色等于换键 |
| 播放 | `playAt(target)`：取片段 → 设 `audio.src` → `play()` → 用 `buildTimings` 起一个逐词高亮的定时器 |
| 结束 | `onEnded`：`loop` 优先；`autoNext === false` 时停下并提示；否则下一句；最后一句收尾 |
| 打断 | `cancelPlayback` 递增 `tokenRef`，让在途响应作废（避免慢响应当作当前句） |
| 换音色 | 正在播就**重读当前句**；暂停中则丢掉旧片段；不在播就下次合成用新音色 |
| 朗读单词 | `speak(text, key)` 不改动阅读器状态，只出声（词卡与单词页的喇叭） |
| 本地引擎缺失 | `/tts` 回 503 `{code:'engine-missing'}` → `EngineMissingError` → 提示「本地语音引擎未安装」，Edge 不受影响 |

## 不变量

- **同一句只发一次请求**：`inflightRef` 是去重用的；去掉它，预取与点击会同时发两份。
- **`tokenRef` 必须递增**：所有异步回写前都要比对令牌，否则「上一句的响应」会盖住「这一句」。
- **`stateRef` 是快照**：所有 handler 从 `stateRef.current` 读当前值，不要闭包捕获 `index`——捕获了就会播错句。
- **一个 `<audio>` 元素**：跨视图保留，所以切到「我的单词」时正在播的句子不会断（测试守着）。
- **`autoNext` 默认连读**：关闭是显式选择，行为写在 `docs/DETAIL.zh.md`「连读开关」。

守护：`test/panel.playback.test.mjs`（7 条：重读、跳句、失败提示、可选引擎缺失、连读开关等）。

## 相邻模块

- 上游：`10-panel/panel-shell`（状态与 `stateRef`）、`10-panel/views`（播放条按钮）。
- 下游：`20-routes/speech-routes`（`/tts`）、`10-panel/word-alignment`（`buildTimings`、`decodeMarks`）。
- 邻居：`10-panel/word-card`（单词喇叭走 `speak`）。

## 改这里时

- **加一个播放控制**（例如 A/B 音色互换）：在 `usePlayback` 里加 handler，`views` 的播放条加按钮，`copy` 加文案。
- **改缓存策略**：`cacheRef` 的上限与淘汰；注意内存（片段是 ArrayBuffer）。
- **支持新的音频格式**：`clipFor` 里看 `content-type` 的用法，`audio.src` 用 blob URL。

## 读代码顺序

1. `usePlayback` 的参数与返回（形状先看全）。
2. `useLayoutEffect` 里的 `stateRef.current` 快照（哪些字段会被读到）。
3. `clipFor`（缓存 + 去重 + fetch）。
4. `playAt`（令牌、设源、逐词高亮）。
5. `onEnded` 的三条分支。
6. 换音色的那个 effect（`spokenWith` / `spokenReady`）。