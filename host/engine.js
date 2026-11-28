/**
 * The local speech engine, installed on demand.
 *
 * `kokoro-js` is an optional peer: the plugin itself must install without it
 * (its native runtime's postinstall fails on newer CUDA versions and used to
 * roll the whole installation back). When the user asks for the local model,
 * the host installs the engine once — with `--ignore-scripts`, so the CUDA
 * probe never runs and the CPU binaries shipped inside the packages are enough
 * — and from then on the worker resolves it the ordinary way.
 *
 * This module owns only the installation and its state; the model download and
 * the speech worker stay in `speech.js` / `worker.mjs`.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The packages the worker needs to load the local engine. */
const ENGINE_PACKAGES = ['kokoro-js', '@huggingface/transformers', 'onnxruntime-node', 'sharp'];

/** What `pnpm add` would install, and the size the panel warns about. */
export const ENGINE_SPEC = 'kokoro-js@^1.2.1';
export const ENGINE_BYTES_APPROX = 120 * 1024 * 1024;

/** Transient install state; on-disk detection is the source of truth. */
export const engine = {
  /** @type {'idle'|'installing'|'error'} */
  phase: 'idle',
  error: '',
  log: '',
  /** @type {Promise<void>|null} the install in flight, so callers can await it. */
  installing: null,
};

/** @param {string} start - a directory to search upward from. @returns {string|null} the profile root. */
function findProfileRoot(start) {
  let directory = resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml')) && existsSync(join(directory, 'package.json'))) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return null;
}

/**
 * Where the engine is installed and resolved from.
 *
 * A normal install lives under the profile's `node_modules`, and the worker
 * (inside that tree) finds the engine by walking up, so the engine goes to the
 * profile root. A `link:` checkout keeps its own `node_modules`, so it goes to
 * the plugin directory instead. `ER_ENGINE_ROOT` overrides both, for tests.
 * @returns {string} an absolute directory.
 */
export function engineRoot() {
  const override = process.env.ER_ENGINE_ROOT;
  if (typeof override === 'string' && override !== '') return resolve(override);
  const plugin = dirname(fileURLToPath(new URL('../worker.mjs', import.meta.url)));
  return findProfileRoot(plugin) ?? plugin;
}

/**
 * The file a package's manifest points at, resolved the way Node resolves it:
 * `exports['.']` first (following `import`/`node`/`default` branches), then
 * `main`, then `index.js`.
 *
 * The manifest alone is not proof of an install: pnpm writes every
 * `package.json` before it unpacks the files, so a check that stops at the
 * manifest calls a half-written tree ready — which is how the worker once
 * started against a `kokoro-js` that had no `dist/` yet.
 * @param {string} directory - the installed package directory.
 * @returns {string|null} the entry file, or null when the manifest is unreadable.
 */
function entryFile(directory) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  const pick = (value) => {
    if (typeof value === 'string') return value;
    if (value === null || typeof value !== 'object') return null;
    for (const key of ['import', 'node', 'default', 'module', 'require']) {
      const found = pick(value[key]);
      if (found !== null) return found;
    }
    return null;
  };
  const exported = manifest.exports === undefined ? null : (manifest.exports['.'] ?? manifest.exports);
  const target = pick(exported) ?? (typeof manifest.main === 'string' ? manifest.main : 'index.js');
  return join(directory, target);
}

/** @param {string} root - where the engine is installed. @returns {boolean} whether the worker can load it. */
export function engineReady(root = engineRoot()) {
  return ENGINE_PACKAGES.every((name) => {
    const file = entryFile(join(root, 'node_modules', name));
    return file !== null && existsSync(file);
  });
}

/** Strip ANSI escapes: the web panel shows this text. */
function clean(text) {
  return String(text).replace(/\u001B\[[0-9;]*m/g, '').replace(/\r/g, '');
}

/** @param {string} root - where the engine is installed. @returns {{phase: 'missing'|'installing'|'ready'|'error', error: string, log: string}} the state. */
export function engineStatus(root = engineRoot()) {
  // A package tree becomes visible before the install command exits; the panel
  // must not start the model download against a half-written tree.
  if (engine.phase === 'installing') return { phase: 'installing', error: '', log: engine.log };
  if (engineReady(root)) return { phase: 'ready', error: '', log: '' };
  if (engine.phase === 'error') return { phase: 'error', error: engine.error, log: engine.log };
  return { phase: 'missing', error: '', log: '' };
}

/**
 * The command that installs the engine for a directory.
 *
 * A profile root has a lockfile and pnpm settings, so it is updated with
 * `pnpm add`. A linked checkout is not a package-manager project; npm's
 * `--no-save` keeps its manifest untouched.
 * @param {string} root - the install directory.
 * @returns {{command: string, args: string[], label: string}} how to run it.
 */
export function installCommand(root) {
  if (existsSync(join(root, 'pnpm-workspace.yaml'))) {
    return {
      command: 'pnpm',
      args: ['add', '--ignore-scripts', ENGINE_SPEC],
      label: `pnpm add --ignore-scripts ${ENGINE_SPEC}`,
    };
  }
  const npmCli = join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(npmCli)) {
    return {
      command: process.execPath,
      args: [npmCli, 'install', '--ignore-scripts', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', ENGINE_SPEC],
      label: `npm install --ignore-scripts --no-save ${ENGINE_SPEC}`,
    };
  }
  return {
    command: 'npm',
    args: ['install', '--ignore-scripts', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', ENGINE_SPEC],
    label: `npm install --ignore-scripts --no-save ${ENGINE_SPEC}`,
  };
}

/** Run one install command, streaming its tail into the state for the panel. */
function runInstall(root, command) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk) => {
      output = `${output}${clean(chunk)}`.slice(-4000);
      engine.log = output;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`the engine install timed out after 15 minutes (${command.label})`));
    }, 15 * 60 * 1000);
    child.on('error', (error) => {
      clearTimeout(timer);
      error.code = error.code ?? 'ENOENT';
      error.command = command.command;
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(`the engine install exited with code ${String(code)}: ${output.slice(-600)}`));
    });
  });
}

/** Install into the directory, falling back to npm's bundled CLI when pnpm is absent. */
async function installInto(root) {
  const command = installCommand(root);
  try {
    await runInstall(root, command);
  } catch (error) {
    if (error?.code !== 'ENOENT' || command.command !== 'pnpm') throw error;
    const fallback = installCommand(root);
    if (fallback.command === 'pnpm') {
      throw new Error('pnpm was not found; run `pnpm add --ignore-scripts kokoro-js@^1.2.1` in the profile directory instead');
    }
    await runInstall(root, fallback);
  }
}

/**
 * Stop pnpm from ever running the engine's CUDA postinstall again.
 *
 * Installing with `--ignore-scripts` skips it once; a later plain `pnpm install`
 * would ask about the same scripts, and approving `onnxruntime-node` on modern
 * CUDA removes the package. Marking those two keys `false` in the profile's
 * `allowBuilds` keeps them installed without running the script. Best effort:
 * an unexpected file shape is left untouched.
 * @param {string} root - the profile root.
 * @returns {boolean} whether the workspace file changed.
 */
export function denyEngineBuilds(root = engineRoot()) {
  const file = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(file)) return false;
  const keys = ['onnxruntime-node', 'sharp']
    .map((name) => {
      try {
        const manifest = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
        return `${name}@${String(manifest.version)}: false`;
      } catch {
        return '';
      }
    })
    .filter((line) => line !== '');
  if (keys.length === 0) return false;
  let lines = readFileSync(file, 'utf8').split('\n');
  let start = lines.findIndex((line) => /^allowBuilds:\s*$/.test(line));
  if (start === -1) {
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    lines.push('allowBuilds:');
    start = lines.length - 1;
  }
  const endOfBlock = () => {
    let end = start + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end += 1;
    return end;
  };
  let changed = false;
  for (const entry of keys) {
    const key = entry.slice(0, entry.indexOf(':'));
    const end = endOfBlock();
    const existing = lines.slice(start + 1, end)
      .findIndex((line) => new RegExp(`^\\s+${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`).test(line));
    if (existing !== -1) {
      const index = start + 1 + existing;
      if (lines[index] !== `  ${entry}`) {
        lines[index] = `  ${entry}`;
        changed = true;
      }
      continue;
    }
    lines.splice(end, 0, `  ${entry}`);
    changed = true;
  }
  if (!changed) return false;
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, lines.join('\n'), { mode: 0o600 });
  renameSync(temporary, file);
  return true;
}

/**
 * Start installing the engine once; the panel polls `localStatus()` for it.
 * @returns {void}
 */
/**
 * Install the engine in the background.
 * @returns {Promise<void>} settles when the install ends, so a caller can drop
 *   the worker that started before the engine existed.
 */
export function startEngineInstall() {
  const root = engineRoot();
  if (engineReady(root)) return Promise.resolve();
  if (engine.phase === 'installing') return engine.installing ?? Promise.resolve();
  engine.phase = 'installing';
  engine.error = '';
  engine.log = '';
  const running = installInto(root)
    .then(() => {
      if (!engineReady(root)) throw new Error('the engine was installed but the worker still cannot load it');
      denyEngineBuilds(root);
      engine.phase = 'idle';
      engine.error = '';
      engine.log = '';
    })
    .catch((error) => {
      engine.phase = 'error';
      engine.error = error instanceof Error ? error.message : String(error);
    })
    .finally(() => { engine.installing = null; });
  engine.installing = running;
  return running;
}