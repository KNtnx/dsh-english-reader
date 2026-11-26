/**
 * 文档契约：让「文档」和「代码」不会各说各话。
 *
 * 这一层不是测行为，而是测**这座文档体系还站得住**：
 * - AGENTS.md 是目录，必须短、必须覆盖八个大模块；
 * - 每篇文档有固定小节，否则读者找不到"不变量"在哪；
 * - 「位置」里引用的 `文件 :: 符号` 必须真的在代码里存在（行号会漂，符号不会）；
 * - 链接能打开，索引不漏篇，源文件不漏文档；
 * - 引用只写符号不写行号（`client.js:123` 这种写法一律拒绝）。
 *
 * 它抓的是"改了代码没改文档"和"文档写了一个早已改名的函数"这两类腐烂。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS = join(ROOT, 'docs/modules')

/** 八个大模块，按依赖方向排序；目录名即编号。 */
const MODULES = [
  '00-loading',
  '10-panel',
  '20-routes',
  '30-store',
  '40-speech',
  '50-dictionary',
  '60-tool',
  '70-testing',
]

/** 小模块文档必须有的七个小节。 */
const SUB_SECTIONS = ['## 职责', '## 位置', '## 输入 → 输出', '## 不变量', '## 相邻模块', '## 改这里时', '## 读代码顺序']

/** 大模块 README 必须有的六个小节。 */
const README_SECTIONS = ['## 一句话', '## 代码入口', '## 小模块索引', '## 数据流', '## 常见改动', '## 风险与历史坑']

/** 一篇小模块文档的行数上限；README 稍宽。 */
const SUB_MAX_LINES = 90
const README_MAX_LINES = 110

/** AGENTS.md 的硬上限：它是每次会话都要读进去的目录。 */
const AGENTS_MAX_LINES = 350

/** 列出某目录下（递归）所有 markdown 文件。 */
function markdownIn(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...markdownIn(path))
    else if (name.endsWith('.md')) out.push(path)
  }
  return out
}

/** 取一篇文档里某个二级小节的正文（到下一个二级标题为止）。 */
function section(text, heading) {
  const start = text.indexOf(`${heading}\n`)
  if (start === -1) return ''
  const rest = text.slice(start + heading.length + 1)
  const end = rest.search(/^## /m)
  return end === -1 ? rest : rest.slice(0, end)
}

/** 一篇文档里的相对链接目标（跳过外链与锚点）。 */
function linksIn(text) {
  const out = []
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1]
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue
    out.push(target.split('#')[0])
  }
  return out
}

const allDocs = () => markdownIn(DOCS)
const subDocs = () => allDocs().filter((path) => path.endsWith('README.md') === false)

test('AGENTS.md 是目录，不是手册', () => {
  const path = join(ROOT, 'AGENTS.md')
  assert.ok(existsSync(path), 'AGENTS.md 必须在仓库根目录：DSH 只会读根目录这一份')
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n').length
  assert.ok(lines <= AGENTS_MAX_LINES, `AGENTS.md 有 ${lines} 行，超过 ${AGENTS_MAX_LINES} 行上限`)
  assert.match(text, /## 任务 → 读什么/, 'AGENTS.md 必须有一张「任务 → 读什么」表，它才是目录')
  for (const module of MODULES) {
    assert.ok(text.includes(`docs/modules/${module}/README.md`),
      `AGENTS.md 没有指向 ${module} 的链接：新读者找不到这个模块`)
  }
})

test('每个大模块都有 README，并且六个小节齐全', () => {
  for (const module of MODULES) {
    const path = join(DOCS, module, 'README.md')
    assert.ok(existsSync(path), `${module}/README.md 不存在`)
    const text = readFileSync(path, 'utf8')
    const lines = text.split('\n').length
    assert.ok(lines <= README_MAX_LINES, `${module}/README.md 有 ${lines} 行，超过 ${README_MAX_LINES} 行`)
    for (const heading of README_SECTIONS) {
      assert.ok(text.includes(`${heading}\n`), `${module}/README.md 缺少小节 ${heading}`)
    }
  }
})

test('每篇小模块文档七个小节齐全，且不超长', () => {
  const docs = subDocs()
  assert.ok(docs.length >= 40, `只找到 ${docs.length} 篇小模块文档，八个模块应该接近 46 篇`)
  for (const path of docs) {
    const name = relative(DOCS, path)
    const text = readFileSync(path, 'utf8')
    const lines = text.split('\n').length
    assert.ok(lines <= SUB_MAX_LINES, `${name} 有 ${lines} 行，超过 ${SUB_MAX_LINES} 行`)
    for (const heading of SUB_SECTIONS) {
      assert.ok(text.includes(`${heading}\n`), `${name} 缺少小节 ${heading}`)
    }
  }
})

test('文档只引用符号，不写行号', () => {
  for (const path of allDocs()) {
    const name = relative(ROOT, path)
    const text = readFileSync(path, 'utf8')
    const cited = text.match(/\b[\w./-]+\.(?:js|mjs|json|yml):\d+/g)
    assert.equal(cited, null, `${name} 里出现行号引用 ${cited}：行号会漂，改写成「文件 :: 符号」`)
  }
})

test('「位置」里的每个符号都能在代码里找到', () => {
  const problems = []
  for (const path of allDocs()) {
    const name = relative(ROOT, path)
    const text = readFileSync(path, 'utf8')
    const body = section(text, '## 位置')
    if (body === '') continue
    for (const line of body.split('\n')) {
      const match = line.match(/^-\s*`([^`]+)`\s*::\s*(.+)$/)
      if (match === null) continue
      const target = match[1]
      const file = join(ROOT, target)
      if (!existsSync(file)) { problems.push(`${name} -> ${target} 不存在`); continue }
      const source = readFileSync(file, 'utf8')
      for (const raw of match[2].split(',')) {
        // 一行里可能带括注（`exports`（声明…））：先去掉括注，再去掉所有反引号。
        const symbol = raw.replace(/（.*?$/u, '').replace(/`/g, '').trim()
        if (symbol === '') continue
        // `DICT.en` 这类点号写法只校验第一段：真正会被改名的就是那个标识符。
        const head = symbol.split('.')[0]
        const found = new RegExp(`(^|[^A-Za-z0-9_$])${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_$]|$)`, 'm').test(source)
        if (!found) problems.push(`${name} -> ${target} 里没有 ${head}`)
      }
    }
  }
  assert.deepEqual(problems, [], `这些引用在代码里找不到：\n${problems.join('\n')}`)
})

test('文档里的相对链接都能打开', () => {
  const problems = []
  for (const path of [join(ROOT, 'AGENTS.md'), ...allDocs()]) {
    const name = relative(ROOT, path)
    const text = readFileSync(path, 'utf8')
    for (const target of linksIn(text)) {
      const resolved = resolve(dirname(path), target)
      if (!existsSync(resolved)) problems.push(`${name} -> ${target}`)
    }
  }
  assert.deepEqual(problems, [], `这些链接打不开：\n${problems.join('\n')}`)
})

test('大模块 README 的索引覆盖本模块每一篇，也没有孤儿', () => {
  for (const module of MODULES) {
    const dir = join(DOCS, module)
    const readme = readFileSync(join(dir, 'README.md'), 'utf8')
    const listed = new Set(linksIn(readme).filter((target) => target.endsWith('.md')))
    const present = readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'README.md')
    for (const name of present) {
      assert.ok(listed.has(`./${name}`), `${module}/README.md 的索引里没有 ${name}`)
    }
    for (const target of listed) {
      assert.ok(present.includes(target.replace(/^\.\//, '')),
        `${module}/README.md 链到了不存在的 ${target}`)
    }
  }
})

test('仓库里每个源文件都被至少一篇文档点名', () => {
  const corpus = [readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'), ...allDocs().map((path) => readFileSync(path, 'utf8'))].join('\n')
  const files = [
    'index.js', 'client.js', 'worker.mjs', 'package.json', 'cordis.patch.yml',
    ...readdirSync(join(ROOT, 'host')).filter((name) => name.endsWith('.js')).map((name) => `host/${name}`),
    ...readdirSync(join(ROOT, 'locale')).map((name) => `locale/${name}`),
    ...readdirSync(join(ROOT, 'test')).filter((name) => name.endsWith('.mjs')).map((name) => `test/${name}`),
  ]
  const missing = files.filter((file) => corpus.includes(file) === false)
  assert.deepEqual(missing, [], `这些文件没有任何文档提到：${missing.join(', ')}`)
})