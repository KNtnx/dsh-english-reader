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
  'remove_word',
  'list_dialogues',
  'add_dialogue',
  'rename_dialogue',
  'delete_dialogue',
  'get_settings',
  'set_dictionary',
  'normalize_words',
  'list_folders',
  'define_word',
];

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
 * @param {any} entry - the stored record. @returns {object} word, id, glosses, provenance.
 */
function publicWord(entry) {
  const senses = sensesOf(entry.senses);
  const translation = sensesOf(entry.translation);
  return {
    word: String(entry.word ?? entry.id ?? ''),
    id: String(entry.id ?? wordId(entry.word)),
    ...typeof entry.context === 'string' && entry.context !== '' ? { context: entry.context } : {},
    ...typeof entry.folderId === 'string' && entry.folderId !== '' ? { folderId: entry.folderId } : {},
    // The panel caches the last answer it showed, so a word saved before a
    // lookup — or after the dictionary changed — carries none of these.
    ...senses.length === 0 ? {} : { senses },
    ...translation.length === 0 ? {} : { translation },
    addedAt: Number(entry.addedAt ?? 0),
  };
}

/**
 * The part of a dialogue a conversation needs.
 * @param {any} entry - the stored record. @returns {object} id, title, length, place.
 */
function publicDialogue(entry) {
  return {
    id: String(entry.id ?? ''),
    title: String(entry.title ?? ''),
    sentences: sentenceCount(entry.text),
    index: Number.isInteger(entry.index) ? entry.index : 0,
    ...typeof entry.mode === 'string' ? { mode: entry.mode } : {},
    ...typeof entry.folderId === 'string' && entry.folderId !== '' ? { folderId: entry.folderId } : {},
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
  /** The saved words, newest first. */
  async list_words(args) {
    const library = await readLibrary();
    const words = [...library.words]
      .sort((left, right) => Number(right.addedAt ?? 0) - Number(left.addedAt ?? 0));
    return { total: words.length, words: words.slice(0, limitOf(args.limit)).map(publicWord) };
  },

  /** Keep one word, deduplicated by the id rule, and the sentence it came from. */
  async add_word(args) {
    const word = String(args.word ?? '').trim();
    const id = wordId(word);
    if (id === '') throw new Error('add_word needs a word that has letters in it');
    const library = await readLibrary();
    const held = library.words.find((entry) => String(entry.id ?? '') === id || wordId(entry.word) === id);
    const entry = {
      // A word is never replaced wholesale: the fields this tool does not know
      // (a folder, a note) belong to the panel and survive an update.
      ...(held ?? {}),
      word,
      id,
      ...typeof args.context === 'string' ? { context: args.context.trim() } : {},
      ...typeof args.folderId === 'string' ? { folderId: args.folderId.trim() } : {},
      addedAt: Date.now(),
    };
    const merged = await writeLibrary(library, { words: [entry] });
    const kept = merged.words.find((candidate) => String(candidate.id ?? '') === id) ?? entry;
    return { created: held === undefined, word: publicWord(kept), total: merged.words.length };
  },

  /** The folders a folderId can point at, so a name can be resolved to it. */
  async list_folders(args) {
    const library = await readLibrary();
    const folders = Array.isArray(library.folders) ? library.folders : [];
    const kind = typeof args.kind === 'string' && args.kind !== '' ? args.kind : null;
    const shown = kind === null ? folders : folders.filter((folder) => folder.kind === kind);
    return {
      total: shown.length,
      folders: shown.map((folder) => ({
        id: String(folder.id ?? ''),
        name: String(folder.name ?? ''),
        kind: String(folder.kind ?? ''),
      })),
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
    const wanted = library.settings !== null && typeof library.settings === 'object'
      ? library.settings.dictionary ?? null
      : null;
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
    const library = await readLibrary()
    const dryRun = args.dryRun === true
    const cleaned = []
    const skipped = []
    for (const entry of library.words) {
      const word = String(entry?.word ?? '')
      const trimmed = word.replace(/[^A-Za-z' \-]+$/u, '').trim()
      if (trimmed === word) continue
      if (trimmed === '') { skipped.push({ word, id: entry.id, reason: 'nothing left after trimming' }); continue }
      cleaned.push({ ...entry, word: trimmed, id: entry.id ?? wordId(trimmed) })
    }
    if (!dryRun && cleaned.length > 0) await writeLibrary(library, { words: cleaned })
    const sample = cleaned.slice(0, 10).map((entry) => ({ before: library.words.find((w) => w === entry)?.word ?? null, after: entry.word, id: entry.id }))
    return {
      dryRun,
      changed: cleaned.length,
      skipped,
      total: library.words.length,
      words: (dryRun ? cleaned : library.words).slice(0, limitOf(args.limit)).map(publicWord),
      sample,
    }
  },

  /** Drop one word, and remember the deletion so no browser syncs it back. */
  async remove_word(args) {
    const word = String(args.word ?? '').trim();
    const id = wordId(word);
    if (id === '') throw new Error('remove_word needs a word that has letters in it');
    const library = await readLibrary();
    const existed = library.words.some((entry) => String(entry.id ?? '') === id || wordId(entry.word) === id);
    // The tombstone is the whole point: the panel asks the host before it keeps
    // a word another browser still has, so the entry stays gone.
    const merged = await writeLibrary(library, { removed: [{ kind: 'word', id, at: Date.now() }] });
    return { removed: true, existed, id, total: merged.words.length };
  },

  /** The dialogue library, most recently touched first. */
  async list_dialogues(args) {
    const library = await readLibrary();
    const items = [...library.items]
      .sort((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0));
    return { total: items.length, dialogues: items.slice(0, limitOf(args.limit)).map(publicDialogue) };
  },

  /** Add one pasted English text as a dialogue of its own. */
  async add_dialogue(args) {
    const text = String(args.text ?? '').trim();
    if (text === '') throw new Error('add_dialogue needs the English text to read');
    const said = typeof args.title === 'string' ? args.title.trim() : '';
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
      ...typeof args.folderId === 'string' ? { folderId: args.folderId.trim() } : {},
    };
    const library = await readLibrary();
    const merged = await writeLibrary(library, { items: [entry] });
    const kept = merged.items.find((candidate) => candidate.id === entry.id) ?? entry;
    return { created: true, dialogue: publicDialogue(kept), total: merged.items.length };
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
    return { dialogue: publicDialogue(entry) };
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
    description: 'Read and edit the user\'s English reader library, the same data the reader panel shows: saved words, dialogue texts and dictionary settings. A saved word carries the sentence it was met in and whatever gloss the panel last cached for it, so list_words answers "what does this word mean" as the panel would. Use it when the user asks about their saved words or dialogues, or asks to add, rename, delete or configure something, instead of asking them to open the panel. One call changes one thing: list first to learn the ids.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: 'What to do: list_words, add_word, remove_word, list_dialogues, add_dialogue, rename_dialogue, delete_dialogue, get_settings, set_dictionary, normalize_words (strip sentence punctuation from saved words, keeping their 原文), list_folders, or define_word.',
        },
        word: { type: 'string', description: 'add_word and remove_word: the word, in any case and with or without surrounding punctuation.' },
        dryRun: { type: 'boolean', description: 'normalize_words: report what would change without writing.' },
        kind: { type: 'string', description: 'list_folders: only folders of this kind.', enum: ['dialogue', 'word'] },
        english: { type: 'string', description: 'define_word: English dictionary to use.', enum: ['wordnet', 'wiktionary', 'collins', 'model'] },
        chinese: { type: 'string', description: 'define_word: Chinese dictionary to use.', enum: ['iciba', 'model'] },
        context: { type: 'string', description: 'add_word: the English sentence the word was met in; shown with the word in the panel.' },
        folderId: { type: 'string', description: 'add_word and add_dialogue: the folder to file the entry under; omit for unclassified.' },
        limit: { type: 'integer', description: 'list_words and list_dialogues: how many entries to return, 1 to 200; 50 when omitted.' },
        id: { type: 'string', description: 'rename_dialogue and delete_dialogue: the dialogue id from list_dialogues.' },
        title: { type: 'string', description: 'add_dialogue and rename_dialogue: the library row title; add_dialogue derives one from the text when omitted.' },
        text: { type: 'string', description: 'add_dialogue: the whole English text to read, speaker labels and line breaks included.' },
        show: { type: 'string', enum: SHOW_MODES, description: 'set_dictionary: which glosses the panel shows — both, en or zh.' },
        chinese: { type: 'string', enum: CHINESE_SOURCES, description: 'set_dictionary: the Chinese dictionary — iciba or model.' },
        english: { type: 'string', enum: ENGLISH_SOURCES, description: 'set_dictionary: the English dictionary — wordnet, wiktionary, collins or model.' },
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
