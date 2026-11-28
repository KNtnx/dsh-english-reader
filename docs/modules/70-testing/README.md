# 70 测试与验收

**一句话**：130 项代码用例分五层——安装契约、静态契约、纯逻辑、宿主路由、面板交互；另有一份文档契约（`test/docs.test.mjs`）把这套文档也当代码检查。面板层在 jsdom 里跑**真的** `client.js` 与真的 React，所以少一个 hook、错一个元素、漏一个参数都会在测试里红，而不是在用户面前炸。

## 一句话

- **负责**：用例怎么分层、每层管什么、怎么跑、每组用例守的是哪个模块，以及每个历史 bug 对应哪条用例。
- **不负责**：被测代码本身（在 `10-panel`、`20-routes`、`30-store`、`60-tool` 各篇里）；真实浏览器的人工复核流程在 `docs/TESTING.zh.md`。

## 代码入口

| 文件 | 关键符号 | 一句话 |
| --- | --- | --- |
| `test/harness.mjs` | `launchPanel`、`createHost`、`internals`、`FIXTURE_STATE`、`FIXTURE_DICT` | 在 jsdom 里挂真面板，用一个假宿主接住所有请求 |
| `test/dom.mjs` | `dom`、`window`、`GLOBALS` | 把浏览器全局装到 Node 上，只此一处 |
| `test/internals.test.mjs` | 见 `unit-and-host` | 纯函数：断句、marks、合并、墓碑 |
| `test/install.test.mjs` | 见 `install-contract` | 安装契约：可选 peer、空目录 worker 的 `engine-missing` |
| `test/host.test.mjs`、`test/tool.test.mjs` | 见 `unit-and-host` | 宿主路由与模型工具 |
| `test/panel.*.test.mjs` | 见 `panel-tests` | 七组面板交互 |
| `test/copy.test.mjs`、`test/views.test.mjs`、`test/scope.test.mjs` | 见 `contract-tests` | 三个读源码的静态扫描器 |
| `test/docs.test.mjs` | —— | 文档契约：6/7 节标题、索引链接、位置引用的符号可 grep、行数上限 |
| `docs/TESTING.zh.md` | —— | 浏览器复核的十四步与历史 bug 表 |

## 小模块索引

| 小模块 | 一句话 | 文档 |
| --- | --- | --- |
| harness | jsdom 环境、假宿主、`launchPanel` 与 `internals` | [harness.md](./harness.md) |
| unit-and-host | 纯逻辑、宿主路由、工具定义三组不点鼠标的用例 | [unit-and-host.md](./unit-and-host.md) |
| panel-tests | 七组面板交互：真实点击、右键、输入、计时 | [panel-tests.md](./panel-tests.md) |
| contract-tests | 三个静态扫描器加文档契约：编译能过、跑起来才炸的那类 | [contract-tests.md](./contract-tests.md) |
| install-contract | 安装契约：本地引擎是可选 peer，缺了也要能装能跑 | [install-contract.md](./install-contract.md) |

## 数据流

| 层 | 文件（条数） | 合计 |
| --- | --- | --- |
| 安装契约 | `install`(2) | 2 |
| 静态契约 | `copy`(6)、`views`(1)、`scope`(1)，加 `host.test` 里两条契约用例 | 10 |
| 纯逻辑 | `internals`(18) | 18 |
| 宿主路由与工具 | `host`(21)、`tool`(20) | 41 |
| 面板交互 | `smoke`(10)、`dict`(19)、`translate`(4)、`playback`(7)、`settings`(7)、`folders`(7)、`sync`(5) | 59 |
| 合计 | | **130** |

上表是 139 项代码用例的来源；`test/docs.test.mjs` 的 8 条只查文档，跑全量时合计 147 项。

为什么这么分：越便宜、越靠前的层先跑——安装契约只读清单并空目录起一次 worker，静态扫描不执行代码，纯逻辑不建 DOM，宿主路由是 URL 上的纯函数，面板最贵但也最接近用户。前几层出问题时定位只要看一个函数；面板层出问题时它证明的是「用户那个动作」。

```
node --test test/
  ├─ 安装契约  读 package.json、空目录起 worker          install
  ├─ 静态契约  读 client.js / docs 源码，不执行           copy · views · scope · docs
  ├─ 纯逻辑    client.js 导出的 internals                internals
  ├─ 宿主      index.js 的 apply → 路由表 → 假 req/res     host · tool
  └─ 面板      __ModuleLoader__ → 真 React → jsdom        panel.*
                        ▲
              createHost 用 globalThis.fetch 答掉面板的每个请求
```

怎么跑：

```bash
npm install                                   # 一次性：react / react-dom / jsdom
timeout 300 node --test test/                 # 全量，约 3 秒，147 项
node --test test/panel.dict.test.mjs          # 单文件
node --test --test-name-pattern "gloss" test/ # 单用例
node --test test/docs.test.mjs                # 只跑文档契约
```

## 常见改动

| 需求 | 改哪里 | 顺手补什么 |
| --- | --- | --- |
| 加一条宿主路由 | `test/host.test.mjs` 的 `registerRoutes` + 一条用例 | 契约用例「every route the panel calls exists on the host」 |
| 加一个工具动作 | `test/tool.test.mjs` | 正向一条、报错一条；要查墓碑就读 `library.json` |
| 修一个 bug | 先写一条会红的用例，再修 | 用例名写**用户看到的现象**，别写实现细节 |
| 加一个视图 | `test/panel.smoke.test.mjs` 点进去一次 | `test/views.test.mjs` 的「收值」检查 |
| 改断句或合并规则 | `test/internals.test.mjs` | 跨端一致性那条要同时跑宿主与浏览器两套实现 |
| 改文档结构 | `node --test test/docs.test.mjs` | 它查标题、索引链接、引用符号与行数 |

## 风险与历史坑

- **绿了不代表对**：三次事故（worker 路径写错、`modelLoaded` 未定义、`cardHeight` 丢参）自动化全绿、浏览器全崩。`docs/TESTING.zh.md` 的「只靠人眼的」一节点出的东西，自动化永远覆盖不了。
- **jsdom 没有排版引擎**：它能证明元素存在，证明不了它放得下；词卡位置这类断言只能证明「算出来的 style 对」，真实观感仍要人看。
- **mock 会骗人**：语音 mock 曾对一条生产会回 `502` 的路由回 `200`，整层测试因此失真。改 `createHost` 时照真实响应的形状加分支。
- **用例必须红过**：把修复故意改坏跑一遍，看见它失败，再改回来；没红过的用例不算用例。
- **一定要带 `timeout`**：曾经一次挂住的用例把机器拖死过；全量约 3 秒。
- **测试里要调小轮询**：`internals.sync.pollMs = 20`（真实值 2 秒），否则同步用例要等两秒。
- **宿主类用例共用一份 `library.json` 就会串**：`host`/`tool` 在 import 宿主模块**之前**把 `DSH_HOME` 指到临时目录。