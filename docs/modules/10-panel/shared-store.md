# shared-store

## 职责

面板的「用户数据」层：从 localStorage 与宿主各读一份，用同一套规则合并成一份，再在状态变化时写回两边。它同时决定**归谁**（`folderAt`）、**删掉的不能复活**（墓碑）、**旧数据怎么迁移**。

## 位置

- `client.js` :: `STORAGE_KEY`, `LEGACY_KEY`, `loadState`, `isFolderRecord`, `readFolders`, `folderOf`, `mergeStates`, `sameLibrary`, `useSharedStore`, `persist`, `sendStore`

## 输入 → 输出

- `loadState()`：读 `dsh-english-reader:state:v2`；不是合法形状时回落 `…:v1`（首版的单篇布局）并把 `{text, voiceA, voiceB, rate, loop, index}` 迁成 v2。
- `mergeStates(local, remote)`：返回 `{...local, items, words, folders, removed}`。规则顺序：
  1. 墓碑表 `kind:id → at` 由两边合并（**删除是记录，不是缺失**）；
  2. 每个列表按 id 并集，`addedAt`（词）/ `updatedAt`（对话）/ `createdAt`（夹）新的赢，早于墓碑的副本直接丢弃；
  3. 词的 `folderId` 由**最大的 `folderAt`** 决定（平局取后合并进来的一方，即宿主）；
  4. 夹子按 `createdAt` 排序；没归类过的条目不会凭空多出 `folderId`；
  5. 宿主带了 `settings.dictionary` 时，吸收成 `dictShow` / `dictCn` / `dictEn`。
- `sameLibrary(a, b)`：按 id 排序后比较，判断「拉回来的和手上的到底是不是同一份」。
- `useSharedStore(...)`：状态 `items`、`activeId`、`index`、`words`、`removed`、`folders`、`aiEntries`；`persist(override)` 写 localStorage（version 3）并 `sendStore`。

## 不变量

- **删除必须留墓碑**。少写一条墓碑，另一台浏览器下次同步就把这个词带回来——`test/panel.folders.test.mjs` 与 `host.test.mjs` 都盯着这条。
- **归类只由 `folderAt` 决定**，`addedAt`/`updatedAt` 涨了不代表「刚被移动」。宿主端 `30-store/merge-rules` 是同一套规则，两边必须一致。
- **读取时做的清洗**：词条 `id` 小写；`senses`/`translation` 走 `sensesOf`（兼容字符串）；`context` 里不含该词的，一律当空（那是从「查单词」框收藏的，不是句子）。
- **`localStorage` 只放本机状态**：宽度、字号、声音、位置、缓存；用户数据同时上宿主，所以换浏览器也能拿到。

守护：`test/internals.test.mjs`（合并、墓碑、跨端一致性）、`test/panel.sync.test.mjs`（宿主变了跟不跟）、`test/panel.folders.test.mjs`（归类与夹子）。

## 相邻模块

- 上游：`10-panel/panel-shell`（提供初始值与 setter）、`00-loading/client-registration`（`ReaderBoot` 先读库再渲染）。
- 下游：`10-panel/host-sync`（`persist` 通过 `sendStore` 出去）、`10-panel/views`（只读状态）。
- 对端：`30-store/library-file` 与 `30-store/merge-rules`（宿主那一半）。

## 改这里时

- **加一个共享字段**（例如词的笔记）：入口加进 `mergeStates` 的 `keep`/`placed`、`sharedState` 白名单（宿主）与 `persist` 的 payload，三处缺一不可。
- **加一种墓碑类型**：`removed` 的 `kind` 要同时在宿主的 `30-store/merge-rules` 与本文件的 `keep` 里出现。
- **改合并规则**：先改 `test/internals.test.mjs`「the browser and the host settle a filing the same way」，再改两边实现。

## 读代码顺序

1. `loadState`（旧数据从哪来）。
2. `mergeStates` 的 `gone` 表（墓碑）。
3. 同一函数的 `keep`（并集 + 时间戳）。
4. `placed` 那段（`folderAt` 决定归属）。
5. `sameLibrary`。
6. `useSharedStore` 的 `persist` → `sendStore`。