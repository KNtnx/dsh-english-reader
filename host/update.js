/**
 * Updating this plugin.
 *
 * Two install shapes, two questions. A **registry** install (npm) moves by
 * version: compare our own version with the registry's `latest` and install
 * `name@version`. A **Git** install moves by commit: ask the repository for the
 * head of `main`, compare it with the commit the profile's lockfile pinned, and
 * install a commit-pinned spec. The shape is read from the profile's dependency,
 * so pressing the button never changes how the plugin was installed — an npm
 * install stays npm.
 *
 * The panel needs the button at all because DSH's plugin page offers an update
 * only to catalog entries (a bundle with a known target version) and to registry
 * dependencies; a Git install gets no button there.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { engineRoot } from './engine.js';

/** The repository the checkout tracks. */
export const REPO = 'KNtnx/dsh-english-reader';

/** A full commit, which is what the manager's Git install requires. */
export const COMMIT = /^[0-9a-f]{40}$/i;

/**
 * The commit the profile locked for this plugin.
 * @param {string} root - the profile root.
 * @returns {string|null} the commit, or null when the lockfile says nothing.
 */
export function currentCommit(root = engineRoot()) {
  let text;
  try {
    text = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^\s+dsh-english-reader:\s*$/.test(line));
  if (start === -1) return null;
  for (let index = start + 1; index < Math.min(start + 6, lines.length); index += 1) {
    const found = /tar\.gz\/([0-9a-f]{40})/i.exec(lines[index] ?? '');
    if (found !== null) return found[1].toLowerCase();
  }
  return null;
}

/**
 * The head of `main`, straight from Git.
 *
 * The GitHub commit API answers 403 without a token once the shared rate limit
 * is used up, and a plugin updating itself must not depend on somebody's quota:
 * `git ls-remote` needs no credential and no quota.
 * @param {() => Promise<string>} [run] - the command, for tests.
 * @returns {Promise<string>} the full commit.
 */
export function gitHead(run = defaultGit) {
  return run().then((output) => {
    const found = /^([0-9a-f]{40})\s/m.exec(String(output));
    if (found === null) throw new Error('git ls-remote named no commit');
    return found[1].toLowerCase();
  });
}

/** The baked-in command: one ref, no credential, no progress output. */
function defaultGit() {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['ls-remote', `https://github.com/${REPO}.git`, 'refs/heads/main'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('git ls-remote timed out')) }, 20_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk });
    child.on('error', (error) => { clearTimeout(timer); reject(error) });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`git ls-remote exited with ${String(code)}`));
    });
  });
}

/** A version the registry can serve: `1.2.3`, `^1.2.3`, `~1.2.3`, `=1.2.3`. */
const VERSION_SPEC = /^(?:\^|~|>=|=)?v?\d+\.\d+\.\d+/;

/**
 * How the profile installed this plugin.
 * @param {string} root - the profile root.
 * @returns {{kind: 'registry', spec: string} | {kind: 'git', spec: string} | {kind: 'unknown', spec?: string}} the shape.
 */
export function installedShape(root = engineRoot()) {
  let spec;
  try {
    spec = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))?.dependencies?.['dsh-english-reader'];
  } catch {
    return { kind: 'unknown' };
  }
  if (typeof spec !== 'string') return { kind: 'unknown' };
  if (VERSION_SPEC.test(spec)) return { kind: 'registry', spec };
  if (/^(?:github:|gitlab:|bitbucket:|gist:|git\+|git@)/i.test(spec)) return { kind: 'git', spec };
  return { kind: 'unknown', spec };
}

/** @returns {string} the version this build was published as. */
export function ownVersion() {
  try {
    return String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  } catch {
    return '';
  }
}

/**
 * The registry's `latest` version.
 * @param {typeof fetch} [fetchImpl] - the fetch to use.
 * @returns {Promise<string>} the version.
 */
export async function latestVersion(fetchImpl = fetch) {
  const response = await fetchImpl('https://registry.npmjs.org/dsh-english-reader/latest', {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`the registry answered ${response.status}`);
  const body = await response.json();
  const version = body?.version;
  if (typeof version !== 'string' || VERSION_SPEC.test(version) === false) throw new Error('the registry returned no version');
  return version;
}

/**
 * The newest commit on the repository's default branch, plus the commit message
 * when the API is willing to say. The message is decoration: a 403 must not fail
 * the check.
 * @param {{git?: () => Promise<string>, fetch?: typeof fetch}} [options] - the lookups.
 * @returns {Promise<{sha: string, message: string, date: string}>} the commit.
 */
export async function latestCommit(options = {}) {
  const sha = await gitHead(options.git);
  let message = '';
  let date = '';
  try {
    const response = await (options.fetch ?? fetch)(`https://api.github.com/repos/${REPO}/commits/${sha}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-english-reader' },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      const body = await response.json();
      message = String(body?.commit?.message ?? '').split('\n')[0].slice(0, 200);
      date = String(body?.commit?.committer?.date ?? '');
    }
  } catch {
    message = '';
  }
  return { sha, message, date };
}

/**
 * Compare what is installed with what is available, in the terms the shape uses.
 * @param {{root?: string, current?: string|null, git?: () => Promise<string>, fetch?: typeof fetch}} [options] - where to look.
 * @returns {Promise<{mode: 'registry'|'git', current: string|null, latest: string, newer: boolean, message: string, date: string}>} the comparison.
 */
export async function checkForUpdate(options = {}) {
  const root = options.root ?? engineRoot();
  const shape = options.shape ?? installedShape(root);
  if (shape.kind === 'registry') {
    const current = options.version ?? ownVersion();
    const latest = await latestVersion(options.fetch);
    return { mode: 'registry', current, latest, newer: current !== latest, message: '', date: '' };
  }
  const current = options.current === undefined ? currentCommit(root) : options.current;
  const latest = await latestCommit({ git: options.git, fetch: options.fetch });
  return { mode: 'git', current, latest: latest.sha, newer: current !== latest.sha, message: latest.message, date: latest.date };
}

/**
 * Whether a target is the kind the shape can install.
 * @param {string} target - a version or a full commit.
 * @param {'registry'|'git'} mode - which shape the profile installed.
 * @returns {boolean} whether the manager would accept it.
 */
export function targetFits(target, mode) {
  if (typeof target !== 'string' || target === '') return false;
  return mode === 'registry' ? VERSION_SPEC.test(target) : COMMIT.test(target);
}

/**
 * Ask the plugin manager to install the target the check named.
 *
 * The spec keeps the install shape: a registry target installs `name@version`, a
 * Git target installs a commit-pinned spec.
 * @param {{installBundle: (spec: string) => Promise<unknown>}} manager - the profile's plugin manager.
 * @param {string} target - a version, or a full commit.
 * @param {'registry'|'git'} [mode] - which shape to install; read from the profile when omitted.
 * @returns {Promise<unknown>} the manager's change result.
 */
export function applyUpdate(manager, target, mode) {
  if (typeof target !== 'string' || target === '') throw new Error('no target');
  if (mode === 'registry' || (mode === undefined && VERSION_SPEC.test(target))) {
    if (VERSION_SPEC.test(target) === false) throw new Error('not a version');
    return manager.installBundle(`dsh-english-reader@${target}`, { enabled: true });
  }
  if (COMMIT.test(target) === false) throw new Error('not a full commit');
  return manager.installBundle(`github:${REPO}#${target.toLowerCase()}`, { enabled: true });
}
