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
    calls.push({ method, path, search: url.search })

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
    if (path === '/api-dsh-english-reader/dict/key') return json({ hasKey: false, masked: '' })
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
    if (path === '/api-dsh-english-reader/translate') {
      const body = JSON.parse(String(init.body ?? '{}'))
      const texts = Array.isArray(body.texts) ? body.texts : []
      return json({ translations: texts.map((text) => `译:${text}`) })
    }
    if (path === '/api-dsh-english-reader/tts') {
      return new Response(new Uint8Array([0]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }
    return json({ ok: false, error: `no mock for ${method} ${path}` }, { status: 404 })
  }

  return { fetch, calls, json }
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
    uiWorkspace: { pickDirectory: async () => null },
  }
  panelModule.apply(context)

  const entry = registered.get('sidebar.right.pane.tab:dsh-english-reader')
  if (entry === undefined) throw new Error('the panel never registered sidebar.right.pane.tab')

  const props = { ...(entry.descriptor.inject?.() ?? {}), pickDirectory: async () => null }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(entry.component, props)) })

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
