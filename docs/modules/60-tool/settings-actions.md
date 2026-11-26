# settings-actions

## 职责

词典设置与两条杂务：读/改面板的词典选择，清洗存量单词的句末标点，按宿主当前配置查一个词。这一组是工具里唯一会碰到 `settings` 这一节的地方。

## 位置

- `host/tool.js` :: `get_settings`, `set_dictionary`, `normalize_words`, `define_word`, `dictionaryOf`, `sensesOf`, `SHOW_MODES`, `CHINESE_SOURCES`, `ENGLISH_SOURCES`, `DEFAULT_DICTIONARY`

## 输入 → 输出

| 动作 | 参数 | 答案 |
| --- | --- | --- |
| `get_settings` | 无 | `{settings:{dictionary}, stored, updatedAt}`；`stored` 说宿主到底有没有 `settings` 这一节（新宿主是 `false`） |
| `set_dictionary` | `show`（必填）、`chinese?`、`english?` | `{settings:{dictionary}, updatedAt}`；三个字段都过白名单，非法值直接抛，消息里列出可选值 |
| `normalize_words` | `dryRun?`、`limit?` | `{dryRun, changed, skipped[], total, words[], sample[]}` |
| `define_word` | `word`（必填）、`english?`、`chinese?` | `{ok, action, word, english, chinese}`；两个源都没命中时 `ok:false` + `error` |

机制：

- `dictionaryOf(settings)`：`show`/`chinese`/`english` 逐个对照白名单，缺失或非法就回落 `DEFAULT_DICTIONARY`（`both` / `iciba` / `wordnet`）。读设置与写设置都用它，所以读回来的一定是合法值。
- `set_dictionary` 的合并：先展开旧的 `settings.dictionary`，再覆盖这三个字段——面板以后加的字段不会被工具抹掉；`updatedAt` 每次都刷新。
- `normalize_words`：只去掉**结尾**的 `[^A-Za-z' \-]`，`context` 逐字节保留（那是词被遇见的原句）；清完会变空的条目（例如 `...`）进 `skipped` 并原样留在库里，附 `reason`；`id` 沿用原条目（`entry.id ?? wordId(trimmed)`）；不是 `dryRun` 且真有改动才写库。
- `sample`：前 10 条 `{before, after, id}`，让模型能向用户复述改了什么；`dryRun` 时同样给。
- `define_word` 的源选择：参数 > 库里的 `settings.dictionary` > `wordnet` / `iciba`；`collins`、`wiktionary`、`wordnet` 分别走 `lookUpCollins`、`lookUpWord`、`lookUpWordNet`，中文走 `lookUpChinese`；`model` 在这里**不发起**模型调用（那是面板 `/dict/ai` 的路），所以配成 `model` 时这一格就是 `null`。
- 每个上游调用都 `.catch(() => null)`：网络坏、词典 5xx 一律按「没查到」上报，不抛。

`define_word` 是唯一在 handler 里**返回** `ok:false` 的动作：`execute` 先写 `{ok:true, action}` 再展开 handler 的答案，后写的 `ok` 生效，所以最终还是一份 `{ok:false, error}` 的答案。

## 不变量

- **白名单就是契约**：`SHOW_MODES`、`CHINESE_SOURCES`、`ENGLISH_SOURCES` 同时喂 `parameters` 里的 enum、`dictionaryOf` 的校验与每个 `set_dictionary` 的错误消息；三者必须同源。
- **`settings` 是面板与工具共有的节**：工具只动 `dictionary.show/chinese/english` 与 `updatedAt`，别的一律原样保留。
- **`normalize_words` 不动 `context`**：句子里带标点的那个词是原文证据，`test/tool.test.mjs`「normalize_words strips punctuation and keeps the sentence it came from」会逐字段比。
- **空词不删只报告**：清洗的目的是去标点，不是清理条目；`skipped` 里的条目仍然可列、可移动、可删。
- **查不到 ≠ 崩**：`define_word` 返回 `{ok:false, error}` 让模型换词或换源；不要改成抛错，否则丢失「是哪个词、试了哪两个源」。
- **`dryRun` 严格判等 `true`**：字符串 `"true"` 不算，避免模型用字符串参数时误写库。
- **`set_dictionary` 的 `show` 必填**：不同于 `chinese`/`english` 可省略；省略语义是「别动这一格」，不是「清空」。

守护：`test/tool.test.mjs`「the dictionary settings written by the tool read back unchanged」「normalize_words strips punctuation and keeps the sentence it came from」「define_word answers from the configured dictionary」。

## 相邻模块

- `50-dictionary/english-dictionaries`、`50-dictionary/chinese-dictionary`：`lookUp*` 的实现与返回形状。
- `50-dictionary/model-dictionary`：配成 `model` 时由面板那一路补，这里只留空格。
- `10-panel/host-sync`：面板的 `adopt` 把 `settings.dictionary` 吸收成 `dictShow`/`dictCn`/`dictEn`；两边的取值必须一致。
- `10-panel/word-card`：用同一份设置决定屏幕上是双语、只看英还是只看中。
- `30-store/secrets`：Collins key 存在宿主，工具不读不写。

## 改这里时

- **加一个词典源**：`ENGLISH_SOURCES` 或 `CHINESE_SOURCES` 加值 → `define_word` 加分支 → 面板设置卡加选项与文案 → `dictionaryOf` 自动跟着白名单走 → 补用例。
- **加一个设置项**：`get_settings` 的返回、`set_dictionary` 的校验与合并、面板的读取（`adopt`）三处一起改；只改一处会出现「设了但界面不认」。
- **改清洗规则**：先用 `dryRun` 的用例验证报告准确，再验证写入；任何可能清空的规则都要保留 `skipped` 分支。
- **想让工具走模型释义/翻译**：不要在 `define_word` 里造，那条路需要 `ctx`，归 `50-dictionary/model-route`。

## 读代码顺序

1. 四个常量：`SHOW_MODES`、`CHINESE_SOURCES`、`ENGLISH_SOURCES`、`DEFAULT_DICTIONARY`。
2. `dictionaryOf`。
3. `get_settings`。
4. `set_dictionary`（校验 → 合并 → 写库）。
5. `sensesOf`（`publicWord` 复用它过滤释义）。
6. `normalize_words`。
7. `define_word`（源选择与 `catch`）。