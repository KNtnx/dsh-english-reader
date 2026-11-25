import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_LIMIT, LOCAL_VOICES, MODEL_BYTES_APPROX, MODEL_DTYPE, MODEL_ID, modelDir } from './constants.js';

/** @type {Map<string, {body: Buffer, type: string, marks: any[]}>} */
export const cache = new Map();

/** Local provider state, fed by the worker's events and read by the panel. */
export const local = {
  /** @type {'absent'|'downloading'|'loading'|'cached'|'ready'|'error'} */
  phase: 'absent',
  loaded: 0,
  total: 0,
  file: '',
  error: '',
  /** @type {boolean|null} */
  onDisk: null,
};

/** Endpoints that answered, keyed by the address the user typed. */
export const resolvedUrls = new Map();

/** The protocol that answered for an address, learned by probing. */
export const resolvedProtocols = new Map();

/** Escape the five characters SSML cannot carry raw. */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

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
export function endpointCandidates(raw, kind) {
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
export function orderedCandidates(raw, kind) {
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
export async function firstThatAnswers(candidates, run) {
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
export function isSpeechModel(id) {
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
export function dashscopeCandidates(raw) {
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
export async function requestDashscope(url, body, headers, signal) {
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

/**
 * Whether the model weights are already on disk.
 * @returns {Promise<boolean>} true when a weight file exists.
 */
export async function hasModel() {
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

/**
 * Accept a model directory only when it really holds a model this engine can read.
 * @param {string} candidate - an absolute directory path from the panel.
 * @returns {Promise<string|null>} the path, or null when it is not usable.
 */
export async function checkModelPath(candidate) {
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
export async function resolveModelPath(candidate) {
  return (await checkModelPath(candidate)).ok ? candidate : null;
}

/** One speech worker, started on first use. */
export let worker = null;

/** Diagnostics from the worker's stderr, kept for failure messages. */
export let workerStderr = '';

/** Request id counter. */
export let nextId = 1;

/** @type {Map<number, {resolve: (value: any) => void, reject: (error: Error) => void, timer: any}>} */
export const pending = new Map();

export let stdoutBuffer = '';

/** Start the worker process. */
export function startWorker() {
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
export function applyEvent(event) {
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
export function ask(payload, timeoutMs) {
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
export function localStatus() {
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
export function startInstall() {
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

export async function synthesizeDashscope(text, settings, signal) {
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
export async function synthesizeAuto(text, settings, signal) {
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
export async function synthesizeAzure(text, settings, signal) {
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
export function synthesizeApi(text, settings, signal) {
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
export async function synthesizeCustom(text, settings, signal) {
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
export async function synthesize(provider, text, voice, custom, modelPath) {
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

