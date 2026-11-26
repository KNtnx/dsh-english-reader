# paths-and-limits

## 职责

宿主所有「写死的东西」的出处：15 条路由的路径、五个数据目录/文件的路径函数、以及各个 handler 与子进程共用的上限。改一个路径或一个上限，只需要在这里改一次——前提是调用方都用了这些名字而不是自己拼。

## 位置

- `host/constants.js` :: `PATHS`, `dshHome`, `modelDir`, `sourcesFile`, `dictKeyFile`, `storeFile`
- `host/constants.js` :: `MAX_TEXT`, `MAX_STORE_BYTES`, `MAX_TRANSLATE_TEXTS`, `MAX_TRANSLATE_CHARS`, `CACHE_LIMIT`, `MAX_HEADER_MARKS`, `MODEL_BYTES_APPROX`, `MODEL_ID`, `MODEL_DTYPE`, `PROTOCOLS`, `LOCAL_VOICES`, `EDGE_VOICE`

## 输入 → 输出

| 符号 | 值 / 形状 | 谁在用 |
| --- | --- | --- |
| `PATHS` | 15 个键，全部以 `/api-dsh-english-reader` 开头 | `host/routes.js` 的 `ROUTES` |
| `dshHome()` | `process.env.DSH_HOME`，缺省 `~/.dsh` | 下面四个路径函数 |
| `modelDir()` | `<DSH_HOME>/dsh-english-reader/models` | 本地模型、`40-speech`、`/local/install` |
| `sourcesFile()` | `<DSH_HOME>/dsh-english-reader/sources.json` | `readSources` / `writeSources` |
| `dictKeyFile()` | `<DSH_HOME>/dsh-english-reader/dictionary.json` | `readCollinsKey` / `writeCollinsKey` |
| `storeFile()` | `<DSH_HOME>/dsh-english-reader/library.json` | `readStore` / `writeStore` |
| `MAX_TEXT` | 800 字符 | 一次合成的文本上限（面板发一句） |
| `MAX_STORE_BYTES` | 4 MiB | `POST /store` 的请求体上限 |
| `MAX_TRANSLATE_TEXTS` | 400 句 | 一次翻译批量的条数 |
| `MAX_TRANSLATE_CHARS` | 2000 字符 | 批量里单句的长度 |
| `CACHE_LIMIT` | 64 | `40-speech` 的内存音频缓存条数 |
| `MAX_HEADER_MARKS` | 6000 字节 | marks 放进响应头的上限 |
| `MODEL_ID` / `MODEL_DTYPE` / `MODEL_BYTES_APPROX` | Kokoro-82M / `q8` / 89 MiB | 下载与「大概多大」的提示 |
| `PROTOCOLS` | `auto`、`openai`、`azure`、`dashscope` | 语音源协议白名单 |
| `LOCAL_VOICES` / `EDGE_VOICE` | 8 个 Kokoro 音色 / 一条 Edge 音色正则 | 音色默认值与校验 |

## 不变量

- **路径一律经函数取**：`dshHome()` 每次调用重算环境变量，所以测试把 `DSH_HOME` 指到临时目录后立刻生效（`test/host.test.mjs` 就是这么隔离的）。别在别处 `join(homedir(), …)` 或拼字符串。
- **`PATHS` 一项对应一条路由**：`ROUTES` 里 15 条全部引用 `PATHS.xxx`，没有裸字符串。`test/host.test.mjs`「every route the panel calls exists on the host」用正则扫 `client.js` 与 `host/*.js` 的路径，双向对齐。
- **上限有两份，越靠前越严**：面板侧先截（库 60 篇、夹子 200、墓碑 500），宿主侧再截一次（`items` 500、`words` 2000、`folders` 200、墓碑 500）。改一边不改另一边，得到的不是报错，而是「悄悄少一条」——放宽宿主侧不会让界面多存，收紧宿主侧才会先丢。
- **`EDGE_VOICE` 是正则不是名单**：形如 `zh-CN-XiaoxiaoNeural`；它只管宿主的拒绝逻辑，面板另有一份 `EDGE_VOICES` 名单用于下拉——两处不一致时表现为「界面能选、宿主拒绝」。
- **`PROTOCOLS` 决定存储合法性**：`isSource` 用它过滤 `sources.json`；手工编辑过的文件里协议写错，那条源会**静默消失**。

## 相邻模块

- 上游：无（本模块是叶子，只依赖 `node:os` / `node:path`）。
- 下游：`20-routes`（全部 15 条路径）、`30-store/library-file`（`storeFile`）、`30-store/secrets`（`sourcesFile`、`dictKeyFile`）、`40-speech`（`modelDir` 与模型常量）、`50-dictionary`（模型路由经 `host/model.js`，词典自己的缓存上限在 `host/dictionary.js`）。

## 改这里时

- **换数据目录**：只改 `dshHome`（或其余四个路径函数之一）；不要同时改调用方，否则会有一半文件写到旧位置。
- **改上限**：`MAX_STORE_BYTES` 是请求体闸门；但每条列表的截断（`500`/`2000`/`200`）写在 `20-routes/library-routes` 的 `sharedState` 与 `30-store/merge-rules` 的 `mergeStore` 里，是**字面量**，不读常量。改上限时两处都要改，否则「请求能进来、列表还是被砍」。
- **加路径**：`PATHS` 加键 → `ROUTES` 加条目 → `client.js` 加同名常量，三处一起；顺序保持一致，方便对读。
- **动模型常量**：`MODEL_ID` 同时被下载器与 `hasModel` 的目录检查使用，换模型要连 `modelDir` 的层级一起想清楚。
- **别把密钥路径改成可配置**：`sourcesFile`/`dictKeyFile` 固定在 DSH home 下，是为了让 0600 与备份边界可预测。

## 读代码顺序

1. 文件头注释：讲的是语音半边与「一条路由」，是历史遗留（实际 15 条），别被它带偏。
2. `dshHome` → `modelDir` → 三个文件路径：四个函数结构一样，看清层级。
3. `PATHS`：15 个键，配 `20-routes/route-table` 的 `ROUTES` 对读。
4. 上限常量那一段（`MAX_TEXT` 到 `MAX_HEADER_MARKS`），以及 `PROTOCOLS` 与两个音色常量。