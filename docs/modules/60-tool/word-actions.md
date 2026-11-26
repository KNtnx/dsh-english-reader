# word-actions

## 职责

管「单词」这一半：列、加、批加、删、批删、移动归类，以及它们共用的那几个 helper——一条词存在哪个 id 下、属于哪个夹子、删除怎么传出去。

## 位置

- `host/tool.js` :: `list_words`, `add_word`, `add_words`, `remove_word`, `remove_words`, `move_words`, `wordId`, `askedWords`, `publicWord`, `foldersOf`, `folderNames`, `folderIdOf`, `folderFor`, `folderReport`

## 输入 → 输出

| 动作 | 参数 | 答案 |
| --- | --- | --- |
| `list_words` | `folder?`、`limit?` | `{total, words[], folder?}`；`total` 是过滤后的总数，`words` 才被 `limit` 截断，按 `addedAt` 倒序 |
| `add_word` | `word`、`context?`、`folder?`/`folderId?` | `{created, word?, total, folder?}`；`created` 表示这条之前不在库里 |
| `add_words` | `words[]`（字符串或 `{word, context}`）、`context?`、`folder?`/`folderId?` | `{added, updated, words[], total, folder}`；一次写入 |
| `remove_word` | `word` | `{removed:true, existed, id, total}` |
| `remove_words` | `words[]` | `{removed:true, count, missing[], total}` |
| `move_words` | `word` 或 `words[]`、`folder?`/`folderId?` | `{moved, missing[], folder, total}`；`folder: ''` 是「移回未分类」，也算一次移动 |

helper 各自的意思：

- `wordId(word)`：小写 → 去掉 `[^a-z' -]` → trim。所以 `"Jealousy."` 与 `"jealousy"` 是同一条；全无字母的词得到空 id，直接不算一次请求。
- `askedWords(args)`：把 `word`+`context` 或 `words`（字符串、或 `{word, context}` 记录）统一成数组；顶层 `context` 供整批使用。
- `publicWord(entry, folders)`：`word`、`id`、`context`、`folderId`、`folder`（夹名，不只是 id）、`senses`、`translation`、`addedAt`。缓存释义只在**有**的时候带——面板缓存的是它最后一次看到的那份。
- `folderFor(library, args, kind)`：`folderId` 优先，查不到就抛，消息里列出**现有夹名**；`folder` 是名字，大小写不敏感匹配，匹配不到就现场建一条 `{id, name, kind, createdAt}`；两者都没给即未分类。返回值里的 `made` 就是待写库的新夹。
- `folderIdOf(library, raw, kind)`：只读解析（列表过滤用），名字或 id 都认，找不到返回 `null`，`list_words` 据此报错而不是偷偷建夹。
- `folderReport(spot)`：答案里的夹子摘要 `{id, name, created}`，让调用方知道「这次归档是不是顺带建了夹」。
- `foldersOf` / `folderNames`：有 id 的夹子数组 / 「现有夹名」逗号串（错误消息用）。

## 不变量

- **归类看 `folderAt`**：`add_words` 与 `move_words` 在写 `folderId` 的同时写 `folderAt: now`。只改 `folderId` 不打戳，面板下一次保存就会把归档抹掉——`test/tool.test.mjs`「a move the tool writes survives a panel save that never saw it」守这条。
- **不整条替换一个词**：`add_words` 先展开库里的旧条目再覆盖自己认识的字段，面板写的 `note`、缓存释义等留在原处（「a word keeps the fields the tool does not know about」）。
- **名字建夹、id 报错**：`folder` 不存在就创建（这就是「归档不用先列夹子」）；`folderId` 不存在是错误，且消息里带上现有夹名与「改用 folder 传名字」的提示。
- **同名夹只建一次**：名字匹配忽略大小写；`create_folder` 是同一规则的显式入口。
- **删除写墓碑**：`removed: [{kind:'word', id, at}]`，与面板写的是同一种记录；没有它，别人手里的旧副本下次同步就把词带回来。
- **批量去重**：同一次调用里同一个 id 只写一条，`added` 只数真正新增的；`updated` = 写入条数 − 新增条数。
- **`limit` 夹在 1..200**，默认 50（`limitOf`）；列表报数量用 `total`。

守护：`test/tool.test.mjs` 的单词组与夹子组（去重与墓碑、保留未知字段、按名建夹、批量一次写、移动存活）。

## 相邻模块

- `tool-definition`：动作清单、参数 schema、`execute` 怎么把答案包起来。
- `dialogue-actions`：同构的另一半，`folderFor`/`folderIdOf` 两边共用。
- `30-store/merge-rules`：`folderAt` 的比较规则（`>=` 平局取后写的一方）在宿主合并里。
- `10-panel/shared-store`：面板写的 `words`、`folders`、`removed` 形状必须与这里一致。
- 用例：`70-testing/unit-and-host` 的 `test/tool.test.mjs`。

## 改这里时

- **加一个词级动作**：先看能不能并进 `add_words`/`move_words`/`remove_words`——模型一次调用做一件事，但一件事可以带十个词。
- **改 id 规则**：`wordId` 同时被增、移、删、公开形状使用；换规则等于换库，老数据要迁移，并且面板的收藏判断也要跟着改。
- **加一种归类方式**（多夹、标签）：`folderFor` 是唯一入口，`folderAt` 的语义（最后一次移动的时间）必须保住。
- **改错误话术**：错误里必须给可执行的下一步（现有夹名、"pass \"folder\" with a name to create one"）。
- **改列表排序**：`list_words` 按 `addedAt` 倒序；换字段会让「最近存的在最上面」这条用户预期变掉。

## 读代码顺序

1. `wordId`。
2. `askedWords`。
3. `foldersOf` / `folderNames` / `folderIdOf` / `folderFor` / `folderReport`。
4. `publicWord`。
5. `list_words`。
6. `add_words`（最复杂：去重、保留未知字段、打戳、顺带建夹）。
7. `move_words`、`remove_words`、`remove_word`。