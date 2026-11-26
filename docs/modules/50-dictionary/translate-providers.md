# translate-providers

## 职责

四个网络翻译实现：Google（无密钥）、火山引擎（网页接口）、Azure AI Translator（密钥 + 区域）、腾讯云 TMT（SecretId/SecretKey + TC3 签名）；以及签名用的两个纯函数 `hmac`、`payloadHash`。

## 位置

- `host/translate.js` :: `translateWithGoogle`, `translateWithVolcengine`, `translateWithAzure`, `translateWithTencent`, `hmac`, `payloadHash`

## 输入 → 输出

所有实现都返回 `string[]`，长度与输入一致、顺序一致；路由还会再检查一遍「没有空串」。

| 实现 | 一次请求 | 认证 | 失败消息 |
| --- | --- | --- | --- |
| `translateWithGoogle` | 一行 | 无（`client=gtx`） | `Google Translate answered <status>` |
| `translateWithVolcengine` | 一行 | 无（伪装 origin/referer） | `Volcengine answered <status>` / `Volcengine returned no translation` |
| `translateWithAzure` | 整批 | `Ocp-Apim-Subscription-Key`，可选 `...-Region` | `Microsoft Translator answered <status>` / 形状不对 |
| `translateWithTencent` | 整批 | TC3-HMAC-SHA256 | 服务端 `Error.Message` |

Google 与火山的并发是「4 个 worker 共享一个游标」，最多 4 个请求同时在飞；Azure 与腾讯一次发完整批。

## 不变量

- **输出的长度与顺序是契约**：四个实现都先 `new Array(texts.length)` 再按下标填；路由再验一次空串，缺行即 502。
- **Google 的解析**：`translate_a/single` 返回嵌套数组，取 `data[0]` 的每个 `segment[0]` 拼接；换接口时这段是第一个要改的。
- **火山的语言码只折中文**：`target` 小写以 `zh` 开头 → `zh`，否则取第一段（`en-US` → `en`）。
- **腾讯的源语言固定 `en`**：`Target` 同样只把 `zh*` 折成 `zh`，其它语言码原样交给 TMT；要翻别的语种得自己补映射。
- **TC3 签名的四步不能换序**：`canonicalRequest` → `stringToSign` → 派生密钥（date → service → `tc3_request`）→ 用派生密钥对 `stringToSign` 做 HMAC 取 hex。
- **`hmac` 返回 Buffer**：所以派生可以一层套一层当 key 用；只有最后一步 `digest('hex')`。
- **时间戳用秒、日期取 UTC**：签名、`x-tc-timestamp` 头必须用同一个 `timestamp`，跨秒会签名失败。
- **密钥不落日志**：错误信息只带服务名与状态码；Auth 头在请求对象里，不往外抛。

## 相邻模块

- 上游：`20-routes/translate-routes` 的 `translateBatch`（选源、取密钥、120 秒总闸）。
- 下游/依赖：`model-route` 的 `secret`（插件行 config / 环境变量里的密钥）与 `targetLanguage`（目标语言）；源密钥的另一条路在 `30-store/secrets`。
- 对照：`model-translate`（第五个源，走 DSH 模型）。

## 改这里时

- **加语言映射**：火山与腾讯各自需要自己的语言码；在对应函数里折，别在路由里改成「一个映射打天下」。
- **改并发**：`Math.min(4, texts.length)` 是两个实现里各写一次的；批量上限由路由的 `MAX_TRANSLATE_TEXTS` 控制。
- **改超时**：这里没有内部超时，全部靠路由的 `AbortController`（120 秒）；不要在单行请求里另起一套。
- **换腾讯接口版本**：`x-tc-version` 与 `service` / host 一起改，签名里的 scope 也要跟着。
- **加新源**：实现放在本文件、`translateBatch` 加分支、`/translate/options` 加 `{id, ready}`、面板加选项——四处缺一不可。

## 读代码顺序

1. `translateWithGoogle`（最短：并发骨架 + 解析）。
2. `translateWithVolcengine`（POST 形状与语言码）。
3. `translateWithAzure`（整批、两个头）。
4. `hmac` 与 `payloadHash`。
5. `translateWithTencent`（canonicalRequest → stringToSign → 派生 → 最终签名 → 请求）。
6. `20-routes/translate-routes` 的 `translateBatch`（哪一步取密钥）。