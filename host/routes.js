import { mkdir, rename } from 'node:fs/promises';
import { EDGE_VOICE, LOCAL_VOICES, MAX_HEADER_MARKS, MAX_STORE_BYTES, MAX_TEXT, MAX_TRANSLATE_CHARS, MAX_TRANSLATE_TEXTS, PATHS, PROTOCOLS, modelDir } from './constants.js';
import { findSource, mergeStore, publicSource, readCollinsKey, readSources, readStore, resolveKey, writeCollinsKey, writeSources, writeStore } from './files.js';
import { defineWithModel, dictKey, lookUpChinese, lookUpCollins, lookUpWord, lookUpWordNet } from './dictionary.js';
import { defaultModelRoute, secret, targetLanguage } from './model.js';
import { ask, cache, checkModelPath, firstThatAnswers, hasModel, isSpeechModel, local, localStatus, orderedCandidates, pending, resolveModelPath, resolvedUrls, startInstall, synthesize, synthesizeApi, worker } from './speech.js';
import { translateWithAzure, translateWithGoogle, translateWithModel, translateWithTencent, translateWithVolcengine } from './translate.js';

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
      // Exactly one source answers: no chaining, so a slow or missing dictionary
      // never hides behind another one.
      const source = String(url.searchParams.get('source') ?? 'iciba');
      const collinsKey = source === 'collins' ? await readCollinsKey() : '';
      let en = null;
      let zh = null;
      let failure = '';
      try {
        if (source === 'iciba') zh = await lookUpChinese(word);
        else if (source === 'wordnet') en = await lookUpWordNet(word);
        else if (source === 'wiktionary') en = await lookUpWord(word);
        else if (source === 'collins') en = await lookUpCollins(word, collinsKey);
        else return Response.json({ ok: false, code: 'badSource' }, { status: 400 });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      if (failure !== '') return Response.json({ ok: false, code: 'failed', error: failure }, { headers: { 'cache-control': 'no-store' } });
      if (en === null && zh === null) {
        return Response.json({ ok: false, code: 'notFound' }, { headers: { 'cache-control': 'no-store' } });
      }
      return Response.json({ ok: true, source, en, zh }, { headers: { 'cache-control': 'no-store' } });
    },
  }), 'english-reader: dictionary route');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PATHS.dictKey,
    /** The browser may learn whether a key exists, never what it is. */
    handler: async (request, response) => {
      const send = (payload, status) => response.writeHead(status ?? 200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(payload));
      if (request.method === 'GET') {
        const key = await readCollinsKey();
        send({ hasKey: key !== '', masked: key === '' ? '' : `${key.slice(0, 4)}…${key.slice(-2)}` });
        return;
      }
      if (request.method !== 'POST') { send({ error: 'method not allowed' }, 405); return; }
      const chunks = [];
      try {
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
      } catch { send({ error: 'unreadable body' }, 400); return; }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') ?? '{}'); } catch { send({ error: 'invalid json' }, 400); return; }
      const key = typeof body?.key === 'string' ? body.key.trim() : '';
      await writeCollinsKey(key);
      send({ hasKey: key !== '' });
    },
  }), 'english-reader: collins key');

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
    path: PATHS.store,
    /**
     * The dialogue library and the saved words, shared by every panel.
     *
     * GET returns whatever the host holds (possibly nothing on a fresh install).
     * POST replaces it; the panel merges before it writes, so two open panels do
     * not delete each other's work.
     */
    handler: async (request, response) => {
      const send = (payload, status) => response.writeHead(status ?? 200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      }).end(JSON.stringify(payload));

      if (request.method === 'GET') {
        send({ ok: true, state: await readStore() });
        return;
      }
      if (request.method !== 'POST') { send({ ok: false, error: 'method not allowed' }, 405); return; }

      /** @type {Buffer[]} */
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of request) {
          size += chunk.length;
          if (size > MAX_STORE_BYTES) { send({ ok: false, error: 'tooLarge' }, 413); return; }
          chunks.push(chunk);
        }
      } catch {
        send({ ok: false, error: 'unreadable' }, 400);
        return;
      }

      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        send({ ok: false, error: 'badJson' }, 400);
        return;
      }
      const state = body?.state;
      if (state === null || typeof state !== 'object' || Array.isArray(state)
        || !Array.isArray(state.items) || !Array.isArray(state.words)) {
        send({ ok: false, error: 'badState' }, 400);
        return;
      }
      // Only the shared half is kept: positions live inside items, settings and
      // caches belong to the browser that made them.
      const stored = {
        savedAt: Number.isFinite(state.savedAt) ? state.savedAt : Date.now(),
        items: state.items.slice(0, 500),
        words: state.words.slice(0, 2000),
        removed: Array.isArray(state.removed) ? state.removed.slice(-500) : [],
      };
      try {
        const merged = mergeStore(await readStore(), stored);
        await writeStore(merged);
        send({ ok: true, savedAt: merged.savedAt });
      } catch (error) {
        send({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
      }
    },
  }), 'english-reader: shared library');

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


