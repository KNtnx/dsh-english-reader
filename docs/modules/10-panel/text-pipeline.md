# text-pipeline

## 职责

把粘贴进来的一段英文变成「句子数组 + 这是文章还是对话 + 标题」。全部是纯函数，不碰 React、不碰网络，因此可以在没有 DOM 的测试里逐条验证。

## 位置

- `client.js` :: `splitSentences`, `readLines`, `detectMode`, `parseDialogue`, `titleFor`, `hashText`

## 输入 → 输出

| 函数 | 输入 | 输出 | 关键规则 |
| --- | --- | --- | --- |
| `readLines(raw)` | 整段文本 | 行对象数组（带标签/正文切分） | 先把硬换行接回去，`A:` / `A：` 才算说话人 |
| `splitSentences(value)` | 一行或一段 | `string[]` | `.` `!` `?` `…` 断句；缩写（`Dr.`、`e.g.`）、小数（`3.5`）不断；后引号跟着句子走 |
| `detectMode(entries)` | 行对象数组 | `'dialogue'` / `'article'` | 两个以上**不同**标签且覆盖 ≥1/4 的行才算对话 |
| `parseDialogue(raw, requestedMode)` | 原文 + 可选强制模式 | `{ mode, sentences: [{ text, speaker }] }` | `requestedMode` 可覆盖判定（界面上的「朗读方式」） |
| `titleFor(raw)` | 原文 | 标题 | 取第一行正文（去掉说话人），超过 46 字截断加 `…`；只在**新建**对话时调用 |
| `hashText(value)` | 任意文本 | 36 进制短哈希 | FNV-1a；用来判断「这段文本是不是同一篇」 |

`splitSentences('')` 返回 `[]`；空白句不会进结果。段落只能靠空行还原，没有空行的粘贴会连成一段——这是已知限制，写在这里而不是藏起来。

## 不变量

- **断句结果拼回去必须等于原文**（只差空白折叠），否则朗读时高亮与语音对不上。
- **判定只依赖文本**：不读设置、不读库；`requestedMode` 由调用方给。
- **`parseDialogue` 的 `sentences` 顺序即朗读顺序**，`index` 就是位置，落盘就是它。
- **`hashText` 变化意味着「换了一篇」**：`ReaderBody` 用它判断是否需要重置朗读位置。
- **标题是一次性的推导，不是正文的预览**：`titleFor` 只在新建对话时跑一次；编辑保存（`startReading`）沿用原来的 `title`，改名是唯一改标题的入口。所以改写正文第一句不会把名字带走。

守护：`test/internals.test.mjs` 的 7 条断句用例 + 对话判定 4 条 + 标题 1 条；「编辑不改标题」在 `test/panel.smoke.test.mjs`。

## 相邻模块

- 上游：`10-panel/panel-shell`（编辑器与导入）、`10-panel/shared-store`（从库里读回的 `text`）。
- 下游：`10-panel/word-alignment`（拿到句子再切词）、`10-panel/playback`（逐句合成）。
- 无网络、无宿主依赖。

## 改这里时

- **改断句规则**：只动 `splitSentences`，然后**先加用例再改**——`test/internals.test.mjs` 里每条规则都有对应用例。
- **让判定更宽松**：改 `detectMode` 的阈值前，看 `docs/DETAIL.zh.md`「这是文章还是对话」一节，那里写着对用户的承诺。
- **加一种说话人写法**（如 `A -`）：改 `readLines` 的正则，并补一条 internals 用例。

## 读代码顺序

1. `readLines`（谁被当成说话人）。
2. `splitSentences`（缩写与小数的例外列表）。
3. `detectMode` 的阈值。
4. `parseDialogue`（`requestedMode` 如何覆盖）。
5. `titleFor`。