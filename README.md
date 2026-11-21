<div align="center">

<img src="icon.svg" width="64" alt="dsh-english-reader"/>

# dsh-english-reader

**在 DeepSeek Harness 里朗读英语：粘贴一段文字，逐句跟读，随时从上次停下的地方继续。**

右侧栏一个标签页，或侧栏一个整页面板。逐词高亮、逐句翻译、Edge 在线与本地 Kokoro 两种引擎，还能接你自己的 TTS API。

[中文](README.md) · [English](README.en.md)

<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
<a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white" alt="powered by dsh"></a>

</div>

## 为什么需要它

读英语长文时，语音合成和阅读位置是两件事：播放器在读第 12 句，你的眼睛在第 30 句，切换回来就找不着了。

这个插件把「念到哪」和「看到哪」绑在一起：句子级定位、词级高亮、进度持久化。关掉面板、重启 Harness，回来还是那一句。

他同时照顾两件事：**文章和对话**。粘贴一篇硬换行的文章不会被拆成乱句；粘贴 `Emma: Hi` / `Daniel: Hello` 这样的对话，会自动识别两个说话人并用两套音色轮流读。

<p align="center">
  <img src="docs/reader.png" width="880" alt="整页阅读：逐句原文与译文、当前句标记、宽度与字号控制条、右侧朗读设置"/>
</p>

<br clear="all">

## 功能

- **两种打开方式**：右侧栏标签页，或侧栏整页面板（全宽，无输入框打扰）。
- **逐句朗读 + 断点续读**：点任意一句从那里念；进度写进存储，重开即恢复。
- **逐词高亮**：Edge 引擎报告**真实词时间戳**，当前词随语音走；本地引擎按时长估算。
- **逐句翻译**：DashScope 内置模型（可选供应商与模型）、Google、Microsoft、腾讯，四个来源可选；译文用衬线体、次级色，与原文区分。
- **文章 / 对话自动判别**：硬换行合并成句，段落按空行切分；识别到两个人名才用双音色。
- **对话库**：保存多篇文本，可重命名、置顶、删除，列表里显示「第几句 / 共几句」。
- **连读与循环**：单句循环和「连读下一句」各自独立，关掉连读就一句一停，停在原处。
- **右键查词**：只有正在朗读的那一句把单词拆成词级；悬停出现淡框，右键弹出释义。
- **中英 / 英英词典**：中文释义按词性分行（简明词典取向），英文释义带例句；可切「中英 / 英英 / 仅中文」。
- **单词收藏**：词卡可收藏，头部入口进入「我的单词」，点一行在原地展开词条、例句和收藏时的原句。
- **阅读宽度与字号**：窄 / 中 / 宽 / 自定义，字号小 / 中 / 大 + 自定义 px；阅读页、对话库、我的单词三处共用。

## 安装

**方式一：从 GitHub 安装（推荐）**

在 DSH 的 **插件 → 添加插件** 里填：

```
github:KNtnx/dsh-english-reader
```

或命令行：

```bash
dsh plugin --profile web add github:KNtnx/dsh-english-reader
```

**方式二：本地目录**

```bash
git clone https://github.com/KNtnx/dsh-english-reader.git
dsh plugin --profile web add link:./dsh-english-reader
```

把 `web` 换成你实际的 profile（Desktop 版通常是 `desktop`）。安装完重启 `dsh web`。

> 插件带两个运行时依赖（`msedge-tts`、`kokoro-js`），通常随安装一起装好。若面板报「引擎不可用」，进插件目录执行一次 `npm install --omit=dev` 再重启。

## 语音来源

内置 Edge，其余来源由你添加（侧栏面板 → 添加来源）。每个来源可以命名、编辑设置、单独删除。

| 来源 | 需要 | 说明 |
| --- | --- | --- |
| 微软 Edge（在线） | 什么都不用 | 神经音色，需要联网，文本发送到微软。首选的「逐词高亮」体验来自它。 |
| 本地模型（Kokoro-82M） | 下载 89 MB | 在本机跑，可离线；也可指向你已有的模型目录（含 `config.json` 与 `onnx/`）。 |
| 自定义 TTS API | 地址、协议、模型、密钥 | 三种协议：OpenAI 兼容 `/audio/speech`、阿里云百炼原生接口、Azure 语音（SSML）。只填域名即可，路径会自动探测并记住。 |

**为什么协议是必选项**：同一家服务的不同接口路径和请求体完全不同。阿里云百炼的 OpenAI 兼容前缀只支持对话与向量，语音合成走原生的 `api/v1/services/audio/tts/SpeechSynthesizer`，返回的还是音频下载地址。协议决定发什么请求。

**密钥不出宿主**：面板只能读到 `hasKey: true`，读不到明文。来源记录存在 `$DSH_HOME/dsh-english-reader/sources.json`（权限 `0600`），测试连接、拉模型列表、拉音色列表都由宿主代取密钥。

<p align="center">
  <img src="docs/words.png" width="640" alt="我的单词：点开即展开词条，中文按词性分行，英文释义带例句"/>
</p>

## 词典

| 词典 | 来源 | 说明 |
| --- | --- | --- |
| 中英 | iciba | 按词性分行，**免密钥**；词组同样可查 |
| 英英 | Wiktionary | 英文释义与例句，免密钥 |

设置里可选「中英 / 英英 / 仅中文」。两者都没有词条时（多为生僻词组），才回落到下面的翻译来源。宿主缓存最近 200 条词条，重复查询不再发请求。

查词只对**当前朗读句**开放：其余句子是纯文本，长文的渲染开销不随句数增长。

## 翻译来源

| 来源 | 需要 | 说明 |
| --- | --- | --- |
| DSH 自带模型 | 无 | 选任一本 Harness 已配置的供应商，再选该供应商下的模型 |
| 阿里云百炼原生 | 无 | 走插件自带的 TTS 来源密钥，无需额外配置 |
| Google | 无 | 免密钥的 `translate.googleapis.com` |
| Microsoft | 密钥 + 区域 | Azure 翻译 v3 |
| 腾讯云 | SecretId / SecretKey | TMT `TextTranslateBatch`，TC3-HMAC-SHA256 签名 |

## 隐私

- 文本只在你选择的引擎上合成：本地模型完全离线，Edge 与自定义 API 会把句子发给对应服务商。
- 查词时只有你查的那个单词会发给词典来源（iciba / Wiktionary），不会上传整篇文本。
- API 密钥只存宿主，不以任何形式下发到浏览器，也不写进前端存储。
- 本机模型与来源配置分别在 `$DSH_HOME/dsh-english-reader/models/` 与 `sources.json`，不上传。
- 翻译与语音请求只从宿主发起，面板不直连第三方。

## 排错

| 现象 | 处理 |
| --- | --- |
| 面板一片空白 | 打开浏览器控制台看报错；多半是插件客户端没加载，重启 `dsh web` |
| 「引擎不可用」 | 插件依赖没装：进插件目录 `npm install --omit=dev` |
| 本地模型一直「未下载」 | 点「下载」等进度到 100%；模型在 `$DSH_HOME/dsh-english-reader/models/` |
| 自定义 API 报 400 / 401 | 先在编辑窗口点「测试连接」，它会显示具体路径与原始响应；401 表示密钥被服务商拒绝 |
| 音色填了却不生效 | 换一个能连通的来源再试；部分服务商对未知音色是静默回退而不是报错 |
| 逐词高亮不动 | 只有 Edge 引擎报告词时间戳，其余来源按字符长度估算 |
| 查词一直「没查到」 | 词典需要联网；先在设置里确认字典档位，词组查不到是正常的，会走翻译来源 |
| 收藏的单词原文显示「无」 | 从字典卡片搜索收藏的词没有来源句，这是预期行为 |

## 开发

```bash
node --check index.js
node --check client.js
node --check worker.mjs
dsh plugin --profile web add link:$(pwd)
```

```
package.json        插件清单（dsh.bundle.patch + dsh.client）
cordis.patch.yml    宿主行插入
index.js            宿主：路由、来源存储、四种翻译、两族 TTS 协议
worker.mjs          子进程：Edge 与 Kokoro 引擎，词边界解析
client.js           浏览器：阅读面板、设置卡片、添加来源对话框、词高亮
locale/             插件市场展示文案
docs/DETAIL.md      插件详情页（英文）
docs/DETAIL.zh.md   插件详情页（中文）
```

## License

除特别说明外，本仓库以 [MIT](LICENSE) 授权。
