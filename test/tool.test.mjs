/**
 * The model-facing `english_reader` tool: the definition it registers, and the
 * library it edits.
 *
 * The host keeps its data under DSH_HOME, so every case points that at a scratch
 * folder: a run never reads or writes the library the panel is using.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'er-tool-test-'))
const { ACTIONS, englishReaderTool, mountTool } = await import('../host/tool.js')
const { apply } = await import('../index.js')

const tool = englishReaderTool()
const run = (args) => tool.execute(args)

/** Point the host at a fresh scratch folder; DSH_HOME is read on every call. */
async function scratch() {
  const home = await mkdtemp(join(tmpdir(), 'er-tool-test-'))
  process.env.DSH_HOME = home
  return home
}

/** The library file as the host wrote it. */
async function stored(home) {
  return JSON.parse(await readFile(join(home, 'dsh-english-reader', 'library.json'), 'utf8'))
}

/** Write a library file by hand, the way an older panel would have left it. */
async function seed(home, state) {
  await mkdir(join(home, 'dsh-english-reader'), { recursive: true })
  await writeFile(join(home, 'dsh-english-reader', 'library.json'), JSON.stringify(state))
}

/** A context shaped like the host's, with the services the plugin asks for. */
function fakeContext(services = {}) {
  const context = {
    effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    inject: (deps, callback) => { callback(services) },
    ...services,
  }
  return context
}

test('the tool declares one action field and a description the model can route on', () => {
  assert.equal(tool.name, 'english_reader')
  assert.match(tool.description, /saved words/)
  assert.match(tool.description, /dialogues/)
  assert.match(tool.description, /dictionary settings/)
  assert.deepEqual(tool.parameters.required, ['action'])
  assert.deepEqual(tool.parameters.properties.action.enum, ACTIONS)
  assert.equal(tool.parameters.properties.action.type, 'string')
  const rendered = tool.output.render({ action: 'list_words' }, { ok: true })
  assert.deepEqual(JSON.parse(rendered[0].text), { ok: true })
  assert.deepEqual(tool.output.schema.required, ['ok'])
})

test('mounting registers the tool once a tool registry is there', () => {
  const registered = []
  const asked = []
  const context = {
    inject: (deps, callback) => { asked.push(deps); callback({ tools: { register: (definition) => registered.push(definition) } }) },
  }
  mountTool(context)
  assert.deepEqual(asked, [['tools']])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'english_reader')
})

test('the plugin still loads when a host has no tool registry', () => {
  // The routes are the plugin; the tool is the optional half. A context without
  // `inject` and without `tools` is what a headless host hands the plugin.
  const routes = new Map()
  const context = {
    effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    webServer: { register: (route) => { routes.set(route.path, route); return () => {} } },
  }
  assert.doesNotThrow(() => mountTool(context))
  assert.doesNotThrow(() => apply(context, {}))
  assert.ok(routes.size > 0, 'every panel route is installed anyway')
})

test('the plugin mounts the tool when the host does have a registry', () => {
  const registered = []
  const services = { tools: { register: (definition) => registered.push(definition) } }
  const routes = new Map()
  const context = fakeContext({
    ...services,
    webServer: { register: (route) => { routes.set(route.path, route); return () => {} } },
  })
  apply(context, {})
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'english_reader')
  assert.ok(routes.size > 0)
})

test('a saved word is listed, deduplicated and then gone with a tombstone', async () => {
  const home = await scratch()

  const added = await run({ action: 'add_word', word: 'Jealousy.', context: 'She felt a pang of jealousy.' })
  assert.equal(added.ok, true)
  assert.equal(added.created, true)
  assert.equal(added.word.id, 'jealousy')

  const listed = await run({ action: 'list_words' })
  assert.equal(listed.total, 1)
  assert.deepEqual(listed.words.map((entry) => entry.word), ['Jealousy.'])
  assert.equal(listed.words[0].context, 'She felt a pang of jealousy.')

  // The panel's id rule keeps "Jealousy." and "jealousy" as one entry.
  const again = await run({ action: 'add_word', word: 'jealousy', context: 'A jealous look.' })
  assert.equal(again.created, false)
  const deduped = await run({ action: 'list_words' })
  assert.equal(deduped.total, 1)
  assert.equal(deduped.words[0].context, 'A jealous look.')

  const removed = await run({ action: 'remove_word', word: 'jealousy' })
  assert.equal(removed.ok, true)
  assert.equal(removed.existed, true)
  assert.deepEqual((await run({ action: 'list_words' })).words, [])

  const file = await stored(home)
  assert.deepEqual(file.words, [], 'the word left the library')
  assert.deepEqual(file.removed.map((entry) => `${entry.kind}:${entry.id}`), ['word:jealousy'])
  assert.ok(file.removed[0].at > 0, 'the deletion carries the moment it happened')
})

test('a word keeps the fields the tool does not know about', async () => {
  const home = await scratch()
  await seed(home, {
    savedAt: 1,
    items: [],
    words: [{
      id: 'dream',
      word: 'dream',
      addedAt: 1,
      folderId: 'f1',
      note: 'the panel wrote this',
      senses: [{ pos: 'n', def: 'a series of images while asleep', example: 'a vivid dream' }],
      translation: [{ pos: 'n', def: '梦' }],
    }],
    removed: [],
    folders: [{ id: 'f1', name: 'Reading', kind: 'word', createdAt: 1 }],
  })

  const listed = await run({ action: 'list_words' })
  assert.deepEqual(listed.words[0].senses,
    [{ pos: 'n', def: 'a series of images while asleep', example: 'a vivid dream' }])
  assert.deepEqual(listed.words[0].translation, [{ pos: 'n', def: '梦' }])

  const added = await run({ action: 'add_word', word: 'dreamy' })
  assert.equal(added.ok, true)
  assert.equal(added.word.senses, undefined, 'a word with no cached gloss gains none')

  const file = await stored(home)
  const dream = file.words.find((entry) => entry.id === 'dream')
  assert.equal(dream.folderId, 'f1')
  assert.equal(dream.note, 'the panel wrote this', 'an unknown field survives a save')
  assert.deepEqual(file.folders, [{ id: 'f1', name: 'Reading', kind: 'word', createdAt: 1 }],
    'a section this tool does not write survives too')
  assert.ok(file.words.some((entry) => entry.id === 'dreamy'))
})

test('a dialogue is added, listed, renamed and deleted', async () => {
  const home = await scratch()
  const text = 'A: The kettle is on.\nB: Then we wait.'

  const added = await run({ action: 'add_dialogue', text, title: 'Kettle' })
  assert.equal(added.ok, true)
  assert.equal(added.created, true)
  const id = added.dialogue.id
  assert.match(id, /^d[0-9a-z]+$/, 'the id is the panel\'s shape')
  assert.equal(added.dialogue.mode, 'article')
  assert.equal(added.dialogue.index, 0)

  const listed = await run({ action: 'list_dialogues' })
  assert.equal(listed.total, 1)
  assert.deepEqual(listed.dialogues.map((entry) => entry.id), [id])
  assert.equal(listed.dialogues[0].title, 'Kettle')
  assert.equal(listed.dialogues[0].sentences, 2)
  assert.equal(listed.dialogues[0].index, 0)

  const renamed = await run({ action: 'rename_dialogue', id, title: 'Kettle at dusk' })
  assert.equal(renamed.ok, true)
  assert.equal(renamed.dialogue.title, 'Kettle at dusk')
  assert.equal((await run({ action: 'list_dialogues' })).dialogues[0].title, 'Kettle at dusk')

  const deleted = await run({ action: 'delete_dialogue', id })
  assert.equal(deleted.ok, true)
  assert.equal(deleted.removed, true)
  assert.deepEqual((await run({ action: 'list_dialogues' })).dialogues, [])

  const file = await stored(home)
  assert.deepEqual(file.items, [], 'the dialogue left the library')
  assert.deepEqual(file.removed.map((entry) => `${entry.kind}:${entry.id}`), [`item:${id}`])
})

test('a dialogue with no title is named from its first turn', async () => {
  await scratch()
  const added = await run({ action: 'add_dialogue', text: 'A: Hi there.\nB: Hello.' })
  assert.equal(added.ok, true)
  assert.equal(added.dialogue.title, 'Hi there.', 'the speaker label is not the title')
})

test('the dictionary settings written by the tool read back unchanged', async () => {
  const home = await scratch()

  const before = await run({ action: 'get_settings' })
  assert.deepEqual(before.settings.dictionary, { show: 'both', chinese: 'iciba', english: 'wordnet' })
  assert.equal(before.stored, false, 'a fresh host holds no settings')

  const set = await run({ action: 'set_dictionary', show: 'zh', chinese: 'model' })
  assert.equal(set.ok, true)
  const after = await run({ action: 'get_settings' })
  assert.deepEqual(after.settings.dictionary, { show: 'zh', chinese: 'model', english: 'wordnet' })
  assert.equal(after.stored, true)
  assert.ok(after.updatedAt > 0)

  // The next call keeps what the first one chose.
  await run({ action: 'set_dictionary', show: 'en', english: 'collins' })
  assert.deepEqual((await run({ action: 'get_settings' })).settings.dictionary,
    { show: 'en', chinese: 'model', english: 'collins' })
  assert.equal((await stored(home)).settings.dictionary.chinese, 'model')

  // A value the panel does not offer changes nothing.
  const refused = await run({ action: 'set_dictionary', show: 'sideways' })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /show to be one of/)
  assert.equal((await stored(home)).settings.dictionary.show, 'en')
})

test('an unknown action comes back as an error, not a crash', async () => {
  await scratch()
  const refused = await run({ action: 'format_disk' })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /unknown action/)
  assert.deepEqual(refused.actions, ACTIONS)

  const missing = await run({})
  assert.equal(missing.ok, false)
  assert.match(missing.error, /unknown action/)
})

test('an action that cannot run answers with a reason and writes nothing', async () => {
  const home = await scratch()
  const refused = await run({ action: 'add_dialogue', text: '   ' })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /English text/)
  await assert.rejects(stored(home), 'no library file was created')
})
test('a panel save and a tool call keep one library', async () => {
  const home = await scratch()
  await run({ action: 'set_dictionary', show: 'zh' })
  await run({ action: 'add_word', word: 'lantern' })

  // The panel posts the library it holds; it carries no settings and no word of
  // the tool's, because it has not loaded them since the tool wrote them.
  const routes = new Map()
  const context = {
    effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
    webServer: { register: (route) => { routes.set(route.path, route); return () => {} } },
  }
  apply(context, {})
  const route = routes.get('/api-dsh-english-reader/store')
  assert.ok(route !== undefined, 'the store route is registered')
  const answered = { status: 200 }
  await route.handler({
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        state: { savedAt: Date.now(), items: [{ id: 'panel-1', title: 'From the panel', updatedAt: Date.now() }], words: [] },
      }))
    },
  }, {
    writeHead(status) { answered.status = status; return this },
    end() { return this },
  })
  assert.equal(answered.status, 200)

  // Nothing either side wrote was erased by the other.
  assert.deepEqual((await run({ action: 'list_words' })).words.map((entry) => entry.id), ['lantern'])
  assert.deepEqual((await run({ action: 'list_dialogues' })).dialogues.map((entry) => entry.id), ['panel-1'])
  assert.equal((await run({ action: 'get_settings' })).settings.dictionary.show, 'zh')
  assert.equal((await stored(home)).settings.dictionary.show, 'zh', 'the panel save kept the settings')
})

test('normalize_words strips punctuation and keeps the sentence it came from', async () => {
  const home = await scratch()
  const context = 'Put effort into fostering healthy relationships.'
  await run({ action: 'add_word', word: 'fostering', context })
  await run({ action: 'add_word', word: 'consequences.', context })
  await run({ action: 'add_word', word: 'crossroads,', context: 'At the crossroads, we chose.' })

  const before = await run({ action: 'list_words' })
  const contextBefore = before.words.find((entry) => entry.id === 'consequences')?.context

  const preview = await run({ action: 'normalize_words', dryRun: true })
  assert.equal(preview.changed, 2, 'both punctuated words are reported')
  assert.equal((await stored(home)).words.find((entry) => entry.id === 'consequences').word, 'consequences.', 'a dry run writes nothing')

  const applied = await run({ action: 'normalize_words' })
  assert.equal(applied.changed, 2)
  const after = await run({ action: 'list_words' })
  assert.deepEqual(after.words.map((entry) => entry.word).sort(), ['consequences', 'crossroads', 'fostering'])
  assert.equal(after.words.find((entry) => entry.id === 'consequences').context, contextBefore, 'the 原文 is untouched')
  assert.equal(after.words.find((entry) => entry.id === 'consequences').context, context)
  assert.equal(after.words.find((entry) => entry.id === 'crossroads').context, 'At the crossroads, we chose.')

  // A word that is nothing but punctuation is left alone, never emptied.
  await run({ action: 'add_word', word: 'word' })
  const library = await stored(home)
  library.words.push({ word: '...', id: 'x', context: 'Kept as it was.', addedAt: 1 })
  await (await import('../host/files.js')).writeStore(library)
  const skipped = await run({ action: 'normalize_words' })
  assert.equal(skipped.skipped.length, 1, 'the un-cleanable entry is reported, not deleted')
  assert.equal((await stored(home)).words.find((entry) => entry.id === 'x').word, '...')
})

test('list_folders resolves a name to the id a word carries', async () => {
  const home = await scratch()
  const files = await import('../host/files.js')
  const library = await files.readStore() ?? { savedAt: 0, items: [], words: [], removed: [] }
  await files.writeStore({
    ...library,
    folders: [
      { id: 'f1', name: '经济', kind: 'word', createdAt: 1 },
      { id: 'f2', name: '旅游', kind: 'dialogue', createdAt: 2 },
    ],
  })
  const all = await run({ action: 'list_folders' })
  assert.deepEqual(all.folders.map((folder) => folder.name).sort(), ['旅游', '经济'])
  const wordsOnly = await run({ action: 'list_folders', kind: 'word' })
  assert.deepEqual(wordsOnly.folders, [{ id: 'f1', name: '经济', kind: 'word', count: 0 }])

  // The id it reports is the one add_word accepts.
  await run({ action: 'add_word', word: 'tariff', folderId: wordsOnly.folders[0].id })
  const listed = await run({ action: 'list_words' })
  assert.equal(listed.words.find((entry) => entry.id === 'tariff').folderId, 'f1')
})

test('define_word answers from the configured dictionary', async () => {
  const home = await scratch()
  // No network in the fixture: the dictionary functions answer null, and the tool
  // reports the miss instead of pretending.
  const miss = await run({ action: 'define_word', word: 'unfindablewordfortest' })
  assert.equal(miss.ok, false)
  assert.match(miss.error, /not found/)
})

test('a word filed by name is created, stamped and counted', async () => {
  const home = await scratch()
  // A conversation knows the shelf by name, not by id: filing must not need a
  // listing first, and the folder does not exist yet.
  const added = await run({ action: 'add_word', word: 'tariff', folder: '25.12.1' })
  assert.equal(added.ok, true, added.error)
  assert.equal(added.folder.name, '25.12.1')
  assert.equal(added.folder.created, true, 'the folder was made by the filing')
  assert.equal(added.word.folder, '25.12.1')

  // The stamp is what survives a merge: without `folderAt`, a panel that never
  // saw the filing overwrites it on its next save.
  const file = await stored(home)
  const word = file.words.find((entry) => entry.id === 'tariff')
  assert.equal(word.folderId, added.folder.id)
  assert.ok(word.folderAt > 0, 'the filing carries the moment it happened')
  assert.deepEqual(file.folders.map((folder) => `${folder.kind}:${folder.name}`), ['word:25.12.1'])

  // Filing the same name again reuses the folder instead of making a second one.
  const again = await run({ action: 'add_word', word: 'quota', folder: '25.12.1' })
  assert.equal(again.folder.created, false)
  assert.equal(again.folder.id, added.folder.id)

  const folders = await run({ action: 'list_folders', kind: 'word' })
  assert.deepEqual(folders.folders, [{ id: added.folder.id, name: '25.12.1', kind: 'word', count: 2 }])
  assert.equal(folders.unfiled, 0, 'nothing is unclassified yet')

  // Names are matched without regard to case, and cannot be confused with an id.
  const same = await run({ action: 'move_words', word: 'tariff', folder: '25.12.1' })
  assert.equal(same.folder.id, added.folder.id)
  const refused = await run({ action: 'add_word', word: 'zebra', folderId: 'no-such-folder' })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /no word folder with the id/)
  assert.match(refused.error, /25\.12\.1/, 'the error says which folders do exist')
});

test('several words are added and filed in one call', async () => {
  const home = await scratch()
  const added = await run({
    action: 'add_words',
    words: ['revive', 'tackle', 'quota', 'revive'],
    context: 'They revive it.',
    folder: '26.6.2',
  })
  assert.equal(added.ok, true, added.error)
  assert.equal(added.added, 3, 'three words, the duplicate counted once')
  assert.equal(added.total, 3)
  assert.deepEqual(added.words.map((entry) => entry.word), ['revive', 'tackle', 'quota'])
  assert.equal(added.words[0].context, 'They revive it.', 'one context serves the batch')
  assert.equal(added.words[0].folder, '26.6.2')

  const moved = await run({ action: 'move_words', words: ['revive', 'quota', 'not-saved'], folder: '' })
  assert.equal(moved.ok, true, moved.error)
  assert.equal(moved.moved, 2)
  assert.deepEqual(moved.missing, ['not-saved'], 'a word that was never saved is reported, not invented')

  const listed = await run({ action: 'list_words', folder: '26.6.2' })
  assert.deepEqual(listed.words.map((entry) => entry.word), ['tackle'])
  assert.equal(listed.total, 1)
  assert.equal((await run({ action: 'list_words' })).total, 3)

  // Unclassified is where a move to no folder leaves an entry, and it stays so.
  const file = await stored(home)
  const unfiled = file.words.filter((entry) => entry.folderId === '')
  assert.deepEqual(unfiled.map((entry) => entry.id).sort(), ['quota', 'revive'])
  assert.ok(unfiled.every((entry) => entry.folderAt > 0), 'a move out of a folder is a move too')
});

test('a dialogue can be created in a folder and moved between them', async () => {
  const home = await scratch()
  const added = await run({ action: 'add_dialogue', text: 'A: The kettle is on.\nB: Then we wait.', title: 'Kettle', folder: '25.12.1' })
  assert.equal(added.ok, true, added.error)
  assert.equal(added.folder.name, '25.12.1')
  assert.equal(added.dialogue.folder, '25.12.1')
  const id = added.dialogue.id

  const moved = await run({ action: 'move_dialogue', id, folder: '26.6.2' })
  assert.equal(moved.ok, true, moved.error)
  assert.equal(moved.dialogue.folder, '26.6.2')
  assert.equal(moved.folder.created, true, 'the second shelf was created by the move')

  // The title is enough when a conversation does not hold the id.
  const byTitle = await run({ action: 'move_dialogue', title: 'Kettle', folder: '25.12.1' })
  assert.equal(byTitle.ok, true, byTitle.error)
  assert.equal(byTitle.dialogue.folder, '25.12.1')

  const folders = await run({ action: 'list_folders', kind: 'dialogue' })
  assert.deepEqual(folders.folders.map((folder) => `${folder.name}:${folder.count}`).sort(), ['25.12.1:1', '26.6.2:0'])
  assert.equal((await run({ action: 'list_dialogues', folder: '26.6.2' })).total, 0)
  assert.equal((await run({ action: 'list_dialogues', folder: '25.12.1' })).total, 1)

  const wordFolders = await run({ action: 'list_folders', kind: 'word' })
  assert.deepEqual(wordFolders.folders, [], 'a dialogue folder is not a word folder')

  // The move is stamped, or a panel that never saw it would undo it.
  const file = await stored(home)
  assert.ok(file.items[0].folderAt > 0)
});

test('folders are made once, by name, for one list at a time', async () => {
  await scratch()
  const first = await run({ action: 'create_folder', name: '经济', kind: 'word' })
  assert.equal(first.created, true)
  assert.equal(first.folder.kind, 'word')

  const again = await run({ action: 'create_folder', name: '经济', kind: 'word' })
  assert.equal(again.created, false, 'the same name is one folder')
  assert.equal(again.folder.id, first.folder.id)

  // The other list keeps its own folder of the same name.
  const other = await run({ action: 'create_folder', name: '经济', kind: 'dialogue' })
  assert.equal(other.created, true)
  assert.notEqual(other.folder.id, first.folder.id)

  const refused = await run({ action: 'create_folder', name: '   ' })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /needs a name/)
});

test('a move the tool writes survives a panel save that never saw it', async () => {
  // The host merges by stamp, and filing does not change any of them. This is
  // the bug the user hit: 43 words filed by hand were back to unclassified.
  const home = await scratch()
  await run({ action: 'add_word', word: 'dream', context: 'The dream returns.' })
  await run({ action: 'move_words', word: 'dream', folder: '25.12.1' })
  const folderId = (await run({ action: 'list_folders', kind: 'word' })).folders[0].id

  const files = await import('../host/files.js')
  const library = await files.readStore()
  assert.equal(library.words[0].folderId, folderId)

  // A panel that has never seen the filing posts its own copy, with the same
  // addedAt and no folder at all.
  const stale = {
    savedAt: Date.now(),
    items: [],
    words: [{ id: 'dream', word: 'dream', context: 'The dream returns.', addedAt: library.words[0].addedAt }],
  }
  const merged = files.mergeStore(library, stale)
  assert.equal(merged.words[0].folderId, folderId, 'the stamp kept the filing')

  await files.writeStore(merged)
  assert.equal((await run({ action: 'list_words' })).words[0].folder, '25.12.1')
  assert.ok(home.length > 0)
});
