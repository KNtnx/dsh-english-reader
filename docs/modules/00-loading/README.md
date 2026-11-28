# 00 装载与契约

**一句话**：这个插件是「一个包里两个半边」——宿主半边由 `index.js` 交给 DSH 的 Cordis 加载器，浏览器半边由 `client.js` 自己向 `__ModuleLoader__` 报到；本模块说明这两件事各自靠什么声明、在哪注册、注册失败会怎样。

## 一句话

- **负责**：`package.json` 的 `dsh` 字段、`cordis.patch.yml` 的插入行、宿主入口的装配顺序、客户端 `apply(ctx)` 的 5 处注册、插件详情页的本地化元数据。
- **不负责**：面板长什么样（`10-panel`）、路由处理逻辑（`20-routes`）、库怎么合并（`30-store`）。

## 代码入口

| 文件 | 关键符号 | 一句话 |
| --- | --- | --- |
| `package.json` | `dsh.bundle.patch`、`dsh.client`、`exports` | 声明两个半边怎么被找到 |
| `cordis.patch.yml` | `insert` 下的 `english-reader` 行 | 往 profile 里插一个插件条目 |
| `index.js` | `inject`、`apply` | 宿主入口：先装路由，再挂工具 |
| `client.js` | `apply(ctx)`（文件末尾） | 客户端入口：5 处注册 |
| `locale/en.json`、`locale/zh.json` | `meta` | 插件列表与详情页的标题/描述 |

## 小模块索引

| 小模块 | 一句话 | 文档 |
| --- | --- | --- |
| bundle-manifest | `package.json` 三个字段决定插件能不能被加载 | [bundle-manifest.md](./bundle-manifest.md) |
| host-entry | `index.js` 只有 30 行，装配顺序就是它的全部内容 | [host-entry.md](./host-entry.md) |
| client-registration | `apply(ctx)` 的 5 处注册：tab 类型、面板体、整页、按钮、输入框入口 | [client-registration.md](./client-registration.md) |
| locale-resources | `locale/*.json` 只管插件详情页，界面文案在 `10-panel/copy` | [locale-resources.md](./locale-resources.md) |
| self-update | 面板里的「检查更新」：插件页给不了 Git 包的更新按钮，所以按钮长在自己身上 | [self-update.md](./self-update.md) |
| release | 怎么发货：Git 看提交、npm 看版本号；首发的 tarball 会迟到几分钟 | [release.md](./release.md) |

## 数据流

```
dsh boot
  └─ profile 的 cordis.patch.yml  ── insert ──► 插件条目 english-reader
        └─ package.json 的 dsh.bundle.patch 指回同一个文件
        └─ import index.js ──► apply(ctx, config)
                                  ├─ host/routes.js 的 apply       （20 条路由，缺一条前端就 404）
                                  └─ host/tool.js 的 mountTool     （软依赖：没有 tools 服务就安静跳过）

浏览器
  └─ __ModuleLoader__.load({ id, factory })   ← client.js 的第一行和最后一行
        └─ factory(require) 返回 { inject, internals, apply }
              └─ apply(ctx) 用 ctx.slots / ctx.sidebarRightTabs 注册界面
```

## 常见改动

| 需求 | 改哪里 | 顺手补什么 |
| --- | --- | --- |
| 插件改名 / 换 id | `package.json` 的 `dsh`、`cordis.patch.yml`、`client.js` 顶部 `TAB_ID`/`PANEL_ID`/`KIND`/`NS` | `test/copy.test.mjs`、`test/host.test.mjs`「every route…」 |
| 面板需要新的宿主服务（如 `ctx.fs`） | `client.js` 的 `inject` 数组 + `apply` 里使用 | `test/panel.smoke.test.mjs` 的假 ctx 要补同一个服务 |
| 宿主多挂一个半边 | `index.js` 的 `apply` | `test/tool.test.mjs`「the plugin still loads when a host has no tool registry」 |
| 详情页文案 | `locale/en.json`、`locale/zh.json` 的 `meta` | 无测试，人工看插件页 |

## 风险与历史坑

- **`client.js` 没有构建步骤**：`export`/`import` 都没有，全部靠 `factory(require)` 里的 `require('react')`。想拆文件就必须引入打包，见 `AGENTS.md` 的硬约束第 1、2 条。
- **注册失败是静默的**：`ctx.slots.register` 抛错只会让面板消失，不会让宿主报错。所以每个注册都包在 `ctx.effect(...)` 里，卸载时由 DSH 统一回收。
- **`tools` 是软依赖**：`mountTool` 在 `ctx.inject(['tools'], …)` 里注册，宿主没有工具注册表时插件照常加载（`test/tool.test.mjs` 守着）。
- **路径写过一次就错**：拆分 `host/` 之后 `./worker.mjs` 曾变成 `host/worker.mjs`，结果每句都 502。见 `70-testing/contract-tests.md` 的「every module points at files that exist」。