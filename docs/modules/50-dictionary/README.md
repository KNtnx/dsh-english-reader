# 50 词典与翻译

**一句话**：右键一个词，宿主按面板选的那一格去查——中文走 iciba，英文走 WordNet / Wiktionary / Collins，或者让模型写一条；整句翻译另有 5 个来源。所有密钥都只在宿主，浏览器只拿到「有没有」。

## 一句话

- **负责**：4 个网络词典源与 1 条模型词条路径、5 个翻译源（含模型）、`dictKey` 规范化、三张进程内缓存、密钥 / 目标语言 / 默认模型路由的读取。
- **不负责**：卡片的交互与解析顺序（`10-panel/word-card`）、路由的参数校验与错误码（`20-routes/dictionary-routes`）、密钥文件怎么存（`30-store/secrets`）。

## 代码入口

| 文件 | 关键符号 | 一句话 |
| --- | --- | --- |
| `host/dictionary.js` | `lookUpWordNet`、`lookUpWord`、`lookUpCollins`、`lookUpChinese`、`defineWithModel` | 四个词典 + 模型词条 |
| `host/translate.js` | `translateWithModel`、`translateWithGoogle`、`translateWithVolcengine`、`translateWithAzure`、`translateWithTencent` | 五个翻译源，输入输出都是 `string[]` |
| `host/model.js` | `defaultModelRoute`、`secret`、`targetLanguage` | 模型去哪、密钥从哪读、翻成什么语言 |
| `host/routes.js` | `handleDict`、`handleDictAi`、`handleTranslate`、`handleTranslateOptions` | 路由层：规范化、校验、错误码 |
| `client.js` | `resolveSource`、`resolveWord` | 面板：两个槽位（中/英）各选一个源 |

## 小模块索引

| 小模块 | 一句话 | 文档 |
| --- | --- | --- |
| english-dictionaries | WordNet（Datamuse）/ Wiktionary / Collins 与 HTML 清洗 | [english-dictionaries.md](./english-dictionaries.md) |
| chinese-dictionary | iciba 释义、中文缓存、所有源共用的 `dictKey` | [chinese-dictionary.md](./chinese-dictionary.md) |
| model-dictionary | 让模型写一条学习者词典式词条 | [model-dictionary.md](./model-dictionary.md) |
| translate-providers | Google / 火山 / Azure / 腾讯 TMT 与签名 | [translate-providers.md](./translate-providers.md) |
| model-translate | 模型整批翻译：编号输入、编号输出 | [model-translate.md](./model-translate.md) |
| model-route | 默认模型路由、密钥读取、目标语言 | [model-route.md](./model-route.md) |

## 数据流

```
右键一个词
  └─ client.js resolveWord → resolveSource(槽位, 源, 模型路由)
        ├─ 英文槽：GET /dict?word=…&source=wordnet|wiktionary|collins
        ├─ 中文槽：GET /dict?word=…&source=iciba
        └─ 模型槽：POST /dict/ai → defineWithModel → ctx.get('llm').stream
              └─ /dict 回 en / zh，/dict/ai 回 entry；查不到是 notFound，不是错误

句子翻译：POST /translate { source, texts, target, model }
  └─ translateBatch
        ├─ dsh        → translateWithModel（DSH 的模型）
        ├─ google     → translateWithGoogle（无密钥）
        ├─ volc       → translateWithVolcengine（网页接口）
        ├─ microsoft  → translateWithAzure（密钥 + 区域）
        └─ tencent    → translateWithTencent（SecretId / SecretKey + TC3 签名）
```

## 常见改动

| 需求 | 改哪里 | 顺手补什么 |
| --- | --- | --- |
| 加一个词典源 | `host/dictionary.js` 加 `lookUpX` + `20-routes/dictionary-routes` 的 `lookUpOne` | 面板的选项与 `copy` 文案、`test/host.test.mjs` |
| 加一个翻译源 | `host/translate.js` + 路由的 `translateBatch` 与 `/translate/options` | 面板来源列表、密钥从 `secret()` 来 |
| 改中文/英文默认源 | 面板 `dictCn` / `dictEn` 的初值（`10-panel`） | 不是宿主行为，别在路由里写默认 |
| 改模型提示词 | `model-dictionary` 的 `buildDefinePrompt`、`model-translate` 的 system | 两处都改时看一眼 JSON / 编号约定 |
| 换目标语言 | `model-route` 的 `targetLanguage` + 插件行 config 的 `target` | 面板的 `zh-CN` 假设 |

## 风险与历史坑

- **一次只查一个源**：`lookUpOne` 不做链式回退——慢或挂掉的词典不会藏在另一个后面，用户看到的是确定的 `notFound` 或错误。
- **密钥只在宿主**：`secret()` 读插件行 config 或环境变量，源密钥走 `resolveKey`（`sources.json`），Collins 的 key 走 `readCollinsKey`（`dictionary.json`）；前端只拿到 `hasKey` 与 `masked`，`test/host.test.mjs` 守着「never the key」。
- **缓存键与代价**：WordNet / Collins 每次都打网络；Wiktionary / iciba 缓存 200 条；模型词条按 `word` 缓存、**不含模型路由**——换模型后同一个词仍返回旧条目。
- **模型可能「知道去哪、但没选型号」**：`defaultModelRoute` 会返回 `model: ''`，此时一律当「没配模型」处理；空 model 绝不能拿去 stream。
- **目标语言会被静默拒绝**：`targetLanguage` 只接受 2 到 12 个字母/连字符，非法值不报错、直接回落——排查时先看请求参数拼错没有。
- **HTML 与标记**：Wiktionary 的释义带 HTML，`plainText` 的清洗顺序有意义（见 `english-dictionaries`）；不要在调用点再补一次简单替换。