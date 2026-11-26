# model-translate

## 职责

让 DSH 的模型整批翻译：把每行编号后发过去、要求同号回来、按编号对行；缺行即整体失败。这是翻译源里的 `dsh`，也是唯一不需要密钥的一个。

## 位置

- `host/translate.js` :: `translateWithModel`

## 输入 → 输出

`translateWithModel(ctx, texts, target, requested)` → `string[]`（与 `texts` 等长、同序）。

| 项 | 事实 |
| --- | --- |
| 路由 | `requested` 的 `{provider, model}` 都在就用它，否则 `defaultModelRoute(ctx)`；两者都没有是错误 |
| 服务 | `ctx.get('llm')`；没有就抛 `this Harness exposes no model service` |
| 系统提示 | 四句话：翻译每一行、每行同号加制表符、不许合并/拆分/重排/跳过/解释、标点自然 |
| 请求体 | `texts.map((text, i) => `${i + 1}\t${text}`).join('\n')` |
| 温度 | `0`——翻译要稳定，不要创作 |
| 解析 | 每行 `/^\s*(\d+)\s*[\t.:、)]\s*(.+)$/`；编号 → 译文进 Map |
| 失败 | 任一行缺失或为空 → `the model did not return a line for every sentence` |

## 不变量

- **一次请求翻整批**：批量上限由路由的 `MAX_TRANSLATE_TEXTS`（400）与单行 `MAX_TRANSLATE_CHARS`（2000）兜住；这里不再分批。
- **编号是唯一对号方式**：编号从 1 开始、按请求体重新数，所以模型不能重排；分隔符接受制表符、`.`、`:`、`、`、`)`。
- **重复编号后者胜**：`byNumber.set` 直接覆盖；模型把两行写成同一个号时，前一行会变成空、整体报错。
- **失败不返回部分结果**：只要一行空就抛错，路由变 502；面板显示翻译失败，而不是半页中文。
- **路由选择只认显式或默认**：显式要求 `provider` 与 `model` 都是字符串且 `model !== ''`；空 model 的默认路由等于「没配模型」。
- **流里 `finish` 的错误必须抛**：被截断的回复不能进解析器，错误消息取 `reason.failure.message`。
- **不缓存**：同一段英文翻两次就是两次模型调用；面板自己按对话保存结果（`10-panel/panel-shell` 的 `translation` 字段）。

## 相邻模块

- 上游：`20-routes/translate-routes` 的 `translateBatch`（`source === 'dsh'` 或未匹配到其它源时落到这里）。
- 依赖：`model-route` 的 `defaultModelRoute`（默认去哪）。
- 对照：`model-dictionary`（同一个 `llm.stream`，输出形状不同）、`translate-providers`（网络源）。

## 改这里时

- **改编号格式**：解析正则与请求体的 `\t` 必须同时改；否则模型照新格式回、解析按老格式找，结果是「一行都没回来」。
- **改提示词**：`system` 里的四句是一组约束，删掉「不许合并/拆分/重排」会让对齐失效——这是整批翻译唯一的正确性来源。
- **要分批**：在路由层切（路由已经有 `MAX_TRANSLATE_TEXTS` 的批量上限），别在这里悄悄分，否则编号会重复。
- **加术语表**：加在 `system` 里、还是拼在请求体前，会影响编号解析；推荐放在 `system`，并在面板侧确认行数没变。

## 读代码顺序

1. 函数签名与路由选择的两行。
2. `system` 的四句约束。
3. 请求体的编号拼接。
4. `llm.stream` 的 `text-delta` / `finish` 分支。
5. 输出按行解析的正则与 `byNumber`。
6. 最后「任一行空」的检查。