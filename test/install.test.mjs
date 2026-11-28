/**
 * Installation contract: the local engine is opt-in.
 *
 * `kokoro-js` drags in `onnxruntime-node`, whose postinstall probes the local
 * CUDA and fails when it is newer than it knows; `sharp` and `protobufjs` come
 * with it. Installing that whole tree with the plugin made a CUDA-13 machine
 * fail the plugin installation, and made every Edge-only user pay for it. These
 * cases pin the fix — the manifest offers the engine as an *optional peer*, so
 * pnpm (with `autoInstallPeers` off) installs none of it, and a worker without
 * the engine answers `engine-missing` instead of dying or blaming the sentence.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { engineReady } from '../host/engine.js'
import { engineFailureOf } from '../host/speech.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MANIFEST = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

/**
 * Run a copy of `worker.mjs` where no dependency can be resolved.
 *
 * The copy makes `kokoro-js` genuinely missing, which is what an optional
 * dependency that pnpm skipped looks like at run time.
 * @param {Array<object>} requests - requests to send, each with an id.
 * @returns {Promise<Map<number, any>>} the replies, by id.
 */
async function talkToWorker(requests) {
  const dir = await mkdtemp(join(tmpdir(), 'er-install-'))
  await copyFile(join(ROOT, 'worker.mjs'), join(dir, 'worker.mjs'))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(dir, 'worker.mjs')], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] })
    const replies = new Map()
    let ready = false
    let buffer = ''
    let stderr = ''
    const finish = () => {
      if (!ready || !requests.every((request) => replies.has(request.id))) return
      clearTimeout(timer)
      child.kill()
      void rm(dir, { recursive: true, force: true })
      resolve(replies)
    }
    const timer = setTimeout(() => {
      child.kill()
      void rm(dir, { recursive: true, force: true })
      reject(new Error(`the worker did not answer: ${stderr.slice(-400)}`))
    }, 10000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line === '') continue
        const message = JSON.parse(line)
        if (message.event === 'ready') { ready = true; continue }
        if (message.event !== undefined) continue
        replies.set(message.id, message)
      }
      finish()
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000) })
    child.on('error', (error) => {
      clearTimeout(timer)
      void rm(dir, { recursive: true, force: true })
      reject(error)
    })
    child.on('exit', (code) => {
      if (ready) return
      clearTimeout(timer)
      void rm(dir, { recursive: true, force: true })
      reject(new Error(`the worker exited before it was ready (code ${String(code)}): ${stderr.slice(-400)}`))
    })
    child.stdin.write(requests.map((request) => `${JSON.stringify(request)}\n`).join(''))
  })
}

test('the local engine is opt-in, so its native runtime never joins a plugin install', () => {
  assert.equal(MANIFEST.dependencies?.['kokoro-js'], undefined,
    'kokoro-js must not be a hard dependency: its onnxruntime-node postinstall is what failed the install')
  assert.equal(MANIFEST.optionalDependencies?.['kokoro-js'], undefined,
    'optionalDependencies are still installed by default, so the engine must not live there either')
  assert.match(String(MANIFEST.peerDependencies?.['kokoro-js'] ?? ''), /^\^?1\./,
    'the engine is offered as a peer, with its 1.x range')
  assert.equal(MANIFEST.peerDependenciesMeta?.['kokoro-js']?.optional, true,
    'the peer has to be optional: pnpm must not auto-install it and the plugin must load without it')
  assert.match(String(MANIFEST.dependencies?.['msedge-tts'] ?? ''), /^\^?2\./,
    'the Edge engine stays a hard dependency: it is the path that has to keep working')
})

test('a worker without the optional engine names the cause and keeps running', async () => {
  const replies = await talkToWorker([
    { id: 1, op: 'local', text: 'They revive it.', voice: 'af_heart' },
    { id: 2, op: 'no-such-op' },
    { id: 3, op: 'probe' },
  ])
  const local = replies.get(1)
  assert.equal(local.ok, false, 'the local request cannot succeed without the engine')
  assert.equal(local.code, 'engine-missing', 'the host and the panel dispatch on this code')
  assert.match(local.error, /optional peer dependency/i, 'the message says why the engine is missing')
  assert.match(local.error, /kokoro-js|onnxruntime/i, 'the message names what is missing')
  assert.equal(replies.get(2).code, undefined, 'an ordinary failure is not mislabelled as a missing engine')
  assert.equal(replies.get(3).ok, true, 'the worker survived the failed engine load')
})
/** Build a fake engine tree: every package present, some entries missing. */
async function fakeEngine(names, missing = []) {
  const root = await mkdtemp(join(tmpdir(), 'er-engine-'))
  for (const name of names) {
    const directory = join(root, 'node_modules', name)
    await mkdir(join(directory, 'dist'), { recursive: true })
    const exports = name === 'kokoro-js'
      ? { types: './types/x.d.ts', node: { import: './dist/entry.js', require: './dist/entry.cjs' }, default: './dist/entry.js' }
      : './dist/entry.js'
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, exports }))
    if (!missing.includes(name)) await writeFile(join(directory, 'dist', 'entry.js'), 'export {}\n')
  }
  return root
}

test('a half-written engine tree is not ready', async () => {
  // pnpm writes every package.json before it unpacks the files. Checking only
  // the manifest called that tree ready, so the panel started the model download
  // against an engine that could not be imported.
  const packages = ['kokoro-js', '@huggingface/transformers', 'onnxruntime-node', 'sharp']
  const partial = await fakeEngine(packages, ['kokoro-js'])
  try {
    assert.equal(engineReady(partial), false, 'a package with no entry file is not installed')
    await writeFile(join(partial, 'node_modules', 'kokoro-js', 'dist', 'entry.js'), 'export {}\n')
    assert.equal(engineReady(partial), true, 'the same tree is ready once every entry file exists')
  } finally {
    await rm(partial, { recursive: true, force: true })
  }
})

test('the entry file follows the manifest the way Node does', async () => {
  const packages = ['kokoro-js', '@huggingface/transformers', 'onnxruntime-node', 'sharp']
  const root = await fakeEngine(packages)
  try {
    const manifest = join(root, 'node_modules', 'sharp', 'package.json')
    // A `main` with no `exports` is still resolved, and `index.js` is the last resort.
    await writeFile(manifest, JSON.stringify({ name: 'sharp', main: 'lib/sharp.js' }))
    assert.equal(engineReady(root), false, 'main points at a file that does not exist')
    await mkdir(join(root, 'node_modules', 'sharp', 'lib'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'sharp', 'lib', 'sharp.js'), 'module.exports = {}\n')
    assert.equal(engineReady(root), true, 'main is followed')
    await writeFile(manifest, JSON.stringify({ name: 'sharp' }))
    assert.equal(engineReady(root), false, 'no main and no index.js is not installed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('only engine failures ask for a new worker', () => {
  // A fresh worker is the only way out of a resolution that failed once; a model
  // or ONNX failure must keep the worker, because a new process would repeat it.
  assert.equal(engineFailureOf({ code: 'engine-missing' }), true)
  assert.equal(engineFailureOf({ message: 'local engine unavailable (kokoro-js is an optional peer dependency and is not installed): Cannot find package' }), true)
  assert.equal(engineFailureOf({ message: "Cannot find package '/home/x/.dsh/profiles/web/node_modules/kokoro-js/index.js' imported from /x/worker.mjs" }), true)
  assert.equal(engineFailureOf({ message: 'failed to load model: protobuf parsing failed' }), false)
  assert.equal(engineFailureOf({ message: 'libonnxruntime.so: cannot open shared object file' }), false)
  assert.equal(engineFailureOf(null), false)
})
