import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PROTOCOLS, dictKeyFile, sourcesFile, storeFile } from './constants.js';

/** @param {any} value - a candidate record. @returns {boolean} whether it is loadable. */
export function isSource(value) {
  return value !== null && typeof value === 'object'
    && typeof value.id === 'string' && value.id !== ''
    && PROTOCOLS.includes(value.protocol)
    && typeof value.baseUrl === 'string';
}

/** @param {any} entry - a stored source. @returns {object} the part the browser may see. */
export function publicSource(entry) {
  return {
    id: entry.id,
    name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.id,
    protocol: entry.protocol,
    baseUrl: entry.baseUrl,
    model: typeof entry.model === 'string' ? entry.model : '',
    voiceA: typeof entry.voiceA === 'string' ? entry.voiceA : '',
    voiceB: typeof entry.voiceB === 'string' ? entry.voiceB : '',
    customVoices: Array.isArray(entry.customVoices) ? entry.customVoices : [],
    hasKey: typeof entry.key === 'string' && entry.key !== '',
  };
}

/** @returns {Promise<any[]>} every stored speech source. */
export async function readSources() {
  try {
    const parsed = JSON.parse(await readFile(sourcesFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(isSource) : [];
  } catch {
    return [];
  }
}

/** @param {any[]} list - sources to persist. */
export async function writeSources(list) {
  await mkdir(dirname(sourcesFile()), { recursive: true });
  await writeFile(sourcesFile(), JSON.stringify(list, null, 2), { mode: 0o600 });
}

/** @returns {Promise<string>} the stored Collins key, or an empty string. */
export async function readCollinsKey() {
  try {
    const parsed = JSON.parse(await readFile(dictKeyFile(), 'utf8'));
    return typeof parsed?.collinsKey === 'string' ? parsed.collinsKey : '';
  } catch {
    return '';
  }
}

/** @param {string} key - the Collins access key; an empty string clears it. */
export async function writeCollinsKey(key) {
  await mkdir(dirname(dictKeyFile()), { recursive: true });
  await writeFile(dictKeyFile(), JSON.stringify({ collinsKey: key }, null, 2), { mode: 0o600 });
}

/** @returns {Promise<{savedAt: number, items: any[], words: any[]}|null>} the stored data, or null. */
export async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(storeFile(), 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    return {
      savedAt: Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      words: Array.isArray(parsed.words) ? parsed.words : [],
      removed: Array.isArray(parsed.removed) ? parsed.removed : [],
    };
  } catch {
    return null;
  }
}

/** Write through a temporary file so a crash mid-write cannot truncate the library. */
export async function writeStore(state) {
  await mkdir(dirname(storeFile()), { recursive: true });
  const temporary = `${storeFile()}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, storeFile());
}

/**
 * Union two library payloads by id, keeping the newer entry of each.
 *
 * Two panels can be open at once (sidebar and full page). Merging here means the
 * one that saves last cannot delete what the other just added.
 */
export function mergeStore(current, incoming) {
  /** `kind:id` to the moment it was deleted, from what is stored and what arrives. */
  const gone = new Map();
  for (const entry of [...(Array.isArray(current?.removed) ? current.removed : []),
    ...(Array.isArray(incoming.removed) ? incoming.removed : [])]) {
    if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
    const key = `${entry.kind}:${entry.id}`;
    gone.set(key, Math.max(gone.get(key) ?? 0, Number(entry.at) ?? 0));
  }
  const union = (left, right, kind, stamp) => {
    const out = new Map();
    for (const entry of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
      if (entry === null || typeof entry !== 'object') continue;
      const id = String(entry.id ?? entry.word ?? '');
      if (id === '') continue;
      // A copy older than its deletion stays deleted; a later save is a new entry.
      if ((gone.get(`${kind}:${id}`) ?? 0) >= Number(entry[stamp] ?? 0)) continue;
      const held = out.get(id);
      if (held === undefined || Number(entry[stamp] ?? 0) >= Number(held[stamp] ?? 0)) out.set(id, entry);
    }
    return [...out.values()];
  };
  const removed = [...gone.entries()].map(([key, at]) => {
    const split = key.indexOf(':');
    return { kind: key.slice(0, split), id: key.slice(split + 1), at };
  }).sort((left, right) => left.at - right.at).slice(-500);
  return {
    savedAt: Math.max(Number(current?.savedAt ?? 0), Number(incoming.savedAt ?? 0)),
    items: union(current?.items, incoming.items, 'item', 'updatedAt').slice(0, 500),
    words: union(current?.words, incoming.words, 'word', 'addedAt').slice(0, 2000),
    removed,
  };
}

/**
 * Load a stored speech source by id.
 * @param {string} id - the source's id.
 * @returns {Promise<any|null>} the record, secret included, or null.
 */
export async function findSource(id) {
  if (typeof id !== 'string' || id === '') return null;
  const list = await readSources();
  return list.find((entry) => entry.id === id) ?? null;
}

/**
 * The key to use for a probe: an explicit one, else whatever the host stored.
 *
 * The panel never holds the secret, so an edit dialog can only name the source it
 * is editing and let the host borrow that source's key.
 * @param {string} explicitKey - a key typed in the panel.
 * @param {string} sourceId - the stored source to borrow a key from.
 * @returns {Promise<string>} the key, possibly empty.
 */
export async function resolveKey(explicitKey, sourceId) {
  if (typeof explicitKey === 'string' && explicitKey !== '') return explicitKey;
  if (typeof sourceId !== 'string' || sourceId === '') return '';
  const record = await findSource(sourceId);
  return typeof record?.key === 'string' ? record.key : '';
}

