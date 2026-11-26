# bundle-manifest

## 职责

用 `package.json` 的三个字段告诉 DSH：宿主半边从哪个文件进、浏览器半边从哪个文件进、往 profile 里插哪一行。它是插件唯一一份「怎么被加载」的声明。

## 位置

- `package.json` :: `dsh`, `bundle`, `patch`, `client`, `platform`, `immediately`, `inject`
- `package.json` :: `exports`, `files`
- `cordis.patch.yml` :: `insert`, `english-reader`

## 输入 → 输出

| 字段 | 值 | 谁读它、读来干什么 |
| --- | --- | --- |
| `dsh.bundle.patch` | `./cordis.patch.yml` | Cordis 加载器插值进 profile 的 patch 层 |
| `dsh.client.platform` | `web` | 客户端模块表：这份 bundle 只给 web 端 |
| `dsh.client.immediately` | `true` | 第一阶段预取：用户点开面板时 bundle 已在本地 |
| `dsh.client.inject` | `dsh-client-ui-sidebar-right`、`dsh-client-ui-conversation` | 声明本 bundle 依赖这两个 UI 包的行（槽位提供方） |
| `exports` | `.`、`./client`、`./locale/*.json`、`./icon` | 宿主 `import` 入口、客户端 bundle 入口、详情页资源 |
| `files` | 见文件 | npm 打包白名单；漏一个就发布一个坏的包 |

`cordis.patch.yml` 只做一件事：在 profile 的条目列表里 `insert` 一行 `english-reader`，`name` 指向本包，`config` 目前是空对象（宿主里的 `config` 参数就来自这里）。

## 不变量

- `dsh.client.platform` 必须是 `web`；写成别的值，bundle 不会被任何端加载。
- `exports['./client']` 与 `files` 里的 `client.js` 必须同时存在，否则客户端表拿到一个空路径。
- `files` 必须包含 `host`、`worker.mjs`、`docs`；`worker.mjs` 漏掉时宿主能启动、但每句语音都失败（历史上就是这一类事故）。
- `cordis.patch.yml` 里的 `id` 必须唯一；与已有插件撞名会让整个 profile 起不来。

守护：`test/host.test.mjs`「every module points at files that exist」检查模块里 `new URL(...)` 指向的文件真实存在；`test/copy.test.mjs` 检查前端资源。

## 相邻模块

- 上游：DSH 的 profile 加载器（不在本仓库）。
- 下游：`00-loading/host-entry`（`index.js`）、`00-loading/client-registration`（`client.js` 的 `apply`）。
- 相关：`00-loading/locale-resources`（`exports['./locale/*.json']` 指的文件）。

## 改这里时

- **加一个客户端槽位依赖**：在 `dsh.client.inject` 追加包名 → 在 `client.js` 的 `inject` 数组同步追加服务名 → 补 `test/panel.smoke.test.mjs` 的假 ctx。
- **发布一个 npm 版本**：确认 `files` 里有 `AGENTS.md` 与 `docs/modules`（没列进去就不会被打包）。
- **改插件 id**：`cordis.patch.yml` 的 `id`、`package.json` 的 `name`、`client.js` 顶部四个常量（`TAB_ID`/`PANEL_ID`/`KIND`/`NS`）要一起改。

## 读代码顺序

1. `package.json` 的 `dsh` 字段（先看两个半边指向哪里）。
2. `cordis.patch.yml`（插入哪一行）。
3. `exports` 与 `files`（哪些文件会被发布）。
4. 回到 `00-loading/host-entry.md`，看宿主入口做了什么。