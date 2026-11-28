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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The host keeps its files under DSH_HOME; point that at a scratch folder so a
// test never reads or writes the user's real dictionary key or model folder.
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'er-host-test-'))
const { apply } = await import('../index.js')

const ORIGIN = 'http://127.0.0.1:3080'
const PREFIX = '/api-dsh-english-reader'
const BASE = `${ORIGIN}${PREFIX}`

test('the engine is detected by the packages the worker resolves', async () => {
  const engine = await import('../host/engine.js')
  const root = await mkdtemp(join(tmpdir(), 'er-engine-'))
  const previous = process.env.ER_ENGINE_ROOT
  process.env.ER_ENGINE_ROOT = root
  try {
    assert.equal(engine.engineStatus().phase, 'missing', 'an empty profile has no engine')
    for (const name of ['kokoro-js', '@huggingface/transformers', 'onnxruntime-node', 'sharp']) {
      mkdirSync(join(root, 'node_modules', name), { recursive: true })
      writeFileSync(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }))
    }
    // A manifest with no file behind it is what a running `pnpm add` looks like;
    // calling it ready is what started a worker against a half-written engine.
    assert.equal(engine.engineStatus().phase, 'missing', 'a manifest alone is not an installed package')
    for (const name of ['kokoro-js', '@huggingface/transformers', 'onnxruntime-node', 'sharp']) {
      writeFileSync(join(root, 'node_modules', name, 'index.js'), 'module.exports = {}\n')
    }
    assert.equal(engine.engineStatus().phase, 'ready', 'the worker can load all four packages')
  } finally {
    if (previous === undefined) delete process.env.ER_ENGINE_ROOT
    else process.env.ER_ENGINE_ROOT = previous
    rmSync(root, { recursive: true, force: true })
  }
})

test('the engine install skips build scripts in both install layouts', async () => {
  const engine = await import('../host/engine.js')
  const profile = await mkdtemp(join(tmpdir(), 'er-profile-'))
  const linked = await mkdtemp(join(tmpdir(), 'er-linked-'))
  try {
    writeFileSync(join(profile, 'package.json'), '{}')
    writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    const managed = engine.installCommand(profile)
    assert.equal(managed.command, 'pnpm', 'a profile is updated with the package manager DSH uses')
    assert.deepEqual(managed.args, ['add', '--ignore-scripts', 'kokoro-js@^1.2.1'],
      'the CUDA postinstall must never run')

    const checkout = engine.installCommand(linked)
    assert.ok(checkout.command !== 'pnpm', 'a linked checkout is not a pnpm project')
    assert.ok(checkout.args.includes('--ignore-scripts'), 'npm must skip the same postinstall')
    assert.ok(checkout.args.includes('--no-save'), 'a checkout manifest is left untouched')
  } finally {
    rmSync(profile, { recursive: true, force: true })
    rmSync(linked, { recursive: true, force: true })
  }
})

test('the profile build settings keep the engine packages after a later install', async () => {
  const engine = await import('../host/engine.js')
  const root = await mkdtemp(join(tmpdir(), 'er-builds-'))
  try {
    writeFileSync(join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - .\n\nallowBuilds:\n  msedge-tts@2.1.1: true\n  onnxruntime-node@1.21.0: true\n')
    for (const [name, version] of [['onnxruntime-node', '1.21.0'], ['sharp', '0.34.5']]) {
      mkdirSync(join(root, 'node_modules', name), { recursive: true })
      writeFileSync(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }))
    }
    assert.equal(engine.denyEngineBuilds(root), true, 'the settings file changes')
    const text = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
    assert.match(text, /onnxruntime-node@1\.21\.0: false/, 'approving it would drop the package')
    assert.match(text, /sharp@0\.34\.5: false/)
    assert.match(text, /msedge-tts@2\.1\.1: true/, 'unrelated declarations stay')
    assert.equal(engine.denyEngineBuilds(root), false, 'a second run is a no-op')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

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

/** Answer a handler-style route with a fake request and response. */
function callHandler(route, options = {}) {
  const answered = { status: 200, body: null }
  const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  const request = {
    method: options.method ?? 'GET',
    async *[Symbol.asyncIterator]() { if (payload !== undefined) yield Buffer.from(payload) },
  }
  const response = {
    writeHead(status) { answered.status = status; return this },
    end(body) { try { answered.body = JSON.parse(body) } catch { answered.body = body } return this },
  }
  return route.handler(request, response).then(() => answered)
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
  // The host is an entry plus one module per responsibility; the routes live in
  // host/routes.js and the paths in host/constants.js.
  const hostDir = fileURLToPath(new URL('../host/', import.meta.url))
  const host = [readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8'),
    ...readdirSync(hostDir).map((name) => readFileSync(join(hostDir, name), 'utf8'))].join('\n')
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

test('the library is shared through the host, not one browser', async () => {
  const route = routes.get(`${PREFIX}/store`)
  assert.ok(route !== undefined, 'the store route is registered')

  const fresh = await callHandler(route)
  assert.deepEqual(fresh.body, { ok: true, state: null, revision: '' }, 'a fresh host holds nothing yet')

  const first = await callHandler(route, {
    method: 'POST',
    body: {
      state: {
        savedAt: 100,
        items: [{ id: 'doc-1', title: 'One', updatedAt: 100 }],
        words: [{ id: 'dream', word: 'dream', addedAt: 100 }],
      },
    },
  })
  assert.equal(first.body.ok, true)

  const stored = await callHandler(route)
  assert.deepEqual(stored.body.state.items.map((item) => item.id), ['doc-1'])
  assert.deepEqual(stored.body.state.words.map((word) => word.id), ['dream'])

  // A second panel saves a different word: nothing from the first is lost.
  await callHandler(route, {
    method: 'POST',
    body: { state: { savedAt: 200, items: [], words: [{ id: 'revive', word: 'revive', addedAt: 200 }] } },
  })
  const merged = await callHandler(route)
  assert.deepEqual(merged.body.state.words.map((word) => word.id).sort(), ['dream', 'revive'])
  assert.deepEqual(merged.body.state.items.map((item) => item.id), ['doc-1'])
})

test('the store refuses what it cannot keep', async () => {
  const route = routes.get(`${PREFIX}/store`)
  const wrongMethod = await callHandler(route, { method: 'DELETE' })
  assert.equal(wrongMethod.status, 405)

  const badJson = await callHandler(route, { method: 'POST', raw: '{not json' })
  assert.equal(badJson.status, 400)
  assert.equal(badJson.body.error, 'badJson')

  const badState = await callHandler(route, { method: 'POST', body: { state: { items: 'nope' } } })
  assert.equal(badState.status, 400)
  assert.equal(badState.body.error, 'badState')
})

test('the host forgets what a panel deleted', async () => {
  const route = routes.get(`${PREFIX}/store`)
  await callHandler(route, {
    method: 'POST',
    body: {
      state: {
        savedAt: 300,
        items: [],
        words: [
          { id: 'keep', word: 'keep', addedAt: 300 },
          { id: 'drop', word: 'drop', addedAt: 300 },
        ],
      },
    },
  })
  const deleted = await callHandler(route, {
    method: 'POST',
    body: {
      state: {
        savedAt: 400,
        items: [],
        words: [{ id: 'keep', word: 'keep', addedAt: 300 }],
        removed: [{ kind: 'word', id: 'drop', at: 400 }],
      },
    },
  })
  assert.equal(deleted.body.ok, true)
  const after = await callHandler(route)
  const idsAfter = after.body.state.words.map((word) => word.id)
  assert.ok(idsAfter.includes('keep'), 'the kept word survived')
  assert.ok(!idsAfter.includes('drop'), 'the deleted word is gone')
  assert.ok(after.body.state.removed.some((entry) => entry.id === 'drop'), 'the deletion is remembered')

  // A panel that never saw the deletion cannot put the word back.
  await callHandler(route, {
    method: 'POST',
    body: { state: { savedAt: 350, items: [], words: [{ id: 'drop', word: 'drop', addedAt: 300 }] } },
  })
  const final = await callHandler(route)
  assert.ok(!final.body.state.words.map((word) => word.id).includes('drop'), 'a stale panel cannot restore it')
})

test('every module points at files that exist', () => {
  // The host used to spawn `./worker.mjs` from index.js. After the split that
  // relative path pointed inside host/, so synthesis died with MODULE_NOT_FOUND
  // while every route test still passed.
  const hostDir = fileURLToPath(new URL('../host/', import.meta.url))
  const missing = []
  for (const name of readdirSync(hostDir)) {
    if (!name.endsWith('.js')) continue
    const file = join(hostDir, name)
    for (const match of readFileSync(file, 'utf8').matchAll(/new URL\(['"]([^'"]+)['"],\s*import\.meta\.url\)/g)) {
      const target = new URL(match[1], pathToFileURL(file))
      if (!existsSync(target)) missing.push(`${name} -> ${match[1]}`)
    }
  }
  assert.deepEqual(missing, [], `modules reference files that do not exist: ${missing.join(', ')}`)
  assert.ok(existsSync(join(hostDir, '../worker.mjs')), 'the speech worker is where the host expects it')
})

test('a move survives a save that never saw it', async () => {
  // A word is stamped by `addedAt` and a dialogue by `updatedAt`; filing one
  // changes neither. The host used to settle the merge on those stamps alone,
  // so a panel that had never seen the move erased it on its next save — the
  // user had to reload, and sometimes even that was not enough.
  const files = await import('../host/files.js')
  const filedAt = (entry) => files.mergeStore(entry.host, entry.incoming);

  const word = filedAt({
    host: { words: [{ id: 'dream', word: 'dream', addedAt: 100, folderId: 'f1', folderAt: 500 }] },
    incoming: { words: [{ id: 'dream', word: 'dream', addedAt: 100 }] },
  });
  assert.equal(word.words[0].folderId, 'f1', 'the newer filing wins over the older copy');

  const dialogue = filedAt({
    host: { items: [{ id: 'doc-1', title: 'One', updatedAt: 100, folderId: 'g1', folderAt: 500 }] },
    incoming: { items: [{ id: 'doc-1', title: 'One', updatedAt: 100 }] },
  });
  assert.equal(dialogue.items[0].folderId, 'g1');

  // Filing something back to unclassified is a move too, and it has to hold.
  const unfiled = filedAt({
    host: { words: [{ id: 'dream', word: 'dream', addedAt: 100, folderId: 'f1', folderAt: 500 }] },
    incoming: { words: [{ id: 'dream', word: 'dream', addedAt: 100, folderId: '', folderAt: 600 }] },
  });
  assert.equal(unfiled.words[0].folderId, '', 'the newest move reads as unclassified');

  // Two filings inside one millisecond: the one being written now is the later
  // of them, so the incoming copy has to win the tie.
  const sameMoment = filedAt({
    host: { words: [{ id: 'dream', word: 'dream', addedAt: 100, folderId: 'f1', folderAt: 700 }] },
    incoming: { words: [{ id: 'dream', word: 'dream', addedAt: 100, folderId: 'f2', folderAt: 700 }] },
  });
  assert.equal(sameMoment.words[0].folderId, 'f2');

  // An entry that was never filed keeps its shape: no folderId is invented.
  const plain = filedAt({
    host: { words: [{ id: 'dream', word: 'dream', addedAt: 100 }] },
    incoming: { words: [{ id: 'dream', word: 'dream', addedAt: 100 }] },
  });
  assert.equal(Object.hasOwn(plain.words[0], 'folderId'), false);
});

test('the revision tells "written elsewhere" from "written by me"', async () => {
  const files = await import('../host/files.js');
  assert.equal(files.revisionOf(null), '', 'an empty host has no revision');
  const one = { savedAt: 1, items: [], words: [{ id: 'a', word: 'a', addedAt: 1 }] };
  const two = { savedAt: 2, items: [], words: [{ id: 'b', word: 'b', addedAt: 2 }] };
  assert.equal(files.revisionOf(one), files.revisionOf(JSON.parse(JSON.stringify(one))),
    'the same file read twice keeps its revision');
  assert.notEqual(files.revisionOf(one), files.revisionOf(two));
  // A word filed elsewhere is news even when every stamp is untouched.
  const filed = { savedAt: 1, items: [], words: [{ id: 'a', word: 'a', addedAt: 1, folderId: 'f', folderAt: 9 }] };
  assert.notEqual(files.revisionOf(one), files.revisionOf(filed));
});

test('an open panel can ask where the library stands without reading it', async () => {
  const route = routes.get(`${PREFIX}/store/revision`);
  assert.ok(route !== undefined, 'the revision route is registered');

  const before = await callHandler(route);
  assert.equal(before.body.ok, true);
  assert.equal(typeof before.body.revision, 'string');

  await callHandler(routes.get(`${PREFIX}/store`), {
    method: 'POST',
    body: { state: { savedAt: 900, items: [], words: [{ id: 'lantern', word: 'lantern', addedAt: 900 }] } },
  });
  const after = await callHandler(route);
  assert.notEqual(after.body.revision, before.body.revision, 'a write moves the revision');

  // The full read carries the same revision, so a panel that pulls the library
  // and one that only asks agree on what it just saw.
  const full = await callHandler(routes.get(`${PREFIX}/store`));
  assert.equal(full.body.revision, after.body.revision);

  const wrongMethod = await callHandler(route, { method: 'POST', body: {} });
  assert.equal(wrongMethod.status, 405);
});

test('a save the host had to correct says so', async () => {
  // The browser sent a library and got back "kept" — but the host kept
  // something else, because a word was deleted, or a tool filed one the browser
  // has never seen. The panel has to know, or it keeps showing a library nobody
  // else has until the page is reloaded.
  const route = routes.get(`${PREFIX}/store`);
  const panelSaves = (state) => callHandler(route, { method: 'POST', body: { state } });
  // The store is shared by every test in this file; start from nothing so the
  // first save is a whole library rather than a correction of leftovers.
  const files = await import('../host/files.js');
  await files.writeStore({ savedAt: 0, items: [], words: [], folders: [], removed: [] });

  const first = await panelSaves({
    savedAt: 1000,
    items: [],
    words: [{ id: 'dream', word: 'dream', addedAt: 1000 }, { id: 'lantern', word: 'lantern', addedAt: 1000 }],
  });
  assert.equal(first.body.changed, false, 'the first save is the library, so nothing was corrected');

  // The panel deletes one word; the host agrees with the rest.
  const answer = await panelSaves({
    savedAt: 1001,
    items: [],
    words: [{ id: 'dream', word: 'dream', addedAt: 1000 }],
    removed: [{ kind: 'word', id: 'lantern', at: 1001 }],
  });
  assert.equal(answer.body.changed, false, 'a deletion the host applies is not a correction');

  // Now a panel that never saw the deletion posts the word again.
  const corrected = await panelSaves({
    savedAt: 1002,
    items: [],
    words: [{ id: 'dream', word: 'dream', addedAt: 1000 }, { id: 'lantern', word: 'lantern', addedAt: 1000 }],
  });
  assert.equal(corrected.body.changed, true, 'the host dropped a word the panel still had');
  assert.equal(corrected.body.revision, await revisionOfAnswer(), 'the answer carries the revision it wrote');

  // Order alone is not a correction: the browser sorts its own list.
  const reordered = await panelSaves({
    savedAt: 1003,
    items: [],
    words: [{ id: 'dream', word: 'dream', addedAt: 1000 }],
    removed: [{ kind: 'word', id: 'lantern', at: 1001 }],
  });
  assert.equal(reordered.body.changed, false, 'the same entries in the same order are no news');

  const other = await panelSaves({
    savedAt: 1004,
    items: [],
    words: [],
    removed: [{ kind: 'word', id: 'lantern', at: 1001 }],
  });
  assert.equal(other.body.changed, true, 'a word the panel dropped is a correction too');
});

/** The revision of the library as it is stored right now, for comparing answers. */
async function revisionOfAnswer() {
  const { revisionOf } = await import('../host/files.js');
  const { readStore } = await import('../host/files.js');
  return revisionOf(await readStore());
}

test('the plugin unloads after the speech worker started', async () => {
  // `worker` is an exported binding. The unload path used to assign to it, which
  // throws `TypeError: Assignment to constant variable` — but only once a first
  // synthesis had started the child process, so every test that never spoke
  // passed. Cleanup then aborted halfway, leaving the effect's disposal chain in
  // the air.
  const speech = await import('../host/speech.js');
  const disposers = [];
  const context = {
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
      return () => {};
    },
    webServer: { register: () => () => {} },
  };
  apply(context, {});
  speech.startWorker();
  assert.notEqual(speech.worker, null, 'the worker process is running');

  assert.doesNotThrow(() => { for (const dispose of disposers) dispose(); }, 'unload must not throw');
  assert.equal(speech.worker, null, 'the handle is cleared, so the next synthesis starts a new one');
});

test('the locked commit is read from the profile lockfile', async () => {
  const update = await import('../host/update.js');
  const root = mkdtempSync(join(tmpdir(), 'er-update-'));
  try {
    assert.equal(update.currentCommit(root), null, 'no lockfile, no commit');
    writeFileSync(join(root, 'pnpm-lock.yaml'), [
      'importers:',
      '  .',
      '    dependencies:',
      '      dsh-english-reader:',
      '        specifier: github:KNtnx/dsh-english-reader#main',
      '        version: https://codeload.github.com/KNtnx/dsh-english-reader/tar.gz/7bdb81f47e1d38bbd4d4a7f82e5868f980b605ec(debug@4.4.3)',
      '      msedge-tts:',
      '        specifier: ^2.1.1',
      '        version: 2.1.1',
    ].join('\n'));
    assert.equal(update.currentCommit(root), '7bdb81f47e1d38bbd4d4a7f82e5868f980b605ec', 'the tar.gz URL carries the commit');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
})

test('a newer commit is offered and installed as a pinned spec', async () => {
  const update = await import('../host/update.js');
  const sha = '8ee9c5a3e6b177dbb8ea35428284853d556808fe';
  const seen = [];
  const manager = { installBundle: async (spec) => { seen.push(spec); return { application: 'applied' } } };
  const latest = { sha, message: 'fix: something', date: '2026-11-28T00:00:00Z' };

  const git = async () => `${sha}\trefs/heads/main`;
  const api = async () => ({ ok: true, json: async () => ({ commit: { message: 'fix: something', committer: { date: latest.date } } }) });
  const newer = await update.checkForUpdate({ current: '0'.repeat(40), git, fetch: api });
  assert.equal(newer.newer, true, 'a different commit is an update');
  assert.equal(newer.message, 'fix: something', 'the API only decorates the answer');
  const same = await update.checkForUpdate({ current: sha, git, fetch: api });
  assert.equal(same.newer, false, 'the locked commit is not an update');
  // The API answering 403 (unauthenticated quota) must not fail the check: git
  // ls-remote needs no token.
  const blocked = await update.checkForUpdate({ current: sha, git, fetch: async () => ({ ok: false, status: 403 }) });
  assert.equal(blocked.latest, sha);
  assert.equal(blocked.message, '');

  await update.applyUpdate(manager, sha);
  assert.deepEqual(seen, [`github:KNtnx/dsh-english-reader#${sha}`], 'the manager gets a spec pinned to the full commit');
  assert.throws(() => update.applyUpdate(manager, 'abcdef1'), /full commit/, 'a short sha is refused before anything is installed');
})

test('a repository that cannot be reached is reported, not thrown', async () => {
  const update = await import('../host/update.js');
  await assert.rejects(
    update.checkForUpdate({ current: null, git: async () => { throw new Error('git ls-remote exited with 128') } }),
    /exited with 128/,
  );
  await assert.rejects(
    update.checkForUpdate({ current: null, git: async () => 'not a commit' }),
    /named no commit/,
  );
})
