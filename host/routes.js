import { mkdir, rename } from 'node:fs/promises';
import { EDGE_VOICE, LOCAL_VOICES, MAX_HEADER_MARKS, MAX_STORE_BYTES, MAX_TEXT, MAX_TRANSLATE_CHARS, MAX_TRANSLATE_TEXTS, PATHS, PROTOCOLS, modelDir } from './constants.js';
import { findSource, mergeStore, publicSource, readCollinsKey, readSources, readStore, resolveKey, revisionOf, sameList, writeCollinsKey, writeSources, writeStore } from './files.js';
import { defineWithModel, dictKey, lookUpChinese, lookUpCollins, lookUpWord, lookUpWordNet } from './dictionary.js';
import { defaultModelRoute, secret, targetLanguage } from './model.js';
import { ask, cache, checkModelPath, firstThatAnswers, hasModel, isSpeechModel, local, localStatus, orderedCandidates, pending, resolveModelPath, resolvedUrls, startInstall, stopWorker, synthesize, synthesizeApi } from './speech.js';
import { translateWithAzure, translateWithGoogle, translateWithModel, translateWithTencent, translateWithVolcengine } from './translate.js';

/** Required host services: the HTTP route registry. */
export const inject = ['webServer'];

/**
 * Answer one node-style route with JSON, uncached.
 * @param {import('node:http').ServerResponse} response - the response to complete.
 * @param {any} payload - the body to serialize.
 * @param {number} [status] - the status code, 200 when omitted.
 */
function sendJson(response, payload, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

/**
 * The URL of a request that may carry only a path.
 * @param {{url?: string}} request - the incoming request.
 * @returns {URL} the absolute URL.
 */
function requestUrl(request) {
  return new URL(request.url ?? '/', 'http://localhost');
}

/**
 * Read a request body, refusing one that grows past `limit`.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @param {number} limit - the largest body worth keeping, in bytes.
 * @returns {Promise<{chunks?: Buffer[], tooLarge?: boolean, failed?: boolean}>} the
 *   body chunks, or which way reading it failed.
 */
async function readBody(request, limit) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > limit) return { tooLarge: true };
      chunks.push(Buffer.from(chunk));
    }
  } catch {
    return { failed: true };
  }
  return { chunks };
}

/**
 * A dictionary word: lowercase letters, spaces, apostrophes and hyphens.
 * @param {string} word - the normalized key.
 * @returns {boolean} whether a dictionary may be asked for it.
 */
function isWord(word) {
  return word !== '' && /^[a-z][a-z' -]{0,48}$/.test(word);
}

/**
 * The provider a speech request names.
 * @param {string|null} requested - the `provider` query parameter.
 * @returns {'local'|'custom'|'edge'} the provider to use; anything else means Edge.
 */
function ttsProvider(requested) {
  if (requested === 'local') return 'local';
  if (requested === 'custom') return 'custom';
  return 'edge';
}

/**
 * The voice a speech request names, defaulted from its provider.
 * @param {string|null} requested - the `voice` query parameter.
 * @param {'local'|'custom'|'edge'} provider - the resolved provider.
 * @param {any} custom - the stored custom source, when the provider is custom.
 * @returns {string} the voice to synthesize with.
 */
function ttsVoice(requested, provider, custom) {
  if (requested !== null) return requested;
  if (provider === 'local') return LOCAL_VOICES[0];
  if (provider === 'custom') return custom?.model ?? '';
  return 'en-US-AriaNeural';
}

/**
 * The text, voice and model path one speech request names.
 * @param {URL} url - the request URL.
 * @param {'local'|'custom'|'edge'} provider - the resolved provider.
 * @param {any} custom - the stored custom source, when the provider is custom.
 * @returns {Promise<{provider: string, custom: any, text: string, voice: string, modelPath: string|null}>} what to synthesize.
 */
async function ttsTarget(url, provider, custom) {
  const requestedPath = (url.searchParams.get('modelPath') ?? '').trim();
  const modelPath = requestedPath === '' ? '' : (await resolveModelPath(requestedPath));
  return {
    provider,
    custom,
    text: (url.searchParams.get('text') ?? '').trim(),
    voice: ttsVoice(url.searchParams.get('voice'), provider, custom),
    modelPath,
  };
}

/**
 * The refusal a speech request deserves before synthesis starts, if any.
 * @param {{provider: string, text: string, voice: string, modelPath: string|null}} target - the request.
 * @returns {Promise<Response|undefined>} the refusal, or nothing when synthesis may start.
 */
async function ttsRefusal(target) {
  if (target.text.length === 0) return new Response('missing text', { status: 400 });
  if (target.text.length > MAX_TEXT) return new Response('text too long', { status: 413 });
  if (target.provider === 'local') {
    if (!LOCAL_VOICES.includes(target.voice)) return new Response('unsupported voice', { status: 400 });
    // A download in progress would otherwise queue this request behind the
    // whole model, so ask the panel to wait instead of hanging.
    if (local.phase === 'downloading') return Response.json({ code: 'preparing' }, { status: 503 });
    if (target.modelPath === null) return Response.json({ code: 'bad-model-path' }, { status: 400 });
    if (target.modelPath === '' && !(await hasModel())) return Response.json({ code: 'not-installed' }, { status: 503 });
    return undefined;
  }
  if (target.provider !== 'custom' && !EDGE_VOICE.test(target.voice)) {
    return new Response('unsupported voice', { status: 400 });
  }
  return undefined;
}

/**
 * The audio response, carrying word marks when the sentence fits the header.
 * @param {{body: Buffer, type: string, marks?: any[]}} clip - the synthesized audio.
 * @returns {Response} the audio.
 */
function speechResponse(clip) {
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
}

/**
 * The error a failed synthesis answers with; a local one also becomes the
 * status' error, so the panel can say what went wrong.
 * @param {string} provider - the provider that failed.
 * @param {unknown} error - what it threw.
 * @returns {Response} a 502 whose body names the failure.
 */
function speechFailure(provider, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (provider === 'local' && local.phase !== 'ready') local.error = message;
  return new Response(`speech synthesis failed: ${message}`, { status: 502 });
}

/**
 * Answer one GET with audio bytes.
 * @param {Request} request - the incoming request.
 * @returns {Promise<Response>} audio, or a short error the panel can show.
 */
async function handleTts(request) {
  const url = new URL(request.url);
  const provider = ttsProvider(url.searchParams.get('provider'));
  const custom = provider === 'custom' ? await findSource(url.searchParams.get('sourceId') ?? '') : null;
  if (provider === 'custom' && custom === null) {
    return Response.json({ code: 'not-configured' }, { status: 503 });
  }
  const target = await ttsTarget(url, provider, custom);
  const refusal = await ttsRefusal(target);
  if (refusal !== undefined) return refusal;
  try {
    return speechResponse(await synthesize(provider, target.text, target.voice, custom, target.modelPath));
  } catch (error) {
    return speechFailure(provider, error);
  }
}

/**
 * Build the source record a POST describes, keeping the stored fields it leaves
 * out.
 * @param {string} id - the normalized source id.
 * @param {any} previous - the stored record with this id, if there is one.
 * @param {any} draft - the parsed request body.
 * @param {string} protocol - the validated protocol.
 * @param {string} baseUrl - the validated endpoint.
 * @returns {any} the record to store.
 */
function sourceRecord(id, previous, draft, protocol, baseUrl) {
  // An omitted key keeps the stored one, so editing a source never blanks it.
  const key = typeof draft?.key === 'string' && draft.key !== ''
    ? draft.key
    : (previous?.key ?? '');
  return {
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
}

/**
 * Store the speech source one POST body describes.
 * @param {any} draft - the parsed request body.
 * @returns {Promise<{code?: string, record?: any}>} the stored record, or the code
 *   explaining why it was refused.
 */
async function saveSource(draft) {
  const id = String(draft?.id ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) return { code: 'badId' };
  const list = await readSources();
  const previous = list.find((entry) => entry.id === id);
  // Fields left out keep their stored value, so a rename need not resend the
  // endpoint, the protocol or the key.
  const protocol = draft?.protocol === undefined ? previous?.protocol : draft.protocol;
  if (!PROTOCOLS.includes(protocol)) return { code: 'badProtocol' };
  const baseUrl = String(draft?.baseUrl ?? previous?.baseUrl ?? '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) return { code: 'urlInvalid' };
  const record = sourceRecord(id, previous, draft, protocol, baseUrl);
  const next = previous === undefined
    ? [...list, record]
    : list.map((entry) => (entry.id === id ? record : entry));
  await writeSources(next);
  return { record };
}

/**
 * The speech sources live on the host: the panel reads them, and only ever
 * receives `hasKey`, never the key itself.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @param {import('node:http').ServerResponse} response - the response to complete.
 */
async function handleSources(request, response) {
  const url = requestUrl(request);
  if (request.method === 'GET') {
    const list = await readSources();
    sendJson(response, { sources: list.map(publicSource) });
    return;
  }
  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id') ?? '';
    const list = await readSources();
    await writeSources(list.filter((entry) => entry.id !== id));
    sendJson(response, { ok: true });
    return;
  }
  if (request.method !== 'POST') {
    sendJson(response, { ok: false, code: 'methodNotAllowed' }, 405);
    return;
  }
  const body = await readBody(request, 64 * 1024);
  if (body.tooLarge) { sendJson(response, { ok: false, code: 'bodyTooLarge' }, 413); return; }
  if (body.failed) { sendJson(response, { ok: false, code: 'badBody' }, 400); return; }
  let draft;
  try {
    draft = JSON.parse(Buffer.concat(body.chunks).toString('utf8'));
  } catch {
    sendJson(response, { ok: false, code: 'badBody' }, 400);
    return;
  }
  const saved = await saveSource(draft);
  if (saved.code !== undefined) { sendJson(response, { ok: false, code: saved.code }, 400); return; }
  sendJson(response, { ok: true, source: publicSource(saved.record) });
}

/**
 * The local engine's state, so the panel can show progress instead of guessing.
 * @returns {Promise<Response>} the status.
 */
async function handleStatus() {
  await hasModel();
  return Response.json(localStatus(), { headers: { 'cache-control': 'no-store' } });
}

/**
 * Start the model download; progress arrives through the status route.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @param {import('node:http').ServerResponse} response - the response to complete.
 */
function handleInstall(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'text/plain' }).end('method not allowed');
    return;
  }
  startInstall();
  response.writeHead(202, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    .end(JSON.stringify({ started: true }));
}

/**
 * Every model route this Harness has configured, so the panel can offer a
 * provider first and then that provider's models.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 * @returns {Array<{provider: string, name: string}>} the configured routes.
 */
function modelRoutes(ctx) {
  try {
    return (ctx.get('llm')?.listProviders?.() ?? []).map((entry) => ({
      provider: entry.id,
      name: entry.name ?? entry.id,
    }));
  } catch { return []; }
}

/**
 * Which translation sources can be used right now.
 * @param {Request} request - the incoming request.
 * @param {any} config - the plugin row's config.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 * @returns {Promise<Response>} the options.
 */
async function handleTranslateOptions(request, config, ctx) {
  const model = defaultModelRoute(ctx);
  const microsoft = secret(config, 'microsoftKey', 'DSH_ENGLISH_READER_MICROSOFT_KEY') !== '';
  const tencent = secret(config, 'tencentSecretId', 'DSH_ENGLISH_READER_TENCENT_SECRET_ID') !== ''
    && secret(config, 'tencentSecretKey', 'DSH_ENGLISH_READER_TENCENT_SECRET_KEY') !== '';
  return Response.json({
    target: targetLanguage(config),
    routes: modelRoutes(ctx),
    model: model === undefined ? null : { provider: model.provider, model: model.model },
    providers: [
      { id: 'dsh', ready: model !== undefined && model.model !== '' },
      { id: 'google', ready: true },
      { id: 'volc', ready: true },
      { id: 'microsoft', ready: microsoft },
      { id: 'tencent', ready: tencent },
    ],
  }, { headers: { 'cache-control': 'no-store' } });
}

/**
 * Models one provider route advertises, for the panel's picker.
 * @param {Request} request - the incoming request.
 * @param {any} config - the plugin row's config.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 * @returns {Promise<Response>} the models, or the error the route gave.
 */
async function handleTranslateModels(request, config, ctx) {
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
}

/**
 * Ask an endpoint for its model list; the first URL shape that answers wins.
 * @param {string} baseUrl - the endpoint the user typed.
 * @param {string} key - the key to present, empty for none.
 * @param {AbortSignal} signal - aborts the attempt.
 * @returns {Promise<{models?: Array<{id: string, name: string}>, failed?: unknown}>} the
 *   models, or whatever made every shape fail.
 */
async function listEndpointModels(baseUrl, key, signal) {
  const headers = key === '' ? {} : { authorization: `Bearer ${key}` };
  const attempt = await firstThatAnswers(orderedCandidates(baseUrl, 'models'), async (target) => {
    const response = await fetch(target, { headers, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    return rows
      .map((entry) => ({ id: String(entry?.id ?? ''), name: String(entry?.name ?? entry?.id ?? '') }))
      .filter((entry) => entry.id !== '');
  });
  if (!attempt.ok) return { failed: attempt.error };
  resolvedUrls.set(`models|${baseUrl}`, attempt.url);
  return { models: attempt.value };
}

/**
 * The model list the panel expects: speech models when the endpoint has any.
 * @param {Array<{id: string, name: string}>} all - every model the endpoint lists.
 * @returns {Response} the picker's data.
 */
function modelsResponse(all) {
  // Most gateways list every model they carry; only some of them can speak.
  const speech = all.filter((entry) => isSpeechModel(entry.id));
  return Response.json({
    ok: true,
    models: speech.length > 0 ? speech : all,
    filtered: speech.length > 0 && speech.length < all.length,
    total: all.length,
  }, { headers: { 'cache-control': 'no-store' } });
}

/**
 * List the models an endpoint advertises, so the panel can offer a picker
 * instead of asking for a model id from memory.
 * @param {Request} request - the incoming request.
 * @returns {Promise<Response>} the models, or the code explaining the refusal.
 */
async function handleModels(request) {
  const url = requestUrl(request);
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
    const listed = await listEndpointModels(baseUrl, key, controller.signal);
    if (listed.failed !== undefined) {
      const message = listed.failed instanceof Error ? listed.failed.message : String(listed.failed);
      return Response.json({ ok: false, code: 'modelsFailed', detail: message.slice(0, 160) });
    }
    return modelsResponse(listed.models);
  } catch (failure) {
    if (failure instanceof Error && failure.name === 'AbortError') {
      return Response.json({ ok: false, code: 'timeout' });
    }
    const message = failure instanceof Error ? failure.message : String(failure);
    return Response.json({ ok: false, code: 'endpointFailed', detail: message.slice(0, 160) });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask exactly one dictionary for a word.
 * @param {string} source - the dictionary the request names.
 * @param {string} word - the normalized key.
 * @param {string} collinsKey - the stored Collins key, when that is the source.
 * @returns {Promise<{en: any, zh: any}|null>} the entry, or null for a source that does not exist.
 */
async function lookUpOne(source, word, collinsKey) {
  const found = { en: null, zh: null };
  if (source === 'iciba') found.zh = await lookUpChinese(word);
  else if (source === 'wordnet') found.en = await lookUpWordNet(word);
  else if (source === 'wiktionary') found.en = await lookUpWord(word);
  else if (source === 'collins') found.en = await lookUpCollins(word, collinsKey);
  else return null;
  return found;
}

/**
 * One word's entry; the panel falls back to translation on a miss.
 * @param {Request} request - the incoming request.
 * @returns {Promise<Response>} the entry, or the code explaining the miss.
 */
async function handleDict(request) {
  const url = requestUrl(request);
  const word = dictKey(url.searchParams.get('word') ?? '');
  if (!isWord(word)) return Response.json({ ok: false, code: 'badWord' }, { status: 400 });
  // Exactly one source answers: no chaining, so a slow or missing dictionary
  // never hides behind another one.
  const source = String(url.searchParams.get('source') ?? 'iciba');
  const collinsKey = source === 'collins' ? await readCollinsKey() : '';
  let found = null;
  let failure = '';
  try {
    found = await lookUpOne(source, word, collinsKey);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  if (failure !== '') return Response.json({ ok: false, code: 'failed', error: failure }, { headers: { 'cache-control': 'no-store' } });
  if (found === null) return Response.json({ ok: false, code: 'badSource' }, { status: 400 });
  if (found.en === null && found.zh === null) {
    return Response.json({ ok: false, code: 'notFound' }, { headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ ok: true, source, en: found.en, zh: found.zh }, { headers: { 'cache-control': 'no-store' } });
}

/**
 * The browser may learn whether a key exists, never what it is.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @param {import('node:http').ServerResponse} response - the response to complete.
 */
async function handleDictKey(request, response) {
  if (request.method === 'GET') {
    const key = await readCollinsKey();
    sendJson(response, { hasKey: key !== '', masked: key === '' ? '' : `${key.slice(0, 4)}…${key.slice(-2)}` });
    return;
  }
  if (request.method !== 'POST') { sendJson(response, { error: 'method not allowed' }, 405); return; }
  const body = await readBody(request, Infinity);
  if (body.failed) { sendJson(response, { error: 'unreadable body' }, 400); return; }
  let draft;
  try { draft = JSON.parse(Buffer.concat(body.chunks).toString('utf8') ?? '{}'); } catch { sendJson(response, { error: 'invalid json' }, 400); return; }
  const key = typeof draft?.key === 'string' ? draft.key.trim() : '';
  await writeCollinsKey(key);
  sendJson(response, { hasKey: key !== '' });
}

/**
 * Model-written dictionary entry; the panel caches it too.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @param {import('node:http').ServerResponse} response - the response to complete.
 * @param {any} config - the plugin row's config.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 */
async function handleDictAi(request, response, config, ctx) {
  const body = await readBody(request, Infinity);
  if (body.failed) {
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unreadable body' }));
    return;
  }
  let draft = {};
  try {
    draft = JSON.parse(Buffer.concat(body.chunks).toString('utf8') ?? '{}');
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid json' }));
    return;
  }
  const word = dictKey(draft?.word ?? '');
  if (!isWord(word)) {
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'badWord' }));
    return;
  }
  try {
    const entry = await defineWithModel(ctx, word, draft?.model);
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ ok: true, entry }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.writeHead(502, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: false, error: message }));
  }
}

/**
 * Keep only the shared half of a library state; settings and caches belong to
 * the browser that made them.
 * @param {any} state - the state a POST carried.
 * @returns {any|null} the part worth storing, or null when the state is not one.
 */
function sharedState(state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)
    || !Array.isArray(state.items) || !Array.isArray(state.words)) {
    return null;
  }
  // Positions live inside items; only the shared half is kept.
  return {
    savedAt: Number.isFinite(state.savedAt) ? state.savedAt : Date.now(),
    items: state.items.slice(0, 500),
    words: state.words.slice(0, 2000),
    // Folders classify items and words; they are part of the shared library.
    folders: Array.isArray(state.folders) ? state.folders.slice(0, 200) : [],
    // The dictionary choice is shared too. A panel that sends no settings keeps
    // whatever the host already holds, so a tool write is not erased.
    ...(state.settings !== null && typeof state.settings === 'object' && !Array.isArray(state.settings)
      ? { settings: state.settings }
      : {}),
    removed: Array.isArray(state.removed) ? state.removed.slice(-500) : [],
  };
}

/**
 * The dialogue library and the saved words, shared by every panel.
 *
 * GET returns whatever the host holds (possibly nothing on a fresh install).
 * POST replaces it; the panel merges before it writes, so two open panels do
 * not delete each other's work.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @param {import('node:http').ServerResponse} response - the response to complete.
 */
async function handleStore(request, response) {
  if (request.method === 'GET') {
    const state = await readStore();
    sendJson(response, { ok: true, state, revision: revisionOf(state) });
    return;
  }
  if (request.method !== 'POST') { sendJson(response, { ok: false, error: 'method not allowed' }, 405); return; }
  const body = await readBody(request, MAX_STORE_BYTES);
  if (body.tooLarge) { sendJson(response, { ok: false, error: 'tooLarge' }, 413); return; }
  if (body.failed) { sendJson(response, { ok: false, error: 'unreadable' }, 400); return; }
  let draft;
  try { draft = JSON.parse(Buffer.concat(body.chunks).toString('utf8')); } catch {
    sendJson(response, { ok: false, error: 'badJson' }, 400);
    return;
  }
  const stored = sharedState(draft?.state);
  if (stored === null) { sendJson(response, { ok: false, error: 'badState' }, 400); return; }
  try {
    const merged = mergeStore(await readStore(), stored);
    await writeStore(merged);
    // The revision of what was just written, so the panel that sent it knows
    // this version as its own and does not pull it back as someone else's.
    //
    // Unless the merge had to correct the save: a panel that holds a word the
    // host has tombstoned, or has never seen a word the host holds, would
    // otherwise take its own write as the truth and keep a library nobody else
    // has. Saying so costs one read, and only when it is true.
    const changed = !sameList(merged.items, stored.items)
      || !sameList(merged.words, stored.words)
      || !sameList(merged.folders, stored.folders)
      || !sameList(merged.removed, stored.removed);
    sendJson(response, { ok: true, savedAt: merged.savedAt, revision: revisionOf(merged), changed });
  } catch (error) {
    sendJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

/**
 * The revision of the shared library, and nothing else.
 *
 * The panel asks this every couple of seconds: the full library is far too big
 * for that, and the only question is whether somebody else — another panel, or
 * an `english_reader` tool call — has written since.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @param {import('node:http').ServerResponse} response - the response to complete.
 */
async function handleStoreRevision(request, response) {
  if (request.method !== 'GET') { sendJson(response, { ok: false, error: 'method not allowed' }, 405); return; }
  try {
    const state = await readStore();
    sendJson(response, { ok: true, revision: revisionOf(state), savedAt: Number(state?.savedAt ?? 0) });
  } catch (error) {
    sendJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

/**
 * Pull a voice list out of whichever shape the service uses.
 * @param {Array<{id: string, label: string, origin: string}>} voices - the list so far.
 * @param {any} payload - one endpoint answer.
 * @returns {number} how many voices it added.
 */
function absorbVoices(voices, payload) {
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
}

/**
 * Ask an endpoint for the voices it publishes; endpoints disagree about where.
 * @param {Array<{id: string, label: string, origin: string}>} voices - the list to add to.
 * @param {{baseUrl: string, protocol: string, key: string}} source - the endpoint to ask.
 */
async function endpointVoices(voices, source) {
  if (!/^https?:\/\/[^\s]+$/i.test(source.baseUrl)) return;
  const host = source.baseUrl.replace(/\/compatible-mode\/v1$/, '').replace(/\/+$/, '');
  const candidates = source.protocol === 'azure'
    ? [`${host}/cognitiveservices/voices/list`]
    : [`${host}/voices`, `${host}/v1/voices`, `${host}/audio/voices`];
  const auth = source.key === '' ? {} : { authorization: `Bearer ${source.key}` };
  // Cloud TTS services usually publish their own list; ask before assuming.
  for (const target of candidates) {
    try {
      const response = await fetch(target, { headers: auth, signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      if (absorbVoices(voices, await response.json()) > 0) break;
    } catch { /* try the next shape */ }
  }
}

/**
 * Voices the user added by hand belong to this source, not to the service.
 * @param {Array<{id: string, label: string, origin: string}>} voices - the list to add to.
 * @param {any} stored - the stored source, if there is one.
 */
function manualVoices(voices, stored) {
  for (const id of Array.isArray(stored?.customVoices) ? stored.customVoices : []) {
    if (voices.some((known) => known.id === id)) continue;
    voices.push({ id, label: id, origin: 'manual' });
  }
}

/**
 * Add the account's cloned voices.
 * @param {Array<{id: string, label: string, origin: string}>} voices - the list to add to.
 * @param {any[]} rows - the voice list the service returned.
 * @returns {number} how many voices it added.
 */
function absorbClonedVoices(voices, rows) {
  let added = 0;
  for (const entry of rows) {
    const id = entry?.voice ?? entry?.voice_id;
    if (typeof id !== 'string' || id === '') continue;
    if (voices.some((known) => known.id === id)) continue;
    voices.push({ id, label: entry?.name ?? id, origin: 'cloned' });
    added += 1;
  }
  return added;
}

/**
 * Voices the account cloned on the service.
 * @param {Array<{id: string, label: string, origin: string}>} voices - the list to add to.
 * @param {string} baseUrl - the endpoint the user typed.
 * @param {string} key - the key to present, empty for none.
 * @returns {Promise<number>} how many cloned voices were added.
 */
async function clonedVoices(voices, baseUrl, key) {
  // Only Alibaba offers that particular listing; other hosts would 404.
  if (!/aliyuncs\.com|dashscope/i.test(baseUrl) || key === '') return 0;
  const host = baseUrl.replace(/\/compatible-mode\/v1$/, '').replace(/\/+$/, '');
  try {
    const response = await fetch(`${host}/api/v1/services/audio/tts/customization`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'qwen-voice-enrollment', input: { action: 'list', page_size: 50 } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return 0;
    const payload = await response.json();
    return absorbClonedVoices(voices, payload?.output?.voice_list ?? []);
  } catch { return 0; /* the account may not offer cloning; suggestions still work */ }
}

/**
 * Voices worth offering for an endpoint.
 *
 * Cloned voices belong to the account and are only knowable by asking the
 * service; the system ones are documentation facts, so both are returned.
 * @param {Request} request - the incoming request.
 * @returns {Promise<Response>} the voices.
 */
async function handleVoices(request) {
  const url = requestUrl(request);
  const baseUrl = (url.searchParams.get('baseUrl') ?? '').trim();
  const key = await resolveKey(url.searchParams.get('key') ?? '', url.searchParams.get('sourceId') ?? '');
  const protocol = url.searchParams.get('protocol') ?? 'auto';
  const voices = [];
  await endpointVoices(voices, { baseUrl, protocol, key });
  // Voices the user added by hand belong to this source, not to the service.
  manualVoices(voices, await findSource(url.searchParams.get('sourceId') ?? ''));
  // Only Alibaba offers that particular listing; other hosts would 404.
  const cloned = await clonedVoices(voices, baseUrl, key);
  return Response.json({
    ok: true,
    voices,
    cloned,
    listed: voices.length > 0,
  }, { headers: { 'cache-control': 'no-store' } });
}

/**
 * Whether an endpoint really answers: one short word, one short timeout.
 * @param {any} payload - the parsed request body.
 * @returns {Promise<any>} the verdict body the panel shows.
 */
async function endpointVerdict(payload) {
  const protocol = PROTOCOLS.includes(payload?.protocol) ? payload.protocol : 'openai';
  const baseUrl = String(payload?.baseUrl ?? '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) return { ok: false, code: 'urlInvalid' };
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
    return { ok: true, bytes: clip.body.length, keySource };
  } catch (failure) {
    // Timeouts are a code; anything else is the service's own words, which no
    // translation table can anticipate.
    if (failure instanceof Error && failure.name === 'AbortError') {
      return { ok: false, code: 'timeout' };
    }
    const message = failure instanceof Error ? failure.message : String(failure);
    return { ok: false, code: 'endpointFailed', detail: message.slice(0, 160), keySource };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check a speech source before the panel accepts it: a folder has to really
 * hold a model, and an endpoint has to really answer.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @param {import('node:http').ServerResponse} response - the response to complete.
 */
async function handleValidate(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'text/plain' }).end('method not allowed');
    return;
  }
  const body = await readBody(request, 256 * 1024);
  if (body.tooLarge) {
    response.writeHead(413, { 'content-type': 'text/plain' }).end('body too large');
    return;
  }
  if (body.failed) {
    response.writeHead(400, { 'content-type': 'text/plain' }).end('unreadable body');
    return;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(body.chunks).toString('utf8'));
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain' }).end('bad json');
    return;
  }
  if (payload?.kind === 'local') {
    sendJson(response, await checkModelPath(String(payload.modelPath ?? '').trim()));
    return;
  }
  sendJson(response, await endpointVerdict(payload));
}

/**
 * Run one batch through the translation source the request named.
 * @param {string} source - the provider id.
 * @param {string[]} texts - the sentences to translate.
 * @param {{target: string, model: any, config: any, ctx: any}} choices - what the batch needs.
 * @param {AbortSignal} signal - aborts every upstream call.
 * @returns {Promise<string[]>} the translations.
 */
async function translateBatch(source, texts, choices, signal) {
  const { target, model, config, ctx } = choices;
  if (source === 'google') return translateWithGoogle(texts, target, signal);
  if (source === 'volc') return translateWithVolcengine(texts, target, signal);
  if (source === 'microsoft') {
    const key = secret(config, 'microsoftKey', 'DSH_ENGLISH_READER_MICROSOFT_KEY');
    if (key === '') throw new Error('no Microsoft Translator key is configured');
    return translateWithAzure(texts, target,
      key, secret(config, 'microsoftRegion', 'DSH_ENGLISH_READER_MICROSOFT_REGION'), signal);
  }
  if (source === 'tencent') {
    const id = secret(config, 'tencentSecretId', 'DSH_ENGLISH_READER_TENCENT_SECRET_ID');
    const key = secret(config, 'tencentSecretKey', 'DSH_ENGLISH_READER_TENCENT_SECRET_KEY');
    if (id === '' || key === '') throw new Error('no Tencent Cloud credentials are configured');
    return translateWithTencent(texts, target, id, key, signal);
  }
  return translateWithModel(ctx, texts, target, model);
}

/**
 * Translate a batch of sentences; the body carries the source choice.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @param {import('node:http').ServerResponse} response - the response to complete.
 * @param {any} config - the plugin row's config.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 */
async function handleTranslate(request, response, config, ctx) {
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'text/plain' }).end('method not allowed');
    return;
  }
  const body = await readBody(request, 1024 * 1024);
  if (body.tooLarge) {
    response.writeHead(413, { 'content-type': 'text/plain' }).end('body too large');
    return;
  }
  if (body.failed) {
    response.writeHead(400, { 'content-type': 'text/plain' }).end('unreadable body');
    return;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(body.chunks).toString('utf8'));
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid json' }));
    return;
  }
  const texts = Array.isArray(payload?.texts)
    ? payload.texts.filter((text) => typeof text === 'string' && text.trim() !== '').slice(0, MAX_TRANSLATE_TEXTS)
    : [];
  if (texts.length === 0) {
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'no texts' }));
    return;
  }
  if (texts.some((text) => text.length > MAX_TRANSLATE_CHARS)) {
    response.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'text too long' }));
    return;
  }
  const source = ['dsh', 'google', 'volc', 'microsoft', 'tencent'].includes(payload?.source) ? payload.source : 'dsh';
  const target = targetLanguage(config, payload?.target);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const translations = await translateBatch(source, texts, { target, model: payload?.model, config, ctx }, controller.signal);
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
}

/**
 * One entry per route: what the web server matches, the shape it answers with,
 * the effect label the plugin unloads it by, and the handler itself.
 *
 * `resource` routes answer with a `Response`; `handler` routes own a node
 * response. Every handler is called with the plugin's config and the host
 * context after the arguments it declares, so a route that needs neither
 * declares neither.
 */
const ROUTES = [
  { path: PATHS.tts, resource: handleTts, effect: 'english-reader: speech route' },
  { path: PATHS.ttsSources, handler: handleSources, effect: 'english-reader: speech sources route' },
  { path: PATHS.status, resource: handleStatus, effect: 'english-reader: local status route' },
  { path: PATHS.install, handler: handleInstall, effect: 'english-reader: local install route' },
  { path: PATHS.translateOptions, resource: handleTranslateOptions, effect: 'english-reader: translation options route' },
  { path: PATHS.translateModels, resource: handleTranslateModels, effect: 'english-reader: translation models route' },
  { path: PATHS.models, resource: handleModels, effect: 'english-reader: endpoint models route' },
  { path: PATHS.dict, resource: handleDict, effect: 'english-reader: dictionary route' },
  { path: PATHS.dictKey, handler: handleDictKey, effect: 'english-reader: collins key' },
  { path: PATHS.dictAi, handler: handleDictAi, effect: 'english-reader: model dictionary' },
  { path: PATHS.store, handler: handleStore, effect: 'english-reader: shared library' },
  { path: PATHS.storeRevision, handler: handleStoreRevision, effect: 'english-reader: shared library revision' },
  { path: PATHS.voices, resource: handleVoices, effect: 'english-reader: voices route' },
  { path: PATHS.validate, handler: handleValidate, effect: 'english-reader: source validation route' },
  { path: PATHS.translate, handler: handleTranslate, effect: 'english-reader: translation route' },
];

/**
 * Bind one registry entry to the plugin's config and context.
 * @param {typeof ROUTES[number]} route - the entry to bind.
 * @param {any} config - the plugin row's config.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 * @returns {{kind: 'exact', path: string, resource?: Function, handler?: Function}} the
 *   route the web server registers.
 */
function bindRoute(route, config, ctx) {
  if (route.resource !== undefined) {
    return { kind: 'exact', path: route.path, resource: (request) => route.resource(request, config, ctx) };
  }
  return { kind: 'exact', path: route.path, handler: (request, response) => route.handler(request, response, config, ctx) };
}

/**
 * Host plugin body: install the speech worker, then register one route per
 * panel call.
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
      // The worker's own module owns the handle: assigning to an imported
      // binding from here throws, and used to abort the rest of the unload.
      stopWorker();
    };
  }, 'english-reader: speech worker');

  for (const route of ROUTES) {
    ctx.effect(() => ctx.webServer.register(bindRoute(route, config, ctx)), route.effect);
  }
}
