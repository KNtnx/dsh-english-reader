/**
 * What an uninstall should take with it.
 *
 * The library, the speech sources and the dictionary settings are user data: a
 * reader who removes the plugin to try something else must find every word back
 * on reinstall. The local model (113 MB) and the engine packages the plugin
 * installed on demand (`pnpm add kokoro-js`, about 120 MB) are neither — they
 * are rebuildable, and leaving them behind means "remove the plugin" frees
 * nothing.
 *
 * DSH has no uninstall hook: `plugin_manager` removes a bundle with
 * `pnpm remove`, which deletes the package and runs no script of it (pnpm only
 * runs lifecycle scripts of its own project). So the plugin schedules the reaping
 * itself, from its own dispose, and checks again a little later whether its
 * package directory is still there — a reload or a disable keeps it, an uninstall
 * does not. Best effort by construction: if the host exits first, the files stay.
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelDir } from './constants.js';
import { engineRoot } from './engine.js';

/** The installed package directory: one level above `host/`. */
export function pluginDirectory() {
  return dirname(fileURLToPath(new URL('../worker.mjs', import.meta.url)));
}

/**
 * The command that takes the engine packages back out.
 *
 * Only `kokoro-js` is a direct dependency (`pnpm add` put it there); the rest of
 * the tree hangs off it and leaves with it. A checkout that is not a package
 * project has nothing to remove — its engine lives in its own `node_modules`,
 * which disappears with the checkout.
 * @param {string} root - the directory the engine was installed into.
 * @returns {{command: string, args: string[], label: string}|null} what to run, if anything.
 */
export function removalCommand(root) {
  if (!existsSync(join(root, 'pnpm-workspace.yaml'))) return null;
  if (!existsSync(join(root, 'node_modules', 'kokoro-js'))) return null;
  return { command: 'pnpm', args: ['remove', 'kokoro-js'], label: 'pnpm remove kokoro-js' };
}

/**
 * Delete the downloaded model, keeping everything else in that folder.
 * @param {string} directory - the model directory.
 * @returns {boolean} whether anything was there to delete.
 */
export function removeModels(directory = modelDir()) {
  if (!existsSync(directory)) return false;
  rmSync(directory, { recursive: true, force: true });
  return true;
}

/**
 * Take the engine packages back out of the profile.
 * @param {string} root - the directory the engine was installed into.
 * @returns {Promise<boolean>} whether a removal ran and succeeded.
 */
export function removeEngine(root = engineRoot()) {
  const command = removalCommand(root);
  if (command === null) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(false) }, 5 * 60 * 1000);
    child.on('error', () => { clearTimeout(timer); resolve(false) });
    child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0) });
    child.stdout.resume();
    child.stderr.resume();
  });
}

/**
 * Remove what an uninstall should remove.
 * @param {{models?: string, root?: string}} options - where the pieces are.
 * @returns {Promise<{models: boolean, engine: boolean}>} what was actually removed.
 */
export async function reapNow(options = {}) {
  const models = removeModels(options.models ?? modelDir());
  const engine = await removeEngine(options.root ?? engineRoot());
  return { models, engine };
}

/**
 * State a watcher that reaps the model and the engine once the package is gone.
 *
 * The plugin is disposed before `pnpm remove` deletes it, so the first look
 * cannot tell an uninstall from a reload; later looks can. The timer lives in the
 * host process, not in the plugin scope, which is why it outlives the disposal at
 * all. `unref` keeps it from holding the process open.
 * @param {{plugin?: string, root?: string, models?: string, delays?: number[]}} [options] - where the pieces are and when to look.
 * @returns {() => void} cancels the watcher.
 */
export function scheduleUninstallReap(options = {}) {
  const plugin = options.plugin ?? pluginDirectory();
  const root = options.root ?? engineRoot();
  const models = options.models ?? modelDir();
  const delays = options.delays ?? [5000, 20000, 60000];
  let done = false;
  const timers = delays.map((delay) => {
    const timer = setTimeout(() => {
      if (done) return;
      // Still installed: a reload, a disable, or a reinstall that beat the timer.
      if (existsSync(join(plugin, 'package.json'))) return;
      done = true;
      for (const other of timers) clearTimeout(other);
      void reapNow({ models, root });
    }, delay);
    timer.unref?.();
    return timer;
  });
  return () => { done = true; for (const timer of timers) clearTimeout(timer) };
}