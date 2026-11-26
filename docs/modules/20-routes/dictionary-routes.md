# dictionary-routes

## 职责

查词的三条路：`/dict` 问一个真正的词典源（中文 / WordNet / Wiktionary / Collins，**只问一个**），`/dict/ai` 让宿主配的模型写一条词条，`/dict/key` 读写用户自己的 Collins key——写进去是真值，读出来只有「有没有」和一段掩码。

## 位置

- `host/routes.js` :: `handleDict`, `isWord`, `lookUpOne`, `handleDictAi`, `handleDictKey`, `sendJson`, `readBody`
- `host/files.js` :: `readCollinsKey`, `writeCollinsKey`
- `host/dictionary.js` :: `dictKey`, `lookUpChinese`, `lookUpWordNet`, `lookUpWord`, `lookUpCollins`, `defineWithModel`, `modelEntries`
- `host/constants.js` :: `PATHS`

## 输入 → 输出

| 路由 | 输入 | 输出 |
| --- | --- | --- |
| `GET /dict?word=&source=` | 词（原样，服务端再归一）与源名，`source` 缺省 `iciba` | `{ok:true, source, en, zh}`，或 `{ok:false, code}` |
| `POST /dict/ai` | JSON `{word, model?}` | `{ok:true, entry}`，失败 502 `{ok:false, error}` |
| `GET /dict/key` | 无 | `{hasKey, masked}`，`masked` 形如 `abcd…yz` |
| `POST /dict/key` | JSON `{key}` | `{hasKey}`；空字符串等于删除 |

`/dict` 的失败码：`badWord` 400（`isWord` 不过）、`badSource` 400（源名不认识）、`failed` 200（上游抛错，附 `error`）、`notFound` 200（两个语种都没结果）。**404 不用**——「没查到」是一个正常答案，不是路由错误。

源与语种的对应是硬编码的：`iciba` → 中文，`wordnet` / `wiktionary` / `collins` → 英文，四者只填 `{en, zh}` 里的一个，所以另一个恒为 `null`。

## 不变量

- **只问一个源，不串联**：`lookUpOne` 对未知源返回 `null`（→ `badSource`），不会退到别的词典。一个慢源只会慢，不会被另一个源的结果掩盖。
- **归一在宿主做**：`dictKey` 会小写、去掉 `’s`、削掉首尾非字母；`isWord` 再挡一次（必须字母开头、最长 49 个字符）。面板传 `Dream.` 与 `dream` 得到同一条。
- **key 只回显掩码**：`GET /dict/key` 的 `masked` 是前 4 位 + `…` + 后 2 位，用来让用户确认「填的是哪一把」，完整值永不出宿主；真正的使用只发生在 `lookUpCollins` 的请求头里。
- **省略 / 空 key 的语义**：`POST /dict/key` 的 `key` 不是字符串或为空即视为清空；`handleDict` 只有 `source === 'collins'` 时才去读 `dictionary.json`，别的源不碰密钥。
- **模型词条有缓存**：`defineWithModel` 先查 `modelEntries`，同一个词只付一次模型调用；缓存按词存，不按模型存。
- **这两个 POST 不设体积上限**：`readBody(request, Infinity)` —— 词条请求本来很小，所以没设限。若将来加字段（例如整段上下文），先把上限补上。

## 相邻模块

- 上游：`10-panel/word-card`（右键词卡的查词顺序），以及从词卡打开的设置页（填 Collins key，见 `10-panel/word-card`）。
- 下游：`50-dictionary`（四个源的解析与缓存）、`60-tool`（工具的动作也复用同一批查询函数）。
- 对端：`30-store/secrets`（`dictionary.json` 的 0600 写入与读取）。

## 改这里时

- **加一个词典源**：`lookUpOne` 加分支 + `host/dictionary.js` 里写一个 `lookUpXxx` + 面板的源列表（`client.js` 的 `dict.src.*` 文案与 `dictCn`/`dictEn` 的合法值）+ 一条用例。现有「未知源被拒」（`i-dont-exist`）就是这条契约的反面。
- **改归一规则**：`dictKey` 与 `client.js` 的 `wordId` 是两份实现，改一处会让「宿主查到的词」与「库里存的词 id」对不上，进而让收藏去重失效。
- **加 AI 词条字段**：`defineWithModel` 的 `toModelEntry`（在 `50-dictionary`）与面板的 `aiEntries` 缓存一起改，别只改响应。
- **改 key 的展示**：`masked` 的拼接在 `handleDictKey` 里；加长掩码等于多泄露几位，别为了「好认」把整把 key 发出去。
- **换存储文件**：路径在 `30-store/secrets`，本模块只经 `readCollinsKey` / `writeCollinsKey`，不要绕过它们直接读文件。

## 读代码顺序

1. `handleDict`：归一 → 校验 → 选源 → `lookUpOne` → 四种回答。
2. `lookUpOne`：五个分支，注意未知源返回 `null` 而不是空结果。
3. `isWord` 与 `dictKey`（后者在 `host/dictionary.js`）：两层校验各挡什么。
4. `handleDictKey`：GET 的掩码、POST 的写入，两者都只回 `hasKey`。
5. `handleDictAi`：`defineWithModel` 的两类失败（没有模型服务 / 没有配模型）。