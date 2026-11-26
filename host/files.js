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
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {
      // Sections this module does not own are carried through untouched: the
      // store file is shared, so dropping an unknown key would erase it.
      ...parsed,
      savedAt: Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      words: Array.isArray(parsed.words) ? parsed.words : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
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
 * Where each entry lives, decided by its newest move.
 *
 * A move changes `folderId` and nothing else that the union looks at: a word
 * filed under "25.12.1" keeps its `addedAt`, and a rename keeps its
 * `updatedAt`. Comparing those stamps would let a copy that never saw the move
 * erase it, so `folderAt` — written by whoever files an entry, the panel or the
 * tool — is what settles the question. This is the browser's rule as well (see
 * `mergeStates` in client.js): the two halves meet in this one file.
 * @param {any[]} lists - every copy of the list that is being merged.
 * @returns {Map<string, {at: number, folderId: string}>} id to its newest filing.
 */
function placements(lists) {
  const out = new Map();
  for (const list of lists) {
    for (const entry of Array.isArray(list) ? list : []) {
      const id = String(entry?.id ?? entry?.word ?? '');
      if (id === '') continue;
      const at = Number(entry.folderAt ?? 0);
      const held = out.get(id);
      // A tie means two filings in the same millisecond: the one being written
      // now is the later of them, and the list being merged in comes second.
      if (held === undefined || at >= held.at) {
        out.set(id, { at, folderId: String(entry.folderId ?? '') });
      }
    }
  }
  return out;
}

/**
 * Give each entry the folder its newest filing put it in.
 * @param {any[]} list - the merged entries.
 * @param {Map<string, {at: number, folderId: string}>} spots - from `placements`.
 * @returns {any[]} the same entries, with `folderId` settled.
 */
function placed(list, spots) {
  return list.map((entry) => {
    const spot = spots.get(String(entry?.id ?? entry?.word ?? ''));
    // An entry that was never filed keeps its shape: no folderId is invented.
    if (spot === undefined) return entry;
    if (spot.folderId === '' && entry.folderId === undefined) return entry;
    return { ...entry, folderId: spot.folderId };
  });
}

/**
 * Union two library payloads by id, keeping the newer entry of each.
 *
 * Two panels can be open at once (sidebar and full page), and a tool call writes
 * the same file. Merging here means the one that saves last cannot delete what
 * the other just added, and that a move survives a save that never saw it.
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
  const merged = {
    savedAt: Math.max(Number(current?.savedAt ?? 0), Number(incoming.savedAt ?? 0)),
    items: placed(union(current?.items, incoming.items, 'item', 'updatedAt'), placements([current?.items, incoming.items])).slice(0, 500),
    words: placed(union(current?.words, incoming.words, 'word', 'addedAt'), placements([current?.words, incoming.words])).slice(0, 2000),
    folders: union(current?.folders, incoming.folders, 'folder', 'createdAt').slice(0, 200),
    removed,
  };
  // Whatever else the file holds belongs to another section: keep it, with the
  // incoming copy winning, instead of silently deleting it on every save.
  for (const [key, value] of Object.entries({ ...(current ?? {}), ...(incoming ?? {}) })) {
    if (!(key in merged)) merged[key] = value;
  }
  return merged;
}

/**
 * Whether two lists of the library hold the same entries.
 *
 * Order is not part of the library: the merge keeps whatever order the file has,
 * and a panel that sends the same entries in another order has nothing to learn.
 * Comparing by id makes that the case, so only a real difference is reported.
 * @param {any} left - one list.
 * @param {any} right - another list.
 * @returns {boolean} whether they hold the same entries.
 */
export function sameList(left, right) {
  const of = (value) => (Array.isArray(value) ? value : []);
  if (of(left).length !== of(right).length) return false;
  const key = (entry) => String(entry?.id ?? entry?.word ?? '');
  const sorted = (list) => [...list].sort((one, other) => key(one).localeCompare(key(other)));
  return JSON.stringify(sorted(of(left))) === JSON.stringify(sorted(of(right)));
}

/**
 * A short fingerprint of a whole library.
 *
 * An open panel cannot poll a 70 KB library every couple of seconds, and it has
 * no other way to learn that a tool call changed the file. The revision is a
 * hash of the stored text, so two panels — or a panel and a tool call — can agree
 * on "nothing changed" by exchanging a dozen bytes. FNV-1a is not a security
 * primitive: it only has to notice an edit, and the length rides along to make a
 * collision of the two cheap.
 * @param {any} state - the library as it is stored.
 * @returns {string} the revision, '' for an empty library.
 */
export function revisionOf(state) {
  if (state === null || state === undefined) return '';
  const text = JSON.stringify(state);
  let hash = 2166136261;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(36)}.${text.length.toString(36)}`;
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

