/**
 * Host half of dsh-english-reader.
 *
 * The plugin entry: the routes live in `host/routes.js`, the model-facing tool
 * in `host/tool.js`, and everything a route needs sits in one focused module
 * beside them — `constants.js` (paths and limits), `files.js` (the JSON files
 * the panel owns), `dictionary.js`, `speech.js` (the worker and its engines),
 * `translate.js` and `model.js` (the Harness model route).
 *
 * Both speech engines run in a child process (`worker.mjs`): a plugin host
 * evaluates a CommonJS dependency to an empty `exports`, so those packages
 * cannot load in-process.
 */

import { apply as applyRoutes, inject } from './host/routes.js';
import { mountTool } from './host/tool.js';

export { inject };

/**
 * Host plugin body: the panel's routes, then the model's tool if the host has a
 * tool registry. The second half is optional — `mountTool` waits for the
 * service and returns quietly when there is none.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 * @param {any} config - the plugin row's config.
 */
export function apply(ctx, config) {
  applyRoutes(ctx, config);
  mountTool(ctx);
}
