# host-entry

## 职责

宿主半边的入口：把「路由」和「工具」两件互不依赖的事装配到一起，并把 `inject` 声明交给 Cordis。全文件 30 行，顺序就是它的全部语义。

## 位置

- `index.js` :: `inject`, `apply`, `applyRoutes`, `mountTool`

## 输入 → 输出

- `inject`（数组）：告诉 Cordis 本插件需要 `webServer` 服务；没有它，`register` 无处可注册。
- `apply(ctx, config)`：同步返回，无返回值。它做两件事，顺序有意义：
  1. `applyRoutes(ctx, config)` —— 16 条路由，**必须成功**，缺一条前端就 404；
  2. `mountTool(ctx)` —— 模型工具，**失败也不影响面板**。
- `config` 来自 `cordis.patch.yml` 里那一行的 `config`，目前是 `{}`，但 `host/routes.js` 会读 `microsoftKey` / `tencentSecretId` 等可选键。

## 不变量

- **工具不阻塞面板**：`mountTool` 内部 `ctx.inject(['tools'], …)` + `try/catch`，宿主没有工具注册表时安静跳过。`test/tool.test.mjs`「the plugin still loads when a host has no tool registry」守着。
- **路由先于工具**：路由是插件的主体，工具是附加能力；反过来写会让一次工具注册失败连带整个面板消失。
- **`inject` 只声明真正用到的服务**：多声明一个会让插件在缺它的 profile 里永远 pending。
- **不要在入口里做 IO**：模型目录的 `mkdir` 在 `host/routes.js` 的 `apply` 里（包在 `ctx.effect` 中，卸载时清理）。

## 相邻模块

- 上游：`00-loading/bundle-manifest`（`exports['.']` 指向本文件）。
- 下游：`20-routes/route-table`（`apply`）、`60-tool/tool-definition`（`mountTool`）。
- 邻居：`40-speech` 的 worker 生命周期挂在 routes 的 `apply` 里，卸载时 `kill`。

## 改这里时

- **新增一个宿主半边**（例如再加一个工具集）：在 `apply` 里加一行，并确认它不会抛——入口抛错等于整个插件不可用。
- **让工具变成必需**：把 `mountTool` 从软依赖改成硬依赖前，先想清楚没有 `tools` 服务的 headless 宿主会怎样（现在是「加载、但没有工具」）。
- **换注入的服务名**：`inject` 数组与 `host/routes.js` 里 `ctx.webServer` 的用法要同时对。

## 读代码顺序

1. `index.js` 顶部的注释（一张模块地图）。
2. `import` 两行：`applyRoutes` 与 `mountTool` 分别来自哪里。
3. `export { inject }`。
4. `export function apply`：两行调用，记住顺序。
5. 需要细节时跳到 `20-routes/route-table.md` 与 `60-tool/tool-definition.md`。