# synthesis-entry

## 职责

一次合成请求的总入口：先查片段缓存，再按 provider 分派——`edge` 与 `local` 交给子进程，`custom` 交给协议分派；`auto` 还会在两种协议之间探一次，并记住谁答通过。

## 位置

- `host/speech.js` :: `synthesize`, `synthesizeAuto`, `orderedCandidates`, `firstThatAnswers`, `isSpeechModel`
- `host/constants.js` :: `CACHE_LIMIT`

## 输入 → 输出

`synthesize(provider, text, voice, custom, modelPath)` → `{ body: Buffer, type: string, marks: Array<{text, at, dur}> }`。

| provider | 走法 | 超时 | marks |
| --- | --- | --- | --- |
| `edge` | `ask({op:'edge', text, voice})` | 45 秒（宿主），worker 内另 30 秒 | 有，毫秒 |
| `local` | `ask({op:'local', text, voice, modelPath})` | 180 秒 | 恒为 `[]` |
| `custom` | `synthesizeApi(...)`，协议见 `custom-endpoints` | 60 秒 `AbortController` | 恒为 `[]` |

```
synthesize(provider, text, voice, custom, modelPath)
  └─ 缓存键：provider|custom.id 或 baseUrl|modelPath|voice|text
        ├─ 命中：delete + set（刷新 LRU 顺序）→ 直接返回
        ├─ custom：synthesizeApi → 缓存 → 返回
        └─ edge/local：ask → base64 解成 Buffer → 缓存 → 返回
```

`isSpeechModel(id)` 是另一件事：它只回答「这个模型 id 看起来能不能朗读」，被 `GET /tts/models` 用来过滤端点返回的模型列表；过滤后为空时路由退回全量，并带 `filtered` 标志。它不参与实际合成。

## 不变量

- **缓存是第一条路**：命中就不碰网络、不碰 worker；键里没有 `protocol` / `model` / `key`，改这些设置不一定换片段（见 `clip-cache`）。
- **`custom` 的 voice 来自本次请求**：`synthesize` 用参数 `voice` 覆盖源记录里的音色——曾经从记录里读，角色 B 永远一个音色。
- **`edge` / `local` 的 `modelPath` 只在 local 有意义**：Edge 请求里它被忽略，但键里仍然带着它，所以换目录不会串片段。
- **cache 的淘汰只有一种**：插入后 `size > CACHE_LIMIT` 就删 Map 里最老的一条；没有 TTL、没有字节上限。
- **`synthesizeAuto` 只探两种协议**：`dashscope` 与 OpenAI 兼容，顺序看上一次记忆或地址里有没有 `aliyuncs.com` / `dashscope`；显式 Azure 不会走 auto。
- **`orderedCandidates` 只改顺序**：上次答通的 URL 排到最前，其余候选做去重保序；记住的地址失效时仍会按剩余候选重试。
- **`firstThatAnswers` 遇 401/403 提前放弃**：换路径不会让密钥变对；其余失败继续试，最后抛 `attempt.error`。

## 相邻模块

- 上游：`10-panel/playback` 的 `clipFor` 一句一次请求；`20-routes/speech-routes` 负责参数、拒绝码与响应头。
- 下游：`worker-protocol`（`ask`）、`custom-endpoints`（`synthesizeApi`）、`clip-cache`（三张内存表）。
- 兄弟入口：`local-model`（preload 与状态）、`edge-engine` / `kokoro-engine`（worker 内实际出声）。

## 改这里时

- **加一种 provider**：`synthesize` 的 `if (provider === 'custom')` 之前插入分支；同时改 `20-routes/speech-routes` 的 `ttsProvider` 与面板选项，否则用户永远选不到。
- **改缓存键**：键的拼接顺序就是「哪句会命中」的定义；加字段（例如 `protocol`）会让旧进程里的条目全部失效，属于预期。
- **换超时**：三个数字各自对应「网络 / 本机 CPU / 长下载」；local 的 180 秒是为了慢机器，别按 Edge 的尺度缩小。
- **改成流式返回**：现在是「整段合成完再一次回」，缓存与 marks 都以整段为单位；要流式得同时改路由的 `speechResponse` 与面板播放器。

## 读代码顺序

1. `synthesize` 的签名与缓存键。
2. 缓存命中时的 delete + set。
3. `custom` 分支的 `AbortController` 与 `synthesizeApi` 参数。
4. `ask` 分支的两个超时与回复解码。
5. `orderedCandidates` → `firstThatAnswers`（只在 custom 路径用到）。
6. `isSpeechModel` 的两个正则与 `20-routes/speech-routes` 的 `modelsResponse`。