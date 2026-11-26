# dialogue-actions

## 职责

管「对话」这一半：列、加、改名、移动、删除，以及它们的公开形状与两个派生规则——标题从哪来、长度怎么数。

## 位置

- `host/tool.js` :: `list_dialogues`, `add_dialogue`, `rename_dialogue`, `move_dialogue`, `delete_dialogue`, `publicDialogue`, `titleFor`, `sentenceCount`, `makeId`, `SPEAKER`

## 输入 → 输出

| 动作 | 参数 | 答案 |
| --- | --- | --- |
| `list_dialogues` | `folder?`、`limit?` | `{total, dialogues[]}`；按 `updatedAt` 倒序，`total` 是过滤后的总数 |
| `add_dialogue` | `text`、`title?`、`folder?`/`folderId?` | `{created:true, dialogue, total, folder?}`；`text` 必填（空文本抛错），标题省略时 `titleFor(text)` |
| `rename_dialogue` | `id`、`title` | `{dialogue}`；只改 `title` 与 `updatedAt`，正文一个字不动 |
| `move_dialogue` | `id` 或 `title`、`folder?`/`folderId?` | `{dialogue, folder}`；给了 id 就只按 id 找，否则按标题（忽略大小写）精确匹配 |
| `delete_dialogue` | `id` | `{removed:true, existed, id, total}`；墓碑是 `{kind:'item', id, at}` |

派生规则：

- `publicDialogue(entry, folders)` → `{id, title, sentences, index, mode?, folderId?, folder?, updatedAt}`；`sentences` 每次现算，不落库；`mode`/`folderId`/`folder` 只在有值时出现。
- `makeId()` → `d` + 时间戳 base36 + 5 位随机。没有碰撞检查，也不需要：id 只在条目创建时产生，夹子建夹时也用同一个函数。
- `titleFor(text)` → 第一个非空行；行首有 `Name:` / `Name：` 标签（`SPEAKER`）就去掉标签只留正文；压平空白；超过 46 字符截到 45 再加 `…`。
- `sentenceCount(text)` → 把文本压平后按 `.!?…` 切句的**近似**。它不做缩写与小数合并，所以一行以 `Dr.` 结尾时，这里可能比面板多算一句——只用于列表报长度。

`add_dialogue` 落库的条目固定带 `mode: 'article'`、`index: 0`、`createdAt`/`updatedAt`，归档时再加 `folderId` 与 `folderAt`。

## 不变量

- **删除的墓碑是 `kind: 'item'`**，不是 `dialogue`：面板的 `removed` 用的就是这个词，两边必须一致，否则删除对面板不可见。
- **id 维持面板的形状**（`^d[0-9a-z]+$`）：面板按 id 记住活跃条目，换 uuid 之类会让老状态对不上。
- **工具不猜文本类型**：新增的对话一律 `article`，面板下次编辑时自己重新判定；不要在工具里跑断句。
- **改名改 `updatedAt`，移动只加 `folderAt`**：前者是「这条被编辑过」，后者是「这条被归过类」；合并按各自的时间戳判新旧，混用会让一次移动被当成一次编辑。
- **正文原样落库**：`text` 只 trim 首尾，不重排、不修标点；清理标点那套（`normalize_words`）只对单词。
- **标题只有两个来源**：调用方给的 `title`，或 `titleFor` 从第一行推导。不要在工具里发明第三种命名。
- **找不到要说清找的是什么**：按 id 找不到报 id，按标题找不到报标题，别统一成一句「not found」。

守护：`test/tool.test.mjs`「a dialogue is added, listed, renamed and deleted」「a dialogue with no title is named from its first turn」「a dialogue can be created in a folder and moved between them」。

## 相邻模块

- `word-actions`：同构的一半，`folderFor`/`folderIdOf` 共用。
- `10-panel/text-pipeline`：面板真正的断句与标题规则；`titleFor`/`sentenceCount` 是它的简化版，改面板规则时要回来看这里还对不对得上。
- `30-store/merge-rules`：`items` 按 `updatedAt` 判新旧，归类按 `folderAt`。
- `10-panel/views`：库列表显示 `title` 与「读到哪里」，即 `index` 与 `sentences`。

## 改这里时

- **支持在对话里改正文**：现在没有这个动作；加的话必须更新 `updatedAt`，并让面板重新断句、重算 `sentenceCount`。
- **改标题规则**：先改 `10-panel/text-pipeline` 的 `titleFor`，两边给出同样的行标题；用例里断言标签被去掉。
- **改 id 形状**：`makeId` 同时给夹子用；改一处等于改两处，还要想清楚老 id 怎么办。
- **加「按标题删除」**：`move_dialogue` 已经做过标题匹配，照抄它的错误消息风格（说明该用 `id` 还是 `title`）。
- **改排序**：`list_dialogues` 按 `updatedAt` 倒序，和面板「最近打开的在上」一致。

## 读代码顺序

1. `makeId`。
2. `titleFor` 与 `SPEAKER`（标签长什么样、为什么只允许一两个词）。
3. `sentenceCount`（近似到什么程度）。
4. `publicDialogue`。
5. `add_dialogue`。
6. `rename_dialogue` / `move_dialogue` / `delete_dialogue`。