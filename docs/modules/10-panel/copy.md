# copy

## 职责

面板里每一个字：一张 `en` / `zh` 的扁平表，加上取词函数 `t()` 与占位符替换。改文案只动这里。

## 位置

- `client.js` :: `DICT`, `fill`, `localised`, `NS`, `SAMPLE`, `EDGE_VOICES`, `LOCAL_VOICES`, `SPEEDS`

## 输入 → 输出

- `DICT` 是 `{ en: {key: text}, zh: {key: text} }`，key 用点分命名（`tab.title`、`dict.kind.zh`、`error.notInstalled`）。
- `fill(text, vars)`：把 `{n}` / `{index}` 之类占位符替换成值；没有 vars 时原样返回。
- `t(key, vars)`（在 `ReaderBody` 里）= `fill(dict[key] ?? key, vars)`；**取不到的 key 返回 key 本身**——这是故意的，缺文案不会让面板崩，只会露出 `some.key`。
- 当前语言：`localised()` 看 `localeSource` 的 locale 是否以 `zh` 开头，否则英文。
- 常量表（`SPEEDS`、`EDGE_VOICES`、`LOCAL_VOICES`）也在这里，因为它们与文案一一对应。

## 不变量

- **两个语言的 key 集合必须相同**。`ctx.locale.register(NS, {en, zh})` 直接把两张表交给 DSH；少一个 key，中文界面会露出 key 名。
- **占位符名要和调用处一致**：`t('words.count', { n })` 里 `{n}` 两边拼错不会报错，只会显示原文。
- **不要在视图里拼中文**：拼了就绕过了 `t()`，切换语言时那一段不变。

守护：`test/copy.test.mjs`（图标与 key 的静态契约）、`test/views.test.mjs`（视图拿到的值都在 `ui` 里）。

## 相邻模块

- 上游：`00-loading/client-registration`（`apply` 里注册 `DICT`）。
- 下游：`10-panel/views`、`10-panel/panel-shell`（都通过 `t` 取词）。
- 容易混淆：`00-loading/locale-resources`（那是插件详情页的文案，不是界面文案）。

## 改这里时

- **加一条文案**：在 `DICT.en` 与 `DICT.zh` 各加一行（同一个 key），然后在视图里 `t('新.key')`。
- **加占位符**：写 `'共 {n} 个'`，调用处 `t('key', { n: 12 })`。
- **加一种语言**：`DICT` 加第三张表 + `localised()` 加分支 + 注册处加一项；注意 `locale/*.json` 也要加。

## 读代码顺序

1. `DICT.en` 的前 20 个 key（看出命名习惯）。
2. `DICT.zh` 对照同一批 key。
3. `fill`。
4. `apply` 里的 `ctx.locale.register`。
5. `ReaderBody` 里的 `const t = useCallback(...)`。