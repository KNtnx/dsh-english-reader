# edge-engine

## 职责

worker 里的 Edge 路径：加载 `msedge-tts`、拿音频流与 metadata 流、把 metadata 里的 WordBoundary 抽成 `{text, at, dur}` 的毫秒 marks，连同 base64 音频一起回给宿主。

## 位置

- `worker.mjs` :: `loadEdge`, `handle`, `collect`, `collectMarks`, `takeMetadataFrame`, `pushFrameMarks`
- `host/constants.js` :: `EDGE_VOICE`

## 输入 → 输出

宿主发 `{ op: 'edge', id, text, voice }`；`handle` 返回 `{ ok: true, type: 'audio/mpeg', audio: '<base64>', marks }`。

| 步骤 | 代码 | 事实 |
| --- | --- | --- |
| 加载 | `loadEdge` | `require('msedge-tts')`；`MsEdgeTTS` 不是函数就报错，并在消息里列出实际导出键 |
| 配置 | `setMetadata` | 音色 + `OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3` + `wordBoundaryEnabled: true` |
| 出声 | `toStream(text)` | 同时给 `audioStream` 与 `metadataStream` |
| 收音频 | `collect` | 累积 Buffer；`end` / `close` 结算；30 秒超时；0 字节是错误 |
| 收 marks | `collectMarks` | 缓冲后按完整 JSON 对象切；`end` / `close` / `error` 都结算 |

marks 的形状是 `{ text, at, dur }`，单位毫秒：源数据是 100ns，`Math.round(值 / 10000)`。只收 `Type === 'WordBoundary'` 的条目，文本取自 `Data.text.Text`。

## 不变量

- **音频与 marks 必须一起等**：`Promise.all([collect(audioStream), collectMarks(metadataStream)])`；音频失败时 marks 无用，整次合成失败。
- **metadata 不能按 chunk 解析**：它是一串首尾相接的 JSON 对象，可能在任意字节处被切开。`takeMetadataFrame` 用括号/引号感知的扫描找完整帧，字符串里的 `}` 不会提前闭合。
- **坏帧只跳过，不致命**：`pushFrameMarks` 的 `try/catch` 只丢这一帧；半个流不值得让整句失败。
- **超时在两侧都有**：worker 的 `collect` 30 秒、宿主的 `ask` 45 秒；worker 先到，错误信息是 `Edge synthesis timed out`。
- **空音频是错误**：`collect` 在 0 chunk 时 reject `Edge synthesis returned no audio`，不当作静音成功。
- **Edge 请求不排队**：worker 只把 `local` / `preload` 放进 `localQueue`；多个 Edge 请求可以同时在飞（面板对同一句去重，但「预取下一句」与「点这一句」仍可能并行）。
- **音色由上游校验**：`EDGE_VOICE` 正则（`xx-XX-...Neural`）在 `20-routes/speech-routes` 里，worker 不重复检查。

## 相邻模块

- 上游：`worker-protocol`（stdin 循环 → `handle`）、`synthesis-entry`（`ask` 的 edge 分支）。
- 下游：`20-routes/speech-routes` 的 `speechResponse`（marks 编码进 `x-er-marks`，超过 `MAX_HEADER_MARKS` 就丢弃）。
- 消费方：`10-panel/word-alignment`（`decodeMarks` → `buildTimings`）；`10-panel/playback` 用它做句内高亮。
- 对照：`kokoro-engine`（同一 worker 的另一条路）。

## 改这里时

- **改输出格式**：`OUTPUT_FORMAT` 换成别的采样率/码率时，面板的逐词高亮不受影响（时间戳与容器无关），但文件名后缀与 `type` 要对上。
- **改 marks 单位**：面板与 `buildTimings` 都假设毫秒；如果改成别的单位，`takeMetadataFrame`、路由头、面板三处一起改。
- **收更多边界类型**：`pushFrameMarks` 现在只认 `WordBoundary`；加 `SentenceBoundary` 时要决定它进不进 marks 表。
- **改超时**：`collect` 的 30000 与宿主 `ask` 的 45000 是两层；只改宿主会让慢请求永远等到 worker 先报错。

## 读代码顺序

1. `loadEdge`：模块加载与导出检查。
2. `handle` 的 `op === 'edge'` 分支（四行，全文最密）。
3. `collect`：音频流与 30 秒超时。
4. `takeMetadataFrame`：括号/引号感知的扫描。
5. `pushFrameMarks`：字段过滤与单位换算。
6. `collectMarks`：缓冲、drain、三种结算事件。