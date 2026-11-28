/**
 * Updating this plugin from its own repository.
 *
 * DSH's plugin page offers an update only to catalog entries — a bundle it
 * knows a target version for. A package installed from a Git spec has no such
 * entry, so the page can show where it came from but never a button, whatever
 * the manifest version says. The plugin therefore carries the button itself:
 * ask GitHub for the newest commit on `main`, compare it with the commit the
 * profile's lockfile pinned, and hand the manager the exact spec to install.
 *
 * The manager call is `installBundle` on a commit-pinned spec, which is the same
 * operation the plugin page performs when a person installs a Git package: it
 * replaces the dependency, reloads the profile, and needs no restart.
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
 * Compare the locked commit with the newest one.
 * @param {{root?: string, current?: string|null, git?: () => Promise<string>, fetch?: typeof fetch}} [options] - where to look.
 * @returns {Promise<{current: string|null, latest: string, newer: boolean, message: string, date: string}>} the comparison.
 */
export async function checkForUpdate(options = {}) {
  const current = options.current === undefined ? currentCommit(options.root) : options.current;
  const latest = await latestCommit({ git: options.git, fetch: options.fetch });
  return { current, latest: latest.sha, newer: current !== latest.sha, message: latest.message, date: latest.date };
}

/**
 * Ask the plugin manager to install a commit of this repository.
 * @param {{installBundle: (spec: string) => Promise<unknown>}} manager - the profile's plugin manager.
 * @param {string} sha - the full commit to install.
 * @returns {Promise<unknown>} the manager's change result.
 */
export function applyUpdate(manager, sha) {
  if (typeof sha !== 'string' || !COMMIT.test(sha)) throw new Error('not a full commit');
  return manager.installBundle(`github:${REPO}#${sha.toLowerCase()}`, { enabled: true });
}