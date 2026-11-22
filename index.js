/**
 * Host half of dsh-english-reader.
 *
 * Owns both speech providers and the one route the panel talks to:
 *
 * - **Edge** — Microsoft's read-aloud endpoint. The browser cannot reach it on
 *   its own: the handshake needs an `Origin`, a `Cookie: muid=…` and a
 *   `Sec-MS-GEC` token the page is not allowed to compute or send.
 * - **Local** — Kokoro-82M (82M parameters, ~89 MB quantized ONNX) running on
 *   this machine. Downloaded once into the DSH home, then completely offline;
 *   the text never leaves the machine.
 *
 * Both engines run in a child process (`worker.mjs`). A plugin host evaluates a
 * CommonJS dependency to an empty `exports`, so the packages cannot be loaded
 * in-process; an ordinary Node process started in this directory can.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Longest text one request may synthesize, in characters; the client sends one sentence. */
const MAX_TEXT = 800;
/** Voice ids the Edge provider will proxy. */
const EDGE_VOICE = /^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]{1,40}Neural$/;
/** English Kokoro voices this plugin exposes, best first. */
const LOCAL_VOICES = ['af_heart', 'af_bella', 'af_sky', 'am_michael', 'am_fenrir', 'am_puck', 'bf_emma', 'bm_george'];
/** The local model: Kokoro-82M, Apache-2.0, the smallest voice that still sounds natural. */
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** Quantized weights: ~89 MB instead of ~330 MB, with no audible difference at this size. */
const MODEL_DTYPE = 'q8';
/** What the panel tells the user the download costs. */
const MODEL_BYTES_APPROX = 89 * 1024 * 1024;

/** Route paths, kept in one place. */
const PATHS = {
  tts: '/api-dsh-english-reader/tts',
  status: '/api-dsh-english-reader/local/status',
  install: '/api-dsh-english-reader/local/install',
  ttsSources: '/api-dsh-english-reader/tts/sources',
  validate: '/api-dsh-english-reader/tts/validate',
  models: '/api-dsh-english-reader/tts/models',
  voices: '/api-dsh-english-reader/tts/voices',
  dict: '/api-dsh-english-reader/dict',
  dictAi: '/api-dsh-english-reader/dict/ai',
  translate: '/api-dsh-english-reader/translate',
  translateOptions: '/api-dsh-english-reader/translate/options',
  translateModels: '/api-dsh-english-reader/translate/models',
};

/** Longest batch one translation request may carry. */
const MAX_TRANSLATE_TEXTS = 400;
/** Longest single line the translation providers will accept. */
const MAX_TRANSLATE_CHARS = 2000;

/** Synthesized clips kept in memory, keyed by `<provider>|<voice>|<text>`. */
const CACHE_LIMIT = 64;
/** Longest mark table worth putting in a response header. */
const MAX_HEADER_MARKS = 6000;
/** @type {Map<string, {body: Buffer, type: string, marks: any[]}>} */
const cache = new Map();

/** The DSH home the model lives under. */
function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}

/** Where the model and its download cache live. */
function modelDir() {
  return join(dshHome(), 'dsh-english-reader', 'models');
}

/** Where the panel's speech sources are kept: a small JSON file, readable by its owner only. */
function sourcesFile() {
  return join(dshHome(), 'dsh-english-reader', 'sources.json');
}

/** Protocols a speech source may speak. Each one shapes the request differently. */
const PROTOCOLS = ['auto', 'openai', 'azure', 'dashscope'];

/** @param {any} value - a candidate record. @returns {boolean} whether it is loadable. */
function isSource(value) {
  return value !== null && typeof value === 'object'
    && typeof value.id === 'string' && value.id !== ''
    && PROTOCOLS.includes(value.protocol)
    && typeof value.baseUrl === 'string';
}

/** @param {any} entry - a stored source. @returns {object} the part the browser may see. */
function publicSource(entry) {
  return {
    id: entry.id,
    name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.id,
    protocol: entry.protocol,
    baseUrl: entry.baseUrl,
    model: typeof entry.model === 'string' ? entry.model : '',
    voiceA: typeof entry.voiceA === 'string' ? entry.voiceA : '',
    voiceB: typeof entry.voiceB === 'string' ? entry.voiceB : '',
    customVoices: Array.isArray(entry.customVoices) ? entry.customVoices : [],
    hasKey: typeof entry.key === 'string' && entry.key !== '',
  };
}

/** @returns {Promise<any[]>} every stored speech source. */
async function readSources() {
  try {
    const parsed = JSON.parse(await readFile(sourcesFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(isSource) : [];
  } catch {
    return [];
  }
}

/** @param {any[]} list - sources to persist. */
async function writeSources(list) {
  await mkdir(dirname(sourcesFile()), { recursive: true });
  await writeFile(sourcesFile(), JSON.stringify(list, null, 2), { mode: 0o600 });
}

/**
 * Ask the configured model for a dictionary entry.
 *
 * The prompt is written to produce what a good learner's dictionary prints:
 * a full-sentence English definition rather than a synonym list, a short
 * Chinese gloss, and one natural example. Strict JSON keeps the parsing
 * boring, and the reply is cached per word so switching dictionary kinds
 * never pays for the same word twice.
 */
async function defineWithModel(ctx, word, requested) {
  const cached = modelEntries.get(word);
  if (cached !== undefined) return cached;
  const llm = ctx.get('llm');
  if (llm === undefined) throw new Error('this Harness exposes no model service');
  const route = (typeof requested?.provider === 'string' && typeof requested?.model === 'string' && requested.model !== '')
    ? { provider: requested.provider, model: requested.model }
    : defaultModelRoute(ctx);
  if (route === undefined || route.model === '') throw new Error('no model is configured');
  const system = [
    'You are the editor of a learner\'s dictionary in the style of Collins COBUILD and the',
    'Concise Oxford: full sentences that explain a word through its use, never bare synonym',
    'lists, no encyclopaedic padding, no etymology unless it changes the meaning.',
    'For the given English word or phrase, reply with JSON only, no prose and no code fences:',
    '{"word":"as asked","phonetic":"IPA without slashes, or empty","senses":[{"pos":"v.","en":"one complete English sentence defining this sense in context, 12-22 words","zh":"简体中文释义，一个短语，不加句号","example":"a short natural sentence using the word"}]}',
    'Rules: 1-4 senses, most common first; pos uses the short form (v., n., adj., adv., phr.);',
    'the English definition must be a sentence a learner can read aloud; the example must not',
    'repeat the definition; if the word has a common figurative sense, include it after the literal one.',
  ].join(' ');
  let output = '';
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: word }] }],
    temperature: 0.3,
  })) {
    if (chunk.type === 'text-delta') output += chunk.text;
    else if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'the model refused to define the word');
    }
  }
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('the model did not answer with JSON');
  let parsed;
  try {
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch {
    throw new Error('the model answered with JSON that does not parse');
  }
  const senses = (Array.isArray(parsed.senses) ? parsed.senses : [])
    .filter((sense) => sense !== null && typeof sense === 'object')
    .map((sense) => ({
      pos: String(sense.pos ?? '').trim(),
      def: String(sense.en ?? '').trim(),
      zh: String(sense.zh ?? '').trim(),
      example: String(sense.example ?? '').trim(),
    }))
    .filter((sense) => sense.def !== '');
  if (senses.length === 0) throw new Error('the model returned no usable sense');
  const entry = {
    word: String(parsed.word ?? word),
    phonetic: String(parsed.phonetic ?? '').replace(/^\/+|\/+$/g, ''),
    senses,
    source: 'model',
  };
  modelEntries.set(word, entry);
  if (modelEntries.size > DICTIONARY_LIMIT) {
    const oldest = modelEntries.keys().next();
    if (!oldest.done) modelEntries.delete(oldest.value);
  }
  return entry;
}

/** Entries the model produced, kept so a word is only paid for once. */
const modelEntries = new Map();

/** Definitions already fetched, so a second look at a word is free. */
const dictionaryCache = new Map();
const DICTIONARY_LIMIT = 200;

/** Trim a word down to what a dictionary accepts: no quotes, punctuation or possessive. */
function dictKey(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[’']s$/, '')
    .replace(/^[^a-z]+|[^a-z]+$/g, '')
    .trim();
}

/**
 * Fetch one word from Wiktionary.
 *
 * A miss is normal: this endpoint only knows single English words, so phrases
 * fall through to the translation source on the panel side.
 * @param {string} word - the normalized word.
 * @returns {Promise<object|null>} the entry, or null when it is unknown.
 */
/** WordNet definitions through Datamuse; free, keyless, and already tagged by part of speech. */
async function lookUpWordNet(word) {
  try {
    const response = await fetch(
      `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=dp&max=1`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const first = Array.isArray(payload) ? payload[0] : null;
    if (first === null || String(first.word ?? '').toLowerCase() !== word) return null;
    const senses = [];
    for (const line of first.defs ?? []) {
      const [pos, ...rest] = String(line).split('\t');
      const meaning = rest.join(' ').trim();
      if (meaning === '') continue;
      senses.push({ pos: String(pos).trim(), def: meaning, example: '' });
      if (senses.length >= 6) break;
    }
    if (senses.length === 0) return null;
    return { word, phonetic: '', senses, source: 'wordnet' };
  } catch {
    return null;
  }
}

async function lookUpWord(word) {
  if (dictionaryCache.has(word)) return dictionaryCache.get(word);
  let payload;
  try {
    const response = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }
  const groups = Array.isArray(payload?.en) ? payload.en : [];
  const senses = [];
  for (const group of groups) {
    for (const definition of group.definitions ?? []) {
      if (senses.length >= 6) break;
      const text = plainText(definition.definition);
      if (text === '') continue;
      senses.push({
        pos: plainText(group.partOfSpeech ?? ''),
        def: text.length > 260 ? `${text.slice(0, 257)}…` : text,
        example: plainText(Array.isArray(definition.examples) ? definition.examples[0] : ''),
      });
    }
    if (senses.length >= 6) break;
  }
  if (senses.length === 0) return null;
  const entry = { word, phonetic: '', senses, source: 'wiktionary' };
  dictionaryCache.set(word, entry);
  if (dictionaryCache.size > DICTIONARY_LIMIT) {
    const oldest = dictionaryCache.keys().next();
    if (!oldest.done) dictionaryCache.delete(oldest.value);
  }
  return entry;
}

/** Chinese meanings, grouped by part of speech, the way a 简明 dictionary lists them. */
const chineseCache = new Map();

async function lookUpChinese(word) {
  if (chineseCache.has(word)) return chineseCache.get(word);
  let payload;
  try {
    const response = await fetch(
      `https://dict-mobile.iciba.com/interface/index.php?c=word&m=getsuggest&nums=1&is_need_mean=1&word=${encodeURIComponent(word)}`,
      { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(9000) },
    );
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }
  const first = Array.isArray(payload?.message) ? payload.message[0] : null;
  if (first === null) return null;
  const senses = [];
  for (const group of first.means ?? []) {
    const meanings = (group.means ?? []).filter((text) => typeof text === 'string' && text !== '');
    if (meanings.length === 0) continue;
    senses.push({ pos: String(group.part ?? ''), def: meanings.join('；') });
    if (senses.length >= 6) break;
  }
  if (senses.length === 0) return null;
  const entry = { word: String(first.key ?? word), phonetic: '', senses, source: 'iciba' };
  chineseCache.set(word, entry);
  if (chineseCache.size > DICTIONARY_LIMIT) {
    const oldest = chineseCache.keys().next();
    if (!oldest.done) chineseCache.delete(oldest.value);
  }
  return entry;
}

/** Wiktionary definitions arrive as HTML; the card wants plain sentences. */
function plainText(html) {
  return String(html ?? '')
    // Drop style and reference blocks with their contents, not just their tags.
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s*\.[a-z-]+\{[^}]*\}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Endpoints that answered, keyed by the address the user typed. */
const resolvedUrls = new Map();
/** The protocol that answered for an address, learned by probing. */
const resolvedProtocols = new Map();

/**
 * Every URL shape a speech endpoint plausibly lives at, most specific last.
 *
 * Vendors disagree about the prefix: OpenAI serves `/v1/audio/speech`, Alibaba's
 * compatible mode serves `/compatible-mode/v1/audio/speech`, and some gateways
 * put the endpoint at the root. Rather than make the user know, try each.
 * @param {string} raw - the address the user typed.
 * @param {'speech'|'models'} kind - which resource is wanted.
 * @returns {string[]} candidate URLs, in the order worth trying.
 */
function endpointCandidates(raw, kind) {
  const base = String(raw).trim().replace(/\/+$/, '');
  const leaf = kind === 'speech' ? 'audio/speech' : 'models';
  if (new RegExp(`/${leaf}$`, 'i').test(base)) return [base];
  const out = [];
  // An address that already names a version only needs the resource appended.
  if (/\/v\d+$/i.test(base)) out.push(`${base}/${leaf}`);
  else out.push(`${base}/${leaf}`);
  if (!/\/v\d+$/i.test(base)) out.push(`${base}/v1/${leaf}`);
  // Only a bare host needs the vendor's compatible prefix spelled out.
  if (!/compatible-mode/.test(base)) out.push(`${base}/compatible-mode/v1/${leaf}`);
  return [...new Set(out)];
}

/**
 * The URL that worked last time for this address, tried first next time.
 * @param {string} raw - the address the user typed.
 * @param {'speech'|'models'} kind - which resource is wanted.
 * @returns {string[]} candidates with the known-good one in front.
 */
function orderedCandidates(raw, kind) {
  const known = resolvedUrls.get(`${kind}|${raw}`);
  const list = endpointCandidates(raw, kind);
  return known === undefined ? list : [known, ...list.filter((url) => url !== known)];
}

/**
 * Run the same request against each candidate until one answers.
 * @param {string[]} candidates - URLs to try.
 * @param {(url: string) => Promise<any>} run - the request.
 * @returns {Promise<{ok: boolean, value?: any, error?: any, url?: string}>} the outcome.
 */
async function firstThatAnswers(candidates, run) {
  let last = null;
  for (const url of candidates) {
    try {
      return { ok: true, value: await run(url), url };
    } catch (failure) {
      last = failure;
      // A 401 or 403 will not improve on another path: the credentials are wrong.
      if (failure instanceof Error && /answered 40[13]/.test(failure.message)) break;
    }
  }
  return { ok: false, error: last };
}

/** @param {string} id - a model id. @returns {boolean} whether it can synthesize speech. */
function isSpeechModel(id) {
  const name = String(id).toLowerCase();
  if (/asr|recognition|transcri|realtime|realtime-plus/.test(name)) return false;
  return /(^|[-_/])(tts|speech|voice)([-_/]|$)|text-to-speech|speech-synthesis/.test(name);
}

/**
 * Where DashScope's native generation endpoint lives.
 *
 * Alibaba's OpenAI-compatible prefix serves chat and embeddings only; speech is
 * reached through this native path, whose reply carries a URL to download.
 * @param {string} raw - the address the user typed.
 * @returns {string[]} candidate URLs.
 */
function dashscopeCandidates(raw) {
  const base = String(raw).trim().replace(/\/+$/, '');
  if (/\/api\/v1\/services\//.test(base)) return [base];
  // The native API hangs off the same host as the compatible prefix, so a
  // compatible-mode address still reaches it one level up.
  const host = base.replace(/\/compatible-mode\/v1$/, '').replace(/\/compatible-mode$/, '');
  return [
    // Token Plan publishes speech synthesis here (Alibaba's own Token Plan overview).
    `${host}/api/v1/services/audio/tts/SpeechSynthesizer`,
    // The pay-as-you-go qwen-tts entry point.
    `${host}/api/v1/services/aigc/multimodal-generation/generation`,
  ];
}

/** Escape the five characters SSML cannot carry raw. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Local provider state, fed by the worker's events and read by the panel. */
const local = {
  /** @type {'absent'|'downloading'|'loading'|'cached'|'ready'|'error'} */
  phase: 'absent',
  loaded: 0,
  total: 0,
  file: '',
  error: '',
  /** @type {boolean|null} */
  onDisk: null,
};

/**
 * Whether the model weights are already on disk.
 * @returns {Promise<boolean>} true when a weight file exists.
 */
async function hasModel() {
  if (local.onDisk !== null) return local.onDisk;
  try {
    const entries = await readdir(join(modelDir(), MODEL_ID, 'onnx'));
    local.onDisk = entries.some((name) => name.endsWith('.onnx'));
  } catch {
    local.onDisk = false;
  }
  if (local.onDisk && local.phase === 'absent') local.phase = 'cached';
  return local.onDisk;
}

/** One speech worker, started on first use. */
let worker = null;
/** Diagnostics from the worker's stderr, kept for failure messages. */
let workerStderr = '';
/** Request id counter. */
let nextId = 1;
/** @type {Map<number, {resolve: (value: any) => void, reject: (error: Error) => void, timer: any}>} */
const pending = new Map();
let stdoutBuffer = '';

/** Start the worker process. */
function startWorker() {
  if (worker !== null) return worker;
  workerStderr = '';
  const script = fileURLToPath(new URL('./worker.mjs', import.meta.url));
  const child = spawn(process.execPath, [script], {
    cwd: dirname(script),
    env: {
      ...process.env,
      ER_MODEL_DIR: modelDir(),
      ER_MODEL_ID: MODEL_ID,
      ER_MODEL_DTYPE: MODEL_DTYPE,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let index;
    while ((index = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, index).trim();
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      if (line === '') continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.event !== undefined) {
        applyEvent(message);
        continue;
      }
      const entry = pending.get(message.id);
      if (entry === undefined) continue;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok === true) entry.resolve(message);
      else entry.reject(new Error(String(message.error ?? 'speech worker failed')));
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    workerStderr = (workerStderr + chunk).slice(-4000);
  });
  child.on('exit', (code) => {
    worker = null;
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`speech worker stopped (code ${String(code)})${workerStderr === '' ? '' : `: ${workerStderr.slice(-300)}`}`));
      pending.delete(id);
    }
  });
  child.on('error', (error) => {
    worker = null;
    workerStderr = error instanceof Error ? error.message : String(error);
  });
  worker = child;
  return child;
}

/**
 * Fold one event from the worker into the local provider state.
 * @param {{event: string, phase?: string, loaded?: number, total?: number, file?: string, error?: string}} event - the event.
 */
function applyEvent(event) {
  if (event.event === 'progress') {
    local.phase = 'downloading';
    local.loaded = Number(event.loaded ?? 0);
    local.total = Number(event.total ?? 0);
    local.file = String(event.file ?? '');
    return;
  }
  if (event.event === 'phase') {
    if (event.phase === 'loading') local.phase = local.onDisk === true ? 'loading' : 'downloading';
    if (event.phase === 'ready') {
      local.phase = 'ready';
      local.onDisk = true;
      local.loaded = 0;
      local.total = 0;
      local.error = '';
    }
    if (event.phase === 'error') {
      local.phase = 'error';
      local.error = String(event.error ?? '');
    }
  }
  if (event.event === 'ready') {
    if (local.phase === 'absent' && local.onDisk === true) local.phase = 'cached';
  }
}

/**
 * Send one request to the worker and wait for its reply.
 * @param {object} payload - request body.
 * @param {number} timeoutMs - how long to wait.
 * @returns {Promise<any>} the worker's reply.
 */
function ask(payload, timeoutMs) {
  const child = startWorker();
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('the speech worker did not answer in time'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    const line = `${JSON.stringify({ id, ...payload })}\n`;
    child.stdin.write(line, (error) => {
      if (error === null || error === undefined) return;
      pending.delete(id);
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Local provider state as the panel reads it. */
function localStatus() {
  const progress = local.total > 0 ? Math.min(1, local.loaded / local.total) : 0;
  return {
    phase: local.phase,
    progress: Math.round(progress * 1000) / 1000,
    loadedBytes: local.loaded,
    totalBytes: local.total,
    approximateBytes: MODEL_BYTES_APPROX,
    file: local.file,
    error: local.error,
    model: MODEL_ID,
    dtype: MODEL_DTYPE,
    /** Where the bundled model lives on disk, so the panel can show it. */
    dir: modelDir(),
    voices: LOCAL_VOICES,
    installed: local.phase === 'ready' || local.phase === 'cached' || local.phase === 'loading' || local.phase === 'downloading',
  };
}

/** Start the download in the background; the panel polls the status route. */
function startInstall() {
  if (local.phase === 'downloading' || local.phase === 'loading' || local.phase === 'ready') return;
  local.phase = 'downloading';
  local.error = '';
  local.loaded = 0;
  local.total = 0;
  void ask({ op: 'preload' }, 30 * 60 * 1000).catch((error) => {
    local.phase = 'error';
    local.error = error instanceof Error ? error.message : String(error);
  });
}

/**
 * Accept a model directory only when it really holds a model this engine can read.
 * @param {string} candidate - an absolute directory path from the panel.
 * @returns {Promise<string|null>} the path, or null when it is not usable.
 */
async function checkModelPath(candidate) {
  if (!isAbsolute(candidate)) return { ok: false, code: 'pathNotAbsolute' };
  let info;
  try {
    info = await stat(candidate);
  } catch {
    return { ok: false, code: 'pathMissing' };
  }
  if (!info.isDirectory()) return { ok: false, code: 'pathNotFolder' };
  const entries = await readdir(candidate);
  // A transformers-style folder always carries the config; the weights live either
  // beside it or in an `onnx/` subdirectory.
  if (!entries.includes('config.json')) return { ok: false, code: 'configMissing' };
  if (!entries.includes('onnx') && !entries.some((name) => name.endsWith('.onnx'))) {
    return { ok: false, code: 'onnxMissing' };
  }
  return { ok: true };
}

/** @param {string} candidate - an absolute directory path. @returns {Promise<string|null>} */
async function resolveModelPath(candidate) {
  return (await checkModelPath(candidate)).ok ? candidate : null;
}

/**
 * Load a stored speech source by id.
 * @param {string} id - the source's id.
 * @returns {Promise<any|null>} the record, secret included, or null.
 */
async function findSource(id) {
  if (typeof id !== 'string' || id === '') return null;
  const list = await readSources();
  return list.find((entry) => entry.id === id) ?? null;
}

/**
 * The key to use for a probe: an explicit one, else whatever the host stored.
 *
 * The panel never holds the secret, so an edit dialog can only name the source it
 * is editing and let the host borrow that source's key.
 * @param {string} explicitKey - a key typed in the panel.
 * @param {string} sourceId - the stored source to borrow a key from.
 * @returns {Promise<string>} the key, possibly empty.
 */
async function resolveKey(explicitKey, sourceId) {
  if (typeof explicitKey === 'string' && explicitKey !== '') return explicitKey;
  if (typeof sourceId !== 'string' || sourceId === '') return '';
  const record = await findSource(sourceId);
  return typeof record?.key === 'string' ? record.key : '';
}

/**
 * Synthesize through Alibaba DashScope's native speech endpoint.
 *
 * The reply does not contain audio: it carries a short-lived URL that has to be
 * fetched next, which is why this cannot share the OpenAI-shaped code path.
 * @param {string} text - sentence to speak.
 * @param {object} settings - endpoint settings.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<{body: Buffer, type: string}>} the clip.
 */
async function requestDashscope(url, body, headers, signal) {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  const type = (response.headers.get('content-type') ?? '').split(';')[0];
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`DashScope answered ${response.status}${detail === '' ? '' : `: ${detail.slice(0, 160)}`}`);
  }
  // Some deployments stream audio straight back.
  if (type.startsWith('audio/')) {
    return { body: Buffer.from(await response.arrayBuffer()), type };
  }
  const payload = await response.json();
  const inline = payload?.output?.audio?.data;
  if (typeof inline === 'string' && inline !== '') {
    return { body: Buffer.from(inline, 'base64'), type: 'audio/wav' };
  }
  const audioUrl = payload?.output?.audio?.url;
  if (typeof audioUrl !== 'string' || audioUrl === '') {
    throw new Error(`DashScope returned no audio (${JSON.stringify(payload).slice(0, 120)})`);
  }
  const download = await fetch(audioUrl, { signal });
  if (!download.ok) throw new Error(`the audio download answered ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.length === 0) throw new Error('the audio download was empty');
  return { body: bytes, type: (download.headers.get('content-type') ?? 'audio/wav').split(';')[0] };
}

async function synthesizeDashscope(text, settings, signal) {
  const model = settings.model === '' ? 'qwen-audio-3.0-tts-plus' : settings.model;
  // `voice` is required and must belong to the model; this is the documented one.
  const voice = settings.voice === '' ? 'longanhuan_v3.6' : settings.voice;
  const bodies = [
    { model, input: { text, voice, format: 'mp3' } },
    { model, input: { text }, parameters: { voice } },
  ];
  const headers = { 'content-type': 'application/json' };
  if (settings.key !== '') headers.authorization = `Bearer ${settings.key}`;
  const failures = [];
  for (const url of dashscopeCandidates(settings.baseUrl)) {
    for (const body of bodies) {
      try {
        const clip = await requestDashscope(url, body, headers, signal);
        resolvedUrls.set(`speech|${settings.baseUrl}`, url);
        return clip;
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : String(failure);
        // Keep the URL in the record: several shapes are tried, and only the first
        // failure explains what the service actually objected to.
        failures.push(`${url.replace(/^https?:\/\/[^/]+/, '')} → ${message.slice(0, 120)}`);
        if (failure instanceof Error && /answered 40[13]/.test(failure.message)) break;
      }
    }
  }
  if (failures.length === 0) throw new Error('DashScope did not answer');
  throw new Error(failures.length === 1 ? failures[0] : `${failures[0]} (+${failures.length - 1} more shapes)`);
}

/**
 * Use whichever protocol answers.
 *
 * Addresses are the one thing users cannot guess; probing lets one address work
 * regardless of which interface family the vendor put behind it.
 */
async function synthesizeAuto(text, settings, signal) {
  const known = resolvedProtocols.get(settings.baseUrl);
  const aliyun = /aliyuncs\.com|dashscope/i.test(settings.baseUrl);
  const order = known !== undefined
    ? [known]
    : aliyun ? ['dashscope', 'openai'] : ['openai', 'dashscope'];
  const failures = [];
  for (const protocol of order) {
    try {
      const clip = protocol === 'dashscope'
        ? await synthesizeDashscope(text, settings, signal)
        : await synthesizeCustom(text, settings, signal);
      resolvedProtocols.set(settings.baseUrl, protocol);
      return clip;
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      failures.push(`${protocol}: ${message}`);
    }
  }
  throw new Error(failures.join('  //  ') || 'no protocol answered');
}

/**
 * Synthesize through Azure's speech endpoint.
 *
 * Azure takes SSML rather than plain text and authenticates with its own header,
 * which is exactly why the protocol is a choice and not an assumption.
 * @param {string} text - sentence to speak.
 * @param {object} settings - endpoint settings, `baseUrl` being the full endpoint.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<{body: Buffer, type: string}>} the clip.
 */
async function synthesizeAzure(text, settings, signal) {
  const voice = settings.voice === '' ? 'en-US-AriaNeural' : settings.voice;
  const ssml = `<speak version='1.0' xml:lang='en-US'><voice name='${escapeXml(voice)}'>${escapeXml(text)}</voice></speak>`;
  const headers = {
    'content-type': 'application/ssml+xml',
    'x-microsoft-outputformat': settings.format === undefined || settings.format === ''
      ? 'audio-24khz-48kbitrate-mono-mp3'
      : settings.format,
  };
  if (settings.key !== '') headers['ocp-apim-subscription-key'] = settings.key;
  const response = await fetch(settings.baseUrl, { method: 'POST', headers, body: ssml, signal });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`the Azure endpoint answered ${response.status}${detail === '' ? '' : `: ${detail.slice(0, 160)}`}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0) throw new Error('the Azure endpoint returned no audio');
  return { body, type: (response.headers.get('content-type') ?? 'audio/mpeg').split(';')[0] };
}

/** @param {object} settings - a stored source with its secret folded in. */
function synthesizeApi(text, settings, signal) {
  if (settings.protocol === 'azure') return synthesizeAzure(text, settings, signal);
  if (settings.protocol === 'dashscope') return synthesizeDashscope(text, settings, signal);
  if (settings.protocol === 'auto') return synthesizeAuto(text, settings, signal);
  return synthesizeCustom(text, settings, signal);
}

/**
 * Synthesize through a user-supplied, OpenAI-compatible `/audio/speech` endpoint.
 * @param {string} text - sentence to speak.
 * @param {{baseUrl: string, model: string, voice: string, format: string, key: string}} settings - endpoint settings.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<{body: Buffer, type: string}>} the clip.
 */
async function synthesizeCustom(text, settings, signal) {
  const headers = { 'content-type': 'application/json' };
  if (settings.key !== '') headers.authorization = `Bearer ${settings.key}`;
  const payload = { input: text, response_format: settings.format };
  if (settings.model !== '') payload.model = settings.model;
  if (settings.voice !== '') payload.voice = settings.voice;
  const attempt = await firstThatAnswers(orderedCandidates(settings.baseUrl, 'speech'), async (url) => {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`the TTS API answered ${response.status}${detail === '' ? '' : `: ${detail.slice(0, 160)}`}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) throw new Error('the TTS API returned no audio');
    return { body, type: (response.headers.get('content-type') ?? 'audio/mpeg').split(';')[0] };
  });
  if (!attempt.ok) throw attempt.error ?? new Error('the TTS API did not answer');
  resolvedUrls.set(`speech|${settings.baseUrl}`, attempt.url);
  return attempt.value;
}

/**
 * Answer one sentence through the chosen provider, reusing the clip cache.
 * @param {string} provider - `edge` or `local`.
 * @param {string} text - sentence to speak.
 * @param {string} voice - provider voice id.
 * @returns {Promise<{body: Buffer, type: string}>} the clip.
 */
async function synthesize(provider, text, voice, custom, modelPath) {
  const key = `${provider}|${custom === undefined || custom === null ? '' : custom.id ?? custom.baseUrl}|${modelPath ?? ''}|${voice}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  if (provider === 'custom') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const clip = await synthesizeApi(text, {
        protocol: custom.protocol,
        baseUrl: custom.baseUrl,
        model: custom.model ?? '',
        key: custom.key ?? '',
        // The panel names the voice per sentence (角色 A or B); the stored record
        // only holds the endpoint. Reading it from the record spoke one voice
        // forever, whatever the panel asked for.
        voice: typeof voice === 'string' ? voice : '',
        format: 'mp3',
      }, controller.signal);
      const entry = { body: clip.body, type: clip.type, marks: [] };
      cache.set(key, entry);
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      return entry;
    } finally {
      clearTimeout(timer);
    }
  }
  const reply = await ask({ op: provider, text, voice, modelPath }, provider === 'local' ? 180000 : 45000);
  const clip = {
    body: Buffer.from(reply.audio, 'base64'),
    type: reply.type ?? 'audio/mpeg',
    // The local model reports no boundaries; the panel estimates those itself.
    marks: Array.isArray(reply.marks) ? reply.marks : [],
  };
  cache.set(key, clip);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return clip;
}

/* ------------------------------------------------------------------ *
 * Translation
 *
 * Four sources, in the order the panel lists them:
 *   dsh       this Harness's own model route (no key, best quality)
 *   google    the keyless endpoint a browser uses (no account, unofficial)
 *   microsoft Azure AI Translator (free F0 tier needs a key and region)
 *   tencent   Tencent Cloud TMT (free tier needs a SecretId/SecretKey)
 *
 * Keys are read from the plugin's row config first and from the environment
 * second, so they never reach the browser and need no settings UI.
 * ------------------------------------------------------------------ */

/** Credential for one source, config field first, environment second. */
function secret(config, field, envName) {
  const fromConfig = config?.[field];
  if (typeof fromConfig === 'string' && fromConfig.trim() !== '') return fromConfig.trim();
  const fromEnv = process.env[envName];
  return typeof fromEnv === 'string' ? fromEnv.trim() : '';
}

/** Target language, overridable per request. */
function targetLanguage(config, requested) {
  if (typeof requested === 'string' && /^[A-Za-z-]{2,12}$/.test(requested)) return requested;
  const configured = config?.target ?? process.env.DSH_ENGLISH_READER_TARGET;
  return typeof configured === 'string' && /^[A-Za-z-]{2,12}$/.test(configured) ? configured : 'zh-CN';
}

/** The route this Harness is already configured to talk to. */
function defaultModelRoute(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
    if (selection !== undefined && selection !== null && typeof selection.provider === 'string' && typeof selection.model === 'string') {
      return { provider: selection.provider, model: selection.model };
    }
  } catch { /* no default configured */ }
  try {
    const [first] = ctx.get('llm')?.listProviders?.() ?? [];
    if (first !== undefined) return { provider: first.id, model: '' };
  } catch { /* no providers */ }
  return undefined;
}

/**
 * Ask the Harness model to translate numbered lines, in one request.
 * @param {object} ctx - host context.
 * @param {string[]} texts - the lines.
 * @param {string} target - target language tag.
 * @param {{provider?: string, model?: string}} requested - the panel's choice.
 * @returns {Promise<string[]>} one translation per line.
 */
async function translateWithModel(ctx, texts, target, requested) {
  const llm = ctx.get('llm');
  if (llm === undefined) throw new Error('this Harness exposes no model service');
  const route = (typeof requested?.provider === 'string' && typeof requested?.model === 'string' && requested.model !== '')
    ? { provider: requested.provider, model: requested.model }
    : defaultModelRoute(ctx);
  if (route === undefined || route.model === '') throw new Error('no model is configured to translate with');
  const system = [
    'You are a translation engine for a language learner.',
    `Translate every numbered line into ${target}.`,
    'Reply with exactly one line per input line, each starting with the same number and a tab character.',
    'Never merge, split, reorder, skip or explain lines. Keep punctuation natural for the target language.',
  ].join(' ');
  const body = texts.map((text, index) => `${index + 1}\t${text}`).join('\n');
  let output = '';
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: body }] }],
    temperature: 0,
  })) {
    if (chunk.type === 'text-delta') output += chunk.text;
    else if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'the model refused the translation');
    }
  }
  const byNumber = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s*[\t.:、)]\s*(.+)$/);
    if (match !== null) byNumber.set(Number(match[1]), match[2].trim());
  }
  const result = texts.map((_, index) => byNumber.get(index + 1) ?? '');
  if (result.some((line) => line === '')) throw new Error('the model did not return a line for every sentence');
  return result;
}

/**
 * Translate through the keyless Google endpoint, one request per line.
 * @param {string[]} texts - the lines.
 * @param {string} target - target language tag.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<string[]>} one translation per line.
 */
async function translateWithGoogle(texts, target, signal) {
  const result = new Array(texts.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < texts.length) {
      const index = cursor;
      cursor += 1;
      const url = 'https://translate.googleapis.com/translate_a/single'
        + `?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(texts[index])}`;
      const response = await fetch(url, { signal, headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`Google Translate answered ${response.status}`);
      const data = await response.json();
      result[index] = (data?.[0] ?? []).map((segment) => segment?.[0] ?? '').join('');
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
  return result;
}

/**
 * Translate through the Volcengine web translator.
 *
 * Its public page uses this endpoint with no account and no key. It takes one
 * string per request, so a batch becomes a few concurrent calls.
 * @param {string[]} texts - sentences to translate.
 * @param {string} target - target language code.
 * @param {AbortSignal} signal - aborts the whole batch.
 * @returns {Promise<string[]>} one translation per sentence.
 */
async function translateWithVolcengine(texts, target, signal) {
  const result = new Array(texts.length);
  const language = target.toLowerCase().startsWith('zh') ? 'zh' : target.split('-')[0];
  let cursor = 0;
  const worker = async () => {
    while (cursor < texts.length) {
      const index = cursor;
      cursor += 1;
      const response = await fetch('https://translate.volcengine.com/crx/translate/v1/', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          origin: 'https://translate.volcengine.com',
          referer: 'https://translate.volcengine.com/',
          'user-agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({ source_language: 'auto', target_language: language, text: texts[index] }),
      });
      if (!response.ok) throw new Error(`Volcengine answered ${response.status}`);
      const payload = await response.json();
      const line = payload?.translation;
      if (typeof line !== 'string' || line === '') throw new Error('Volcengine returned no translation');
      result[index] = line;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
  return result;
}

/**
 * Translate through Azure AI Translator.
 * @param {string[]} texts - the lines.
 * @param {string} target - target language tag.
 * @param {string} key - subscription key.
 * @param {string} region - subscription region, when the resource is regional.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<string[]>} one translation per line.
 */
async function translateWithAzure(texts, target, key, region, signal) {
  const headers = { 'content-type': 'application/json', 'Ocp-Apim-Subscription-Key': key };
  if (region !== '') headers['Ocp-Apim-Subscription-Region'] = region;
  const response = await fetch(
    `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(target)}`,
    { method: 'POST', headers, body: JSON.stringify(texts.map((text) => ({ Text: text }))), signal },
  );
  if (!response.ok) throw new Error(`Microsoft Translator answered ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Microsoft Translator returned an unexpected body');
  return data.map((entry) => entry?.translations?.[0]?.text ?? '');
}

/** HMAC-SHA256 as a Buffer. */
function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value, encoding ?? 'utf8').digest();
}

/**
 * Translate through Tencent Cloud TMT with a TC3-HMAC-SHA256 signature.
 * @param {string[]} texts - the lines.
 * @param {string} target - target language tag.
 * @param {string} secretId - SecretId.
 * @param {string} secretKey - SecretKey.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<string[]>} one translation per line.
 */
async function translateWithTencent(texts, target, secretId, secretKey, signal) {
  const host = 'tmt.tencentcloudapi.com';
  const service = 'tmt';
  const payload = JSON.stringify({
    SourceTextList: texts,
    Source: 'en',
    Target: target.toLowerCase().startsWith('zh') ? 'zh' : target,
    ProjectId: 0,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + host + '\n';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, payloadHash(payload)].join('\n');
  const scope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), scope, payloadHash(canonicalRequest)].join('\n');
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      host,
      authorization,
      'x-tc-action': 'TextTranslateBatch',
      'x-tc-version': '2018-03-21',
      'x-tc-timestamp': String(timestamp),
    },
    body: payload,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.Response?.Error !== undefined) {
    const message = data?.Response?.Error?.Message ?? `Tencent TMT answered ${response.status}`;
    throw new Error(message);
  }
  return (data.Response.TargetTextList ?? []).map((text) => text ?? '');
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
function payloadHash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Required host services: the HTTP route registry. */
export const inject = ['webServer'];

/**
 * Host plugin body: answer speech, local status, the local install request, and
 * translation.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 * @param {{microsoftKey?: string, microsoftRegion?: string, tencentSecretId?: string, tencentSecretKey?: string, target?: string}} config - the plugin row's config.
 */
export function apply(ctx, config) {
  ctx.effect(() => {
    void mkdir(modelDir(), { recursive: true }).catch(() => {});
    void hasModel();
    return () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('plugin unloaded'));
      }
      pending.clear();
      if (worker !== null) {
        worker.kill();
        worker = null;
      }
    };
  }, 'english-reader: speech worker');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.tts,
    /**
     * Answer one GET with audio bytes.
     * @param {Request} request - the incoming request.
     * @returns {Promise<Response>} audio, or a short error the panel can show.
     */
    resource: async (request) => {
      const url = new URL(request.url);
      const text = (url.searchParams.get('text') ?? '').trim();
      const requested = url.searchParams.get('provider');
      const provider = requested === 'local' ? 'local' : requested === 'custom' ? 'custom' : 'edge';
      const stored = provider === 'custom' ? await findSource(url.searchParams.get('sourceId') ?? '') : null;
      if (provider === 'custom' && stored === null) {
        return Response.json({ code: 'not-configured' }, { status: 503 });
      }
      const custom = provider === 'custom' ? stored : null;
      const requestedPath = (url.searchParams.get('modelPath') ?? '').trim();
      const modelPath = requestedPath === '' ? '' : (await resolveModelPath(requestedPath));
      const voice = url.searchParams.get('voice')
        ?? (provider === 'local' ? LOCAL_VOICES[0] : provider === 'custom' ? (custom?.model ?? '') : 'en-US-AriaNeural');
      if (text.length === 0) return new Response('missing text', { status: 400 });
      if (text.length > MAX_TEXT) return new Response('text too long', { status: 413 });
      if (provider === 'local') {
        if (!LOCAL_VOICES.includes(voice)) return new Response('unsupported voice', { status: 400 });
        // A download in progress would otherwise queue this request behind the
        // whole model, so ask the panel to wait instead of hanging.
        if (local.phase === 'downloading') return Response.json({ code: 'preparing' }, { status: 503 });
        if (modelPath === null) return Response.json({ code: 'bad-model-path' }, { status: 400 });
        if (modelPath === '' && !(await hasModel())) return Response.json({ code: 'not-installed' }, { status: 503 });
      } else if (provider !== 'custom' && !EDGE_VOICE.test(voice)) {
        return new Response('unsupported voice', { status: 400 });
      }
      try {
        const clip = await synthesize(provider, text, voice, custom, modelPath);
        const headers = {
          'content-type': clip.type,
          'content-length': String(clip.body.length),
          'cache-control': 'no-store',
        };
        if (clip.marks !== undefined && clip.marks.length > 0) {
          const encoded = Buffer.from(JSON.stringify(clip.marks), 'utf8').toString('base64');
          // A sentence long enough to overflow the header simply loses playback
          // word marks; the panel falls back to an even estimate.
          if (encoded.length <= MAX_HEADER_MARKS) headers['x-er-marks'] = encoded;
        }
        return new Response(clip.body, { headers });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (provider === 'local' && local.phase !== 'ready') local.error = message;
        return new Response(`speech synthesis failed: ${message}`, { status: 502 });
      }
    },
  }), 'english-reader: speech route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.ttsSources,
    /**
     * The speech sources live on the host: the panel reads them, and only ever
     * receives `hasKey`, never the key itself.
     */
    handler: async (request, response) => {
      const send = (body, status = 200) => {
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify(body));
      };
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET') {
        const list = await readSources();
        send({ sources: list.map(publicSource) });
        return;
      }
      if (request.method === 'DELETE') {
        const id = url.searchParams.get('id') ?? '';
        const list = await readSources();
        await writeSources(list.filter((entry) => entry.id !== id));
        send({ ok: true });
        return;
      }
      if (request.method !== 'POST') {
        send({ ok: false, code: 'methodNotAllowed' }, 405);
        return;
      }
      /** @type {Buffer[]} */
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 64 * 1024) { send({ ok: false, code: 'bodyTooLarge' }, 413); return; }
          chunks.push(chunk);
        }
      } catch {
        send({ ok: false, code: 'badBody' }, 400);
        return;
      }
      let draft;
      try {
        draft = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        send({ ok: false, code: 'badBody' }, 400);
        return;
      }
      const id = String(draft?.id ?? '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) { send({ ok: false, code: 'badId' }, 400); return; }
      const list = await readSources();
      const previous = list.find((entry) => entry.id === id);
      // Fields left out keep their stored value, so a rename need not resend the
      // endpoint, the protocol or the key.
      const protocol = draft?.protocol === undefined ? previous?.protocol : draft.protocol;
      if (!PROTOCOLS.includes(protocol)) { send({ ok: false, code: 'badProtocol' }, 400); return; }
      const baseUrl = String(draft?.baseUrl ?? previous?.baseUrl ?? '').trim();
      if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) { send({ ok: false, code: 'urlInvalid' }, 400); return; }
      // An omitted key keeps the stored one, so editing a source never blanks it.
      const key = typeof draft?.key === 'string' && draft.key !== ''
        ? draft.key
        : (previous?.key ?? '');
      const record = {
        id,
        name: String(draft?.name ?? previous?.name ?? '').trim() || id,
        protocol,
        baseUrl,
        model: String(draft?.model ?? previous?.model ?? '').trim(),
        voiceA: String(draft?.voiceA ?? previous?.voiceA ?? '').trim(),
        voiceB: String(draft?.voiceB ?? previous?.voiceB ?? '').trim(),
        // Voices this source added by hand, kept alongside the endpoint's own list.
        customVoices: Array.isArray(draft?.customVoices)
          ? draft.customVoices.map((value) => String(value).trim()).filter((value) => value !== '')
          : (Array.isArray(previous?.customVoices) ? previous.customVoices : []),
        key,
      };
      const next = previous === undefined
        ? [...list, record]
        : list.map((entry) => (entry.id === id ? record : entry));
      await writeSources(next);
      send({ ok: true, source: publicSource(record) });
    },
  }), 'english-reader: speech sources route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.status,
    resource: async () => {
      await hasModel();
      return Response.json(localStatus(), { headers: { 'cache-control': 'no-store' } });
    },
  }), 'english-reader: local status route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.install,
    /**
     * Start the model download; progress arrives through the status route.
     * @param {import('node:http').IncomingMessage} request - the incoming request.
     * @param {import('node:http').ServerResponse} response - the response to complete.
     */
    handler: (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { 'content-type': 'text/plain' }).end('method not allowed');
        return;
      }
      startInstall();
      response.writeHead(202, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ started: true }));
    },
  }), 'english-reader: local install route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.translateOptions,
    /** Which translation sources can be used right now. */
    resource: async () => {
      const model = defaultModelRoute(ctx);
      const microsoft = secret(config, 'microsoftKey', 'DSH_ENGLISH_READER_MICROSOFT_KEY') !== '';
      const tencent = secret(config, 'tencentSecretId', 'DSH_ENGLISH_READER_TENCENT_SECRET_ID') !== ''
        && secret(config, 'tencentSecretKey', 'DSH_ENGLISH_READER_TENCENT_SECRET_KEY') !== '';
      // Every model route this Harness has configured, so the panel can offer a
      // provider first and then that provider's models.
      let routes = [];
      try {
        routes = (ctx.get('llm')?.listProviders?.() ?? []).map((entry) => ({
          provider: entry.id,
          name: entry.name ?? entry.id,
        }));
      } catch { routes = []; }
      return Response.json({
        target: targetLanguage(config),
        routes,
        model: model === undefined ? null : { provider: model.provider, model: model.model },
        providers: [
          { id: 'dsh', ready: model !== undefined && model.model !== '' },
          { id: 'google', ready: true },
          { id: 'volc', ready: true },
          { id: 'microsoft', ready: microsoft },
          { id: 'tencent', ready: tencent },
        ],
      }, { headers: { 'cache-control': 'no-store' } });
    },
  }), 'english-reader: translation options route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.translateModels,
    /** Models one provider route advertises, for the panel's picker. */
    resource: async (request) => {
      const provider = new URL(request.url).searchParams.get('provider') ?? '';
      try {
        const models = await ctx.get('llm')?.listModels(provider) ?? [];
        return Response.json({
          models: models.map((entry) => ({ model: entry.id, name: entry.name ?? entry.id })),
        }, { headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        return Response.json({ models: [], error: error instanceof Error ? error.message : String(error) },
          { headers: { 'cache-control': 'no-store' } });
      }
    },
  }), 'english-reader: translation models route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.models,
    /**
     * List the models an endpoint advertises, so the panel can offer a picker
     * instead of asking for a model id from memory.
     */
    resource: async (request) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const baseUrl = (url.searchParams.get('baseUrl') ?? '').trim();
      if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) return Response.json({ ok: false, code: 'urlInvalid' });
      if (url.searchParams.get('protocol') === 'azure') {
        // Azure publishes no model list; its voices are chosen by name.
        return Response.json({ ok: false, code: 'modelsUnsupported' });
      }
      const key = await resolveKey(url.searchParams.get('key') ?? '', url.searchParams.get('sourceId') ?? '');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const headers = key === '' ? {} : { authorization: `Bearer ${key}` };
        const attempt = await firstThatAnswers(orderedCandidates(baseUrl, 'models'), async (target) => {
          const response = await fetch(target, { headers, signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
          return rows
            .map((entry) => ({ id: String(entry?.id ?? ''), name: String(entry?.name ?? entry?.id ?? '') }))
            .filter((entry) => entry.id !== '');
        });
        if (!attempt.ok) {
          const message = attempt.error instanceof Error ? attempt.error.message : String(attempt.error);
          return Response.json({ ok: false, code: 'modelsFailed', detail: message.slice(0, 160) });
        }
        resolvedUrls.set(`models|${baseUrl}`, attempt.url);
        const all = attempt.value;
        // Most gateways list every model they carry; only some of them can speak.
        const speech = all.filter((entry) => isSpeechModel(entry.id));
        return Response.json({
          ok: true,
          models: speech.length > 0 ? speech : all,
          filtered: speech.length > 0 && speech.length < all.length,
          total: all.length,
        }, { headers: { 'cache-control': 'no-store' } });
      } catch (failure) {
        if (failure instanceof Error && failure.name === 'AbortError') {
          return Response.json({ ok: false, code: 'timeout' });
        }
        const message = failure instanceof Error ? failure.message : String(failure);
        return Response.json({ ok: false, code: 'endpointFailed', detail: message.slice(0, 160) });
      } finally {
        clearTimeout(timer);
      }
    },
  }), 'english-reader: endpoint models route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.dict,
    /** One word's entry; the panel falls back to translation on a miss. */
    resource: async (request) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const word = dictKey(url.searchParams.get('word') ?? '');
      if (word === '') return Response.json({ ok: false, code: 'badWord' }, { status: 400 });
      if (!/^[a-z][a-z' -]{0,48}$/.test(word)) return Response.json({ ok: false, code: 'badWord' }, { status: 400 });
      const kinds = String(url.searchParams.get('kinds') ?? 'both');
      // "en" is Wiktionary, "zh" is the Chinese 简明-style entry; ask only for what is wanted.
      const [en, zh] = await Promise.all([
        kinds === 'zh' ? null : (await lookUpWordNet(word)) ?? (await lookUpWord(word)),
        kinds === 'en' ? null : lookUpChinese(word),
      ]);
      if (en === null && zh === null) {
        return Response.json({ ok: false, code: 'notFound' }, { headers: { 'cache-control': 'no-store' } });
      }
      return Response.json({ ok: true, en, zh }, { headers: { 'cache-control': 'no-store' } });
    },
  }), 'english-reader: dictionary route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.dictAi,
    /** Model-written dictionary entry; the panel caches it too. */
    handler: async (request, response) => {
      const chunks = [];
      try {
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unreadable body' }));
        return;
      }
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') ?? '{}');
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid json' }));
        return;
      }
      const word = dictKey(body?.word ?? '');
      if (word === '' || !/^[a-z][a-z' -]{0,48}$/.test(word)) {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'badWord' }));
        return;
      }
      try {
        const entry = await defineWithModel(ctx, word, body?.model);
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify({ ok: true, entry }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(502, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: false, error: message }));
      }
    },
  }), 'english-reader: model dictionary');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.voices,
    /**
     * Voices worth offering for an endpoint.
     *
     * Cloned voices belong to the account and are only knowable by asking the
     * service; the system ones are documentation facts, so both are returned.
     */
    resource: async (request) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const baseUrl = (url.searchParams.get('baseUrl') ?? '').trim();
      const key = await resolveKey(url.searchParams.get('key') ?? '', url.searchParams.get('sourceId') ?? '');
      const protocol = url.searchParams.get('protocol') ?? 'auto';
      const voices = [];
      const auth = key === '' ? {} : { authorization: `Bearer ${key}` };
      /** Pull a voice list out of whichever shape the service uses. */
      const absorb = (payload) => {
        const rows = Array.isArray(payload?.data) ? payload.data
          : Array.isArray(payload?.voices) ? payload.voices
            : Array.isArray(payload) ? payload : [];
        let added = 0;
        for (const entry of rows) {
          const id = entry?.id ?? entry?.voice ?? entry?.ShortName ?? entry?.name;
          if (typeof id !== 'string' || id === '') continue;
          if (voices.some((known) => known.id === id)) continue;
          voices.push({ id, label: String(entry?.name ?? entry?.FriendlyName ?? id), origin: 'endpoint' });
          added += 1;
        }
        return added;
      };
      // Cloud TTS services usually publish their own list; ask before assuming.
      if (/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
        const host = baseUrl.replace(/\/compatible-mode\/v1$/, '').replace(/\/+$/, '');
        const candidates = protocol === 'azure'
          ? [`${host}/cognitiveservices/voices/list`]
          : [`${host}/voices`, `${host}/v1/voices`, `${host}/audio/voices`];
        for (const target of candidates) {
          try {
            const response = await fetch(target, { headers: auth, signal: AbortSignal.timeout(8000) });
            if (!response.ok) continue;
            if (absorb(await response.json()) > 0) break;
          } catch { /* try the next shape */ }
        }
      }
      // Voices the user added by hand belong to this source, not to the service.
      const stored = await findSource(url.searchParams.get('sourceId') ?? '');
      for (const id of Array.isArray(stored?.customVoices) ? stored.customVoices : []) {
        if (voices.some((known) => known.id === id)) continue;
        voices.push({ id, label: id, origin: 'manual' });
      }
      // No list means the service documents its voices elsewhere; the panel says
      // so instead of guessing ids that belong to one particular vendor.
      let cloned = 0;
      // Only Alibaba offers that particular listing; other hosts would 404.
      if (/aliyuncs\.com|dashscope/i.test(baseUrl) && key !== '') {
        const host = baseUrl.replace(/\/compatible-mode\/v1$/, '').replace(/\/+$/, '');
        try {
          const response = await fetch(`${host}/api/v1/services/audio/tts/customization`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: 'qwen-voice-enrollment', input: { action: 'list', page_size: 50 } }),
            signal: AbortSignal.timeout(12000),
          });
          if (response.ok) {
            const payload = await response.json();
            for (const entry of payload?.output?.voice_list ?? []) {
              const id = entry?.voice ?? entry?.voice_id;
              if (typeof id !== 'string' || id === '') continue;
              if (voices.some((known) => known.id === id)) continue;
              voices.push({ id, label: entry?.name ?? id, origin: 'cloned' });
              cloned += 1;
            }
          }
        } catch { /* the account may not offer cloning; suggestions still work */ }
      }
      return Response.json({
        ok: true,
        voices,
        cloned,
        listed: voices.length > 0,
      }, { headers: { 'cache-control': 'no-store' } });
    },
  }), 'english-reader: voices route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.validate,
    /**
     * Check a speech source before the panel accepts it: a folder has to really
     * hold a model, and an endpoint has to really answer.
     */
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { 'content-type': 'text/plain' }).end('method not allowed');
        return;
      }
      /** @type {Buffer[]} */
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 256 * 1024) {
            response.writeHead(413, { 'content-type': 'text/plain' }).end('body too large');
            return;
          }
          chunks.push(chunk);
        }
      } catch {
        response.writeHead(400, { 'content-type': 'text/plain' }).end('unreadable body');
        return;
      }
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        response.writeHead(400, { 'content-type': 'text/plain' }).end('bad json');
        return;
      }
      const reply = async (body, status = 200) => {
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify(body));
      };
      if (payload?.kind === 'local') {
        const verdict = await checkModelPath(String(payload.modelPath ?? '').trim());
        await reply(verdict);
        return;
      }
      // An endpoint is proven by using it: one short word, one short timeout.
      const protocol = PROTOCOLS.includes(payload?.protocol) ? payload.protocol : 'openai';
      const baseUrl = String(payload?.baseUrl ?? '').trim();
      if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
        await reply({ ok: false, code: 'urlInvalid' });
        return;
      }
      const explicitKey = String(payload?.key ?? '');
      const storedKey = await resolveKey(explicitKey, String(payload?.sourceId ?? ''));
      // Reported back so a refusal can say which key was tried; the value never leaves.
      const keySource = explicitKey !== '' ? 'request' : (storedKey !== '' ? 'stored' : 'none');
      const settings = {
        protocol,
        baseUrl,
        model: String(payload?.model ?? ''),
        voice: String(payload?.voice ?? ''),
        key: storedKey,
        format: '',
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const clip = await synthesizeApi('ok', settings, controller.signal);
        await reply({ ok: true, bytes: clip.body.length, keySource });
      } catch (failure) {
        // Timeouts are a code; anything else is the service's own words, which no
        // translation table can anticipate.
        if (failure instanceof Error && failure.name === 'AbortError') {
          await reply({ ok: false, code: 'timeout' });
          return;
        }
        const message = failure instanceof Error ? failure.message : String(failure);
        await reply({ ok: false, code: 'endpointFailed', detail: message.slice(0, 160), keySource });
      } finally {
        clearTimeout(timer);
      }
    },
  }), 'english-reader: source validation route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.translate,
    /** Translate a batch of sentences; the body carries the source choice. */
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { 'content-type': 'text/plain' }).end('method not allowed');
        return;
      }
      /** @type {Buffer[]} */
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 1024 * 1024) {
            response.writeHead(413, { 'content-type': 'text/plain' }).end('body too large');
            return;
          }
          chunks.push(Buffer.from(chunk));
        }
      } catch {
        response.writeHead(400, { 'content-type': 'text/plain' }).end('unreadable body');
        return;
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid json' }));
        return;
      }
      const texts = Array.isArray(body?.texts)
        ? body.texts.filter((text) => typeof text === 'string' && text.trim() !== '').slice(0, MAX_TRANSLATE_TEXTS)
        : [];
      if (texts.length === 0) {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'no texts' }));
        return;
      }
      if (texts.some((text) => text.length > MAX_TRANSLATE_CHARS)) {
        response.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'text too long' }));
        return;
      }
      const source = ['dsh', 'google', 'volc', 'microsoft', 'tencent'].includes(body?.source) ? body.source : 'dsh';
      const target = targetLanguage(config, body?.target);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        let translations;
        if (source === 'google') {
          translations = await translateWithGoogle(texts, target, controller.signal);
        } else if (source === 'volc') {
          translations = await translateWithVolcengine(texts, target, controller.signal);
        } else if (source === 'microsoft') {
          const key = secret(config, 'microsoftKey', 'DSH_ENGLISH_READER_MICROSOFT_KEY');
          if (key === '') throw new Error('no Microsoft Translator key is configured');
          translations = await translateWithAzure(texts, target,
            key, secret(config, 'microsoftRegion', 'DSH_ENGLISH_READER_MICROSOFT_REGION'), controller.signal);
        } else if (source === 'tencent') {
          const id = secret(config, 'tencentSecretId', 'DSH_ENGLISH_READER_TENCENT_SECRET_ID');
          const key = secret(config, 'tencentSecretKey', 'DSH_ENGLISH_READER_TENCENT_SECRET_KEY');
          if (id === '' || key === '') throw new Error('no Tencent Cloud credentials are configured');
          translations = await translateWithTencent(texts, target, id, key, controller.signal);
        } else {
          translations = await translateWithModel(ctx, texts, target, body?.model);
        }
        if (translations.length !== texts.length || translations.some((line) => typeof line !== 'string' || line === '')) {
          throw new Error('the translation came back incomplete');
        }
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify({ translations, source, target }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify({ error: message }));
      } finally {
        clearTimeout(timer);
      }
    },
  }), 'english-reader: translation route');
}