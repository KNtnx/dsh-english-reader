/**
 * Speech worker: one child process that owns both TTS engines.
 *
 * The plugin host cannot load these packages itself — its module loader
 * evaluates a CommonJS package to an empty `exports`, so a constructor read from
 * it is never a function. A plain Node process started in this directory has a
 * normal module system, so the engines live here and the host talks to this
 * worker over newline-delimited JSON on stdin/stdout.
 *
 * Requests (host → worker):
 *   {"id":1,"op":"edge","text":"…","voice":"en-US-AriaNeural"}
 *   {"id":2,"op":"local","text":"…","voice":"af_heart"}
 *   {"id":3,"op":"preload"}
 *   {"id":4,"op":"probe"}
 *
 * Replies (worker → host):
 *   {"id":1,"ok":true,"audio":"<base64>","type":"audio/mpeg"}
 *   {"id":2,"ok":false,"error":"…"}
 *   {"event":"progress","phase":"downloading","loaded":1,"total":2,"file":"…"}
 *   {"event":"phase","phase":"ready"}
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const MODEL_ID = process.env.ER_MODEL_ID ?? 'onnx-community/Kokoro-82M-v1.0-ONNX'
const MODEL_DTYPE = process.env.ER_MODEL_DTYPE ?? 'q8'
const MODEL_DIR = process.env.ER_MODEL_DIR ?? ''

/** @type {{ MsEdgeTTS: any, OUTPUT_FORMAT: any } | null} */
let edge = null
/** @type {any} */
let kokoro = null
/** @type {Promise<any> | null} */
let kokoroPending = null

/** @param {object} payload - one JSON object per line. */
function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

/** Load the Edge client module the ordinary way, in an ordinary process. */
function loadEdge() {
  if (edge !== null) return edge
  const module = require('msedge-tts')
  if (typeof module?.MsEdgeTTS !== 'function') {
    throw new Error(`msedge-tts did not export MsEdgeTTS (keys: ${Object.keys(module ?? {}).join(',') || 'none'})`)
  }
  edge = { MsEdgeTTS: module.MsEdgeTTS, OUTPUT_FORMAT: module.OUTPUT_FORMAT }
  return edge
}

/** Per-file download progress, aggregated into one byte counter. */
const downloads = new Map()

/** @param {{status?: string, file?: string, loaded?: number, total?: number}} info - progress event. */
function onProgress(info) {
  const file = info.file ?? ''
  if (info.status !== 'progress' && info.status !== 'download' && info.status !== 'initiate') return
  const previous = downloads.get(file) ?? { loaded: 0, total: 0 }
  const total = typeof info.total === 'number' && info.total > 0 ? info.total : previous.total
  const loaded = typeof info.loaded === 'number' && info.loaded > 0 ? info.loaded : previous.loaded
  downloads.set(file, { loaded, total })
  let sumLoaded = 0
  let sumTotal = 0
  for (const entry of downloads.values()) {
    sumLoaded += entry.loaded
    sumTotal += entry.total
  }
  emit({ event: 'progress', phase: 'downloading', loaded: sumLoaded, total: sumTotal, file })
}

/** Which model the loaded engine belongs to, so a different directory reloads. */
let kokoroSource = '';

/**
 * Load the local model.
 *
 * Without a directory the bundled model id is fetched into the cache (downloading
 * on first use). With one, the engine is pointed at that directory on disk and
 * remote fetching is disabled, so a model the user already has is used as-is.
 * @param {string} [modelPath] - an absolute model directory, when one was chosen.
 */
function loadKokoro(modelPath = '') {
  const source = modelPath === '' ? MODEL_ID : modelPath;
  if (kokoro !== null && kokoroSource === source) return Promise.resolve(kokoro)
  if (kokoroPending !== null) return kokoroPending;
  kokoro = null
  kokoroPending = (async () => {
    emit({ event: 'phase', phase: 'loading' })
    const module = await import('kokoro-js')
    const KokoroTTS = module?.KokoroTTS ?? module?.default?.KokoroTTS
    if (typeof KokoroTTS !== 'function') {
      throw new Error(`kokoro-js did not export its engine (keys: ${Object.keys(module ?? {}).join(',') || 'none'})`)
    }
    // `kokoro-js` re-exports an `env` that is NOT the one its engine reads, so
    // setting the cache through it silently does nothing. The real object lives
    // in the package the engine delegates to.
    const transformers = await import('@huggingface/transformers')
    const env = transformers?.env ?? transformers?.default?.env ?? module?.env ?? module?.default?.env
    if (env === undefined) throw new Error('the local engine did not expose its environment')
    if (MODEL_DIR !== '') env.cacheDir = MODEL_DIR
    env.allowLocalModels = true
    env.allowRemoteModels = modelPath === ''
    if (modelPath !== '') {
      env.localModelPath = modelPath
      env.cacheDir = MODEL_DIR === '' ? env.cacheDir : MODEL_DIR
    }
    emit({ event: 'cache', dir: String(env.cacheDir ?? '') })
    kokoro = await KokoroTTS.from_pretrained(source, {
      dtype: MODEL_DTYPE,
      device: 'cpu',
      progress_callback: onProgress,
    })
    kokoroSource = source
    downloads.clear()
    emit({ event: 'phase', phase: 'ready' })
    return kokoro
  })().catch((error) => {
    emit({ event: 'phase', phase: 'error', error: error instanceof Error ? error.message : String(error) })
    throw error
  }).finally(() => { kokoroPending = null })
  return kokoroPending
}

/**
 * Pull the word boundaries out of the Edge metadata stream.
 *
 * The payload arrives as concatenated JSON objects that may be split anywhere,
 * so it is buffered and drained with a brace/quote-aware scan instead of one
 * JSON.parse per chunk.
 * @param {import('node:stream').Readable|null} stream - the metadata stream.
 * @returns {Promise<Array<{text: string, at: number, dur: number}>>} marks in milliseconds.
 */
function collectMarks(stream) {
  if (stream === null || stream === undefined) return Promise.resolve([]);
  return new Promise((resolve) => {
    let buffer = '';
    const marks = [];
    const drain = () => {
      let depth = 0;
      let start = -1;
      let inString = false;
      let escaped = false;
      for (let index = 0; index < buffer.length; index += 1) {
        const character = buffer[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') { inString = true; continue; }
        if (character === '{') {
          if (depth === 0) start = index;
          depth += 1;
        } else if (character === '}') {
          if (depth === 0) continue;
          depth -= 1;
          if (depth === 0 && start >= 0) {
            try {
              const payload = JSON.parse(buffer.slice(start, index + 1));
              for (const entry of payload?.Metadata ?? []) {
                if (entry?.Type !== 'WordBoundary') continue;
                const text = entry?.Data?.text?.Text;
                if (typeof text !== 'string') continue;
                marks.push({
                  text,
                  at: Math.round(Number(entry.Data.Offset) / 10000),
                  dur: Math.round(Number(entry.Data.Duration) / 10000),
                });
              }
            } catch { /* an unparseable frame is skipped, not fatal */ }
            buffer = buffer.slice(index + 1);
            index = -1;
            start = -1;
          }
        }
      }
    };
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { buffer += chunk; drain(); });
    const finish = () => { drain(); resolve(marks); };
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', finish);
  });
}

/** @param {import('node:stream').Readable} stream - the Edge audio stream. */
function collect(stream) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    const timer = setTimeout(() => reject(new Error('Edge synthesis timed out')), 30000)
    const finish = () => {
      clearTimeout(timer)
      if (chunks.length === 0) reject(new Error('Edge synthesis returned no audio'))
      else resolve(Buffer.concat(chunks))
    }
    stream.on('data', (chunk) => { chunks.push(Buffer.from(chunk)) })
    stream.on('end', finish)
    stream.on('close', finish)
    stream.on('error', (error) => { clearTimeout(timer); reject(error) })
  })
}

/** @param {Float32Array} samples - mono samples in [-1, 1]. @param {number} sampleRate - Hz. */
function toWav16(samples, sampleRate) {
  const count = samples.length
  const buffer = Buffer.alloc(44 + count * 2)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + count * 2, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(count * 2, 40)
  for (let index = 0; index < count; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    buffer.writeInt16LE(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), 44 + index * 2)
  }
  return buffer
}

/**
 * Run one request.
 * @param {{op: string, text?: string, voice?: string}} request - the request.
 */
async function handle(request) {
  if (request.op === 'edge') {
    const { MsEdgeTTS, OUTPUT_FORMAT } = loadEdge()
    const client = new MsEdgeTTS()
    await client.setMetadata(request.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true })
    const { audioStream, metadataStream } = client.toStream(request.text)
    // Both streams settle independently; the marks are worthless if the audio failed.
    const [audio, marks] = await Promise.all([collect(audioStream), collectMarks(metadataStream)])
    return { ok: true, type: 'audio/mpeg', audio: audio.toString('base64'), marks }
  }
  if (request.op === 'local') {
    const instance = await loadKokoro(typeof request.modelPath === 'string' ? request.modelPath : '')
    const generated = await instance.generate(request.text, { voice: request.voice })
    const wav = toWav16(generated.audio, generated.sampling_rate)
    return { ok: true, type: 'audio/wav', audio: wav.toString('base64') }
  }
  if (request.op === 'preload') {
    await loadKokoro(typeof request.modelPath === 'string' ? request.modelPath : '')
    return { ok: true }
  }
  if (request.op === 'probe') {
    return { ok: true, edge: edge !== null, local: kokoro !== null }
  }
  return { ok: false, error: `unknown op ${String(request.op)}` }
}

/**
 * Local inference runs one sentence at a time (the CPU is the bottleneck), but a
 * long model preload must not block Edge requests, so only the local ops queue.
 */
let localQueue = Promise.resolve()

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line === '') continue
    let request
    try {
      request = JSON.parse(line)
    } catch (error) {
      emit({ id: null, ok: false, error: `bad request line: ${String(error?.message)}` })
      continue
    }
    const run = async () => {
      try {
        const result = await handle(request)
        emit({ id: request.id, ...result })
      } catch (error) {
        emit({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (request.op === 'local' || request.op === 'preload') {
      localQueue = localQueue.then(run, run)
    } else {
      void run()
    }
  }
})

process.stdin.on('end', () => { process.exit(0) })
emit({ event: 'ready' })