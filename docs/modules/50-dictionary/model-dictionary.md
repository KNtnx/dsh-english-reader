# model-dictionary

## 职责

让 DSH 的模型写一条学习者词典式的词条：提示词、流式收集、JSON 提取、形状归一、付费结果的缓存；以及「没有 llm 服务 / 没有模型 / 模型乱答」三种失败怎么变成错误。

## 位置

- `host/dictionary.js` :: `defineWithModel`, `modelEntries`, `dictionaryCache`, `DICTIONARY_LIMIT`, `buildDefinePrompt`, `defineRoute`, `collectDefineAnswer`, `parseDefineAnswer`, `toSenses`, `toModelEntry`, `rememberModelEntry`

## 输入 → 输出

`defineWithModel(ctx, word, requested)` → `{ word, phonetic, senses: [{ pos, def, zh, example }], source: 'model' }`。

| 步骤 | 代码 | 事实 |
| --- | --- | --- |
| 缓存 | `modelEntries` | 按 `word` 命中，命中即免费返回 |
| 服务 | `ctx.get('llm')` | 没有就抛 `this Harness exposes no model service` |
| 路由 | `defineRoute` | 请求里 `{provider, model}` 都在就用它，否则 `defaultModelRoute(ctx)` |
| 请求 | `collectDefineAnswer` | `stream({system, messages, temperature: 0.3})`；`text-delta` 累加 |
| 解析 | `parseDefineAnswer` | 取第一个 `{` 到最后一个 `}`，再 `JSON.parse` |
| 归一 | `toSenses` / `toModelEntry` | 丢空释义；音标去掉两端 `/` |

提示词要点：学习者词典（COBUILD / 简明牛津）风格、只回 JSON、一到四条释义、`pos` 用 `v.` / `n.` 这种短形、英文释义 12 到 22 词、中文释义是一个短语且不加句号、例句不复述释义。

## 不变量

- **缓存按词，不按模型**：`modelEntries` 的键是 `word`；同一个词换模型仍返回旧条目。要按模型区分就改键（面板的 `entryKey` 已经带上了 provider/model，但宿主的表没有）。
- **只有成功进缓存**：失败不写 `modelEntries`，下一次会重新花钱。
- **三种错误分开报**：没有 llm 服务、没有可用路由（或 `model === ''`）、模型答得不可用；路由把它们统一变成 502 `{ok:false, error}`，面板显示错误而不是空词条。
- **`finish` 里的 error 必须抛**：截断的回复不能送进解析器；这是「半条释义比没有更糟」的唯一防线。
- **必须真的解析出 JSON**：夹带散文可以容忍，半截 JSON 不行；两种失败有不同消息（`did not answer with JSON` / `answered with JSON that does not parse`）。
- **一条释义都没有是错误**：`toSenses` 抛 `the model returned no usable sense`，不返回空词条。
- **`zh` 是可选字段**：面板把它映射成卡片的 `translation`；`def` 为空的那条被丢弃，`zh` 为空没问题。
- **上限 200**：`modelEntries` 插入后超 `DICTIONARY_LIMIT` 删最老一条；`dictionaryCache`（Wiktionary 用）是另一张表，别混。

## 相邻模块

- 上游：`20-routes/dictionary-routes` 的 `handleDictAi`（`POST /dict/ai`，做 `dictKey` 与 `isWord` 校验）。
- 下游/依赖：`model-route` 的 `defaultModelRoute`；面板的模型槽（`dictCn` / `dictEn` 可为 `'model'`）。
- 邻居：`model-translate`（同样走 `llm.stream`，同样是「模型写文本」的路径）。

## 改这里时

- **改提示词**：`buildDefinePrompt` 是唯一来源；改完检查中英两栏是否都还填得上，并跑 `test/panel.dict.test.mjs`（展开已存词条不抢占新查询）。
- **加字段**：`toSenses` / `toModelEntry` 加键 → 面板 `resolveSource` 的映射跟着加，否则新字段在浏览器侧被丢掉。
- **改缓存键**：按模型区分会让「换模型」立刻生效，代价是同一个词多付一次；这是产品选择，不是性能优化。
- **改温度**：0.3 是「稳定但仍像人写的」折中；调高会更容易出现不符合提示词的 JSON。

## 读代码顺序

1. `defineWithModel`：缓存 → 服务 → 路由 → 流 → 解析 → 归一。
2. `buildDefinePrompt`：模型被要求写成什么样。
3. `collectDefineAnswer`：`text-delta` 与 `finish` 的错误分支。
4. `parseDefineAnswer` 的两个错误。
5. `toSenses` / `toModelEntry`：哪些字段会被丢。
6. `rememberModelEntry` 的淘汰。