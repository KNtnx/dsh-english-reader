# word-alignment

## 职责

两件对齐工作：把一句话切成**可点击的词元**（右键查词、逐词高亮都基于它），把语音引擎报的边界 marks 变成**每个词的起始时间**（句内跟读高亮）。

## 位置

- `client.js` :: `wordsOf`, `normalizeWord`, `buildTimings`, `decodeMarks`, `sensesOf`

## 输入 → 输出

| 函数 | 输入 | 输出 | 规则 |
| --- | --- | --- | --- |
| `wordsOf(text)` | 一句 | 词元数组 | 只按空白切；标点留在词里（`"stop!"` 是一个词元） |
| `normalizeWord(value)` | 词元 | 小写、只留 `a-z0-9'` | 与引擎 marks 里的文本对齐用的规范化 |
| `buildTimings(words, marks, durationMs)` | 词元 + marks + 音频长度 | 每个词的起始毫秒 | 有 marks 时按**规范化文本**匹配（不是按下标）；没有 marks 时按词长分配整段时长 |
| `decodeMarks(value)` | 响应头里的 base64 | `[{text, at, dur}]` | 解析失败返回 `[]` |
| `sensesOf(value)` | 库里的旧数据 | 统一形状的义项数组 | 早版本存的是字符串，这里兼容 |

## 不变量

- **按下标对齐是错的**：Edge 的 marks 是按「说的话」给的，`left—but` 是两个 mark，`"stop!"` 是一个词元；所以 `buildTimings` 必须按文本消耗 marks，不能 `marks[i]`。这条在注释里写着，改之前先读。
- **没有 marks 也不能没有高亮**：本地 Kokoro 不给 marks，回落是按词长分配；`durationMs` 未知时用 `max(1200, 长度 × 62)` 估。
- **`wordsOf` 不做语义处理**：它输出的就是屏幕上渲染的块，渲染与高亮必须用同一份，否则下标错位。
- **`normalizeWord` 只做规范化**，不查词、不改原文。

守护：`test/internals.test.mjs`「speech marks line up with the words that were rendered」「without marks the words are spread over the clip by length」。

## 相邻模块

- 上游：`10-panel/text-pipeline`（句子）、`20-routes/speech-routes`（响应头里的 marks）。
- 下游：`10-panel/playback`（用 timings 高亮当前词）、`10-panel/word-card`（右键取词元）。
- 数据形状：marks 由 `40-speech/edge-engine` 产生。

## 改这里时

- **改词元切分规则**：`wordsOf` 是渲染与高亮的共同来源，改它要同时看 `renderLine`；补一条 internals 用例。
- **换一个不发 marks 的引擎**：确认 `buildTimings` 的回落路径被走到（`marks.length === 0`）。
- **marks 格式变了**：改 `decodeMarks` 与 `40-speech` 里写响应头的那一侧，两边必须同时改。

## 读代码顺序

1. `wordsOf`（切分只有一行）。
2. `normalizeWord`。
3. `buildTimings` 的 marks 分支（按文本消耗）。
4. 同一函数的回落分支（按长度分配）。
5. `decodeMarks`。