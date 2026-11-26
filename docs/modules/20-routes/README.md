# 20 宿主路由

**一句话**：宿主半边只做一件事——把 15 条 `exact` 路由挂到 DSH 的 `webServer` 上。每条路由都是薄壳：读请求、看上限、把活交给 `files` / `dictionary` / `speech` / `translate`，最后把结果写成 JSON、音频或一段错误码。

## 一句话

- **负责**：`ROUTES` 表（路径 → 形态 → 处理函数 → 卸载标签）、`bindRoute` 把插件 `config` 与宿主 `ctx` 预绑定、`apply` 用 `ctx.effect` 注册与回收、读体与 JSON 响应的小工具。
- **不负责**：库怎么合并（`30-store`）、词典/翻译/语音怎么实现（`50-dictionary`、`40-speech`）、面板什么时候调哪条（`10-panel`）。

## 代码入口

| 位置 | 符号 | 一句话 |
| --- | --- | --- |
| `host/routes.js` | `inject`、`apply`、`ROUTES`、`bindRoute` | 路由层本体：声明依赖、注册 15 条、卸载 |
| `host/routes.js` | `sendJson`、`requestUrl`、`readBody` | 三条公共件：写 JSON、补全 URL、有上限地读体 |
| `host/constants.js` | `PATHS` | 15 个路径字符串的唯一出处 |
| `client.js` | `TTS_PATH`、`STORE_PATH`、`TRANSLATE_PATH` 等 15 个常量 | 前端那一半的同名路径（两份必须一致） |

路径前缀统一是 `/api-dsh-english-reader`，`PATHS` 里写全，前端常量也写全：

| 路径 | 形态 | 处理函数 | 前端常量 |
| --- | --- | --- | --- |
| `/tts` | resource | `handleTts` | `TTS_PATH` |
| `/tts/sources` | handler | `handleSources` | `SPEECH_SOURCE_PATH` |
| `/tts/voices` | resource | `handleVoices` | `VOICES` |
| `/tts/validate` | handler | `handleValidate` | `VALIDATE` |
| `/tts/models` | resource | `handleModels` | `MODELS` |
| `/local/status` | resource | `handleStatus` | `LOCAL_STATUS` |
| `/local/install` | handler | `handleInstall` | `LOCAL_INSTALL` |
| `/dict` | resource | `handleDict` | `DICT_PATH` |
| `/dict/ai` | handler | `handleDictAi` | `DICT_AI` |
| `/dict/key` | handler | `handleDictKey` | `DICT_KEY` |
| `/store` | handler | `handleStore` | `STORE_PATH` |
| `/store/revision` | handler | `handleStoreRevision` | `STORE_REVISION` |
| `/translate` | handler | `handleTranslate` | `TRANSLATE_PATH` |
| `/translate/options` | resource | `handleTranslateOptions` | `TRANSLATE_OPTIONS` |
| `/translate/models` | resource | `handleTranslateModels` | `TRANSLATE_MODELS` |

## 小模块索引

| 小模块 | 一句话 | 文档 |
| --- | --- | --- |
| route-table | `ROUTES`、`bindRoute`、`apply` 与 `effect` 卸载 | [route-table.md](./route-table.md) |
| speech-routes | 五个 handler：合成、源管理、音色、试连、模型列表 | [speech-routes.md](./speech-routes.md) |
| model-routes | `/local/status` 与 `/local/install`：下载靠轮询进度 | [model-routes.md](./model-routes.md) |
| dictionary-routes | `/dict`、`/dict/ai`、`/dict/key`（key 只进不出） | [dictionary-routes.md](./dictionary-routes.md) |
| translate-routes | `/translate` 批处理与两条「能做什么」的路由 | [translate-routes.md](./translate-routes.md) |
| library-routes | `/store`、`/store/revision`：`changed` 与白名单 | [library-routes.md](./library-routes.md) |

## 数据流

```
浏览器 fetch('/api-dsh-english-reader/...')
  └─ webServer 精确匹配 path（kind: 'exact'）
        └─ bindRoute 已经吃掉了 config 与 ctx
              ├─ resource 路由：handler(request) → Response（音频或 JSON）
              └─ handler 路由：handler(request, response) 自己 writeHead/end
                    └─ 业务在 host/files.js、host/dictionary.js、host/speech.js、host/translate.js
```

卸载方向只有一条：`apply(ctx, config)` 里每条路由一个 `ctx.effect`，插件被关掉时 DSH 逐个调用 `webServer.register` 返回的 dispose，15 条一起消失；同一个 `apply` 里另有语音 worker 的 effect，负责清 pending 与 `worker.kill()`。

## 常见改动

| 需求 | 改哪里 | 顺手补什么 |
| --- | --- | --- |
| 加一条路由 | `PATHS` 加键 → `ROUTES` 加一条（带 `effect` 标签）→ 写 `handleXxx` → `client.js` 加同名常量 | `test/host.test.mjs`「every route the panel calls exists on the host」会双向检查 |
| 改响应形状 | 对应 handler；resource 用 `Response.json`，handler 用 `sendJson` | 面板那侧的解析（`10-panel`）+ 一条读回用例 |
| 需要新 config 键 | 处理函数签名追加，`bindRoute` 已经会传 | `cordis.patch.yml` 的 `config` 与 `50-dictionary` 的密钥读取 |
| 换路径前缀 | `PATHS` 与 `client.js` 顶部 15 个常量 | 上述用例用的正则只认 `/api-dsh-english-reader/[a-z/]+` |
| 改请求上限 | `readBody(request, limit)` 的实参（`MAX_STORE_BYTES` 等放 `30-store/paths-and-limits`） | 超限分支的 413 用例 |

## 风险与历史坑

- **`exact` 不是前缀匹配**：`/store` 与 `/store/revision` 是两条独立条目，靠 web server 的精确匹配区分。若哪天注册成全前缀，`/store/revision` 会先被 `/store` 吃掉。
- **两份路径常量**：`host/constants.js` 与 `client.js` 各写一遍，没有共享模块可引（浏览器半边没有构建步骤）。改一处不改另一处，表现为静默 404 / 空数据，而不是报错。
- **错误形状本来就不统一**：resource 路由答 `{ok: false, code}`，`/tts/validate`、`/translate` 这类 handler 路由答 `text/plain` 或 `{error}`。这是增量长出来的，面板按路由分别处理，别指望一套。
- **`readBody` 永不抛**：它把超限和读失败变成 `tooLarge` / `failed` 字段，所以每个 handler 都必须显式分支，忘了就是 200 + 半个对象。
- **marks 可丢**：`MAX_HEADER_MARKS` 装不下时 `speechResponse` 静默不发 `x-er-marks`，面板回落到按时长估算；这不是失败。
- **历史坑**：语音子进程路径曾写成 `host/worker.mjs`，结果每句 502（`test/host.test.mjs`「every module points at files that exist」守着）；`apply` 里的 `void mkdir(modelDir())` 也不是摆设——`worker.mjs` 把 `ER_MODEL_DIR` 直接当下载器的 `cacheDir` 用，目录得先存在。