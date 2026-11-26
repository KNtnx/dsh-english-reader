# route-table

## 职责

宿主路由的注册表与安装过程：`ROUTES` 说清「哪个路径、哪种形态、哪个处理函数、用哪个标签卸载」，`bindRoute` 把插件 `config` 与宿主 `ctx` 预先绑进处理函数，`apply` 用 `ctx.effect` 逐条注册——插件卸载时 15 条一起被摘掉。

## 位置

- `host/routes.js` :: `inject`, `ROUTES`, `bindRoute`, `apply`, `sendJson`, `requestUrl`, `readBody`
- `host/constants.js` :: `PATHS`

## 输入 → 输出

| 符号 | 作用 |
| --- | --- |
| `inject` | `['webServer']`：本模块唯一的硬依赖；没有它 `register` 无处可去 |
| `ROUTES` | 15 个条目，字段是 `path` + （`resource` 或 `handler` 二选一）+ `effect` |
| `bindRoute(route, config, ctx)` | 返回 `{kind: 'exact', path, resource}` 或 `{kind: 'exact', path, handler}`；`config`/`ctx` 在这一层被吃掉 |
| `apply(ctx, config)` | 先一个 effect：建模型目录、探一次模型、卸载时清 `pending` 并 `worker.kill()`；再 `for (const route of ROUTES)` 每条一个 effect |
| `sendJson(response, payload, status)` | node 风格响应：`application/json` + `cache-control: no-store` |
| `requestUrl(request)` | 把可能只有路径的 `request.url` 补成绝对 `URL`（base 用 `http://localhost`） |
| `readBody(request, limit)` | 流式读体；超限 `{tooLarge: true}`，读失败 `{failed: true}`，**从不抛** |

两种形态的分界只有一句：`resource` 返回一个 `Response`（音频或 JSON），`handler` 拿到 node 的 `response` 自己 `writeHead` / `end`。需要 `config`（密钥）或 `ctx`（模型路由）的都用 `resource`；需要流式读大 body 的用 `handler`。

## 不变量

- **每条都是 `kind: 'exact'`**：没有前缀表、没有中间件、没有顺序依赖。路径写错就是 404，不会「被上一条接住」。
- **一个路由一个 effect 标签**：标签是字符串（`english-reader: shared library` 之类），也是 `ctx.effect` 的登记名；让它唯一，排查「哪条没卸掉」时才分得清。加路由就加新标签。
- **`config` 只在这里透传**：`ROUTES` 里存的是未绑定的函数，同一份表可以被不同 `config` 的插件实例各绑一次；处理函数签名是 `(request[, response], config, ctx)`，用不到就不声明。
- **`readBody` 不抛**：所有 handler 都必须显式看 `tooLarge` / `failed`，否则会把半个对象当完整请求。
- **新增路径要两处登记**：`PATHS` 加键、`ROUTES` 加条目。`test/host.test.mjs` 的第一条用例双向检查「前端调用的路径宿主都有」与「宿主声明的路径都注册了」。

## 相邻模块

- 上游：`00-loading/host-entry`（`apply` 由 `index.js` 调用，顺序在 `mountTool` 之前）。
- 下游：`20-routes/speech-routes`、`model-routes`、`dictionary-routes`、`translate-routes`、`library-routes`（五组处理函数）。
- 邻居：`30-store/paths-and-limits`（`PATHS` 与各类上限的出处）；`40-speech` 的 worker 生命周期也挂在本模块的 `apply` 里，卸载时清 `pending`、`worker.kill()`。

## 改这里时

- **加一条路由**：先在 `PATHS` 起名，再在 `ROUTES` 末尾加 `{path, resource|handler, effect}`。位置无所谓，匹配是精确的；但顺序与 `PATHS` 的书写顺序保持一致，读起来更省事。
- **换一种形态**：`resource` → `handler` 时，处理函数要改成自己写响应头，`bindRoute` 不用动；反过来同理，但别让 `Response` 和 `response.end` 混用。
- **加 config 键**：只在需要它的处理函数签名里补一个形参——`bindRoute` 已经按形态把 `config`/`ctx` 接在请求参数之后（`resource` 是第 2、3 位，`handler` 是第 3、4 位）；`cordis.patch.yml` 的 `config` 与 `test/host.test.mjs` 的假 context 要一起对。
- **改注册方式**（例如挂到别的前缀、改成中间件）：`bindRoute` 是唯一出口，改它不必碰 15 个 handler；同时确认 `client.js` 的 15 个常量跟着改。

## 读代码顺序

1. 文件头的 `import`：一眼看出五组业务分别在哪个模块。
2. `ROUTES`：15 条，配 `PATHS` 一起读，得到路径 ↔ 处理函数 ↔ 标签的完整映射。
3. `bindRoute`：为什么 `config`/`ctx` 不在 `ROUTES` 里。
4. `apply`：worker 的 effect + 循环注册的 effect。
5. 三条公共件 `sendJson`、`requestUrl`、`readBody`——后面每个 handler 都会用到它们。