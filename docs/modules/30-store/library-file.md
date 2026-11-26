# library-file

## 职责

`library.json` 这一份文件的读写：读的时候把「不像库」的内容变成 `null`（缺失、坏 JSON、数组、空），合法时补齐四个数组与 `savedAt`，并把不认识的字段原样带过去；写的时候先写临时文件再 `rename`，让一次崩溃不会留下半截库。

## 位置

- `host/files.js` :: `readStore`, `writeStore`
- `host/constants.js` :: `storeFile`, `MAX_STORE_BYTES`

## 输入 → 输出

| 符号 | 输入 | 输出 |
| --- | --- | --- |
| `readStore()` | 无（路径由 `storeFile()` 决定） | `Promise<{savedAt, items, words, folders, removed, ...}>` 或 `null` |
| `writeStore(state)` | 任意可序列化对象 | `Promise<void>`；失败直接抛给调用方 |

`readStore` 的清洗规则：

| 情况 | 结果 |
| --- | --- |
| 文件不存在 / 不可读 / JSON 坏 | `null`（**不抛**） |
| 解析出来是 `null`、数组、或非对象 | `null` |
| `savedAt` 不是有限数字 | `0` |
| `items` / `words` / `folders` / `removed` 不是数组 | `[]` |
| 其他顶层字段 | 原样保留（展开在前，四个数组覆盖在后） |

`writeStore` 走三步：`mkdir(dirname(storeFile()), {recursive: true})` → `writeFile(storeFile() + '.tmp', JSON.stringify(state), {mode: 0o600})` → `rename(tmp, storeFile())`。文件内容**没有缩进**（对比 `writeSources` 用的是两空格）。

## 不变量

- **读永不抛**：`readStore` 的 `catch` 返回 `null`。所有调用方都必须把 `null` 当「空库」：`GET /store` 原样回 `state: null`，`POST /store` 用 `mergeStore(null, incoming)` 合并，工具侧写 `readStore() ?? {savedAt: 0, …}`。
- **写是原子的**：同一目录内的 `rename` 是原子的，读到的要么是旧文件、要么是新文件；`.tmp` 永远不会被 `readStore` 读到。
- **`.tmp` 名字固定**：`library.json.tmp`。这假设同一时刻只有一个宿主进程在写；两个 DSH 进程共用一个 `DSH_HOME` 时，它们会抢同一个临时文件（见「改这里时」）。
- **未知字段必须活下来**：`readStore` 先 `...parsed` 再覆盖四个数组，`mergeStore` 最后再补一遍未知键——两处都是为了让「别的模块写进这个文件的字段」不被这次保存擦掉。
- **不替调用方编字段**：缺失的数组补 `[]`，但不会生成 `id`、时间戳或默认 `folderId`；「没归过类」就是没有 `folderId` 这个键。

## 相邻模块

- 上游调用者：`20-routes/library-routes`（`handleStore` 的 GET/POST）、`60-tool`（工具直接读改写）。
- 下游/配合：`30-store/merge-rules`（合并后才写）、`30-store/revision`（哈希的是 `JSON.stringify` 的同一份对象）、`30-store/paths-and-limits`（`storeFile`、`MAX_STORE_BYTES` 是请求体上限，不是文件上限）。
- 对照：`30-store/secrets` 的两个小文件是直接 `writeFile` + 0600，没有 tmp/rename——同样是整份覆盖，但少了原子性这道保险。

## 改这里时

- **加一个顶层字段**：要能被面板写，就得在 `sharedState` 白名单、`mergeStore` 的并集（或让它落进「未知键」分支）、面板 `persist` 的 payload 里出现。只在 `readStore` 加默认值的话，值会被「未知键」分支原样保住，但永远改不动。
- **多进程/多实例**：把临时文件名改成带 `pid` 或随机后缀，并在 `rename` 前 `fsync`；否则两个进程可能互相 `rename` 掉对方正在写的内容。
- **加备份**：最省事是在 `writeStore` 的 `rename` 之前把旧文件复制成 `.bak`；不要改成「先删旧文件再写」，那会把原子性丢掉。
- **不要在这里做迁移**：`readStore` 一旦开始「顺手修一下」，读操作就变成了写操作，`GET /store` 会有副作用；迁移放到启动时的显式步骤里。
- **换存储格式**（例如从 JSON 换成行式）：`revisionOf` 依赖 `JSON.stringify` 的文本，两边必须一起换。

## 读代码顺序

1. `readStore` 的 `try` 块：解析 → 形状检查 → 展开与四个数组。
2. `readStore` 的 `catch`：为什么返回 `null` 而不是抛。
3. `writeStore` 三行：`mkdir`、写 `.tmp`（注意 `mode`）、`rename`。
4. 回头看 `handleStore` 怎么用这两个函数（`20-routes/library-routes`）。
5. 再读 `mergeStore` 的末尾：未知键是怎么被补回去的。