# chinese-dictionary

## 职责

中文释义（iciba 的移动接口）与它的一张缓存；以及所有词典共用的词形规范化 `dictKey`——查词前把用户点的那个词（可能带所有格、标点、大小写）削成词典认识的样子。

## 位置

- `host/dictionary.js` :: `lookUpChinese`, `chineseCache`, `dictKey`, `DICTIONARY_LIMIT`

## 输入 → 输出

`lookUpChinese(word)` → `{ word, phonetic: '', senses: [{ pos, def }], source: 'iciba' }`，最多 6 条，`en` 侧恒为 `null`（由路由拼）。

`dictKey(raw)` 只做四件事：

| 输入 | 输出 | 规则 |
| --- | --- | --- |
| `Dream's` | `dream` | 小写 + 去所有格（`'s` / `’s`） |
| `lantern’s` | `lantern` | 弯引号也识别 |
| `"quill,"` | `quill` | 去两端非 `a-z` |
| `ice cream` | `ice cream` | 中间的连字符与空格保留 |
| `12345` | （空串） | 两端都被削光 → 路由判 `badWord` |

## 不变量

- **规范化是查词的第一步**：路由先 `dictKey` 再 `isWord`（`^[a-z][a-z' -]{0,48}$`）；空串或非法词直接 400 `badWord`，零请求发出。
- **一次只答一种语言**：`lookUpChinese` 只给 `zh`，英文源只给 `en`；路由把两个槽位的结果拼成一条词条，不在词典层合并。
- **按词性分组**：iciba 的 `part` 直接当 `pos`，同组多个意思用中文分号 `；` 连接；一个意思都没有的组整组丢掉。
- **缓存键是规范化后的词**：`chineseCache` 按 `dictKey` 的结果存，命中就返回；直接调用本模块的人要自己先规范化。
- **只缓存成功**：插入后超过 `DICTIONARY_LIMIT`（200）删最老一条；miss 不写缓存，所以生词会反复打网络。
- **失败即 miss**：非 200、JSON 解不开、`message[0]` 不存在 → `null`；不抛错，让路由回 `notFound`。
- **接口挑 UA**：请求带 `user-agent: Mozilla/5.0`；去掉它可能被 iciba 拒。
- **返回的 `word` 用接口回写的词**（`first.key`），拿不到才用请求词。

## 相邻模块

- 上游：`20-routes/dictionary-routes` 的 `handleDict`（用 `dictKey` 与 `isWord`）。
- 下游：面板中文槽（`dictCn === 'iciba'`）把 `zh.senses` 装进 `translation`。
- 邻居：`english-dictionaries`（英文侧）、`model-dictionary`（模型侧）。

## 改这里时

- **换中文接口**：`lookUpChinese` 的 URL 与解析（`message[0].means[].means`）一起改；返回形状保持 `{ word, phonetic, senses, source }`，路由与面板都不用动。
- **改 `dictKey` 规则**：它是全仓公共入口，改完要跑 `test/host.test.mjs` 的「a possessive is looked up by its base word」与 `test/panel.dict.test.mjs` 的去标点用例。
- **加缓存**：`chineseCache` 已经是 200 条的 LRU 近似；要加 TTL 就在这里加，别在路由层再套一层。
- **加第二个中文源**：按 `english-dictionaries` 的「加一个源」做，并想清楚面板的默认源要不要变。

## 读代码顺序

1. `dictKey`（四行正则，先看它）。
2. `lookUpChinese` 的 URL 与 `message[0]` 解析。
3. `chineseCache` 的命中与淘汰。
4. `20-routes/dictionary-routes` 的 `isWord` 与 `lookUpOne`（为什么一次只查一个源）。