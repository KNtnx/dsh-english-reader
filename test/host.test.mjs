/**
 * The host half: the routes the panel calls, and the parsing the dictionary
 * answers depend on.
 *
 * The routes are pure functions over a URL, so they are tested without a server.
 * Upstream dictionaries are stubbed, which means these tests say what the host
 * does with a real answer — not whether the internet is reachable today.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The host keeps its files under DSH_HOME; point that at a scratch folder so a
// test never reads or writes the user's real dictionary key or model folder.
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'er-host-test-'))
const { apply } = await import('../index.js')

const ORIGIN = 'http://127.0.0.1:3080'
const PREFIX = '/api-dsh-english-reader'
const BASE = `${ORIGIN}${PREFIX}`

/** Register the plugin against a fake context and hand back its routes. */
function registerRoutes(services = {}) {
  const routes = new Map()
  const context = {
    effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    get: (name) => services[name],
    webServer: {
      register: (route) => { routes.set(route.path, route); return () => {} },
    },
  }
  apply(context, {})
  return routes
}

/** Answer one resource route, and return its JSON plus status. */
async function ask(routes, path, query = '') {
  const route = routes.get(`${PREFIX}${path}`)
  if (route === undefined) throw new Error(`no route registered for ${path}`)
  const response = await route.resource(new Request(`${BASE}${path}${query}`))
  return { status: response.status, body: await response.json() }
}

/** Stub one upstream fetch shape for the duration of a call. */
async function withUpstream(routes_, fetchImpl, run) {
  const original = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

const routes = registerRoutes()

test('every route the panel calls exists on the host', () => {
  const client = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')
  const host = readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8')
  const pathsIn = (text) => new Set(text.match(/\/api-dsh-english-reader\/[a-z/]+/g) ?? [])
  const hostPaths = pathsIn(host)
  const missing = [...pathsIn(client)].filter((path) => !hostPaths.has(path))
  assert.deepEqual(missing, [], `the panel calls routes the host does not serve: ${missing.join(', ')}`)
  for (const path of hostPaths) {
    assert.ok(routes.has(path), `route ${path} was not registered`)
  }
})

test('the Chinese dictionary groups meanings by part of speech', async () => {
  const body = await withUpstream(routes, async (url) => {
    assert.match(String(url), /iciba/)
    return Response.json({
      message: [{
        key: 'dream',
        means: [
          { part: 'n', means: ['梦（想）', '理想'] },
          { part: 'v', means: ['做梦', '渴望'] },
        ],
      }],
    })
  }, () => ask(routes, '/dict', '?word=dream&source=iciba').then((result) => result.body))
  assert.equal(body.ok, true)
  assert.equal(body.source, 'iciba')
  assert.deepEqual(body.zh.senses, [
    { pos: 'n', def: '梦（想）；理想' },
    { pos: 'v', def: '做梦；渴望' },
  ])
  assert.equal(body.en, null, 'one source answers at a time')
})

test('a possessive is looked up by its base word', async () => {
  const seen = []
  const body = await withUpstream(routes, async (url) => {
    seen.push(String(url))
    return Response.json({ message: [{ key: 'lantern', means: [{ part: 'n', means: ['灯笼'] }] }] })
  }, () => ask(routes, '/dict', '?word=lantern%E2%80%99s&source=iciba').then((result) => result.body))
  assert.match(seen[0], /word=lantern$/)
  assert.equal(body.ok, true)
})

test('the English dictionary turns Datamuse definitions into senses', async () => {
  const body = await withUpstream(routes, async (url) => {
    assert.match(String(url), /datamuse/)
    return Response.json([{
      word: 'revive',
      defs: ['v\tto restore to life or consciousness', 'v\tto become active again'],
    }])
  }, () => ask(routes, '/dict', '?word=revive&source=wordnet').then((result) => result.body))
  assert.equal(body.ok, true)
  assert.deepEqual(body.en.senses, [
    { pos: 'v', def: 'to restore to life or consciousness', example: '' },
    { pos: 'v', def: 'to become active again', example: '' },
  ])
  assert.equal(body.zh, null)
})

test('a Wiktionary definition loses its markup and keeps its example', async () => {
  const body = await withUpstream(routes, async () => Response.json({
    en: [{
      partOfSpeech: 'Noun',
      definitions: [{
        definition: '<style>.x{color:red}</style>A hope &amp; wish<sup>[1]</sup>.',
        examples: ['He had a <b>dream</b>.'],
      }],
    }],
  }), () => ask(routes, '/dict', '?word=quill&source=wiktionary').then((result) => result.body))
  assert.equal(body.ok, true)
  assert.equal(body.en.senses[0].pos, 'Noun')
  assert.equal(body.en.senses[0].def, 'A hope & wish.')
  assert.equal(body.en.senses[0].example, 'He had a dream.')
})

test('a word neither dictionary knows is a miss, not a failure', async () => {
  const body = await withUpstream(routes, async () => Response.json([]),
    () => ask(routes, '/dict', '?word=zzzqqq&source=wordnet').then((result) => result.body))
  assert.deepEqual(body, { ok: false, code: 'notFound' })
})

test('a word that is not a word is refused before any request goes out', async () => {
  let called = 0
  const result = await withUpstream(routes, async () => { called += 1; return Response.json({}) },
    () => ask(routes, '/dict', '?word=12345&source=iciba'))
  assert.equal(result.status, 400)
  assert.deepEqual(result.body, { ok: false, code: 'badWord' })
  assert.equal(called, 0, 'no request is made for an impossible word')
})

test('an unknown source is refused', async () => {
  const result = await withUpstream(routes, async () => Response.json({}),
    () => ask(routes, '/dict', '?word=dream&source=i-dont-exist'))
  assert.equal(result.status, 400)
  assert.deepEqual(result.body, { ok: false, code: 'badSource' })
})

test('the panel is told whether a Collins key exists, never the key', async () => {
  const route = routes.get(`${PREFIX}/dict/key`)
  assert.ok(route !== undefined, 'the key route is registered')
  const answers = []
  const response = {
    writeHead() { return this },
    end(payload) { answers.push(JSON.parse(payload)); return this },
  }
  await route.handler({ method: 'GET' }, response)
  assert.equal(answers.length, 1)
  assert.equal(answers[0].hasKey, false, 'a fresh host has no key')
  assert.equal(answers[0].masked, '')
})

test('the translation route reports what it can do without a model', async () => {
  const body = await ask(routes, '/translate/options').then((result) => result.body)
  assert.ok(Array.isArray(body.providers), 'the panel needs a provider list')
  assert.equal(typeof body.target, 'string')
  const microsoft = body.providers.find((entry) => entry.id === 'microsoft')
  assert.equal(microsoft.ready, false, 'no key configured means not ready')
})

test('the local engine reports its state instead of failing the panel', async () => {
  const result = await ask(routes, '/local/status')
  assert.equal(result.status, 200)
  assert.equal(typeof result.body.installed, 'boolean')
  assert.ok(typeof result.body.phase === 'string' || result.body.phase === null)
})