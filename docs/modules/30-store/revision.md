# revision

## 职责

给整份库算一个十几个字节的指纹，让打开着的面板每两秒只取这点字节就能判断「别人写过没有」。它不需要安全，只需要**同一份内容永远算出同一个串、内容一变就算出另一个串**；算法是 FNV-1a 加一个长度后缀。

## 位置

- `host/files.js` :: `revisionOf`
- `host/routes.js` :: `handleStore`, `handleStoreRevision`

## 输入 → 输出

| 输入 | 输出 |
| --- | --- |
| `null` / `undefined` | `''`（空库没有指纹） |
| 任何可序列化对象 | `` `${hash.toString(36)}.${length.toString(36)}` `` |

算法逐步：

1. `text = JSON.stringify(state)`——注意是**文本**，键序与数字格式都属于输入；
2. `hash = 2166136261`，逐字符 `hash ^= charCodeAt(i)` 再 `hash = Math.imul(hash, 16777619)`（FNV-1a，32 位）；
3. 返回 `(hash >>> 0).toString(36)` 与 `text.length.toString(36)`，中间一个点。

两处用法都只做「比较」，不解析：`GET /store` 与 `POST /store` 回的是刚读/刚写那一版的指纹，`GET /store/revision` 回的是磁盘上那一版。面板把它们当不透明字符串存进 `revisionRef`。

## 不变量

- **同一份内容 → 同一个串**：`revisionOf(x)` 与 `revisionOf(结构化克隆(x))` 必须相等（`test/host.test.mjs`「the revision tells "written elsewhere" from "written by me"」第一条断言）。所以计算里不能掺时间、随机数、`mtime`、进程 id——掺了就会让每次轮询都「有变化」，退化成两秒拉一次整库。
- **键序是输入的一部分**：`JSON.stringify` 按对象键的插入顺序输出。`readStore` 用 `...parsed` 保留文件里的顺序再覆盖四个数组，`mergeStore` 按固定字面量顺序构造再补未知键——两条路径对**同一份内容**必须产出同样的键序，否则 `POST` 回的指纹与下一次 `GET /store/revision` 的不同，面板会把自己刚写的当成别人写的，白读一次，最坏来回震荡。
- **长度必须进指纹**：32 位哈希会撞；带上长度后，长度不同直接不同，长度相同才需要比较那 32 位。这是「便宜地降低误判」而不是密码学保证。
- **空库就是空串**：`revisionOf(null) === ''`，`GET /store` 在新宿主上返回 `state: null, revision: ''`；面板把这个值当「还没有版本」，第一次保存之后才会有真正的指纹。
- **`savedAt` 参与哈希**：保存会带上新的 `savedAt`（`mergeStore` 取两边最大），所以即使四个列表一模一样，指纹通常也会变。面板因此把自己这次写记成已知版本（`changed` 为假时不再回读）。
- **面板不重算指纹**：它只比较字符串，所以改算法不需要同时改浏览器半边；代价是升级后每个面板会多读一次整库。

## 相邻模块

- 上游：`20-routes/library-routes`（`GET /store`、`POST /store`、`GET /store/revision` 三处回它）。
- 下游消费者：`10-panel/host-sync`（`revisionRef` 与 2 秒轮询；`changed: true` 时立刻回读）。
- 依赖：`30-store/library-file`（读回来的对象键序）、`30-store/merge-rules`（写下去的对象键序）——三者一起决定「同一份库只有一个指纹」。
- 无关：`30-store/secrets` 的小文件没有指纹，它们不轮询。

## 改这里时

- **换算法**（例如换成 SHA-256 前缀）：只要 `POST` 与 `GET` 两条路径都用新函数即可；别只改一处，那会让每次保存都被当成「别人写的」。
- **想加更多信息**（例如文件大小）：加进 `text` 或加进返回串；不要引入随每次读变化的东西。
- **别在 `revisionOf` 里排序键**：排序看似能让指纹与顺序无关，但如果只在函数里排、而落盘与合并仍按原顺序，`POST` 的指纹与 `GET` 的指纹就会分叉。要么两边都规范化，要么都不。
- **性能**：整库几十 KB，逐字符取哈希是亚毫秒级；`/store/revision` 每两秒一次完全够。若将来库涨到 MB 级，先加缓存（按 `savedAt` 或文件 `mtime` 失效），别把轮询间隔当解法。
- **不要把它当校验和**：它只回答「变没变」，不证明内容正确；库的完整性靠原子写（`30-store/library-file`）。

## 读代码顺序

1. `revisionOf` 开头的 `null` 分支。
2. `JSON.stringify` 那行：为什么是文本而不是遍历字段。
3. 三行哈希循环（`Math.imul` 是 32 位乘法的关键）。
4. 返回值的两段与中间的点。
5. 回头看 `handleStoreRevision`：它只做 `readStore()` + `revisionOf`，没有别的逻辑。
6. 再看 `handleStore` 的 POST：指纹算的是**合并后**的对象，不是面板发来的。