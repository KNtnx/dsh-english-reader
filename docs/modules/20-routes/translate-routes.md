# translate-routes

## 职责

翻译这一侧的三条：`/translate` 收一批句子、选一个源、整批翻回来；`/translate/options` 告诉面板「现在能用哪些源、目标语言是什么、有没有模型」；`/translate/models` 把一个 provider 的模型名列表掏出来给下拉框。

## 位置

- `host/routes.js` :: `handleTranslate`, `translateBatch`, `handleTranslateOptions`, `handleTranslateModels`, `modelRoutes`
- `host/translate.js` :: `translateWithGoogle`, `translateWithVolcengine`, `translateWithAzure`, `translateWithTencent`, `translateWithModel`
- `host/model.js` :: `secret`, `targetLanguage`, `defaultModelRoute`
- `host/constants.js` :: `MAX_TRANSLATE_TEXTS`, `MAX_TRANSLATE_CHARS`

## 输入 → 输出

| 路由 | 输入 | 输出 |
| --- | --- | --- |
| `POST /translate` | JSON `{texts, source?, target?, model?}` | `{translations, source, target}`，失败 502 `{error}` |
| `GET /translate/options` | 无 | `{target, routes, model, providers}` |
| `GET /translate/models?provider=` | 路由 id | `{models: [{model, name}]}`，失败时 `{models: [], error}` |

`/translate` 的校验顺序：非 POST 405 → body 超 1 MB 413 → JSON 坏 400 → `texts` 过滤成非空字符串数组并截到 `MAX_TRANSLATE_TEXTS` → 空数组 400 `no texts` → 任一句超 `MAX_TRANSLATE_CHARS` 413 `text too long` → 源名不在白名单则回落 `dsh` → `targetLanguage` 定目标语。

五个源的取用方式不同：`google`、`volc` 免密钥；`microsoft` 从插件 `config`/环境变量取 `microsoftKey`（缺失直接抛错）；`tencent` 要 `tencentSecretId` + `tencentSecretKey` 两把；其余（含 `dsh`）走 Harness 的模型路由。整批共用一个 120 秒 `AbortController`。

## 不变量

- **批量必须一一对应**：`translateBatch` 返回后有一道硬检查——长度必须等于输入、且不能有空字符串，否则按失败处理。少一句就整批 502，不做「部分成功」。
- **密钥只在宿主**：`secret` 先读 `config` 再读环境变量（`DSH_ENGLISH_READER_*`），面板拿不到任何明文；`/translate/options` 只报 `ready: true/false`。
- **源名白名单在路由里**：`['dsh','google','volc','microsoft','tencent']`，别处写错的名字静默变 `dsh`——不会报错，只会「翻了但用的是模型」。
- **`options` 是自足的**：它不做网络请求，`routes` 来自 `ctx.get('llm')` 的 `listProviders()`，`model` 来自 `defaultModelRoute(ctx)`；没有模型服务时 `model` 为 `null`、`dsh` 的 `ready` 为 `false`。
- **`/translate/models` 从不抛**：`listModels` 的异常被吃成 `{models: [], error}`，面板据此显示「这个 provider 没有可用模型」。

## 相邻模块

- 上游：`10-panel` 的翻译视图（`TRANSLATE_PATH` 批量翻、`TRANSLATE_OPTIONS` 决定下拉里显示哪些源、`TRANSLATE_MODELS` 二级下拉）。
- 面板侧用例：`test/panel.translate.test.mjs`（换源必须替换掉已经翻好的行）——断言在浏览器半边，但触发的那次请求就是 `/translate`。
- 下游：`50-dictionary/translate-providers`（五个源的请求形状与签名）、`host/model.js`（模型路由与 `secret`）。
- 交叉：`20-routes/dictionary-routes` 的 `/dict` 与这里是两条独立通路——词卡查不到时用翻译兜底，是面板的决定，不是宿主的。

## 改这里时

- **加一个翻译源**：白名单、`translateBatch` 分支、`/translate/options` 的 `providers` 三处一起改；`client.js` 的 `SOURCES` 数组是第四处（它只列 `dsh`/`google`/`volc`，因为微软与腾讯的密钥来自插件配置，面板填不了）。
- **改批量上限**：`MAX_TRANSLATE_TEXTS` 与 `MAX_TRANSLATE_CHARS` 在 `host/constants.js`；调大之前先看面板是不是一次把整篇文章丢过来。
- **改超时**：120 秒留给模型逐句翻整篇；`AbortController` 也是上游 fetch 的 signal，超时会变成 502 `{error}` 而不是挂住。
- **让 `/translate/options` 带上更多信息**：它是纯读、无网络的，保持这样；要探测端点可用性请另开路由，别把它变成会超时的接口。
- **换模型选择方式**：`modelRoutes` 与 `handleTranslateModels` 都直接问 `ctx.get('llm')`，两处要同步；`ctx` 在 `bindRoute` 那一层已经绑好。

## 读代码顺序

1. `handleTranslate`：校验链与 120 秒计时器。
2. `translateBatch`：五个分支，注意 `microsoft`/`tencent` 缺密钥时是 `throw`。
3. 响应前的一致性检查（长度 + 非空）。
4. `handleTranslateOptions`：`providers` 的 `ready` 各由什么决定。
5. `handleTranslateModels` 与 `modelRoutes`：`ctx.get('llm')` 的两种用法（可选链 + try/catch）。