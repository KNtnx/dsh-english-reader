# self-update

## 职责

让插件**自己**判断有没有新版本并装上**同一形态**的下一版。DSH 的插件页只给「目录条目」和 registry 依赖更新按钮；从 Git spec 装的包在页面上永远没有按钮，所以面板里也留了一个。判定按安装形态分流：

- **npm（registry）装**：比版本号（自己 `package.json` 的 `version` 对 registry 的 `latest`），装 `dsh-english-reader@<版本>`；
- **Git 装**：比提交（`git ls-remote` 拿 `main` 的头，对 profile 锁文件里钉住的那条），装 `github:…#<完整提交>`。

按下按钮**不会**改变安装形态：npm 装的还是 npm 装，Git 装的还是 Git 装。

## 位置

- `host/update.js` :: `REPO`, `COMMIT`, `currentCommit`, `installedShape`, `ownVersion`, `gitHead`, `latestCommit`, `latestVersion`, `checkForUpdate`, `targetFits`, `applyUpdate`
- `host/routes.js` :: `handleUpdate`, `apply`（`pluginManager` 软依赖）
- `host/constants.js` :: `PATHS.update`
- `client.js` :: `UPDATE`, `checkUpdate`, `applyUpdate`, `versionBlock`, `versionNote`

## 输入 → 输出

| 调用 | 行为 | 回答 |
| --- | --- | --- |
| `GET /api-dsh-english-reader/update` | 读 `pnpm-lock.yaml` 里本包的提交，`git ls-remote` 问 `main` 的头 | `{current, latest, newer, message, date}`；取不到时 502 `{error}` |
| `POST /…/update` body `{target}` | 先回 202，再 `installBundle`：registry 装 `dsh-english-reader@<版本>`，Git 装钉住提交的 spec | 202 `{started, target}`；目标与形态不匹配（`targetFits`）→ 400；没有插件管理器 → 503 |
| 面板「引擎」区底部 | 一行版本状态 + 一个按钮：没查过显示「版本未知」，查过显示「已是最新 · sha」或「有新版本：sha」 | 按钮文案随之在「检查更新 / 立即更新 / 正在更新…」之间切换 |

## 不变量

- **先回复再安装**：`installBundle` 会替换正在运行的包并重载 profile，晚一秒回包就永远回不出去。所以 202 先落地，安装扔给后台。
- **只用完整提交**：管理器的 Git 安装要求 spec `#` 后面正好是 40 位提交（`COMMIT`）；短 sha 或分支名会被它拒。面板传的是 `git ls-remote` 回来的全 sha。
- **形态由 profile 决定，不由按钮决定**：`installedShape` 读 profile `package.json` 的依赖形态（版本号 / `github:` / `link:`）；`link:` 属于第三种，面板不提供更新（本地目录自己 `git pull`）。这是这条通道不被投诉「我一按它把我从 npm 变成了 Git 装」的原因。
- **registry 模式只问版本**：`GET registry.npmjs.org/dsh-english-reader/latest` 拿 `version`，不发 GitHub API、不看提交。
- **比较的是提交，不是版本号**：`package.json` 的 `version` 不参与判断——从 Git 装的包按提交走，版本号只影响插件页显示。
- **插件管理器是软依赖**：没有它（或宿主没有 `inject`）时路由照常注册，只有 POST 回 503；检查更新仍然可用。
- **不用 GitHub API 取提交**：`git ls-remote` 不要 token、不吃速率限制；未认证的 commits 接口用光配额就回 403（实测踩过）。API 只用来补一句提交说明，失败就当没有，不影响判断。
- **不自动检查**：打开设置不发请求，用户点了才查。
- **它不是唯一的更新路**：从 npm 装的包，DSH 插件详情页自己就有「更新到 x.y.z」（registry 依赖按版本号比较）；面板这个按钮是给 Git 装和「插件页没按钮」的情况用的。两条路都走 `installBundle`，互不冲突。
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