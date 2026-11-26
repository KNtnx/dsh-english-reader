# model-route

## 职责

`host/model.js` 的三件小事：密钥从哪读（`secret`）、翻成哪种语言（`targetLanguage`）、模型默认去哪（`defaultModelRoute`）。全仓库的「模型侧」——模型词条、模型翻译、`/translate/options`——都从这三个函数出发。

## 位置

- `host/model.js` :: `defaultModelRoute`, `secret`, `targetLanguage`

## 输入 → 输出

| 函数 | 输入 | 输出 |
| --- | --- | --- |
| `secret(config, field, envName)` | 插件行 config + 环境变量名 | `string`；config 优先，env 第二，都没有是 `''` |
| `targetLanguage(config, requested)` | 请求里的 target + config | 合法语言标签；默认 `zh-CN` |
| `defaultModelRoute(ctx)` | 宿主 context | `{ provider, model }` 或 `undefined` |

```
targetLanguage("ja", config)      → "ja"
targetLanguage("", config.target) → config.target（若合法）
targetLanguage("中文", …)          → config / env / "zh-CN"（非法值静默跳过）

defaultModelRoute(ctx)
  ├─ agentDefaultModel.currentSelection() → {provider, model}（两者都是字符串才算）
  ├─ llm.listProviders()[0]              → {provider: id, model: ''}
  └─ 都没有                                → undefined
```

## 不变量

- **`secret` 不抛错**：没有配置就返回 `''`，由调用方决定怎么报（翻译源回 `no Microsoft Translator key is configured`，Collins 直接抛）。
- **config 优先于环境变量**：同一凭据两处都有时以插件行为准；空串或纯空白视为「没配」。
- **`targetLanguage` 只接受 2 到 12 个字母/连字符**：非法值不报错、逐级回落，最终 `zh-CN`；这是「永远给得出一个语言」的取舍。
- **`model: ''` 不是一条可用路由**：它只表示「知道去哪家、但没选型号」；调用方必须当「没配模型」处理，空 model 不能拿去 `stream`。
- **`defaultModelRoute` 只读不写**：先问 agent 默认选择，再退到第一个 provider；两次 `ctx.get` 都包在 `try/catch` 里，缺服务不会炸。
- **密钥永远不进浏览器**：本文件没有返回密钥的路径；前端只经路由拿到 `hasKey` / `masked`。
- **这里不是源密钥的入口**：`sources.json` 的 key 走 `files.js` 的 `resolveKey`，Collins 的 key 走 `readCollinsKey`；`secret` 只管插件行 config 与环境变量。

## 相邻模块

- 上游：`20-routes/translate-routes` 的 `/translate/options`（provider 是否 ready、`model` 是谁）、`/translate/models`（`listModels`）。
- 下游：`model-dictionary`（`defineRoute` 的兜底）、`model-translate`（同一个兜底）。
- 邻居：`30-store/secrets`（源密钥的另一条路）。

## 改这里时

- **改默认路由规则**：先想清楚「第一个 provider」是否支持 chat/stream——`listProviders()[0]` 只保证存在，不保证能跑对话；要加优先级就在这里加，别在调用点各写一份。
- **加环境变量**：`secret` 的 `envName` 由调用点传入（`DSH_ENGLISH_READER_*`），加变量时把名字写在调用点，不要在这里维护白名单。
- **改语言白名单**：`/^[A-Za-z-]{2,12}$/` 出现在两处（请求值与配置值）；改宽/改严都要同步 `test/host.test.mjs` 的「translation route reports what it can do」。
- **要支持「用户选的 provider 但没选 model」**：`defaultModelRoute` 的 `model: ''` 已经表达了它；不要在这里猜一个模型，猜错会静默翻译成别的语言。

## 读代码顺序

1. `secret`：三行，config → env → 空串。
2. `targetLanguage`：三个来源与同一个正则。
3. `defaultModelRoute`：两次 `ctx.get` 与两种返回，`undefined` 的含义。
4. `20-routes/translate-routes` 的 `/translate/options`：`ready` 是怎么算出来的。