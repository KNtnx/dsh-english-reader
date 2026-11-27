# speech-routes

## 职责

语音这一侧的五个入口：合成一段音频（`/tts`）、管理自定义语音源（`/tts/sources`）、列一份可选音色（`/tts/voices`）、在用户点「保存」前试连一次（`/tts/validate`）、列出某个端点自带的模型（`/tts/models`）。它们只做校验与转发，真正的合成在 `host/speech.js` 与子进程里。

## 位置

- `host/routes.js` :: `handleTts`, `ttsProvider`, `ttsVoice`, `ttsTarget`, `ttsRefusal`, `speechResponse`, `speechFailure`, `handleSources`, `sourceRecord`, `saveSource`, `handleVoices`, `endpointVoices`, `absorbVoices`, `manualVoices`, `clonedVoices`, `absorbClonedVoices`, `handleValidate`, `endpointVerdict`, `handleModels`, `listEndpointModels`, `modelsResponse`
- `host/constants.js` :: `MAX_TEXT`, `EDGE_VOICE`, `LOCAL_VOICES`, `MAX_HEADER_MARKS`
- `host/files.js` :: `publicSource`, `findSource`, `resolveKey`
- `host/speech.js` :: `synthesize`, `synthesizeApi`, `firstThatAnswers`, `orderedCandidates`, `isSpeechModel`, `resolvedUrls`, `hasModel`, `checkModelPath`, `local`

## 输入 → 输出

| 路由 | 输入 | 输出 |
| --- | --- | --- |
| `GET /tts` | query `provider`、`voice`、`text`、`sourceId`、`modelPath` | 音频字节 + `content-type` + 可选 `x-er-marks`（base64 的 marks）；本地引擎缺失时 503 `{code:'engine-missing'}` |
| `GET /tts/sources` | 无 | `{sources: publicSource[]}`，**没有 `key`，只有 `hasKey`** |
| `POST /tts/sources` | JSON `{id, name, protocol, baseUrl, model, voiceA, voiceB, customVoices, key}` | `{ok, source}`；省略的字段保留旧值 |
| `DELETE /tts/sources?id=` | 源 id | `{ok: true}`，不存在也算成功 |
| `GET /tts/voices` | query `baseUrl`、`key`、`sourceId`、`protocol` | `{ok, voices, cloned, listed}`，每个音色带 `origin` |
| `POST /tts/validate` | JSON `{kind:'local', modelPath}` 或 `{protocol, baseUrl, model, voice, key, sourceId}` | `{ok}` / `{ok:false, code}`，端点那条还带 `keySource` |
| `GET /tts/models` | query `baseUrl`、`key`、`sourceId`、`protocol` | `{ok, models, filtered, total}`，失败给 `code` + `detail` |

`/tts` 的处理顺序不是按「便宜」排的：先定 `provider`（custom 时 `findSource`，找不到 503 `not-configured`）→ 组装目标（显式 `modelPath` 会先在盘上校验，非法就变 `null`）→ `ttsRefusal` 逐条拒绝：空文本 400 → 超 `MAX_TEXT` 413 → local 音色不在 `LOCAL_VOICES` 400 → 正在下载 503 `preparing` → `modelPath` 为 `null` 400 `bad-model-path` → 路径为空且没装模型 503 `not-installed` → Edge 音色不合 `EDGE_VOICE` 400。全部通过才进 `synthesize`；抛错统一 502，但**本地引擎未安装**（`engine-missing`）改回 503 `{code:'engine-missing'}`，本地还会把错误与 code 记进 `local.error` / `local.code`。

## 不变量

- **密钥不进浏览器**：`/tts/sources` 的 GET 与 POST 响应都过 `publicSource`；`/tts/voices`、`/tts/validate`、`/tts/models` 只在宿主侧用 `resolveKey` 借出已存的 key，回给面板的最多只有 `keySource`（`request` / `stored` / `none`）。
- **省略字段 ≠ 清空字段**：`saveSource` 只覆盖传了的键。`key` 尤其如此——没传或传空串都沿用旧值，**所以这条路由没法清空 key**（要清就删源或直接改文件），换来的是「改个名字不会把密钥弄丢」。
- **一次合成只用一个引擎**：`ttsProvider` 把未知的 `provider` 一律当 `edge`，不降级、不串联；`provider === 'custom'` 但源不存在的请求直接 503，不会偷偷用 Edge 读。
- **下载中不排队**：`local.phase === 'downloading'` 时 `/tts` 立刻 503 `preparing`，不然面板会卡在一句读十秒的表象里。
- **引擎缺失是 503 带 code，不是 502**：`speechFailure` 只对这一种 failure 改状态码，面板按 `code` 显示「本地引擎未安装」；其它合成失败仍是 502 纯文本，两者不要揉成一个。
- **marks 可有可无**：超过 `MAX_HEADER_MARKS` 时丢 header 不报错，面板回落到按时长估算（见 `10-panel/word-alignment`）。
- **`/tts/models` 会过滤**：端点列出的模型里 `isSpeechModel` 命中的优先，全都不像语音模型时才原样返回全部，并用 `filtered` 说明过滤发生过。

## 相邻模块

- 上游调用者：`10-panel/playback`（每句一次 `/tts`）、`10-panel/panel-shell`（`ReaderBody` 里的语音源状态：音色、保存/删除、试连、模型列表）。
- 下游实现：`40-speech`（`synthesize`、`synthesizeApi`、worker 与本地模型）。
- 对端数据：`30-store/secrets`（`sources.json` 的读写与 0600）、`30-store/paths-and-limits`（`MAX_TEXT` 等上限）。

## 改这里时

- **加一个引擎**：`ttsProvider` 加分支 + `ttsVoice` 的默认音色 + `ttsRefusal` 的校验 + `synthesize` 的分发，四处缺一处就会「能选但不能读」。
- **加一个拒绝码**：`ttsRefusal` 的 JSON 503（`preparing` / `not-installed`）与 `speechFailure` 的 `engine-missing` 是两条路；面板 `clipFor` 只按 `code` 分派，新增码要同步面板分支与 DICT 文案。
- **改音色枚举**：`LOCAL_VOICES` 在 `host/constants.js`，`client.js` 有一份同名副本用于界面；两份不一致时，界面能选、宿主拒绝。
- **加源字段**：`sourceRecord`（读旧值）+ `publicSource`（决定是否暴露）+ `saveSource`（校验）三处一起改，再补一例「省略字段保存后还在」的用例。
- **改试连语义**：`endpointVerdict` 用 `synthesizeApi('ok', …)` 真合成一个短词，12s 超时；换成只 ping 端点会把「密钥错」漏过去。
- **动 `/tts/models` 的超时**：`listEndpointModels` 外面是 15s AbortController，`clonedVoices` 自己还有 12s——两层不要合成一层。

## 读代码顺序

1. `handleTts`（最短的一条主流程）。
2. `ttsProvider` → `ttsVoice` → `ttsTarget` → `ttsRefusal`：四个小函数把「请求」变成「可合成 / 该拒绝」。
3. `speechResponse` 与 `speechFailure`：响应头与 502 的形状。
4. `handleSources` → `saveSource` → `sourceRecord`：文件那一侧的写入规则。
5. `handleVoices` 的四段（endpoint / manual / cloned / 合并），最后看 `handleValidate` 与 `handleModels` 的 timeout 处理。