# 测试流程（含浏览器复核）

这份文档回答两件事：**怎么跑测试**，以及**每次改动后怎么用真实浏览器把功能走一遍**。

它存在的原因是三次事故，每一次的自动化测试都是绿的：

| 坏掉的功能 | 为什么测试没抓到 |
| --- | --- |
| 每一句都播不出来（`502 speech worker stopped (code 1)`） | 宿主拆成 `host/*.js` 后 worker 路径变成了 `host/worker.mjs`；而路由测试把语音整个 mock 掉了 |
| 打开设置卡片整页崩溃（`modelLoaded is not defined`） | 拆视图时漏传了「本地引擎」分支才会用到的值，而测试跑的是 Edge 分支 |
| 右键词卡飞到页面顶部 | 卡片高度 `cardHeight` 在拆视图时丢了，`top` 算成 `NaN` 被浏览器丢弃，绝对定位就落到了容器顶部 |

共同点：**测试只证明了「组件能渲染」，没有证明「用户做的那个动作是对的」。**

---

## 一、两层测试，各管一半

| 层 | 命令 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| 自动化（jsdom + 真实 React + 真实 `client.js`） | `npm test` | 状态机、竞态、事件、路由契约、文件路径契约 | 布局、真实音频、真实网络、真实模型 |
| 浏览器（真 Chrome，本机 3080） | 见第二节 | 上面所有抓不到的，以及「测试 mock 得不对」 | 无（但慢，且要人/代理操作） |

**规则：自动化全绿不算完，必须再做一次浏览器复核（第二节）。** 上面三个 bug 全都只在浏览器里现形。

---

## 二、浏览器复核流程（可照抄）

### 2.1 准备

```bash
# 1. 插件是否加载（宿主改动后要重载）
curl -s -b cookies.txt -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:3080/api-dsh-english-reader/store"        # 200 = 已加载

# 2. 拿一个有效会话（token 由 dsh web 打印，交给浏览器用）
#    注意：不要用 curl 反复撞带 token 的地址，直接把 URL 给浏览器
```

用 browser-skill（`bsk_*` 工具）驱动：

1. `bsk_session start` + 带 token 的 URL。
2. **若页面显示 `forbidden`，直接 `location.reload()` 一次**——首跳经常 403，reload 即正常（本机复现过多次，不是 token 失效）。
3. 点左侧导航 `对话朗读`（VOM 里是 `button "对话朗读"`），进入整页阅读视图。
   **绝对不要在这个窗口打开那条几十万 token 的长会话页**——会把机器内存打满。

### 2.2 十四步验收（每步都要看结果，不是走过场）

| # | 操作 | 期望 | 判定方式 |
| --- | --- | --- | --- |
| 1 | 打开对话朗读 | 正文与译文成对出现，底部显示 `n / 总数` | 截图 |
| 2 | 点播放 ▶ | 一秒内出声；按钮变暂停；底部计数前进 | 截图 + `bsk_inspect network url=tts` 应见 `200`，随后 `blob:` 有 `206` |
| 3 | 点下一句 ⏭ | 说话的是下一句，计数同步 | 截图 |
| 4 | 播放中改音色 | 同一句用新音色重读，不中断 | network 里出现新 `voice=` 的请求 |
| 5 | 打开设置卡片 | 四段（引擎/音色/字典/翻译）都能展开；卡片不超出窗口 | 截图 |
| 6 | 引擎切到「本地模型」 | 显示「已下载 / 第一句时加载模型」，不崩 | 截图（这条就是 `modelLoaded` 崩溃的回归点） |
| 7 | 卡片里按 Esc / 点外部 | 卡片关闭 | 截图 |
| 8 | 右键正文里**靠下**的一个词 | 词卡出现在鼠标旁边，不跑到顶部 | 截图（这条是 `cardHeight` 丢参的回归点） |
| 8b | 按住词卡顶部的字或左侧的握把拖动 | 卡片跟着鼠标走，松开就停下；不动就选中文字 | 截图前后各一张 |
| 8c | 打开「查单词」对话框（显示条右侧书本图标），拖它的握把 | 同样可以拖动，输入框照常能打字 | 截图 |
| 9 | 切到「我的单词」 | 列表出现，中文模式下**只有中文释义** | 截图 |
| 10 | 展开一个已存单词 | 展开自己的词条；再右键别的词，两者互不覆盖 | 截图 |
| 11 | 改翻译来源 | 屏幕上译文被替换（不是保留旧的） | 截图 |
| 12 | 刷新页面 | 阅读位置、单词、对话都还在；**再点播放仍能出声** | network 里 `tts` 仍 `200` |
| 13 | 不刷新，在对话里让模型调 `english_reader`（如 `add_word` / `move_words`） | 面板两秒内自己变：新词出现在列表、归类进对应夹子 | 截图前后各一张；`bsk_inspect network url=store` 应见 `GET .../store/revision` 反复 `200`，变化时跟一条 `GET .../store` |
| 14 | 再让模型 `remove_word` | 那一行自己消失，不需要刷新 | 截图；`localStorage` 里该词也不见了 |

> 第 12 步的第 2 半句是 worker 路径 bug 的回归点：数据在、但播放死掉，正是那次事故的样子。

### 2.3 每次都要做的三项检查

```text
bsk_inspect console                 # 只有宿主的 chat-wait.css 提示，不能有插件的报错
bsk_inspect network url=tts         # 至少一条 200；502/500 就是语音坏了
bsk_inspect screenshot              # 三张：阅读页、设置卡片、我的单词+展开
```

收尾：`bsk_session stop`（会话不关会一直占内存）。

---

## 三、自动化测试怎么跑

```bash
npm install                 # 一次性：react / react-dom / jsdom 是 devDependencies
timeout 300 node --test test/        # 全套，约 3 秒，130 项
```

单文件、单用例：

```bash
node --test test/panel.dict.test.mjs
node --test --test-name-pattern "gloss" test/
```

**一定要带 `timeout`**：一次挂住的用例把机器拖死过。

### 分层

| 层 | 文件 | 管什么 |
| --- | --- | --- |
| 静态契约 | `test/copy.test.mjs`、`test/views.test.mjs`、`test/host.test.mjs`（「every route…」「every module points at files that exist」） | 客户端与宿主对路径、文案 key、CSS 类、文件位置是否一致 |
| 纯逻辑 | `test/internals.test.mjs` | 断句、marks、合并、墓碑、哈希 |
| 宿主路由 | `test/host.test.mjs` | 每个路由一条，临时 `$DSH_HOME`，上游 `fetch` 打桩 |
| 面板交互 | `test/panel.smoke.test.mjs`、`panel.dict`、`panel.translate`、`panel.playback`、`panel.sync` | 真实 `client.js` + 真实 React + 真实点击/右键/输入 |

面板层最重要：它通过 `__ModuleLoader__` 挂载真正的 bundle，所以少一个 hook、错一个元素类型、漏一个参数，都会在这里炸，而不是在你面前炸。

---

## 四、历史 bug 与守护用例

| Bug（现象 ← 原因） | 守护用例 |
| --- | --- |
| 每句都 `502 speech worker stopped (code 1)` ← 拆分后 worker 路径指向 `host/worker.mjs` | `host.test.mjs`「every module points at files that exist」；`panel.playback.test.mjs` 5 条 |
| 设置卡片崩溃 `modelLoaded is not defined` ← 拆视图漏传本地引擎分支的值 | `views.test.mjs`「every view receives every panel value it uses」 |
| 右键词卡跑到页面顶部 ← `cardHeight` 丢参，`top` 变 `NaN` 被丢弃 | `panel.dict.test.mjs`「the card opens at the word that was clicked」+ `views.test.mjs` 的「漏传」检查 |
| 中文模式里出现英文释义 ← 行回落到了英文缓存 | `panel.dict.test.mjs`「Chinese-only mode never prints an English gloss in the list」 |
| 模型写的释义在列表里不显示 ← 缓存键 `word\|model` 与 `word\|model\|provider/model` 不一致 | `panel.dict.test.mjs`「a model-written entry is found by the list」 |
| 展开已存单词会覆盖右键词卡 ← 共用一个请求令牌 | `panel.dict.test.mjs`「a saved word expanded in the list does not hijack the next lookup」 |
| 慢结果盖掉新查询 ← 后到者赢 | `panel.dict.test.mjs`「a slow answer never lands on top of a newer lookup」 |
| 换翻译来源不生效 ← 只校验哈希与行数 | `panel.translate.test.mjs` 4 条 |
| 浮动词卡跟着飘到「我的单词」页 | `panel.smoke.test.mjs`「leaving the dialogue closes the floating card」 |
| 删除的词/对话同步后又回来 ← 并集合并无法删除 | `host.test.mjs`「the host forgets what a panel deleted」；`internals.test.mjs` 墓碑 |
| 不同会话不共享词库 ← 存在 `localStorage` | `host.test.mjs`「the library is shared through the host…」；`panel.dict.test.mjs`「a word saved in another session…」 |
| 每次挂载都有 React key 警告 | `panel.smoke.test.mjs`「the panel mounts without console errors」 |
| 改音色后当前句不重读 ← 音频已下载 | `panel.playback.test.mjs`「changing the voice re-reads the sentence that is playing」 |
| 阅读位置没记住 | `panel.smoke.test.mjs`「the reading position is remembered」 |
| Esc 关不掉设置卡片 | `panel.smoke.test.mjs`「the settings card opens, collapses, and closes with Escape」 |
| 上一句/下一句跳错句 | `panel.smoke.test.mjs`「next and previous move the sentence that is being read」 |
| 引擎段一展开就崩 | `panel.smoke.test.mjs`「the engine section lists the speech sources without breaking the page」 |
| 所有格 `students'` 查不到 | `host.test.mjs`「a possessive is looked up by its base word」 |
| 非单词也发请求 | `host.test.mjs`「a word that is not a word is refused before any request goes out」 |
| Collins key 泄漏到面板 | `host.test.mjs`「the panel is told whether a Collins key exists, never the key」 |
| 存储接受存不下的数据 | `host.test.mjs`「the store refuses what it cannot keep」 |
| 旧格式词典记录（字符串 senses、丢 example）崩卡片 | `internals.test.mjs` 词典形状用例 |
| 断句切错缩写/小数、换行没接回、后引号丢失 | `internals.test.mjs` 7 条断句用例 |
| 宿主没给 marks 时高亮错位 | `internals.test.mjs`「without marks the words are spread over the clip by length」 |
| 手改/工具写的归类被浏览器旧副本抹掉 ← 宿主合并只看 `addedAt`，而移动不改它 | `host.test.mjs`「a move survives a save that never saw it」「the browser and the host settle a filing the same way」（`internals.test.mjs` 同一条跨端一致性用例） |
| 工具写完必须刷新页面才看得见 ← 面板只在挂载时读一次库 | `panel.sync.test.mjs` 四条：新增、删除、自己的写不回头、被宿主纠正后立刻读回 |
| 卸载插件抛 `Assignment to constant variable`（只有「合成过再卸载」才走到）← 别的模块给 ESM import 绑定赋值 | `host.test.mjs`「the plugin unloads after the speech worker started」 |
| 同一毫秒内两次移动，先写入的赢 ← 时间戳相等时用 `>` 判新 | `host.test.mjs`「a move survives a save that never saw it」的 sameMoment 分支；`internals.test.mjs` 跨端一致性用例 |

---

## 五、只靠人眼的（自动化不覆盖）

- 音频是否真的响、语速、逐词高亮是否跟着走；
- 排版：设置卡片高度、窄面板换行、三档字号、底部播放条；
- 真实词典/翻译质量，真实模型下载与首句延迟；
- 真实断网/超时（自动化里只有一个合成的 502）；
- 任何 GPU 相关。

jsdom 没有排版引擎：测试只能证明元素存在，证明不了它放得下。

---

## 六、写新测试的规矩

1. **先证明它会红。** 把修复故意改坏（或回滚），跑一遍，看它失败，再改回来。没红过的测试不算测试。
2. **mock 要反映真实形状。** 语音 mock 曾经对一条生产上返回 `502 speech worker stopped` 的路由回 `200`，整层测试因此失真。宿主能返回 `503 {code:'preparing'}`、`413`、`502`、网络错误，就该各有用例。
3. **测动作，不测标记。** 点用户会点的控件（`aria-label`、可见文字）；内部类名交给契约测试去管。
4. **拆分/改名之后**，先跑 `views.test.mjs` 和静态契约——它们是浏览器清单的便宜版本。
5. **新增路由 / 宿主会 spawn 的文件**，必须有契约测试：客户端只调存在的路由，模块只指向存在的文件。

---

## 七、提交前 checklist

```bash
for f in index.js client.js host/*.js worker.mjs; do node --check "$f"; done
timeout 300 node --test test/          # 69 项全绿
```

改动涉及宿主或面板结构时，再加：

```text
重载插件 → curl /store 与一条真实 /tts → 按第二节 12 步走一遍 → 三张截图
```

commit message 要写清三件事：哪里坏了、为什么、怎么验证的（截图/命令/用例名）。