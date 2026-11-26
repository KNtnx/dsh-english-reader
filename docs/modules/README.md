# 模块地图

这个仓库按「一层职责 = 一个大模块」切成 8 块；每块再拆成**不可拆的小模块**，一个小模块一篇文档。

读法永远是三步：先用 [AGENTS.md](../../AGENTS.md) 的任务路由表定位 → 进大模块 README 看它管什么 → 进小模块文档看它怎么改。

## 八个大模块

| 前缀 | 大模块 | 一句话 | 主要文件 |
| --- | --- | --- | --- |
| `00` | 装载与契约 | 插件怎么被 DSH 装起来：清单、入口、注册 | `package.json`、`cordis.patch.yml`、`index.js`、`locale/*.json` |
| `10` | 面板（浏览器半边） | 4,836 行单 bundle：文案、解析、三个 hook、13 个视图、面板外壳 | `client.js` |
| `20` | 宿主路由 | 15 条 exact 路由：每个前端调用落到哪个处理函数 | `host/routes.js` |
| `30` | 存储与合并 | 一份 `library.json`，两个写者，`folderAt` 定归属 | `host/files.js`、`host/constants.js` |
| `40` | 语音 | 调度 + 子进程：Edge 在线、Kokoro 本地 | `host/speech.js`、`worker.mjs` |
| `50` | 词典与翻译 | 4 个词典源、5 个翻译源、模型兜底 | `host/dictionary.js`、`host/translate.js`、`host/model.js` |
| `60` | 模型工具 | `english_reader`：17 个动作，让对话直接改库 | `host/tool.js` |
| `70` | 测试与验收 | 122 项用例分四层，外加静态契约扫描 | `test/*.mjs`、`docs/TESTING*.md` |

## 依赖方向（改东西时看谁会被波及）

```
浏览器          10 面板
                   │ HTTP
宿主进程        20 路由 ── 40 语音 ── 50 词典/翻译
                   │            │
                30 存储        （子进程）
                   │
                library.json
模型侧          60 工具 ──► 30 存储
装载            00 把上面全部挂起来
```

改 `30` 的合并规则，会同时影响 `10` 的面板合并与 `60` 的工具写入——两边规则必须一致，这是全仓库最容易出事的一处。

## 一次改动通常要碰几篇

| 改动 | 要改的文档（按顺序读） |
| --- | --- |
| 加一条路由 | `20-routes/route-table.md` → 对应 handler 的小模块 → 更新 `10-panel` 里调用它的文档 |
| 加一个工具动作 | `60-tool/tool-definition.md` → 归属动作小模块 → `70-testing/unit-and-host.md` |
| 改合并/归类 | `30-store/merge-rules.md` → `10-panel/shared-store.md` → 两边的守护用例 |
| 加一条界面文案 | `10-panel/copy.md`（两端都要加，key 必须一致） |

## 新增一个小模块的步骤

1. 在本目录建 `docs/modules/<NN>-<slug>/` 与小模块 `.md`（模板见 `AGENTS.md`「文档规则」）。
2. 把新文档登记进所属大模块 README 的「小模块索引」表。
3. 跑 `node --test test/docs.test.mjs`：它会检查链接、引用符号、必需小节、孤儿文档。

## 文档规则（由用例强制）

- 只引用 `文件` :: `符号`，**不写行号**；行号会漂，符号名可以 grep。
- 每篇小模块 7 节：职责 / 位置 / 输入 → 输出 / 不变量 / 相邻模块 / 改这里时 / 读代码顺序。
- 每篇大模块 README 6 节：一句话 / 代码入口 / 小模块索引 / 数据流 / 常见改动 / 风险与历史坑。
- 单篇小模块 ≤ 90 行；写"为什么"和"边界"，不复制代码。