/**
 * Host half of dsh-english-reader.
 *
 * The plugin entry is this re-export: the routes live in `host/routes.js`, and
 * everything a route needs sits in one focused module beside it —
 * `constants.js` (paths and limits), `files.js` (the JSON files the panel owns),
 * `dictionary.js`, `speech.js` (the worker and its engines), `translate.js` and
 * `model.js` (the Harness model route).
 *
 * Both speech engines run in a child process (`worker.mjs`): a plugin host
 * evaluates a CommonJS dependency to an empty `exports`, so those packages
 * cannot load in-process.
 */

export { inject, apply } from './host/routes.js';
