# custom-endpoints

## 职责

用户自带的语音端点：OpenAI 兼容的 `/audio/speech`、Azure 的 SSML 接口、阿里 DashScope 的原生生成接口。这里定义三种请求形状、地址候选与探测、失败信息怎么拼；密钥由路由层解析好传进来。

## 位置

- `host/speech.js` :: `synthesizeApi`, `synthesizeCustom`, `synthesizeAzure`, `synthesizeDashscope`, `endpointCandidates`, `dashscopeCandidates`, `requestDashscope`, `escapeXml`, `resolvedUrls`, `resolvedProtocols`
- `host/constants.js` :: `PROTOCOLS`

## 输入 → 输出

`settings` 是路由层（`endpointVerdict`、`handleTts`）拼好的对象：`{ protocol, baseUrl, model, voice, format, key }`；`key` 已含「请求里给的」或「存下来的」。

| protocol | 函数 | 请求 | 音频从哪来 |
| --- | --- | --- | --- |
| `openai`（及未知值） | `synthesizeCustom` | JSON `{input, response_format}`，可选 `model` / `voice`，`authorization: Bearer` | 响应体直接是音频 |
| `azure` | `synthesizeAzure` | SSML 字符串，`ocp-apim-subscription-key` 头 | 响应体直接是音频 |
| `dashscope` | `synthesizeDashscope` | JSON，两种 body 形状轮流试 | 先 `output.audio.data`（base64），否则 `output.audio.url` 再下载 |
| `auto` | `synthesizeAuto` | 依次试 dashscope 与 openai | 同上 |

```
endpointCandidates("https://api.x.com", 'speech')
  → https://api.x.com/audio/speech
    https://api.x.com/v1/audio/speech
    https://api.x.com/compatible-mode/v1/audio/speech

endpointCandidates("https://api.x.com/v1", 'speech')
  → https://api.x.com/v1/audio/speech
    https://api.x.com/v1/compatible-mode/v1/audio/speech   ← 仍会多拼一条
```

候选只做两件事：补资源名（`audio/speech` 或 `models`）、补版本前缀；地址本身已经以资源名结尾时只回一条。最后一个候选只看「地址里没有 `compatible-mode`」，所以带 `/v1` 的地址也会被拼一条，前缀能答就不会走到它。

## 不变量

- **协议只有四个合法值**：`PROTOCOLS = ['auto','openai','azure','dashscope']`；`synthesizeApi` 对任何非 azure / dashscope / auto 的值都按 OpenAI 兼容处理——存进来的脏值不会让请求失败，只会按默认形状发。
- **密钥不进 URL、不进日志**：Bearer 或 Azure 头由 `settings.key` 给出；失败信息里只有服务名、状态码与截断到 160 字的响应正文。
- **401 / 403 在 `firstThatAnswers` 里直接放弃**：凭据错了，再猜十个地址也没用。DashScope 的实现只在当前地址上跳过第二套 body，外层仍会试下一个候选——错误里因此可能出现两三条同因失败。
- **DashScope 不能走 OpenAI 兼容前缀**：那个前缀只服务 chat 与 embeddings；原生路径是 `/api/v1/services/...`，而且回复常常不是音频而是链接。
- **`resolvedUrls` / `resolvedProtocols` 只是建议**：写在成功之后，读在请求之前；重启即忘，记错了也只是多试一次。
- **Azure 的正文必须是 SSML**：音色与文本都要 `escapeXml`，否则一个 `&` 就让整句 400；`x-microsoft-outputformat` 默认 `audio-24khz-48kbitrate-mono-mp3`。
- **空音频是错误**：OpenAI 兼容与 Azure 都检查 0 字节，DashScope 的下载路径检查 0 字节；DashScope 既没有 `data` 也没有 `url` 时报 `returned no audio`。

## 相邻模块

- 上游：`20-routes/speech-routes` 的 `handleTts`（`provider=custom`）、`endpointVerdict`（「验证」按钮）、`listEndpointModels`（`/tts/models`）。
- 下游：`clip-cache`（写 `resolvedUrls` / `resolvedProtocols`）、`30-store/secrets`（`resolveKey` 把存储的 key 交给这里）。
- 邻居：`synthesis-entry`（`synthesize` 的 custom 分支）、`local-model`（另一种自带源）。

## 改这里时

- **加一种协议**：`PROTOCOLS` 加值 → `synthesizeApi` 加分支 → 面板的协议下拉 → `endpointVerdict` 的默认值；少一处，面板能存但合成会掉进 OpenAI 兼容。
- **改候选顺序**：`endpointCandidates` 的返回顺序就是尝试顺序；`orderedCandidates` 会把上次答通的提到最前，所以「最坏情况」由这里决定。
- **改错误文案**：面板把 502 的正文原样显示；`endpointFailed` 的 `detail` 已经是 160 字截断，不要把密钥拼进去。
- **换 Azure 输出格式**：`format` 为空时走默认 MP3；换 `audio-16khz-...` 前先确认面板播放器不需要改。

## 读代码顺序

1. `synthesizeApi`：四行分派，先看它。
2. `endpointCandidates` 与 `orderedCandidates`：地址是怎么猜的。
3. `synthesizeCustom`：`firstThatAnswers` 的用法与成功后的记录。
4. `synthesizeAzure`：SSML 与两个头。
5. `synthesizeDashscope`：两套 body、两套音频来源。
6. `requestDashscope`：`content-type`、`data`、`url` 三种返回。
7. `synthesizeAuto` 的探测顺序与 `resolvedProtocols`。