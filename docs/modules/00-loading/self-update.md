# self-update

## 职责

让插件**自己**把新提交装上来。DSH 的插件页只给「目录条目」更新按钮——它得知道一个目标版本号；从 Git spec 装的包没有目标版本，页面永远只显示来源和版本，点不了。所以按钮长在面板里：宿主问 GitHub 要 `main` 上的最新提交，跟 profile 锁文件里钉住的那条比，再把精确的 spec 交给插件管理器安装。

## 位置

- `host/update.js` :: `REPO`, `COMMIT`, `currentCommit`, `latestCommit`, `checkForUpdate`, `applyUpdate`
- `host/routes.js` :: `handleUpdate`, `apply`（`pluginManager` 软依赖）
- `host/constants.js` :: `PATHS.update`
- `client.js` :: `UPDATE`, `checkUpdate`, `applyUpdate`, `versionBlock`, `versionNote`

## 输入 → 输出

| 调用 | 行为 | 回答 |
| --- | --- | --- |
| `GET /api-dsh-english-reader/update` | 读 `pnpm-lock.yaml` 里本包的提交，`GET api.github.com/repos/…/commits/main` | `{current, latest, newer, message, date}`；取不到时 502 `{error}` |
| `POST /…/update` body `{sha}` | 先回 202，再 `installBundle('github:KNtnx/dsh-english-reader#<sha>')` | 202 `{started, target}`；缺 `sha` 或不是 40 位提交 → 400；没有插件管理器 → 503 |
| 面板「引擎」区底部 | 一行版本状态 + 一个按钮：没查过显示「版本未知」，查过显示「已是最新 · sha」或「有新版本：sha」 | 按钮文案随之在「检查更新 / 立即更新 / 正在更新…」之间切换 |

## 不变量

- **先回复再安装**：`installBundle` 会替换正在运行的包并重载 profile，晚一秒回包就永远回不出去。所以 202 先落地，安装扔给后台。
- **只用完整提交**：管理器的 Git 安装要求 spec `#` 后面正好是 40 位提交（`COMMIT`）；短 sha 或分支名会被它拒。面板传的是 API 回来的全 sha。
- **比较的是提交，不是版本号**：`package.json` 的 `version` 不参与判断——从 Git 装的包按提交走，版本号只影响插件页显示。
- **插件管理器是软依赖**：没有它（或宿主没有 `inject`）时路由照常注册，只有 POST 回 503；检查更新仍然可用。
- **不自动检查**：打开设置不发请求，用户点了才查——GitHub 未认证接口有频率限制。
- **装上以后要重启吗**：`installBundle` 自己会重载 profile，通常不用；面板提示「重启 DSH 生效」是为了让**新代码**在客户端也干净地加载（客户端 bundle 有缓存）。

## 相邻模块

- 上游：`00-loading/bundle-manifest`（为什么 spec 是 `github:` 形态）、`10-panel/panel-shell`（设置卡片的结构）。
- 下游：DSH 的 `pluginManager` 服务（`installBundle`）、`pnpm-lock.yaml`。
- 相关：`40-speech/engine-install`（另一个「按需安装」的东西，但它装的是依赖而不是插件自己）。

## 改这里时

- **换仓库**：`REPO` 一处；`applyUpdate` 拼 spec、`latestCommit` 拼 API URL 都从它来。
- **换分支**：`latestCommit` 里的 `commits/main`；换了默认分支这里要跟着改。
- **加「更新到某个指定提交」**：POST 已经接受任意全 sha，面板补一个输入框即可。
- **改状态文案**：`DICT` 里 `version.*` 共 10 个 key，中英各一份。

## 读代码顺序

1. `currentCommit`：锁文件里那段 `dsh-english-reader:` 块长什么样（`tar.gz/<sha>`）。
2. `latestCommit` / `checkForUpdate`：网络失败怎么变成一句话错误。
3. `handleUpdate`：为什么 202 要先发。
4. `applyUpdate` 拼出来的 spec 与 `pinnedGitOrigin` 认的形状。
5. 面板 `versionBlock` 的三种状态（未知 / 已是最新 / 有新版）。