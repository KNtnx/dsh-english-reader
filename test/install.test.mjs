/**
 * Installation contract: the local engine is optional.
 *
 * `kokoro-js` drags in `onnxruntime-node`, whose postinstall downloads a CUDA
 * build and fails when the machine's CUDA is newer than it knows. When that
 * happened, pnpm rolled the whole plugin installation back: a plugin that only
 * needed Edge voices could not be installed at all. These cases pin the fix —
 * the manifest keeps the engine optional, and a worker without it answers
 * `engine-missing` instead of dying or blaming the sentence.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

test('the local engine is optional, so a failed native build cannot roll back the install', () => {
  assert.equal(MANIFEST.dependencies?.['kokoro-js'], undefined,
    'kokoro-js must not be a hard dependency: its onnxruntime-node postinstall is what failed the install')
  assert.match(String(MANIFEST.optionalDependencies?.['kokoro-js'] ?? ''), /^\^?1\./,
    'the optional local engine keeps its 1.x range')
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
  assert.match(local.error, /optional dependency/i, 'the message says why the engine is missing')
  assert.match(local.error, /kokoro-js|onnxruntime/i, 'the message names what is missing')
  assert.equal(replies.get(2).code, undefined, 'an ordinary failure is not mislabelled as a missing engine')
  assert.equal(replies.get(3).ok, true, 'the worker survived the failed engine load')
})