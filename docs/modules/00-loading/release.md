# release

## 职责

把一次改动变成别人机器上能拿到的版本。两种发货方式并存，规则不同：

- **Git**：跟 `main` 的提交走，**不用改版本号**；DSH 插件页不给更新按钮，靠面板里的「检查更新」或命令行的 `dsh plugin update`。
- **npm**：按 `version` 走，**每次都得 bump 并发布**；这是唯一能在插件详情页出现「更新到 x.y.z」的安装形态。

## 位置

- `package.json` :: `version`, `publishConfig`, `files`, `dsh`
- `host/update.js` :: `checkForUpdate`, `applyUpdate`（面板按钮背后的比较与安装）
- `docs/modules/00-loading/self-update.md`（按钮本身怎么工作）
- `.github/workflows/`（没有：发布是手动的，见下）

## 输入 → 输出

| 想做什么 | 命令 | 结果 |
| --- | --- | --- |
| 发一个 npm 版本 | `npm version 0.2.4 --no-git-tag-version` → 提交推送 → `npm publish --registry=https://registry.npmjs.org` | 新版本出现在 registry；旧版本用户能在插件页看到更新 |
| 只发 Git | `git push origin main` | 面板「检查更新」立刻能看到新提交 |
| 另一台设备更新 | 插件页「更新到 x.y.z」（npm）或面板「立即更新」（两种都行）/ `dsh plugin --profile web update dsh-english-reader`（Git） | 几秒后本机就是新版本 |

## 不变量

- **npm 装必须 bump**：同一个版本号发不上去（`E403 cannot publish over`），而且插件页按版本号比较，不 bump 等于没更新。`npm version --no-git-tag-version` 只改 `package.json`，标签我们不要。
- **Git 装不看版本号**：面板比的是提交（`git ls-remote` + 锁文件里的 `tar.gz/<sha>`）。
- **首次发布有传播延迟**：新包名第一次 publish 后，元数据先出现（`npm view` 有版本），**tarball 仍 404 几分钟**（实测约 6 分钟）。判断"发好了"要用 `npm pack dsh-english-reader@<版本>`，不是 `npm view`。
- **国内镜像不一定同步**：npmmirror 的 `dist-tags.latest` 曾长时间停在 `0.0.0-stage`（占位版本），于是「添加插件」填包名会解析到空壳、报 **`declares no dsh.bundle`**，填 `名字@版本` 则报「未找到相关插件」。判断某个源有没有：`npm view <包> dist-tags.latest --registry=<源>`。
- **官方源的兜底写在 profile 里**：`$DSH_HOME/profiles/<profile>/cordis.patch.yml` 追加一条 `- id: plugin-manager` / `config.fallbackRegistries: [https://registry.npmjs.org/]`。这样「添加插件」下拉会多出「npm 官方源」，版本查询也会在镜像查不到时回落官方源。**改完要重启 DSH**（plugin-manager 在启动时读配置）。
- **首次发布会留一个 `0.0.0-stage` 占位版本**：npm 给新包名建的是"暂存占位"（`Temporary package placeholder for staged publishing`），有一段时间 `dist-tags.latest` 指着它。此时在「添加插件」里填包名会报 **`declares no dsh.bundle`**——因为占位包的清单里没有 `dsh` 字段。修法是把标签指回真实版本：`npm dist-tag add dsh-english-reader@0.2.3 latest`，然后用 `npm view <包> version` + `npm pack <包>@<版本>` 双重确认（`npm pack` 能下下来才算真的可用）。
- **2FA**：`npm login` 拿到的登录 token 不带"免 2FA 证明"，直接 publish 会被拦；要么 `--otp=验证器6位`，要么用带 *Bypass 2FA* 的 Granular Access Token 写进 `~/.npmrc`。
- **别把测试发上去**：`files` 只列运行期文件与文档，`test/` 与 `package-lock.json` 不进包（87 个文件、约 871 KB）。
- **客户端改动要提示刷新**：只改宿主时插件页/面板热重载即可；改了 `client.js` 得刷新浏览器（bundle 有缓存）。
- **发布是对外动作**：跑 `npm publish` 之前先用 `--dry-run` 核对文件清单，确认没有本地路径、密钥或测试数据。

## 相邻模块

- 上游：`00-loading/bundle-manifest`（`files`/`dsh` 字段为什么这么写）、`00-loading/self-update`（面板按钮）。
- 下游：用户的说明书 `README.md` / `README.en.md` 的「安装」「更新」「卸载」三节（发布方式变了要同步）。
- 相关：`40-speech/engine-install`（另一个按需下载，它不进 npm 包，是运行时装到 profile 的）。

## 改这里时

- **改了 `files`**：跑一次 `npm pack --dry-run --json`，确认顶层目录没少（`host/`、`docs/`、`locale/`、`client.js`、`worker.mjs`、`cordis.patch.yml`）。
- **换了 registry**：`publishConfig.registry` 与本机 `~/.npmrc` 的默认源是两件事；发布命令里显式带 `--registry=https://registry.npmjs.org` 最稳（本机默认源可能指向 npmmirror 镜像，镜像不能发布）。
- **加自动化**：如果要 CI 发布，用带 bypass 2FA 的 granular token 放进仓库 secret，并保留 `--dry-run` 那一步的检查。

## 读代码顺序

1. `package.json` 的 `version` / `publishConfig` / `files`。
2. `host/update.js` 的 `checkForUpdate`：面板怎么判断"有新版本"。
3. `applyUpdate` 拼的 spec：为什么必须钉到完整提交。
4. `README` 的三节（安装/更新/卸载）——发布方式一动，它们就得跟着改。