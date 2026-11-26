/**
 * Boots the real panel in jsdom: same client.js, same React, same events.
 *
 * The panel is loaded exactly the way the host loads it — through
 * `window.__ModuleLoader__` — so registration mistakes (a slot that never
 * registers, a component that throws on mount) fail here as well as in the app.
 * Everything the panel talks to over `fetch` is answered by `createHost()`.
 */

import './dom.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React

const PANEL_FILE = fileURLToPath(new URL('../client.js', import.meta.url))

/** Load client.js the way the browser does, and return its module object. */
async function loadPanelModule() {
  const captured = {}
  window.__ModuleLoader__ = {
    load(spec) { captured.spec = spec },
  }
  // A cache-busting query keeps two launches in one process independent.
  await import(`${new URL(`../client.js?test=${Math.random()}`, import.meta.url).href}`)
  if (captured.spec === undefined) throw new Error('client.js never called __ModuleLoader__.load')
  const module = captured.spec.factory((id) => {
    if (id === 'react') return React
    throw new Error(`the panel required an unexpected module: ${id}`)
  })
  return module
}

const panelModule = await loadPanelModule()

/** Pure helpers client.js exposes for exactly this: testing without a browser. */
export const internals = panelModule.internals

/**
 * A small stand-in for the host's merge: union the lists by id and drop what a
 * tombstone covers. The real rule lives in host/files.js and is tested there;
 * this only has to keep the panel's own save from erasing a test's write.
 */
function mergeStore(current, incoming) {
  if (incoming === null || typeof incoming !== 'object') return current
  const base = current !== null && typeof current === 'object' ? current : {}
  const gone = new Map([...(base.removed ?? []), ...(incoming.removed ?? [])]
    .map((entry) => [`${entry.kind}:${entry.id}`, Number(entry.at ?? 0)]))
  const union = (left, right, stamp) => {
    const out = new Map()
    for (const entry of [...(left ?? []), ...(right ?? [])]) {
      const id = String(entry?.id ?? '')
      if (id === '') continue
      const held = out.get(id)
      if (held === undefined || Number(entry[stamp] ?? 0) >= Number(held[stamp] ?? 0)) out.set(id, entry)
    }
    return [...out.values()]
  }
  return {
    savedAt: Math.max(Number(base.savedAt ?? 0), Number(incoming.savedAt ?? 0)),
    items: union(base.items, incoming.items, 'updatedAt')
      .filter((entry) => (gone.get(`item:${entry.id}`) ?? 0) < Number(entry.updatedAt ?? 0)),
    words: union(base.words, incoming.words, 'addedAt')
      .filter((entry) => (gone.get(`word:${entry.id}`) ?? 0) < Number(entry.addedAt ?? 0)),
    folders: union(base.folders, incoming.folders, 'createdAt'),
    removed: [...gone.entries()].map(([key, at]) => {
      const split = key.indexOf(':')
      return { kind: key.slice(0, split), id: key.slice(split + 1), at }
    }),
    ...(incoming.settings === undefined ? (base.settings === undefined ? {} : { settings: base.settings }) : { settings: incoming.settings }),
  }
}

/** Whether two lists hold the same ids, the way the host decides a save was fine. */
function sameIds(left, right) {
  const ids = (list) => [...(Array.isArray(list) ? list : [])].map((entry) => String(entry?.id ?? '')).sort()
  return JSON.stringify(ids(left)) === JSON.stringify(ids(right))
}

/** Replace the global fetch for one panel, and record every request. */
export function createHost(options = {}) {
  const dict = options.dict ?? {}
  const latency = options.latency ?? {}
  const calls = []
  const json = (body, init = {}) => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
  const wait = (word) => new Promise((resolve) => setTimeout(resolve, latency[word] ?? 0))

  const fetch = async (input, init = {}) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    const path = url.pathname
    const method = String(init.method ?? 'GET').toUpperCase()
    calls.push({ method, path, search: url.search, body: typeof init.body === 'string' ? init.body : null })

    if (path === '/api-dsh-english-reader/tts/sources' && method === 'GET') return json({ sources: [] })
    if (path === '/api-dsh-english-reader/local/status') {
      return json({ installed: false, phase: 'absent', onDisk: false, dir: '/tmp/model' })
    }
    if (path === '/api-dsh-english-reader/translate/options') {
      return json({
        target: 'zh-CN',
        routes: [],
        model: null,
        providers: [{ id: 'dsh', ready: false }, { id: 'google', ready: true }, { id: 'volc', ready: true }],
      })
    }
    if (path === '/api-dsh-english-reader/translate/models') return json({ models: [] })
    // The host holds the Collins key, never the browser: POST stores it, GET only
    // reports whether one is there. A test that saves a key needs the write to
    // land, so the flag is kept here instead of being hard-coded false.
    if (path === '/api-dsh-english-reader/dict/key') {
      if (method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}'))
        host.collinsKey = typeof body?.key === 'string' ? body.key.trim() : ''
        return json({ hasKey: host.collinsKey !== '' })
      }
      return json({ hasKey: host.collinsKey !== '', masked: host.collinsKey === '' ? '' : '••••' })
    }
    if (path === '/api-dsh-english-reader/store') {
      if (method === 'GET') return json({ ok: true, state: host.store, revision: host.revision })
      // The real host merges by id instead of replacing, so a test's write is
      // not erased by the panel's next save — and a tombstone still wins.
      const posted = JSON.parse(String(init.body ?? '{}'))?.state ?? null
      host.store = mergeStore(host.store, posted)
      host.revision = `r${host.writes += 1}`
      return json({
        ok: true,
        savedAt: Date.now(),
        revision: host.revision,
        changed: !sameIds(host.store.items, posted?.items)
          || !sameIds(host.store.words, posted?.words)
          || !sameIds(host.store.folders, posted?.folders),
      })
    }
    // A tool call writes the same file the panel reads; this is how a test says
    // "somebody else changed the library" without going through the panel.
    if (path === '/api-dsh-english-reader/store/revision') {
      return json({ ok: true, revision: host.revision, savedAt: 0 })
    }
    if (path === '/api-dsh-english-reader/dict' && method === 'GET') {
      const word = (url.searchParams.get('word') ?? '').toLowerCase()
      const source = url.searchParams.get('source') ?? ''
      await wait(word)
      const entry = dict[word]
      if (entry === undefined) return json({ ok: false, code: 'notFound' })
      if (source === 'model') return json({ ok: false, code: 'notFound' })
      return json({
        ok: true,
        en: source === 'wordnet' || source === 'wiktionary' || source === 'collins' ? entry.en ?? null : null,
        zh: source === 'iciba' || source === 'model' ? entry.zh ?? null : null,
      })
    }
    if (path === '/api-dsh-english-reader/dict/ai') return json({ ok: false, error: 'no model in tests' })
    // A local folder added through the dialog is checked by the host first.
    // Only a test that asks for a verdict gets one; every other test keeps the
    // 404 it saw before this route existed.
    if (path === '/api-dsh-english-reader/tts/validate' && method === 'POST' && options.validate !== undefined) {
      return json(options.validate)
    }
    if (path === '/api-dsh-english-reader/translate') {
      const body = JSON.parse(String(init.body ?? '{}'))
      const texts = Array.isArray(body.texts) ? body.texts : []
      return json({ translations: texts.map((text) => `译[${body.source}]:${text}`) })
    }
    if (path === '/api-dsh-english-reader/tts') {
      if (options.tts === 'fail') {
        return new Response('speech synthesis failed: speech worker stopped (code 1)', {
          status: 502,
          headers: { 'content-type': 'text/plain' },
        })
      }
      return new Response(new Uint8Array([0]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }
    return json({ ok: false, error: `no mock for ${method} ${path}` }, { status: 404 })
  }

  const host = {
    fetch, calls, json, store: options.store ?? null, revision: 'r0', writes: 0,
    collinsKey: options.collinsKey ?? '',
    /** Pretend a tool call wrote the library while the panel was open. */
    write(state) {
      host.store = state
      host.revision = `r${host.writes += 1}`
    },
  }
  return host
}

/** A saved word and a dialogue containing it, so the list and the page agree. */
export const FIXTURE_STATE = {
  version: 3,
  activeId: 'doc-1',
  items: [{
    id: 'doc-1',
    title: 'Reviving a dream',
    text: 'They revive it.\nThe dream returns.',
    index: 0,
    mode: 'article',
    createdAt: 1,
    updatedAt: 1,
  }],
}

export const FIXTURE_DICT = {
  dream: {
    en: { phonetic: '/driːm/', senses: [{ pos: 'n', def: 'imaginary events seen while sleeping', example: 'a vivid dream' }] },
    zh: { senses: [{ pos: 'n', def: '梦（想）；理想' }] },
  },
  revive: {
    en: { phonetic: '/rɪˈvaɪv/', senses: [{ pos: 'v', def: 'to bring back to life', example: 'revive a custom' }] },
    zh: { senses: [{ pos: 'v', def: '使复活；使苏醒' }] },
  },
  they: { en: { phonetic: '', senses: [{ pos: 'pron', def: 'the people already mentioned', example: '' }] } },
}

/** Mount the panel and hand back the queries a test needs. */
export async function launchPanel(options = {}) {
  // The directory picker is a host capability, not a route: a test that presses
  // "Choose…" passes one in, every other test keeps the dismissed picker.
  const pickDirectory = options.pickDirectory ?? (async () => null)
  const host = createHost({ dict: FIXTURE_DICT, ...(options.host ?? {}) })
  const state = options.state ?? FIXTURE_STATE
  window.localStorage.clear()
  window.localStorage.setItem('dsh-english-reader:state:v2', JSON.stringify(state))
  globalThis.fetch = host.fetch

  const errors = []
  const originalError = console.error
  console.error = (...args) => { errors.push(args.map(String).join(' ')) }

  const registered = new Map()
  const context = {
    effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    locale: {
      register: () => () => {},
      subscribe: () => () => {},
      getLocale: () => ({ active: options.locale ?? 'en' }),
    },
    slots: {
      inject: (name, register) => register(),
      register: (descriptor, component) => {
        registered.set(`${descriptor.name}:${descriptor.key ?? descriptor.id ?? ''}`, { descriptor, component })
        return () => {}
      },
    },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTab: () => {} },
    uiWorkspace: { pickDirectory },
  }
  panelModule.apply(context)

  const entry = registered.get('sidebar.right.pane.tab:dsh-english-reader')
  if (entry === undefined) throw new Error('the panel never registered sidebar.right.pane.tab')

  const props = { ...(entry.descriptor.inject?.() ?? {}), pickDirectory }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(entry.component, props)) })
  // The panel reads the shared library from the host on mount; let it land.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

  const api = {
    host,
    errors,
    container,
    internals: panelModule.internals,
    q: (selector) => container.querySelector(selector),
    qa: (selector) => [...container.querySelectorAll(selector)],
    text: (selector) => container.querySelector(selector)?.textContent ?? '',
    /** Text of every node matching, trimmed. */
    texts: (selector) => [...container.querySelectorAll(selector)].map((node) => node.textContent.trim()),
    async click(node) {
      if (node === null || node === undefined) throw new Error('click: no node')
      await act(async () => { node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })) })
      await api.settle()
    },
    /** Right-click, the way a word span opens the dictionary. */
    async rightClick(node, point = { x: 40, y: 30 }) {
      if (node === null || node === undefined) throw new Error('rightClick: no node')
      await act(async () => {
        node.dispatchEvent(new window.MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: point.x, clientY: point.y,
        }))
      })
      await api.settle()
    },
    async type(node, value) {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        const areaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        if (node.tagName === 'TEXTAREA') areaSetter.call(node, value)
        else setter.call(node, value)
        node.dispatchEvent(new window.Event('input', { bubbles: true }))
      })
      await api.settle()
    },
    /** Press one key on an element, the way a user does. */
    async key(node, key) {
      if (node === null || node === undefined) throw new Error('key: no node')
      await act(async () => {
        node.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      })
      await api.settle()
    },
    /** Pick one option of a native `<select>`, the way a user does. */
    async choose(node, value) {
      if (node === null || node === undefined) throw new Error('choose: no node')
      await act(async () => {
        node.value = value
        node.dispatchEvent(new window.Event('change', { bubbles: true }))
      })
      await api.settle()
    },
    /** Wait for something the panel does asynchronously, up to a timeout. */
    async waitFor(predicate, options = {}) {
      const timeout = options.timeout ?? 3000
      const label = options.label ?? 'the panel'
      const started = Date.now()
      while (Date.now() - started < timeout) {
        if (predicate()) return true
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
      }
      throw new Error(`timed out after ${timeout}ms waiting for ${label}`)
    },
    /** Let real time pass, with React act around whatever the panel's timers do. */
    async idle(ms) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
    },
    /** Let effects, promises and the panel's own timers run out. */
    async settle(rounds = 8) {
      for (let index = 0; index < rounds; index += 1) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      }
    },
    async unmount() {
      await act(async () => { root.unmount() })
      container.remove()
      console.error = originalError
    },
  }
  return api
}

/** The word span for one token of the sentence on screen. */
export function wordSpan(api, token) {
  const wanted = String(token).toLowerCase()
  return api.qa('.er-w').find((node) => node.textContent.toLowerCase() === wanted) ?? null
}
