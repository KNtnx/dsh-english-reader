# locale-resources

## 职责

`locale/en.json` 与 `locale/zh.json` 只负责**插件在 DSH 插件列表/详情页里长什么样**：标题、一句描述、详情文档指向。界面里所有按钮和提示不在这里。

## 位置

- `locale/en.json` :: `meta`, `title`, `description`, `detail`
- `locale/zh.json` :: `meta`, `title`, `description`, `detail`
- `package.json` :: `exports`（声明 `./locale/*.json` 的那一条）

## 输入 → 输出

- 每个文件只有一个 `meta` 对象；
- `detail` 是**仓库相对路径**（`docs/DETAIL.md` / `docs/DETAIL.zh.md`），插件详情页据此加载文档；
- 两个文件的 key 必须完全一致，缺一个语言就回落到英文标题。

## 不变量

- **`detail` 指向的文件必须存在**，否则详情页空白。
- **两个文件的 `meta` 结构一致**：只有语言不同。
- **界面文案不写在这里**：面板里的每一个字来自 `client.js` 的 `DICT` 表（见 `10-panel/copy.md`），`ctx.locale.register(NS, DICT)` 把那张表注册成命名空间。两处都改不会同步，只改这里面板不会变。

## 相邻模块

- 上游：`00-loading/bundle-manifest`（`exports` 暴露这三个路径）。
- 下游：`docs/DETAIL.md` / `docs/DETAIL.zh.md`（详情页正文）。
- 容易混淆的邻居：`10-panel/copy`（真正的界面文案）。

## 改这里时

- **改插件标题/描述**：两个 json 一起改，保持一致。
- **把详情页挪走**：同时改两个 json 的 `detail` 与 `README` 里的图片相对路径（详情页引用 `docs/*.png`）。
- **加第三种语言**：新增 `locale/xx.json`，并确认 `exports` 的通配 `./locale/*.json` 覆盖它；面板界面的第三语言还需在 `DICT` 加一份。

## 读代码顺序

1. `locale/zh.json`（短，一眼看完）。
2. `locale/en.json` 对照 key。
3. `package.json` 的 `exports` 确认路径。
4. 想看界面文案就去 `10-panel/copy.md`。