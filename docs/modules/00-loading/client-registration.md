# client-registration

## 职责

`client.js` 末尾的 `apply(ctx)`：把面板挂到 DSH 的四个槽位上（侧栏 tab、面板体、整页、输入框入口），并把文案表注册成一份 locale 命名空间。注册错了的表现不是报错，而是**面板根本不出现**。

## 位置

- `client.js` :: `apply`, `localeSource`, `localised`, `openTab`, `ReaderBoot`, `PanelIcon`, `Launcher`, `GuideGlyph`, `DICT`, `NS`
- `client.js` :: `TAB_ID`, `PANEL_ID`, `KIND`

## 输入 → 输出

五处注册，缺一处就少一个入口：

| 顺序 | 槽位 | 注册了什么 | 用户看到 |
| --- | --- | --- | --- |
| 1 | `ctx.locale.register(NS, {en, zh})` | 整张 `DICT` 表 | 所有 `t('...')` 的来源 |
| 2 | `ctx.sidebarRightTabs.register` | tab 类型 + 引导卡（`keepMounted: true`） | 右侧栏多一个「对话朗读」页签 |
| 3 | `ctx.slots.inject('sidebar.right.pane.tab')` | `ReaderBoot` | 页签里的面板本体 |
| 4 | `ctx.slots.inject('sidebar.panellist')` + `('main')` | `PanelIcon` + `ReaderBoot` | 左侧栏按钮 → 整页视图 |
| 5 | `ctx.slots.inject('conversation.input.left')` | `Launcher` | 输入框上方的小按钮，点了开侧栏 |

- `localeSource` 是给组件用的可观察源：`getSnapshot()` 读 `ctx.locale.getLocale().active`，`subscribe()` 转发 `ctx.locale.subscribe`。组件永远拿不到 `ctx`。
- `localised()` 按当前语言返回 `DICT.zh` 或 `DICT.en`——没写中文就回落英文。
- `openTab()` 包了 `try/catch`：还没有会话在屏幕上时，侧栏 API 会抛。

## 不变量

- **`keepMounted: true` 不能去掉**：侧栏一收起就卸载面板，播放会断、滚动位置与词卡状态会丢。
- **组件不碰 `ctx`**：`inject: () => ({...})` 只暴露 `localeSource`、`pickDirectory` 这类可观察值/回调。把 `ctx` 传进组件会让热卸载失效，并让测试无法造假 ctx。
- **`ReaderBoot` 是唯一入口组件**：它自己读共享库，然后才渲染 `Reader`（错误边界）。父组件不能替它调 hook——`ReaderBody` 是以普通函数调用的，无法再持有自己的 hook。
- **每个注册都包在 `ctx.effect`**：卸载插件时槽位必须自动回收。

守护：`test/panel.smoke.test.mjs` 通过 `__ModuleLoader__` 真挂载，少一个注册直接报「the panel never registered…」。

## 相邻模块

- 上游：`00-loading/bundle-manifest`（`dsh.client.inject` 声明依赖的 UI 包）。
- 下游：`10-panel/panel-shell`（`ReaderBody`）、`10-panel/copy`（`DICT` 与 `t`）。
- 邻居：`10-panel/shared-store`（`ReaderBoot` 启动时读库）。

## 改这里时

- **加一个入口**：先确认槽位名在目标包里存在（`sidebar.panellist` / `main` / `conversation.input.left`），再在 `apply` 里照抄一段 `ctx.effect(() => ctx.slots.inject(...))`，补 `test/panel.smoke.test.mjs`。
- **改页签标题/引导语**：改 `DICT` 表（`tab.title`、`guide.title`、`guide.desc`），不要在 `apply` 里写死中文。
- **让面板能在更多端出现**：`package.json` 的 `dsh.client.inject` 与这里的 `inject` 数组要一起加。

## 读代码顺序

1. `client.js` 第 1 行 `window.__ModuleLoader__.load({ id, factory })` 与文件最后的 `}"`——它是整个文件的壳。
2. 工厂开头四个常量（`TAB_ID` / `PANEL_ID` / `KIND` / `NS`）。
3. `apply(ctx)`：`localeSource` → `localised` → `openTab`。
4. 五个 `ctx.effect(...)` 注册块，按上表顺序读。
5. `internals`（工厂导出的纯函数），测试靠它免 DOM 调 `mergeStates`。