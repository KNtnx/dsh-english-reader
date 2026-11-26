# tool-definition

## 职责

定义 `english_reader` 对外长什么样：名字、给模型看的那段描述、`parameters` 与 `output` 两个 schema、`execute` 的分发与兜错，以及它怎么被挂到宿主上。

## 位置

- `host/tool.js` :: `ACTIONS`, `englishReaderTool`, `mountTool`, `HANDLERS`
- `index.js` :: `apply`, `mountTool`

## 输入 → 输出

| 符号 | 作用 |
| --- | --- |
| `englishReaderTool()` | 返回 `{ name, description, parameters, output, execute }`，直接交给 `tools.register` |
| `parameters` | 只有一个必填字段 `action`，`enum` 就是 `ACTIONS`；其余 15 个字段按动作选用，全部可选 |
| `output.schema` | `{type:'object', additionalProperties:true, required:['ok'], properties:{ok,error,action}}`——只有 `ok` 是所有答案共有的 |
| `output.render` | 把答案 `JSON.stringify(value, null, 2)` 塞进一条 text part，模型看到的是缩进后的 JSON |
| `execute(raw)` | 非对象参数当 `{}`；未知动作返回 `{ok:false, error, actions: ACTIONS}`；已知动作返回 `{ok:true, action, ...payload}`；handler 抛错被 `catch` 成 `{ok:false, action, error}` |
| `mountTool(ctx)` | `ctx.inject(['tools'], scope => scope.tools.register(englishReaderTool()))`；没有 `ctx.inject` 直接 return，注册抛错被吞掉 |

参数按用途分组（描述里也是这么写的）：

- 读：`list_words`、`list_folders`、`list_dialogues`、`get_settings`、`define_word`、`normalize_words`。
- 写：`add_word`、`add_words`、`remove_word`、`remove_words`、`move_words`、`create_folder`、`add_dialogue`、`rename_dialogue`、`move_dialogue`、`delete_dialogue`、`set_dictionary`。
- 归位：`folder`（名字）、`folderId`（id）、`name`+`kind`（建夹）、`id`/`title`（对话）、`words`/`word`（批量与单个）、`context`、`text`、`limit`、`dryRun`、`show`/`chinese`/`english`。

**为什么不用 `defineTool`**：本插件不依赖 `@deepseek-ai/dsh-tools`（`package.json` 里只有 `kokoro-js` 与 `msedge-tts`）。`defineTool` 会把工具层变成硬 import，解析失败时宿主的 `apply` 直接抛，面板的全部路由跟着一起没；现在这个定义是个纯对象，注册表只检查输出 schema，参数由各动作自己检查，跑不动的动作回一个错误对象而不是抛。

## 不变量

- **`name` 必须是 `english_reader`**：文档、用例与对话里的说法都按这个名字对齐，改它等于改模型的使用手册。
- **`action.enum` 必须等于 `ACTIONS`**，且 `ACTIONS` 的顺序就是描述里列动作的顺序；用例直接 `deepEqual` 这两者。
- **`execute` 永不抛**：参数错、动作错、上游网络坏，都在答案里；否则一次误调用会中断整个对话回合。
- **`required` 只有 `action`**：其余字段的必填性由每个 handler 自己判（例如 `add_dialogue` 要 `text`、`rename_dialogue` 要 `id` 与 `title`）。
- **输出 schema 故意宽松**：`additionalProperties: true`，新动作不必改 schema，只要答案里带 `ok`。
- **`mountTool` 必须留在 `ctx.inject` 里**：注册跟着插件生命周期走，卸载时由 DSH 回收；写成顶层 `ctx.tools.register` 会让「没有 tools 服务」的宿主加载失败。
- **描述是路由面**：模型靠它决定「要不要用这个工具、用哪个动作」；改行为要同步改描述，否则模型照旧用法调用。

守护：`test/tool.test.mjs` 前四条（定义、软依赖两条、有注册表时挂载）。

## 相邻模块

- 上游：`00-loading/host-entry`（`index.js` 的 `apply` 调 `mountTool`，顺序在路由之后）。
- 下游：`30-store/library-file`（`readStore`/`writeStore`）、`30-store/merge-rules`（`mergeStore`）。
- 同层：`20-routes/route-table`——面板走 HTTP，模型走注册表，两条路落到同一个文件。
- 用例：`70-testing/unit-and-host` 里的 `test/tool.test.mjs`。

## 改这里时

- **加一个动作**：`ACTIONS`、`HANDLERS`、`parameters.properties`、描述四处一起改；`output` 不用动。
- **加参数**：`parameters.properties` 加一项，描述里写清哪几个动作读它；handler 里自己校验，别指望 schema 的 `required`。
- **想让错误更可执行**：在 handler 里 `throw new Error('…')`，消息里给下一步（现有夹名、可选值、该用哪个字段）。例外是 `define_word`，见 `settings-actions`。
- **换挂载方式**：先把 `test/tool.test.mjs`「the plugin still loads when a host has no tool registry」跑一遍，它模拟的就是没有注册表的宿主。

## 读代码顺序

1. `ACTIONS`。
2. `englishReaderTool` 的 `description`（模型看到的全文）。
3. `parameters.properties` 与 `required`。
4. `output.schema` 与 `output.render`。
5. `execute`（未知动作分支与 `catch`）。
6. `mountTool`。