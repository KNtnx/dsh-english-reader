# clip-cache

## 职责

宿主进程里的三张内存表：合成过的片段（`cache`）、端点地址里上次答通的 URL（`resolvedUrls`）、某个地址上次答通的协议（`resolvedProtocols`）。前一张省合成，后两张省配置。

## 位置

- `host/speech.js` :: `cache`, `resolvedUrls`, `resolvedProtocols`, `synthesize`, `synthesizeCustom`
- `host/constants.js` :: `CACHE_LIMIT`

## 输入 → 输出

| 表 | 键 | 值 | 谁写 | 谁读 |
| --- | --- | --- | --- | --- |
| `cache` | `provider\|custom.id 或 baseUrl\|modelPath\|voice\|text` | `{ body: Buffer, type: string, marks: any[] }` | `synthesize`（两条路径都写） | `synthesize` 的缓存命中 |
| `resolvedUrls` | `speech\|<用户输入的地址>`、`models\|<地址>` | 答通的完整 URL | `synthesizeCustom`、`synthesizeDashscope`、路由的 `listEndpointModels` | `orderedCandidates` |
| `resolvedProtocols` | `<用户输入的地址>` | `'dashscope'` 或 `'openai'` | `synthesizeAuto` | `synthesizeAuto` |

键长这样：`edge|||en-US-AriaNeural|They revive it.`、`local||/models/kokoro|af_heart|They revive it.`、`custom|src-1||alloy|They revive it.`。

## 不变量

- **命中要 delete + set**：`Map` 的插入顺序就是 LRU 序；只 `get` 不重插，热句会被当成最老的一条淘汰。
- **上限只有条数**：插入后 `size > CACHE_LIMIT`（64）就删第一个键；没有 TTL、没有字节上限，重启宿主才清空。
- **片段按「一句」存**：面板一次只发一句（`MAX_TEXT` 800 字符），键里直接放原文；换音色、换目录、换源 id 都会换键。
- **`custom` 的键用 id 优先**：同一地址配两个源（A/B 角色）不会互相串片段；`id` 缺失时才退回 `baseUrl`。
- **键里没有 protocol / model / format / key**：改一个源的模型、协议或密钥后，同一句、同一音色仍会命中旧片段——直到被淘汰或重启。要立刻生效，改源 id。
- **地址记忆按 kind 分开**：`speech` 与 `models` 各自学习，合成答通的地址不会污染模型列表那条。
- **记忆只影响尝试顺序**：`orderedCandidates` 把记住的 URL 提到最前并去重；它失效时后面的候选照常试。
- **三张表都是进程内共享**：同一宿主上的所有面板、所有标签页共用一份；没有落盘，也不会同步到别的机器。

## 相邻模块

- 上游：`synthesis-entry`（`synthesize` 的缓存判断）、`custom-endpoints`（写两个 resolved 表）、`20-routes/speech-routes` 的 `listEndpointModels`（写 `models|…`）。
- 下游：`orderedCandidates`（读 `resolvedUrls`）、`synthesizeAuto`（读 `resolvedProtocols`）。
- 邻居：`10-panel/playback` 的 `cacheRef` / `inflightRef` 是**浏览器侧**的另一层缓存，两者互不相干。

## 改这里时

- **改上限**：只动 `host/constants.js` 的 `CACHE_LIMIT`；算一下内存：64 段 MP3 × 一句的量级，别按整篇文章估。
- **加 TTL 或字节上限**：现在只有条数，淘汰点是插入之后；要按时间淘汰得加时间戳并在命中时检查，别只改淘汰条数。
- **把 protocol 加进缓存键**：解决「改协议听到旧音频」，代价是同一句在协议切换后要重合成一次；改键就等于清空老条目（新进程生效，同进程里老条目只是永远命不中）。
- **想持久化**：`resolvedUrls` 落盘需要跟 `sources.json` 的密钥规则一起考虑；片段本身不建议落盘（体积与隐私）。
- **多宿主共享**：本插件只跑一个宿主进程；跨机器共享不是加锁能解决的，需要外部缓存。

## 读代码顺序

1. `synthesize` 的缓存键拼接（顺序即语义）。
2. 命中处的 `delete` + `set`。
3. 两条写入路径末尾的 `size > CACHE_LIMIT` 淘汰。
4. `orderedCandidates` 怎么用 `resolvedUrls`。
5. `synthesizeCustom` 与 `synthesizeDashscope` 写回的位置。
6. `synthesizeAuto` 的 `resolvedProtocols` 读写。