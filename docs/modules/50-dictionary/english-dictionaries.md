# english-dictionaries

## 职责

三个英文词典源：WordNet（经 Datamuse）、Wiktionary、Collins；以及把 Wiktionary 的 HTML 洗成卡片可读句子的 `plainText`。三个源都归一成同一个词条形状，查不到就回 `null`。

## 位置

- `host/dictionary.js` :: `lookUpWordNet`, `lookUpWord`, `lookUpCollins`, `plainText`, `dictionaryCache`, `DICTIONARY_LIMIT`

## 输入 → 输出

词条形状固定为 `{ word, phonetic: '', senses: [{ pos, def, example }], source }`，`senses` 最多 6 条。

| 源 | 请求 | 超时 | 缓存 | 失败 |
| --- | --- | --- | --- | --- |
| WordNet / Datamuse | `GET api.datamuse.com/words?sp=<词>&md=dp&max=1` | 9 秒 | 无 | `null` |
| Wiktionary | `GET en.wiktionary.org/api/rest_v1/page/definition/<词>` | 9 秒 | `dictionaryCache`（200 条） | `null` |
| Collins | `GET api.collinsdictionary.com/api/v1/dictionaries/english/entries/<词>` | 12 秒 | 无 | 无 key 抛错，其余 `null` |

`plainText` 的顺序：

```
<style> / <sup> 连内容整块删除
  → 其它标签剥掉
  → &quot; &#39; &apos; &lt; &gt; &nbsp;
  → &amp; 最后（避免二次解码）
  → 去掉残留的 CSS 规则片段
  → 折叠空白、trim
```

## 不变量

- **miss 一律 `null`，不抛错**：网络失败、非 200、JSON 解不开、空结果都返回 `null`；路由据此回 `notFound`，面板回落到翻译。唯一例外是 Collins 缺 key——那是配置错误，必须让用户看见。
- **Datamuse 必须词形一致**：返回的 `word` 小写后要和查询词相同，否则当 miss，绝不把联想词当释义。
- **最多 6 条释义**：三层循环共用 `senses.length >= 6` 的提前退出；改条数要同时改三个源。
- **只有 Wiktionary 进缓存**：`dictionaryCache` 按词存成功结果，插入后超过 `DICTIONARY_LIMIT` 删最老一条；miss 不缓存，所以同一个生词会反复打网络。
- **Collins 的 key 是用户自己的**：没有 key 时抛 `no Collins API key is configured`；错误由路由变成 `failed`，不是 `notFound`。
- **`plainText` 顺序不能换**：先整块删 `<style>` / `<sup>`（否则 CSS 文本会漏进来），最后解 `&amp;`（否则 `&amp;lt;` 会被解成 `<`）。
- **释义截断在 260 字符**（`slice(0, 257)` + `…`）；例子只取第一条。
- **词形由上游规范化**：这里收到的已经是 `dictKey` 的结果（见 `chinese-dictionary`），词内部的连字符与空格保留。

## 相邻模块

- 上游：`20-routes/dictionary-routes` 的 `lookUpOne`（一次只查一个源）；`dictKey` 在 `chinese-dictionary`。
- 下游：面板 `resolveSource` 把 `en` 的 `senses` 装进卡片；模型词条见 `model-dictionary`。
- 守护：`test/host.test.mjs` 覆盖 Datamuse 释义拆分、Wiktionary 去标记与示例、miss 与 `badWord`、`badSource`、Collins 密钥不外泄。

## 改这里时

- **加一个英文源**：写 `lookUpX`、在 `lookUpOne` 分支、面板选项与文案、`test/host.test.mjs` 补一条 stub 用例；词条形状必须与现有三个一致。
- **改缓存**：`dictionaryCache` 只管 Wiktionary；要给 Datamuse 加缓存就另开表（它的返回带词形，键要注意大小写）。
- **改 `plainText`**：先看样式块与实体两段；任何新增替换都放对位置，并拿一条真实 Wiktionary HTML 验一次。
- **改超时**：9 秒 / 12 秒是三处独立数字；词典是「查不到就算了」的路径，不要改成让卡片长时间转圈。

## 读代码顺序

1. `plainText`（先看它怎么把 HTML 变成一句话）。
2. `lookUpWordNet`（最简单的源：一个请求、一个数组、六个 sense）。
3. `lookUpWord` + `dictionaryCache` 的写入与淘汰。
4. `lookUpCollins`（key 检查、entries/senses 嵌套、示例）。
5. `20-routes/dictionary-routes` 的 `lookUpOne` 与 `handleDict`（错误码怎么来的）。