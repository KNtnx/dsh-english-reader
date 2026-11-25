import { homedir } from 'node:os';
import { join } from 'node:path';

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
/** Longest text one request may synthesize, in characters; the client sends one sentence. */
export const MAX_TEXT = 800;

/** Voice ids the Edge provider will proxy. */
export const EDGE_VOICE = /^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]{1,40}Neural$/;

/** English Kokoro voices this plugin exposes, best first. */
export const LOCAL_VOICES = ['af_heart', 'af_bella', 'af_sky', 'am_michael', 'am_fenrir', 'am_puck', 'bf_emma', 'bm_george'];

/** The local model: Kokoro-82M, Apache-2.0, the smallest voice that still sounds natural. */
export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** Quantized weights: ~89 MB instead of ~330 MB, with no audible difference at this size. */
export const MODEL_DTYPE = 'q8';

/** What the panel tells the user the download costs. */
export const MODEL_BYTES_APPROX = 89 * 1024 * 1024;

/** Route paths, kept in one place. */
export const PATHS = {
  tts: '/api-dsh-english-reader/tts',
  status: '/api-dsh-english-reader/local/status',
  install: '/api-dsh-english-reader/local/install',
  ttsSources: '/api-dsh-english-reader/tts/sources',
  validate: '/api-dsh-english-reader/tts/validate',
  models: '/api-dsh-english-reader/tts/models',
  voices: '/api-dsh-english-reader/tts/voices',
  dict: '/api-dsh-english-reader/dict',
  dictAi: '/api-dsh-english-reader/dict/ai',
  dictKey: '/api-dsh-english-reader/dict/key',
  store: '/api-dsh-english-reader/store',
  translate: '/api-dsh-english-reader/translate',
  translateOptions: '/api-dsh-english-reader/translate/options',
  translateModels: '/api-dsh-english-reader/translate/models',
};

/** Longest library payload worth keeping; a full library is far smaller. */
export const MAX_STORE_BYTES = 4 * 1024 * 1024;

/** Longest batch one translation request may carry. */
export const MAX_TRANSLATE_TEXTS = 400;

/** Longest single line the translation providers will accept. */
export const MAX_TRANSLATE_CHARS = 2000;

/** Synthesized clips kept in memory, keyed by `<provider>|<voice>|<text>`. */
export const CACHE_LIMIT = 64;

/** Longest mark table worth putting in a response header. */
export const MAX_HEADER_MARKS = 6000;

/** The DSH home the model lives under. */
export function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}

/** Where the model and its download cache live. */
export function modelDir() {
  return join(dshHome(), 'dsh-english-reader', 'models');
}

/** Where the panel's speech sources are kept: a small JSON file, readable by its owner only. */
export function sourcesFile() {
  return join(dshHome(), 'dsh-english-reader', 'sources.json');
}

/** Where the Collins access key is kept: same folder, same mode as the sources. */
export function dictKeyFile() {
  return join(dshHome(), 'dsh-english-reader', 'dictionary.json');
}

/**
 * The panel's shared data: the dialogue library and the saved words.
 *
 * These used to live in one browser's localStorage, which made them per browser
 * and per origin (localhost and 127.0.0.1 are different origins), so two
 * conversations could show two different libraries. They are user data, not view
 * state, so they are kept on the host and every panel reads the same file.
 */
export function storeFile() {
  return join(dshHome(), 'dsh-english-reader', 'library.json');
}

/** Protocols a speech source may speak. Each one shapes the request differently. */
export const PROTOCOLS = ['auto', 'openai', 'azure', 'dashscope'];

