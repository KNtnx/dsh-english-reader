# contract-tests

## 职责

三个不执行代码、只读 `client.js` 源码的扫描器：文案与图标、视图收到的值、函数作用域。它们抓「编译能过、跑起来才炸」的那一类——错位的 key、没有规则的类名、只在某个分支出现的 `ReferenceError`。本轮起再加一份文档契约（`test/docs.test.mjs`），把文档也当代码检查。

为什么静态检查能抓到「跑起来才炸」的问题：这些 bug 的共同形状是**两处的名字必须相等**——文案 key 的两张表、类名与 CSS、视图与 `ui` 的字段、函数与它用到的名字、文档与源码符号。运行时它们散在少见分支里；静态扫描只比较文本，加载前就能把「对不上」变成一条失败。代价是它们不理解语义：`scope.test.mjs` 看不见字符串与模板里的名字，属性名会跳过；`views.test.mjs` 用正则切函数体。它们只守「名字搬家」这一类，够用即可。

## 位置

- `test/copy.test.mjs` :: `DICT`, `classNameText`, `definedClasses`
- `test/views.test.mjs` :: `UNFED_ALLOWED`, `panelLocals`, `declaredIn`
- `test/scope.test.mjs` :: `tokenize`, `FUNCTIONS`, `UNITS`, `declarations`, `ownNames`, `factoryNames`, `PAIRS`, `REGEX_AFTER`, `KEYWORDS`

## 输入 → 输出

| 文件 | 条数 | 输入 | 断言什么 |
| --- | --- | --- | --- |
| `copy.test.mjs` | 5 | `DICT` 两张表；源码里的 `t('key')`、`className:`、`ICON.name` 与 `ICON` 块 | 两种语言的 key 集合相同且都非空；`t()` 要的 key 两边都有（含插值拼出来的那几族）；用到的 `er-*` 类名都有规则；用到的图标都定义，且路径含 `z`/`Z`（只描边不闭合的路径渲染成空图） |
| `views.test.mjs` | 1 | `ReaderBody` 的局部名、`const ui = {...}`、每个 `renderX(ui)` 的解构与函数体 | 视图用到的面板值必须来自 `ui` 或自己声明；视图解构了 `ui` 根本不带的名字也算错（`UNFED_ALLOWED` 只放行 `body`、`cardHeight` 这两个永远被内部遮蔽的名字） |
| `scope.test.mjs` | 1 | 把 `client.js` 切成 token，取出每个顶层函数的声明与使用 | 在一个函数里声明、在另一个函数里使用、又不在工厂作用域的名字，一律报错 |
| `docs.test.mjs` | —— | `docs/modules/**/*.md` + `AGENTS.md` | 大模块 README 的六个二级标题、小模块的七个；索引链到同目录每篇；`## 位置` 里引用的符号真能在该文件里 grep 到；不出现行号；单篇行数上限 |

三个扫描器的分工，对应三类历史 bug：

- `copy`：切换语言时露出 key 名、未上色的控件、空 `<svg>`（跟随图标曾整块没有）。
- `views`：拆视图时漏传值——`modelLoaded is not defined`、词卡 `cardHeight` 丢参后飞到页面顶部。
- `scope`：helper 放错作用域——`commitWidth` 留在另一个视图里，点「自定义」按钮才炸。

## 不变量

- **只读，不 import `client.js`**：它没有 `export`，能读不能执行；唯一执行它的是 `harness`。
- **`UNFED_ALLOWED` 是白名单，不是垃圾桶**：新加一项前先确认那个名字真的永远被视图内部遮蔽。
- **契约红了先怀疑重构**：它通常说明拆分时把名字或 key 搬走了，而不是「测试太严」。
- **文档契约同样会红**：改了标题、漏登记一篇、`## 位置` 写了不存在的符号，都要改文档而不是改检查。
- **行号一律不写**：行号会漂，符号名可以 grep；这条由 `docs.test.mjs` 强制。

## 相邻模块

- `70-testing/harness`：唯一执行 `client.js` 的地方，与这里的「只读」互补。
- `10-panel/copy`（`DICT`、`fill`）、`10-panel/views`（`renderX` 与 `ui`）、`10-panel/panel-shell`（`ReaderBody` 的局部名）。
- `docs/TESTING.zh.md` 的「历史 bug 与守护用例」表：这三份各守哪几条。
- `AGENTS.md` 的「文档规则」：`docs.test.mjs` 检查的就是那几条。

## 改这里时

- **加文案 / 类名 / 图标**：通常不用改测试，扫描器自动覆盖；除非是插值拼出的 key，要像文件里那样把候选显式加进 `wanted`。
- **拆视图、挪 helper**：先跑这三份；它红了就是真的漏传或越界，别急着改断言。
- **白名单变长**：先确认那个名字真的「永远被内部遮蔽」，否则等于关掉检查。
- **改文档结构**：先跑 `node --test test/docs.test.mjs`，它比人眼快。

## 读代码顺序

1. `copy.test.mjs` 的 `classNameText` 与 `definedClasses`（两个正则各抓什么）。
2. 同一个文件的图标块（为什么要求路径闭合）。
3. `views.test.mjs` 的 `panelLocals`（`ui` 能装什么）。
4. `views.test.mjs` 末尾的 `missing`/`unfed` 两段（两种失败方向）。
5. `scope.test.mjs` 的 `tokenize`（为什么先分词）。
6. `scope.test.mjs` 的 `UNITS` 与 `declarations`（什么叫「同层」）。