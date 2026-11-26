/**
 * The model-facing half: one tool a conversation uses to read and edit the
 * library the panel owns.
 *
 * The panel talks to the host over HTTP; a model talks to the same file through
 * `english_reader`, one action per call. Both sides go through
 * `mergeStore`/`writeStore` on `$DSH_HOME/dsh-english-reader/library.json`, so a
 * tool call and a panel save merge instead of replacing each other:
 *
 * - `list_words` / `add_word` / `remove_word` — the saved words;
 * - `list_dialogues` / `add_dialogue` / `rename_dialogue` / `delete_dialogue` —
 *   the dialogue library;
 * - `get_settings` / `set_dictionary` — the dictionary choices.
 *
 * A deletion writes a tombstone into `removed`, the same record the panel
 * writes, so a browser holding an older copy cannot sync the entry back.
 *
 * The tool is registered through a soft `tools` dependency (see `mountTool`): a
 * host without a tool registry still loads every route of the panel.
 */

import { mergeStore, readStore, writeStore } from './files.js';
import { lookUpChinese, lookUpCollins, lookUpWord, lookUpWordNet } from './dictionary.js';

/** The actions the tool answers, in the order the description lists them. */
export const ACTIONS = [
  'list_words',
  'add_word',
  'add_words',
  'remove_word',
  'remove_words',
  'move_words',
  'list_folders',
  'create_folder',
  'list_dialogues',
  'add_dialogue',
  'rename_dialogue',
  'move_dialogue',
  'delete_dialogue',
  'get_settings',
  'set_dictionary',
  'normalize_words',
  'define_word',
];

/** The two lists the library keeps folders apart for. */
const FOLDER_KINDS = ['word', 'dialogue'];

/** Modes the panel offers for showing a gloss: both languages, English or Chinese. */
const SHOW_MODES = ['both', 'en', 'zh'];

/** Chinese dictionary sources the panel offers. */
const CHINESE_SOURCES = ['iciba', 'model'];

/** English dictionary sources the panel offers. */
const ENGLISH_SOURCES = ['wordnet', 'wiktionary', 'collins', 'model'];

/** What the panel shows before the user picks anything. */
const DEFAULT_DICTIONARY = { show: 'both', chinese: 'iciba', english: 'wordnet' };

/** Entries one listing returns when the caller names no limit. */
const DEFAULT_LIMIT = 50;

/** Entries one listing returns at most; a model turn has no use for more. */
const MAX_LIMIT = 200;

/** `Name: text` — the label a dialogue turn carries, when it has one. */
const SPEAKER = /^([A-Za-z\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff.'’\-]*(?: [A-Za-z0-9\u4e00-\u9fff.'’\-]+)?)\s*[:：]\s*(.+)$/;

/**
 * The id a saved word is stored under: lowercase, without punctuation, the
 * same rule the panel uses, so "Jealousy." and "jealousy" are one entry.
 * @param {any} word - the word as the user or the model typed it.
 * @returns {string} the id, possibly empty for a word without letters.
 */
function wordId(word) {
  return String(word ?? '').toLowerCase().replace(/[^a-z' -]/g, '').trim();
}

/**
 * The title a dialogue gets when the caller names none: the first turn,
 * trimmed to something readable, the way the panel names one.
 * @param {string} text - the pasted English.
 * @returns {string} the title, possibly empty.
 */
function titleFor(text) {
  const first = String(text).split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '');
  if (first === undefined) return '';
  const parsed = first.match(SPEAKER);
  const body = parsed === null ? first : parsed[2];
  const clean = body.replace(/\s+/g, ' ').trim();
  return clean.length > 46 ? `${clean.slice(0, 45)}…` : clean;
}

/**
 * How many sentences one text carries.
 *
 * This is the panel's splitting rule without the abbreviation and decimal join,
 * so a listing can say how long a dialogue is without reading it: a text that
 * ends a line on "Dr." may count one more here than the panel does.
 * @param {any} text - the stored English.
 * @returns {number} the sentence count.
 */
function sentenceCount(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat === '') return 0;
  const pieces = flat.match(/[^.!?…]+[.!?…]+["'”’)\]]*|[^.!?…]+$/g) ?? [flat];
  return pieces.filter((piece) => piece.trim() !== '').length;
}

/**
 * A dialogue id no other entry can take, in the panel's own shape.
 * @returns {string} the new id.
 */
function makeId() {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * How many entries one listing may return.
 * @param {any} value - the `limit` argument, however the model sent it.
 * @returns {number} a whole number between 1 and `MAX_LIMIT`.
 */
function limitOf(value) {
  const asked = Number(value);
  if (!Number.isFinite(asked)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(asked), 1), MAX_LIMIT);
}

/**
 * The folders the library holds, optionally of one kind.
 *
 * @param {any} library - the stored library.
 * @param {'word'|'dialogue'} [kind] - only this list's folders.
 * @returns {any[]} folder records with a usable id.
 */
function foldersOf(library, kind) {
  return (Array.isArray(library?.folders) ? library.folders : [])
    .filter((folder) => isRecord(folder) && typeof folder.id === 'string' && folder.id !== '')
    .filter((folder) => kind === undefined || folder.kind === kind);
}

/**
 * The folder names of one kind, for an error a model can act on.
 * @param {any} library - the stored library.
 * @param {'word'|'dialogue'} kind - the list being filed.
 * @returns {string} the names, comma separated.
 */
function folderNames(library, kind) {
  const names = foldersOf(library, kind).map((folder) => String(folder.name ?? ''));
  return names.length === 0 ? '(none yet)' : names.join(', ');
}

/**
 * The id a folder name or id points at, without creating anything.
 *
 * Used by the listings: a filter that names a folder nobody made should say so
 * instead of quietly creating one.
 * @param {any} library - the stored library.
 * @param {any} raw - a folder id or name.
 * @param {'word'|'dialogue'} kind - which list's folders to look in.
 * @returns {string|null} the id, or null when nothing matches.
 */
function folderIdOf(library, raw, kind) {
  const text = String(raw ?? '').trim();
  if (text === '') return '';
  const folders = foldersOf(library, kind);
  const held = folders.find((folder) => folder.id === text)
    ?? folders.find((folder) => String(folder.name ?? '').toLowerCase() === text.toLowerCase());
  return held === undefined ? null : held.id;
}

/**
 * The folder a call wants an entry filed under.
 *
 * `folder` is a name and `folderId` an id. A name is what a conversation knows
 * ("25.12.1"); asking for a listing first, only to turn that name into an opaque
 * id, is a round trip for nothing. A name the library does not have yet is
 * created — that is how a shelf gets made without a second call. An id that is
 * not there is an error: a wrong id is a mistake, not a new name.
 * @param {any} library - the stored library.
 * @param {any} args - the call's arguments.
 * @param {'word'|'dialogue'} kind - the list being filed.
 * @returns {{folderId: string, name: string, created: boolean, made: any|null}} where it goes.
 */
function folderFor(library, args, kind) {
  const wantedId = typeof args.folderId === 'string' ? args.folderId.trim() : '';
  const wantedName = typeof args.folder === 'string' ? args.folder.trim() : '';
  if (wantedId !== '') {
    const held = foldersOf(library, kind).find((folder) => folder.id === wantedId);
    if (held === undefined) {
      throw new Error(`no ${kind} folder with the id "${wantedId}"; the ${kind} folders are ${folderNames(library, kind)} — pass "folder" with a name to create one`);
    }
    return { folderId: wantedId, name: String(held.name ?? ''), created: false, made: null };
  }
  if (wantedName === '') return { folderId: '', name: '', created: false, made: null };
  const named = foldersOf(library, kind)
    .find((folder) => String(folder.name ?? '').toLowerCase() === wantedName.toLowerCase());
  if (named !== undefined) return { folderId: named.id, name: String(named.name ?? ''), created: false, made: null };
  const made = { id: makeId(), name: wantedName, kind, createdAt: Date.now() };
  return { folderId: made.id, name: wantedName, created: true, made };
}

/**
 * The folder part of an answer, so a caller can see where an entry went.
 * @param {{folderId: string, name: string, created: boolean}} spot - from `folderFor`.
 * @returns {{id: string, name: string, created: boolean}} the folder, empty when unclassified.
 */
function folderReport(spot) {
  return { id: spot.folderId, name: spot.name, created: spot.created };
}

/**
 * The words one call asks for, in either shape: `word` with an optional
 * `context`, or a `words` list of strings or `{word, context}` records.
 * @param {any} args - the call's arguments.
 * @returns {Array<{word: string, context: string|undefined}>} one entry per request.
 */
function askedWords(args) {
  const list = Array.isArray(args.words) ? args.words : [args];
  return list.map((item) => {
    if (typeof item === 'string') {
      return { word: item, context: typeof args.context === 'string' ? args.context : undefined };
    }
    if (!isRecord(item)) return { word: '', context: undefined };
    return {
      word: String(item.word ?? ''),
      context: typeof item.context === 'string'
        ? item.context
        : typeof args.context === 'string' ? args.context : undefined,
    };
  });
}

/** @param {any} value - a candidate record. @returns {boolean} whether it is one. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * One stored gloss list, in the shape the panel shows it.
 * @param {any} value - senses or translation, however an older panel wrote them.
 * @returns {Array<{pos: string, def: string, example?: string}>} the senses worth showing.
 */
function sensesOf(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((sense) => sense !== null && typeof sense === 'object' && typeof sense.def === 'string' && sense.def !== '')
    .map((sense) => ({
      pos: typeof sense.pos === 'string' ? sense.pos : '',
      def: sense.def,
      ...typeof sense.example === 'string' && sense.example !== '' ? { example: sense.example } : {},
    }));
}

/**
 * The part of a saved word a conversation needs.
 * @param {any} entry - the stored record.
 * @param {any[]} [folders] - the library's folders, so the answer says where it lives.
 * @returns {object} word, id, folder, glosses, provenance.
 */
function publicWord(entry, folders) {
  const senses = sensesOf(entry.senses);
  const translation = sensesOf(entry.translation);
  const folder = folderOf(folders, entry.folderId);
  return {
    word: String(entry.word ?? entry.id ?? ''),
    id: String(entry.id ?? wordId(entry.word)),
    ...typeof entry.context === 'string' && entry.context !== '' ? { context: entry.context } : {},
    ...typeof entry.folderId === 'string' && entry.folderId !== '' ? { folderId: entry.folderId } : {},
    // The name, not only the id: a conversation files by name and should not
    // have to hold a list of ids to read one back.
    ...folder === null ? {} : { folder },
    // The panel caches the last answer it showed, so a word saved before a
    // lookup — or after the dictionary changed — carries none of these.
    ...senses.length === 0 ? {} : { senses },
    ...translation.length === 0 ? {} : { translation },
    addedAt: Number(entry.addedAt ?? 0),
  };
}

/**
 * The name of the folder an entry points at, when that folder still exists.
 * @param {any[]|undefined} folders - every folder in the library.
 * @param {any} value - the entry's `folderId`.
 * @returns {string|null} the name, or null when the entry is unclassified.
 */
function folderOf(folders, value) {
  if (typeof value !== 'string' || value === '' || !Array.isArray(folders)) return null;
  const held = folders.find((folder) => isRecord(folder) && folder.id === value);
  return held === undefined ? null : String(held.name ?? '');
}

/**
 * The part of a dialogue a conversation needs.
 * @param {any} entry - the stored record.
 * @param {any[]} [folders] - the library's folders, so the answer says where it lives.
 * @returns {object} id, title, folder, length, place.
 */
function publicDialogue(entry, folders) {
  const folder = folderOf(folders, entry.folderId);
  return {
    id: String(entry.id ?? ''),
    title: String(entry.title ?? ''),
    sentences: sentenceCount(entry.text),
    index: Number.isInteger(entry.index) ? entry.index : 0,
    ...typeof entry.mode === 'string' ? { mode: entry.mode } : {},
    ...typeof entry.folderId === 'string' && entry.folderId !== '' ? { folderId: entry.folderId } : {},
    ...folder === null ? {} : { folder },
    updatedAt: Number(entry.updatedAt ?? 0),
  };
}

/**
 * The dictionary choices, with the panel's defaults for whatever is unset.
 * @param {any} settings - the stored settings section, if there is one.
 * @returns {{show: string, chinese: string, english: string}} the choices.
 */
function dictionaryOf(settings) {
  const held = isRecord(settings?.dictionary) ? settings.dictionary : {};
  return {
    show: SHOW_MODES.includes(held.show) ? held.show : DEFAULT_DICTIONARY.show,
    chinese: CHINESE_SOURCES.includes(held.chinese) ? held.chinese : DEFAULT_DICTIONARY.chinese,
    english: ENGLISH_SOURCES.includes(held.english) ? held.english : DEFAULT_DICTIONARY.english,
  };
}

/** @returns {Promise<any>} the stored library, or an empty one on a fresh host. */
async function readLibrary() {
  return await readStore() ?? { savedAt: 0, items: [], words: [], removed: [] };
}

/**
 * Merge one change into the stored library and write it back.
 *
 * The panel and this tool write the same file, so a save is a merge: whatever a
 * change does not mention stays exactly as the host has it, unknown sections
 * included.
 * @param {any} current - the library as it was read.
 * @param {{items?: any[], words?: any[], removed?: any[], settings?: any}} change - what to apply.
 * @returns {Promise<any>} the merged library that was written.
 */
async function writeLibrary(current, change) {
  const merged = mergeStore(current, { savedAt: Date.now(), ...change });
  await writeStore(merged);
  return merged;
}

/**
 * One handler per action; each returns the payload of a call that worked, and
 * throws a message a model can act on when it cannot be done.
 */
const HANDLERS = {
  /** The saved words, newest first, with the folder each one lives in. */
  async list_words(args) {
    const library = await readLibrary();
    const folders = foldersOf(library);
    const filter = typeof args.folder === 'string' && args.folder.trim() !== ''
      ? folderIdOf(library, args.folder, 'word')
      : '';
    if (filter === null) {
      throw new Error(`no word folder named or numbered "${String(args.folder).trim()}"; the word folders are ${folderNames(library, 'word')}`);
    }
    const shown = filter === ''
      ? library.words
      : library.words.filter((entry) => String(entry?.folderId ?? '') === filter);
    const words = [...shown]
      .sort((left, right) => Number(right.addedAt ?? 0) - Number(left.addedAt ?? 0));
    return {
      total: shown.length,
      words: words.slice(0, limitOf(args.limit)).map((entry) => publicWord(entry, folders)),
      ...(filter === '' ? {} : { folder: folderReport({ folderId: filter, name: String(args.folder).trim(), created: false }) }),
    };
  },

  /** Keep one word, deduplicated by the id rule, and the sentence it came from. */
  async add_word(args) {
    const result = await HANDLERS.add_words({ ...args, words: undefined, label: 'add_word' });
    const [first] = result.words;
    return {
      created: result.added === 1,
      ...(first === undefined ? {} : { word: first }),
      total: result.total,
      ...(result.folder.name === '' ? {} : { folder: result.folder }),
    };
  },

  /**
   * Keep several words at once, in one write.
   *
   * Making the caller loop over one call per word costs a round trip and a file
   * write each; a conversation that has just discussed ten words has ten.
   */
  async add_words(args) {
    const label = typeof args.label === 'string' ? args.label : 'add_words';
    const asked = askedWords(args).filter((item) => wordId(item.word) !== '');
    if (asked.length === 0) throw new Error(`${label} needs a word that has letters in it`);
    const library = await readLibrary();
    const spot = folderFor(library, args, 'word');
    const now = Date.now();
    const written = [];
    let added = 0;
    for (const item of asked) {
      const word = String(item.word ?? '').trim();
      const id = wordId(word);
      if (written.some((entry) => entry.id === id)) continue;
      const held = library.words.find((entry) => String(entry.id ?? '') === id || wordId(entry.word) === id);
      if (held === undefined) added += 1;
      written.push({
        // A word is never replaced wholesale: the fields this tool does not know
        // (a note, a cached gloss) belong to the panel and survive an update.
        ...(held ?? {}),
        word,
        id,
        ...item.context === undefined ? {} : { context: item.context.trim() },
        // A filing needs its own stamp: `addedAt` does not move when someone
        // files a word, so a copy that never saw the move would erase it.
        ...spot.folderId === '' ? {} : { folderId: spot.folderId, folderAt: now },
        addedAt: now,
      });
    }
    const merged = await writeLibrary(library, {
      words: written,
      ...spot.made === null ? {} : { folders: [spot.made] },
    });
    const folders = foldersOf(merged);
    const kept = written
      .map((entry) => merged.words.find((candidate) => String(candidate.id ?? '') === entry.id) ?? entry)
      .map((entry) => publicWord(entry, folders));
    return {
      added,
      updated: written.length - added,
      words: kept,
      total: merged.words.length,
      folder: folderReport(spot),
    };
  },

  /** The folders a folderId can point at, so a name can be resolved to it. */
  async list_folders(args) {
    const library = await readLibrary();
    const kind = FOLDER_KINDS.includes(args.kind) ? args.kind : null;
    const folders = foldersOf(library, kind === null ? undefined : kind);
    const counts = new Map(folders.map((folder) => [folder.id, 0]));
    for (const entry of [...library.words, ...library.items]) {
      const id = String(entry?.folderId ?? '');
      if (counts.has(id)) counts.set(id, counts.get(id) + 1);
    }
    const list = folders.map((folder) => ({
      id: String(folder.id ?? ''),
      name: String(folder.name ?? ''),
      kind: String(folder.kind ?? ''),
      // How many entries are in it, so "did the filing work" is one call.
      count: counts.get(folder.id) ?? 0,
    }));
    if (kind === null) return { total: list.length, folders: list };
    const mine = kind === 'word' ? library.words : library.items;
    const unfiled = mine.filter((entry) => !counts.has(String(entry?.folderId ?? ''))).length;
    return { total: list.length, folders: list, unfiled };
  },

  /** Make a folder, or answer with the one that already has that name. */
  async create_folder(args) {
    const name = String(args.name ?? '').trim();
    const kind = FOLDER_KINDS.includes(args.kind) ? args.kind : 'word';
    if (name === '') throw new Error('create_folder needs a name');
    const library = await readLibrary();
    const held = foldersOf(library, kind)
      .find((folder) => String(folder.name ?? '').toLowerCase() === name.toLowerCase());
    if (held !== undefined) {
      return { created: false, folder: { id: held.id, name: String(held.name ?? ''), kind, created: false } };
    }
    const made = { id: makeId(), name, kind, createdAt: Date.now() };
    await writeLibrary(library, { folders: [made] });
    return { created: true, folder: { id: made.id, name, kind, created: true } };
  },

  /** File saved words under a folder, or back to unclassified with no folder. */
  async move_words(args) {
    const asked = askedWords(args).map((item) => String(item.word ?? '').trim()).filter((word) => word !== '');
    if (asked.length === 0) throw new Error('move_words needs the words to move');
    const library = await readLibrary();
    const spot = folderFor(library, args, 'word');
    const at = Date.now();
    const moved = [];
    const missing = [];
    for (const word of asked) {
      const id = wordId(word);
      const held = library.words.find((entry) => String(entry.id ?? '') === id || wordId(entry.word) === id);
      if (held === undefined) { missing.push(word); continue; }
      moved.push({ ...held, folderId: spot.folderId, folderAt: at });
    }
    const merged = await writeLibrary(library, {
      words: moved,
      ...spot.made === null ? {} : { folders: [spot.made] },
    });
    return {
      moved: moved.length,
      missing,
      folder: folderReport(spot),
      total: merged.words.length,
    };
  },

  /**
   * Look a word up in the dictionaries the panel is configured with, through the
   * same functions the /dict route uses.
   */
  async define_word(args) {
    const word = String(args.word ?? '').trim();
    if (word === '') throw new Error('define_word needs a word');
    const library = await readLibrary();
    const wanted = isRecord(library.settings) ? library.settings.dictionary ?? null : null;
    const english = String(args.english ?? wanted?.english ?? 'wordnet');
    const chinese = String(args.chinese ?? wanted?.chinese ?? 'iciba');
    const result = { ok: true, action: 'define_word', word, english: null, chinese: null };
    if (english === 'collins') result.english = await lookUpCollins(word, null).catch(() => null);
    else if (english === 'wiktionary') result.english = await lookUpWord(word).catch(() => null);
    else if (english === 'wordnet') result.english = await lookUpWordNet(word).catch(() => null);
    if (chinese === 'iciba') result.chinese = await lookUpChinese(word).catch(() => null);
    if (result.english === null && result.chinese === null) {
      result.ok = false;
      result.error = `${word} was not found in ${english} or ${chinese}`;
    }
    return result;
  },

  /**
   * Strip sentence punctuation from every saved word, keeping the sentence it was
   * met in byte for byte. A word that would become empty is left alone.
   */
  async normalize_words(args) {
    const library = await readLibrary();
    const dryRun = args.dryRun === true;
    const cleaned = [];
    const skipped = [];
    for (const entry of library.words) {
      const word = String(entry?.word ?? '');
      const trimmed = word.replace(/[^A-Za-z' \-]+$/u, '').trim();
      if (trimmed === word) continue;
      if (trimmed === '') { skipped.push({ word, id: entry.id, reason: 'nothing left after trimming' }); continue; }
      cleaned.push({ ...entry, word: trimmed, id: entry.id ?? wordId(trimmed), before: word });
    }
    if (!dryRun && cleaned.length > 0) await writeLibrary(library, { words: cleaned });
    const sample = cleaned.slice(0, 10).map((entry) => ({ before: entry.before, after: entry.word, id: entry.id }));
    return {
      dryRun,
      changed: cleaned.length,
      skipped,
      total: library.words.length,
      words: (dryRun ? cleaned : library.words).slice(0, limitOf(args.limit)).map((entry) => publicWord(entry)),
      sample,
    };
  },

  /** Drop one word, and remember the deletion so no browser syncs it back. */
  async remove_word(args) {
    return await HANDLERS.remove_words({ ...args, words: undefined });
  },

  /**
   * Drop several words at once, each with the tombstone the panel keeps.
   *
   * The tombstone is the whole point: the panel asks the host before it keeps a
   * word another browser still has, so an entry stays gone.
   */
  async remove_words(args) {
    const asked = askedWords(args).map((item) => String(item.word ?? '').trim()).filter((word) => word !== '');
    if (asked.length === 0) throw new Error('remove_words needs a word that has letters in it');
    const library = await readLibrary();
    const at = Date.now();
    const gone = [];
    const missing = [];
    for (const word of asked) {
      const id = wordId(word);
      if (id === '') continue;
      if (!library.words.some((entry) => String(entry.id ?? '') === id || wordId(entry.word) === id)) missing.push(word);
      if (gone.some((entry) => entry.id === id)) continue;
      gone.push({ kind: 'word', id, at });
    }
    const merged = await writeLibrary(library, { removed: gone });
    const single = !Array.isArray(args.words);
    return {
      removed: true,
      ...single ? { existed: missing.length === 0, id: gone[0]?.id ?? '' } : { count: gone.length, missing },
      total: merged.words.length,
    };
  },

  /** The dialogue library, most recently touched first, with its folders. */
  async list_dialogues(args) {
    const library = await readLibrary();
    const folders = foldersOf(library);
    const filter = typeof args.folder === 'string' && args.folder.trim() !== ''
      ? folderIdOf(library, args.folder, 'dialogue')
      : '';
    if (filter === null) {
      throw new Error(`no dialogue folder named or numbered "${String(args.folder).trim()}"; the dialogue folders are ${folderNames(library, 'dialogue')}`);
    }
    const shown = filter === ''
      ? library.items
      : library.items.filter((entry) => String(entry?.folderId ?? '') === filter);
    const items = [...shown]
      .sort((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0));
    return {
      total: shown.length,
      dialogues: items.slice(0, limitOf(args.limit)).map((entry) => publicDialogue(entry, folders)),
    };
  },

  /** Add one pasted English text as a dialogue of its own. */
  async add_dialogue(args) {
    const text = String(args.text ?? '').trim();
    if (text === '') throw new Error('add_dialogue needs the English text to read');
    const said = typeof args.title === 'string' ? args.title.trim() : '';
    const library = await readLibrary();
    const spot = folderFor(library, args, 'dialogue');
    const now = Date.now();
    const entry = {
      id: makeId(),
      title: said !== '' ? said : titleFor(text),
      text,
      // The panel re-detects dialogue against article when it edits the entry;
      // an added text is laid out as an article until then.
      mode: 'article',
      index: 0,
      createdAt: now,
      updatedAt: now,
      // A filing carries its own stamp, the way a word's does.
      ...spot.folderId === '' ? {} : { folderId: spot.folderId, folderAt: now },
    };
    const merged = await writeLibrary(library, {
      items: [entry],
      ...spot.made === null ? {} : { folders: [spot.made] },
    });
    const kept = merged.items.find((candidate) => candidate.id === entry.id) ?? entry;
    return {
      created: true,
      dialogue: publicDialogue(kept, foldersOf(merged)),
      total: merged.items.length,
      ...spot.name === '' ? {} : { folder: folderReport(spot) },
    };
  },

  /** Retitle one dialogue, keeping the text and everything else on it. */
  async rename_dialogue(args) {
    const id = String(args.id ?? '').trim();
    const title = String(args.title ?? '').trim();
    if (id === '') throw new Error('rename_dialogue needs the id of the dialogue');
    if (title === '') throw new Error('rename_dialogue needs the new title');
    const library = await readLibrary();
    const held = library.items.find((entry) => String(entry.id ?? '') === id);
    if (held === undefined) throw new Error(`no dialogue with id "${id}"`);
    const entry = { ...held, title, updatedAt: Date.now() };
    await writeLibrary(library, { items: [entry] });
    return { dialogue: publicDialogue(entry, foldersOf(library)) };
  },

  /** File one dialogue under a folder, or back to unclassified. */
  async move_dialogue(args) {
    const id = String(args.id ?? '').trim();
    const title = String(args.title ?? '').trim();
    if (id === '' && title === '') throw new Error('move_dialogue needs the id or the title of the dialogue');
    const library = await readLibrary();
    const held = id !== ''
      ? library.items.find((entry) => String(entry.id ?? '') === id)
      : library.items.find((entry) => String(entry.title ?? '').trim().toLowerCase() === title.toLowerCase());
    if (held === undefined) {
      throw new Error(id !== '' ? `no dialogue with id "${id}"` : `no dialogue titled "${title}"`);
    }
    const spot = folderFor(library, args, 'dialogue');
    const entry = { ...held, folderId: spot.folderId, folderAt: Date.now() };
    const merged = await writeLibrary(library, {
      items: [entry],
      ...spot.made === null ? {} : { folders: [spot.made] },
    });
    return {
      dialogue: publicDialogue(entry, foldersOf(merged)),
      folder: folderReport(spot),
    };
  },

  /** Drop one dialogue, and remember the deletion the way the panel does. */
  async delete_dialogue(args) {
    const id = String(args.id ?? '').trim();
    if (id === '') throw new Error('delete_dialogue needs the id of the dialogue');
    const library = await readLibrary();
    const existed = library.items.some((entry) => String(entry.id ?? '') === id);
    const merged = await writeLibrary(library, { removed: [{ kind: 'item', id, at: Date.now() }] });
    return { removed: true, existed, id, total: merged.items.length };
  },

  /** The dictionary choices in force, and whether the host holds any yet. */
  async get_settings() {
    const library = await readLibrary();
    const settings = isRecord(library.settings) ? library.settings : {};
    return {
      settings: { dictionary: dictionaryOf(settings) },
      stored: isRecord(library.settings),
      updatedAt: Number(settings.updatedAt ?? 0),
    };
  },

  /** Choose what the panel shows and which dictionaries answer it. */
  async set_dictionary(args) {
    const show = String(args.show ?? '');
    if (!SHOW_MODES.includes(show)) throw new Error(`set_dictionary needs show to be one of ${SHOW_MODES.join(', ')}`);
    const chinese = args.chinese === undefined ? undefined : String(args.chinese);
    if (chinese !== undefined && !CHINESE_SOURCES.includes(chinese)) {
      throw new Error(`set_dictionary needs chinese to be one of ${CHINESE_SOURCES.join(', ')}`);
    }
    const english = args.english === undefined ? undefined : String(args.english);
    if (english !== undefined && !ENGLISH_SOURCES.includes(english)) {
      throw new Error(`set_dictionary needs english to be one of ${ENGLISH_SOURCES.join(', ')}`);
    }
    const library = await readLibrary();
    const held = isRecord(library.settings) ? library.settings : {};
    const dictionary = {
      // The panel owns this section too: a field it grew later stays.
      ...(isRecord(held.dictionary) ? held.dictionary : {}),
      show,
      ...chinese === undefined ? {} : { chinese },
      ...english === undefined ? {} : { english },
    };
    const settings = { ...held, dictionary, updatedAt: Date.now() };
    await writeLibrary(library, { settings });
    return { settings: { dictionary: dictionaryOf(settings) }, updatedAt: settings.updatedAt };
  },
};

/**
 * The `english_reader` definition: one tool, one action field.
 *
 * Declared as a plain registry entry (a name, a parameter schema, an output
 * schema and `execute`) instead of through `defineTool`: this plugin ships no
 * `@deepseek-ai/dsh-tools` dependency, and an import that cannot resolve would
 * take the whole panel down with it. The registry checks the output schema; the
 * arguments are checked here, per action, and an action that cannot run answers
 * with an error object instead of throwing.
 * @returns {object} a definition ready for `tools.register`.
 */
export function englishReaderTool() {
  return {
    name: 'english_reader',
    description: 'Read and edit the user\'s English reader library, the same data the reader panel shows: saved words, dialogue texts, folders and dictionary settings. A saved word carries the sentence it was met in and whatever gloss the panel last cached for it, so list_words answers "what does this word mean" as the panel would. Use it when the user asks about their saved words or dialogues, or asks to add, file, rename, delete or configure something, instead of asking them to open the panel. Filing by name: `folder` takes the folder\'s name ("25.12.1"), and a name that does not exist yet is created on the spot, so no listing is needed first; `folderId` takes one from list_folders and an unknown id is an error. Several words go in one call (add_words, move_words, remove_words), so filing ten words is one call, not ten. One action per call; list first when a name or an id is unclear.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: 'What to do. Read: list_words, list_folders, list_dialogues, get_settings, define_word, normalize_words. Write: add_word, add_words, remove_word, remove_words, move_words, create_folder, add_dialogue, rename_dialogue, move_dialogue, delete_dialogue, set_dictionary.',
        },
        word: { type: 'string', description: 'add_word and remove_word: the word, in any case and with or without surrounding punctuation.' },
        words: {
          type: 'array',
          items: { type: 'string' },
          description: 'add_words, move_words and remove_words: several words in one call, as plain strings. `context` may still be sent for all of them.',
        },
        folder: {
          type: 'string',
          description: 'Where the entry should live, by name: add_word, add_words, add_dialogue, move_words, move_dialogue create the folder when that name is new. list_words and list_dialogues return only the entries in it. Omit for unclassified.',
        },
        folderId: {
          type: 'string',
          description: 'The id from list_folders, when a caller has one; an id no folder carries is an error. `folder` and `folderId` name the same thing.',
        },
        name: { type: 'string', description: 'create_folder: the name of the folder to make.' },
        kind: { type: 'string', description: 'create_folder and list_folders: which list the folder belongs to. Words and dialogues keep separate folders.', enum: ['dialogue', 'word'] },
        dryRun: { type: 'boolean', description: 'normalize_words: report what would change without writing.' },
        context: { type: 'string', description: 'add_word and add_words: the English sentence the word was met in; shown with the word in the panel.' },
        limit: { type: 'integer', description: 'list_words and list_dialogues: how many entries to return, 1 to 200; 50 when omitted.' },
        id: { type: 'string', description: 'rename_dialogue, move_dialogue and delete_dialogue: the dialogue id from list_dialogues.' },
        title: { type: 'string', description: 'add_dialogue and rename_dialogue: the library row title; add_dialogue derives one from the text when omitted. move_dialogue accepts it instead of an id.' },
        text: { type: 'string', description: 'add_dialogue: the whole English text to read, speaker labels and line breaks included.' },
        show: { type: 'string', enum: SHOW_MODES, description: 'set_dictionary: which glosses the panel shows — both, en or zh.' },
        chinese: { type: 'string', enum: CHINESE_SOURCES, description: 'set_dictionary and define_word: the Chinese dictionary.' },
        english: { type: 'string', enum: ENGLISH_SOURCES, description: 'set_dictionary and define_word: the English dictionary.' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        // The payload follows the action: a listing, the entry that changed, or
        // an error message. Only `ok` is common to every answer.
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean', description: 'Whether the action ran; when false, `error` says why.' },
          error: { type: 'string' },
          action: { type: 'string' },
        },
        required: ['ok'],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    /** @param {any} raw - the model's arguments. @returns {Promise<object>} the answer. */
    async execute(raw) {
      const args = isRecord(raw) ? raw : {};
      const action = String(args.action ?? '');
      if (!Object.hasOwn(HANDLERS, action)) {
        return { ok: false, error: `unknown action "${action}"`, actions: ACTIONS };
      }
      try {
        return { ok: true, action, ...await HANDLERS[action](args) };
      } catch (error) {
        // An action a model got wrong is an answer it can act on, not a crash:
        // the tool result carries the reason and the turn continues.
        return { ok: false, action, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/**
 * Mount the tool on a host that has a tool registry.
 *
 * `tools` is a soft dependency: the callback only runs once the service exists,
 * so a profile without one — or a test's fake context — loads the panel exactly
 * as before, just without the tool. Registering inside `ctx.inject` also ties
 * the registration to this plugin, so unloading disposes it.
 * @param {any} ctx - the plugin's host context.
 */
export function mountTool(ctx) {
  if (typeof ctx?.inject !== 'function') return;
  ctx.inject(['tools'], (scope) => {
    try {
      scope.tools.register(englishReaderTool());
    } catch {
      // A registry that refuses the definition must not cost the panel its
      // routes: the tool is the secondary half of this plugin.
    }
  });
}
