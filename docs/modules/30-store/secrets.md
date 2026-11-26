# secrets

## 职责

两个放密钥的小文件：`sources.json`（自定义语音源的端点与 key）和 `dictionary.json`（Collins 词典 key）。本模块定义它们的形状、权限（0600）、以及「浏览器能看见什么」——答案永远是「有没有 key」，不是 key。

## 位置

- `host/files.js` :: `isSource`, `publicSource`, `readSources`, `writeSources`, `readCollinsKey`, `writeCollinsKey`, `findSource`, `resolveKey`
- `host/constants.js` :: `sourcesFile`, `dictKeyFile`, `PROTOCOLS`, `dshHome`

## 输入 → 输出

| 符号 | 作用 |
| --- | --- |
| `readSources()` | 读 `sources.json`：不是数组、或解析失败 → `[]`；数组则逐条过 `isSource` |
| `writeSources(list)` | `mkdir -p` 后整份覆盖写，`mode: 0o600`，两空格缩进 |
| `readCollinsKey()` | 读 `dictionary.json` 的 `collinsKey`；文件坏了/字段不是字符串 → `''` |
| `writeCollinsKey(key)` | 写 `{collinsKey: key}`，`mode: 0o600`；空字符串等于删除 |
| `publicSource(entry)` | 面向前端的投影：`id`、`name`、`protocol`、`baseUrl`、`model`、`voiceA`、`voiceB`、`customVoices`、`hasKey` |
| `findSource(id)` | 按 id 取**带 key 的原始记录**，宿主内部用；找不到 `null` |
| `resolveKey(explicitKey, sourceId)` | 优先用显式给的 key，否则借 `sourceId` 那一条已存的 key；都没有 `''` |

`sources.json` 是一条数组，元素至少要有 `id`（非空字符串）、`protocol`（在 `PROTOCOLS` 里）、`baseUrl`（字符串）才被 `isSource` 接受。`dictionary.json` 是一个对象，key 包在 `collinsKey` 字段里——这样以后加别的 key 不必换文件形状。

## 不变量

- **key 只进不出**：`host/routes.js` 里所有对外的语音源响应都过 `publicSource`，只给 `hasKey`；`/dict/key` 的 GET 另给一段掩码（前 4 位 + `…` + 后 2 位），完整值永不出宿主。真正用到明文的地方只有两处：上游请求的 `Authorization` 头，和 `host/speech.js` 的合成参数。
- **权限 0600 写在每次写入上**：`writeSources` 与 `writeCollinsKey` 都带 `mode: 0o600`；文件是整份重写，所以权限不会被旧文件带跑。
- **省略 key ≠ 清空 key**：`sourceRecord`（在 `20-routes/speech-routes`）在请求没带 `key` 或给空串时沿用旧值。这就是「面板永远拿不到 key，却还能修改源」的实现方式——改名、改地址都不会把 key 弄丢。
- **显式 key 优先**：`resolveKey('', id)` 借已存的，`resolveKey('user-typed', '')` 用用户刚填的，两者都有则用用户填的。试连一个还没保存的源靠这条。
- **读失败一律当空**：坏 JSON、权限不足、文件不存在都变成 `[]` / `''`，不抛给路由层。代价见下面第一条风险。
- **`isSource` 会静默丢弃**：协议不在白名单、缺 `id`、`baseUrl` 不是字符串的记录读进来就消失；而 `handleSources` 的 POST 是「读全量 → 改一条 → 写全量」，所以下一次保存会把它**永久删掉**。

## 相邻模块

- 上游写成者：`20-routes/speech-routes`（`/tts/sources` 的 POST/DELETE 走 `saveSource` → `writeSources`）、`20-routes/dictionary-routes`（`/dict/key` 的 POST 走 `writeCollinsKey`）。
- 上游读者：`/tts`（custom 源）、`/tts/voices`（`customVoices`）、`/tts/validate` 与 `/tts/models`（`resolveKey`）、`/dict`（`lookUpCollins` 的 key）。
- 路径与协议白名单：`30-store/paths-and-limits`（`sourcesFile`、`dictKeyFile`、`PROTOCOLS`）。
- 对照：`30-store/library-file` 是原子写（tmp + rename）；本模块**不是**。

## 改这里时

- **加一个源字段**：`isSource`（要不要校验）、`publicSource`（要不要暴露）、`sourceRecord`（怎么合并旧值）三处一起改；只加在 `publicSource` 会让字段永远为空。
- **想让文件也原子**：照 `writeStore` 的 tmp + rename 改，但注意 `readSources` 现在把坏文件当空数组——原子化之后可以考虑「坏文件当不存在，但不要立刻覆盖」，否则一次磁盘问题会清空所有源。
- **加第二个词典 key**：`dictionary.json` 已经是对象，加字段即可；但 `writeCollinsKey` 是整份覆盖，新字段要先读旧的再写，否则会把别的字段抹掉。
- **加密存储**：当前是明文 0600。要加密就得解决「密钥本身放哪」，别把主密钥也写进同一个目录。
- **不要把 `masked` 挪进 `publicSource`**：掩码只属于 `/dict/key` 的 GET，语音源连掩码都不该给。

## 读代码顺序

1. `publicSource`：一眼看清对外是一张固定的九字段投影，`key` 不在其中，未知字段也不会跟着出去。
2. `readSources` + `isSource`：为什么坏记录是静默的。
3. `writeSources`：`mode: 0o600` 与两空格缩进。
4. `readCollinsKey` / `writeCollinsKey`：对象包一层的好处。
5. `findSource` 与 `resolveKey`：宿主内部怎么借 key，以及优先级。
6. 跳到 `20-routes/speech-routes` 的 `sourceRecord`，看「省略字段保留旧值」怎么落到写入上。