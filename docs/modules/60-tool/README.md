# 60 模型工具

**一句话**：`english_reader` 是插件面向模型的唯一入口——一次调用只做一个动作，读写的却是面板正在用的那份 `library.json`；17 个动作覆盖单词、夹子、对话、词典设置，以及两条整理/查词的杂务。

## 一句话

- **负责**：动作清单（`ACTIONS`）、给模型看的描述与参数/输出 schema、动作分发与兜错、每个动作对库的读写与对模型的错误话术。
- **不负责**：库怎么合并与落盘（`30-store`）、面板怎么通过 HTTP 拿到同一份库（`20-routes`）、词典与翻译怎么实现（`50-dictionary`）、面板界面（`10-panel`）。

## 代码入口

| 文件 | 关键符号 | 一句话 |
| --- | --- | --- |
| `host/tool.js` | `ACTIONS`、`englishReaderTool` | 动作清单与工具定义（名字、描述、两个 schema、`execute`） |
| `host/tool.js` | `HANDLERS` | 17 个动作的实现，一个 key 一个动作 |
| `host/tool.js` | `mountTool` | 软依赖挂载：等 `tools` 服务出现，再把定义登记进去 |
| `host/tool.js` | `readLibrary`、`writeLibrary` | 读整库 / 把一次改动合并后写回 |
| `host/files.js` | `readStore`、`writeStore`、`mergeStore` | 真正落盘与合并（`30-store` 的地盘） |
| `index.js` | `apply`、`mountTool` | 宿主入口：先装路由，再挂工具 |

## 小模块索引

| 小模块 | 一句话 | 文档 |
| --- | --- | --- |
| tool-definition | `ACTIONS`、描述、两个 schema、`execute` 与 `mountTool`；为什么不用 `defineTool` | [tool-definition.md](./tool-definition.md) |
| word-actions | 单词的列/加/批加/删/批删/移动，`wordId` 与按名建夹 | [word-actions.md](./word-actions.md) |
| dialogue-actions | 对话的列/加/改名/移动/删除，`titleFor` 与 `sentenceCount` | [dialogue-actions.md](./dialogue-actions.md) |
| settings-actions | 词典设置、存量单词清洗、`define_word` 查词 | [settings-actions.md](./settings-actions.md) |

## 数据流

```
conversation ── english_reader { action, … } ──► execute
                                                  ├─ 未知动作 ──► { ok:false, error, actions }
                                                  └─ HANDLERS[action] 拿到参数
                                                       ├─ readLibrary() ──readStore──► library.json
                                                       ├─ folderFor / wordId / …（纯函数）
                                                       └─ writeLibrary() ──mergeStore──► writeStore
                                                                            │
面板 POST /store ─────────────── 同一个 mergeStore ──────────────────────────► library.json
面板 GET /store/revision（每 2s）──► 指纹变了才 GET /store ──► 看见工具刚写的东西
```

两个写者、一份文件，因此**每次都合并**：工具不认得的字段（面板写的笔记、缓存释义、以后加的东西）必须原样留在库里。

## 常见改动

| 需求 | 改哪里 | 顺手补什么 |
| --- | --- | --- |
| 加一个动作 | `ACTIONS` + `HANDLERS` + `parameters.properties` + 描述 | `test/tool.test.mjs` 一条正向、一条报错 |
| 改某个动作的行为 | 对应的 `HANDLERS` 条目 | 那一组用例；跨半边的改动再跑 `test/host.test.mjs` |
| 加一个参数 | `parameters.properties` 与用它的 handler；描述里写清哪些动作读它 | `test/tool.test.mjs` 的定义用例 |
| 让模型少绕路 | 先想批量接口：`add_words` / `move_words` / `remove_words` | 用例里断言「一次调用只写一次文件」 |
| 改库的形状或路径 | 不在本模块改，去 `30-store` | 面板与工具共用，改一处等于改两处 |

## 风险与历史坑

- **不要改用 `defineTool`**：插件没有 `@deepseek-ai/dsh-tools` 依赖，解析不到的 `import` 会把整个插件（含全部路由）一起带走。定义就是一个普通对象，交由注册表检查输出 schema。
- **`tools` 是软依赖**：`mountTool` 必须继续包在 `ctx.inject(['tools'], …)` 里；没有工具注册表时插件照常加载，注册被拒也只是安静降级（面板才是主体）。
- **归类靠 `folderAt` 这根戳**：移动时只改 `folderId` 而不打 `folderAt`，面板下一次保存就会把归档抹掉——用户踩过一次：43 个手工归档的词集体回到未分类。
- **删除必须写墓碑**：词是 `kind:'word'`，对话是 `kind:'item'`（不是 `dialogue`）。少了墓碑，另一台浏览器同步时会把条目带回来。
- **名字与 id 不对称**：`folder` 传名字，库里没有就**现场建**（这正是「归档不用先列夹子」的来源）；`folderId` 传 id，查不到就是错误，错误消息里带上现有夹名。
- **一次动作一次写**：批量动作是为了省往返与省写文件；别在描述或文档里教模型「一个词调一次」。
- **错误是答案不是崩溃**：`execute` 把 handler 抛出的消息包成 `{ok:false, error}`，模型能读到原因并改参数；新增动作照此办理。
- **`add_dialogue` 一律 `mode:'article'`**：工具不猜文章还是对话，面板下次编辑时自己判定。
- **`limit` 夹在 1..200，默认 50**：`total` 是过滤后的总数，`words`/`dialogues` 才被截断——报数量用 `total`。