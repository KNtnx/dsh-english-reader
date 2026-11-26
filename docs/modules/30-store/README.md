# 30 存储与合并

**一句话**：整个插件只有一份用户数据——`$DSH_HOME/dsh-english-reader/library.json`。面板通过 HTTP 写它，`english_reader` 工具直接写它，两边都走 `host/files.js` 里的同一套合并规则；密钥不在这份文件里，而是两个 0600 的小 JSON，前端永远只拿到「有没有」。

## 一句话

- **负责**：路径与上限（`host/constants.js`）、库文件的原子读写、按 id 的并集合并与墓碑、归类归属（`folderAt`）、库指纹、`sources.json` / `dictionary.json` 的读写与脱敏。
- **不负责**：谁在什么时候写（`10-panel/host-sync`、`20-routes/library-routes`、`60-tool`）、界面怎么展示（`10-panel`）。

## 代码入口

| 文件 | 关键符号 | 一句话 |
| --- | --- | --- |
| `host/constants.js` | `dshHome`、`modelDir`、`sourcesFile`、`dictKeyFile`、`storeFile`、`MAX_STORE_BYTES` | 所有路径与上限的唯一出处 |
| `host/files.js` | `readStore`、`writeStore` | 库文件的读（缺/坏都给 `null`）与写（tmp + rename） |
| `host/files.js` | `mergeStore`、`placements`、`placed`、`sameList` | 合并：并集、墓碑、归类、比较 |
| `host/files.js` | `revisionOf` | 十几个字节的库指纹 |
| `host/files.js` | `isSource`、`publicSource`、`readSources`、`writeSources`、`readCollinsKey`、`writeCollinsKey`、`findSource`、`resolveKey` | 两个 0600 小文件的读写与脱敏 |
| `host/routes.js` | `handleStore`、`handleStoreRevision`、`sharedState` | HTTP 那一侧的包装 |

## 小模块索引

| 小模块 | 一句话 | 文档 |
| --- | --- | --- |
| paths-and-limits | `PATHS`、五个路径函数、七组上限 | [paths-and-limits.md](./paths-and-limits.md) |
| library-file | `readStore` / `writeStore`：原子写与失败回落 | [library-file.md](./library-file.md) |
| merge-rules | 并集、墓碑、`placements`/`placed`、两个写者 | [merge-rules.md](./merge-rules.md) |
| revision | FNV-1a + 长度，与客户端轮询的契约 | [revision.md](./revision.md) |
| secrets | `sources.json`、`dictionary.json`、`publicSource`、`resolveKey` | [secrets.md](./secrets.md) |

## 数据流

```
面板 POST /store {state}                        english_reader 工具
        │  sharedState 白名单                          │ mergeStore(current, change)
        └──────────────►  mergeStore  ◄───────────────┘
                              ▲
                   readStore()┘
                              │
                 writeStore：library.json.tmp ──rename──► library.json
                              │
                       revisionOf(merged)
                              ▼
              {revision, changed} ──► 面板决定「当自己的」还是「立刻回读」

面板每 2s ──► GET /store/revision ──► revisionOf(readStore())   （只回指纹）
```

## 常见改动

| 需求 | 改哪里 | 顺手补什么 |
| --- | --- | --- |
| 库里多存一类数据 | `sharedState`（`20-routes/library-routes`）+ `readStore` 默认值 + `mergeStore` 并集 + 面板 `persist` | `test/host.test.mjs` 的保存-读回用例 |
| 改合并/归类 | `merge-rules`，**两边一起改** | `test/internals.test.mjs`「the browser and the host settle a filing the same way」 |
| 加一个密钥文件 | `secrets` + `paths-and-limits` 的路径函数 | 一条「响应里找不到明文 key」的断言 |
| 换指纹算法 | `revision` | `test/host.test.mjs` 里 revision 相关的几条用例 |
| 换存储目录 | `dshHome` 一处；所有调用点都经它 | 测试里把 `DSH_HOME` 指到临时目录，别读真实数据 |

## 风险与历史坑

- **写库必须原子**：直接写目标文件时，进程在写一半退出就留下半截 JSON；`readStore` 会把它当坏文件返回 `null`，用户看到的是「库被清空了」。所以 `writeStore` 是 `library.json.tmp` + `rename`，读到的永远是完整的旧版或完整的新版。
- **键序会影响指纹**：`revisionOf` 哈希的是 `JSON.stringify` 的文本，而 `JSON.stringify` 保持对象的键插入顺序。`readStore` 用展开先保留文件里的未知键、`mergeStore` 先写字面量再补未知键——这两处顺序必须稳定，否则 `POST` 返回的 `revision` 与下一次 `GET` 算出的不同，面板会把自己刚写的当成别人写的，多一次回读，最坏形成回环。
- **坏文件不自动修**：`readStore` 遇到不可解析的内容返回 `null`，下一次保存会以空库为基底合并。宿主上的旧数据就此丢失（各浏览器的 localStorage 还有副本，但那是本机的）。要修就显式修，别偷偷在 `readStore` 里兜底。
- **墓碑会被挤掉**：只保留最新 500 条；删除量极大时最老的墓碑消失，一个很旧的副本理论上能把它带回来。
- **时间戳来自客户端**：`addedAt`/`updatedAt`/`folderAt` 都是面板或工具写的 `Date.now()`，两个时钟不同步的浏览器同时写会按各自的时间判胜负；`folderAt` 平局时按「后合并进来的一方」赢，这条在 `merge-rules` 里写死。
- **白名单只保护 HTTP 那一侧**：`sharedState` 会砍掉本机状态，但工具不走它，工具写的未知字段会原样落盘——扩展方便，也意味着工具能写出面板不认识的东西。