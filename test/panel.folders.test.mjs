/**
 * Folders for the dialogue library and the saved words.
 *
 * The two lists share one folder bar and one storage shape: a folder is
 * `{ id, name, kind, createdAt }`, an entry points at it with `folderId`, and a
 * deleted folder travels as a tombstone. These tests drive the real panel, so a
 * bar that renders but never filters fails here instead of in the app.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launchPanel } from './harness.mjs'

const STATE = {
  version: 3,
  activeId: 'doc-1',
  items: [
    { id: 'doc-1', title: 'Reviving a dream', text: 'They revive it.\nThe dream returns.', index: 0, mode: 'article', createdAt: 1, updatedAt: 1 },
    { id: 'doc-2', title: 'Second dialogue', text: 'A: Hello.\nB: Hi.', index: 0, mode: 'dialogue', createdAt: 2, updatedAt: 2 },
  ],
  words: [
    { id: 'dream', word: 'dream', context: 'The dream returns.', senses: [], translation: [], addedAt: 2 },
    { id: 'revive', word: 'revive', context: '', senses: [], translation: [], addedAt: 1 },
  ],
}

/** The two pages that carry a folder bar. */
async function openLibrary(api) {
  await api.click(api.q('button.er-glyph[title="Library"]'))
}

async function openWords(api) {
  await api.click(api.q('button.er-glyph[title="Saved words"]'))
}

const chips = (api) => api.qa('.er-folders .er-folder-chip')
const chipTexts = (api) => chips(api).map((node) => node.textContent.trim())
/** `all`, `''` (unclassified), or a folder id. */
const chip = (api, key) => api.q(`.er-folders .er-folder-chip[data-folder="${key}"]`)
/** The id of the chip that carries a folder's name. */
const chipByText = (api, name) => {
  const found = chips(api).find((node) => node.textContent.trim() === name)
  assert.ok(found !== undefined, `the bar shows the folder "${name}"`)
  return found.getAttribute('data-folder')
}
const folderIds = (api) => chips(api)
  .map((node) => node.getAttribute('data-folder'))
  .filter((key) => key !== 'all' && key !== '')
const rowTitles = (api) => api.qa('.er-entry .er-entry-title').map((node) => node.textContent.trim())
const wordTitles = (api) => api.qa('.er-wrow .er-entry-title').map((node) => node.textContent.trim())

/** Create a folder in the bar of the page on screen, and hand back its id. */
async function createFolder(api, name) {
  const add = api.q('.er-folders .er-folder-new')
  assert.ok(add !== null, 'the folder bar offers a New folder button')
  await api.click(add)
  assert.ok(api.q('.er-folders .er-folder-input') !== null, 'the name field appeared in place')
  await api.type(api.q('.er-folders .er-folder-input'), name)
  await api.key(api.q('.er-folders .er-folder-input'), 'Enter')
  assert.ok(api.q('.er-folders .er-folder-input') === null, 'Enter closes the name field')
  const created = chips(api).find((node) => node.textContent.trim() === name)
  assert.ok(created !== undefined, `the new folder "${name}" is in the bar`)
  return created.getAttribute('data-folder')
}

/** The row of one dialogue or word, found by its title. */
function rowFor(api, selector, title) {
  return api.qa(selector).find((node) => node.querySelector('.er-entry-title')?.textContent.trim() === title) ?? null
}

/** Open a row's picker and choose a folder in it. */
async function moveRow(api, selector, title, folderId) {
  const row = rowFor(api, selector, title)
  assert.ok(row !== null, `the row "${title}" is on screen`)
  const move = row.querySelector('button[aria-label="Move to folder"]')
  assert.ok(move !== null, 'every row offers a Move to folder button')
  await api.click(move)
  const select = api.q('.er-move select')
  assert.ok(select !== null, 'the picker opened under the row')
  assert.ok([...select.options].some((option) => option.value === folderId), 'the folder is offered by the picker')
  await api.choose(select, folderId)
  assert.equal(api.q('.er-move select'), null, 'choosing closes the picker')
}

test('a new folder appears in the filter bar of its own list', async () => {
  const api = await launchPanel({ state: STATE })
  try {
    await openLibrary(api)
    assert.deepEqual(chipTexts(api), ['All', 'Uncategorized'], 'a list with no folders shows both fixed chips')
    const id = await createFolder(api, 'Study')
    assert.ok(id !== '' && id !== 'all', 'the folder has an id of its own')
    assert.deepEqual(chipTexts(api), ['All', 'Study', 'Uncategorized'])
    assert.equal(chip(api, id).getAttribute('aria-pressed'), 'false', 'a new folder is not the current filter')

    // Folders are typed: a dialogue folder is not offered on the words page.
    await openWords(api)
    assert.deepEqual(chipTexts(api), ['All', 'Uncategorized'], 'the words page has its own folders')
    assert.deepEqual(folderIds(api), [])
    assert.deepEqual(api.errors, [])
  } finally {
    await api.unmount()
  }
})

test('a dialogue filed in a folder shows there, in All, and not in Uncategorized', async () => {
  const api = await launchPanel({ state: STATE })
  try {
    await openLibrary(api)
    const id = await createFolder(api, 'Study')
    await moveRow(api, '.er-entry', 'Reviving a dream', id)

    await api.click(chip(api, id))
    assert.equal(chip(api, id).getAttribute('aria-pressed'), 'true', 'the chip shows it is the filter')
    assert.deepEqual(rowTitles(api), ['Reviving a dream'], 'only the filed dialogue is listed')

    await api.click(chip(api, 'all'))
    assert.deepEqual(rowTitles(api).sort(), ['Reviving a dream', 'Second dialogue'], 'All still lists everything')

    await api.click(chip(api, ''))
    assert.deepEqual(rowTitles(api), ['Second dialogue'], 'the filed dialogue is no longer uncategorized')

    // Filtering narrows the list; it must not turn a row read-only. The same
    // row is renamed and then deleted without leaving its folder first.
    await api.click(chip(api, id))
    await api.click(api.q('.er-entry button[aria-label="Rename"]'))
    const nameField = api.q('.er-entry input')
    assert.ok(nameField !== null, 'a row inside a folder can still be renamed')
    await api.type(nameField, 'Reviving it')
    await api.key(api.q('.er-entry input'), 'Enter')
    assert.deepEqual(rowTitles(api), ['Reviving it'], 'the renamed dialogue stayed in the folder')

    await api.click(api.q('.er-entry .er-entry-del'))
    await api.click(api.q('.er-entry .er-entry-del'))
    assert.deepEqual(rowTitles(api), [], 'a row inside a folder can still be deleted')
    assert.equal(api.text('.er-empty'), 'No dialogue in this folder yet.')

    // An empty folder says so instead of showing a blank page.
    const empty = await createFolder(api, 'Empty')
    await api.click(chip(api, empty))
    assert.deepEqual(rowTitles(api), [])
    assert.equal(api.text('.er-empty'), 'No dialogue in this folder yet.')

    await api.click(chip(api, 'all'))
    assert.deepEqual(rowTitles(api), ['Second dialogue'], 'the deleted dialogue is gone from All too')
  } finally {
    await api.unmount()
  }
})

test('a saved word filed in a folder shows there, in All, and not in Uncategorized', async () => {
  const api = await launchPanel({ state: STATE })
  try {
    await openWords(api)
    const id = await createFolder(api, 'Verbs')
    assert.deepEqual(chipTexts(api), ['All', 'Verbs', 'Uncategorized'])
    await moveRow(api, '.er-wrow', 'revive', id)

    await api.click(chip(api, id))
    assert.deepEqual(wordTitles(api), ['revive'], 'only the filed word is listed')

    // Filtering must not make a row read-only: it still expands in place.
    await api.click(api.q('.er-wrow .er-entry-open'))
    assert.ok(api.q('.er-wrow-body') !== null, 'a row inside a folder still expands')

    await api.click(chip(api, 'all'))
    assert.deepEqual(wordTitles(api).sort(), ['dream', 'revive'], 'All still lists every word')

    await api.click(chip(api, ''))
    assert.deepEqual(wordTitles(api), ['dream'], 'the filed word is no longer uncategorized')

    // The text filter and the folder filter narrow together instead of fighting.
    await api.click(chip(api, id))
    await api.type(api.q('.er-words-bar input'), 'zzz')
    assert.deepEqual(wordTitles(api), [])
    assert.equal(api.text('.er-empty'), 'Nothing matches that filter.')
    assert.deepEqual(api.errors, [])
  } finally {
    await api.unmount()
  }
})

test('deleting a folder returns its entries to Uncategorized instead of losing them', async () => {
  const api = await launchPanel({ state: STATE })
  try {
    await openLibrary(api)
    const id = await createFolder(api, 'Study')
    await moveRow(api, '.er-entry', 'Reviving a dream', id)
    await api.click(chip(api, id))
    assert.deepEqual(rowTitles(api), ['Reviving a dream'])

    // Deleting takes two clicks, the same way deleting a dialogue does.
    await api.click(api.q('.er-folder-tools button[aria-label="Delete folder"]'))
    assert.equal(api.qa('.er-folder-chip').length, 3, 'the first click only asks')
    await api.click(api.q('.er-folder-tools button[aria-label="Delete folder"]'))

    assert.deepEqual(chipTexts(api), ['All', 'Uncategorized'], 'the deleted folder is gone from the bar')
    assert.equal(chip(api, id), null)
    assert.deepEqual(rowTitles(api).sort(), ['Reviving a dream', 'Second dialogue'], 'the bar falls back to everything')

    await api.click(chip(api, ''))
    const unclassified = rowTitles(api)
    assert.ok(unclassified.includes('Reviving a dream'), 'the dialogue is unclassified, not deleted')
    assert.deepEqual(unclassified.sort(), ['Reviving a dream', 'Second dialogue'], 'the folder ref reads as unclassified')
  } finally {
    await api.unmount()
  }
})

test('an entry filed under a folder that is gone reads as unclassified and keeps its id', async () => {
  // A state written before folders existed has no `folders` at all; one written
  // elsewhere can name a folder this browser never saw. Either way the entry is
  // listed as unclassified, and the reference is kept so a folder that comes
  // back still finds it.
  const orphaned = {
    ...STATE,
    items: [{ ...STATE.items[0], folderId: 'no-such-folder' }, STATE.items[1]],
    words: [{ ...STATE.words[0], folderId: 'no-such-folder' }, STATE.words[1]],
  }
  const api = await launchPanel({ state: orphaned })
  try {
    await openLibrary(api)
    assert.deepEqual(chipTexts(api), ['All', 'Uncategorized'], 'a missing folder adds no chip')
    await api.click(chip(api, ''))
    assert.deepEqual(rowTitles(api).sort(), ['Reviving a dream', 'Second dialogue'], 'the orphaned dialogue reads as unclassified')

    await openWords(api)
    await api.click(chip(api, ''))
    assert.deepEqual(wordTitles(api).sort(), ['dream', 'revive'], 'the orphaned word reads as unclassified')

    await new Promise((resolve) => setTimeout(resolve, 450))
    await api.settle()
    const saved = JSON.parse(window.localStorage.getItem('dsh-english-reader:state:v2'))
    assert.equal(saved.items.find((item) => item.id === 'doc-1').folderId, 'no-such-folder', 'the dialogue keeps its reference')
    assert.equal(saved.words.find((word) => word.id === 'dream').folderId, 'no-such-folder', 'the word keeps its reference')
  } finally {
    await api.unmount()
  }
})

test('folders and the filing survive a reload of the same state', async () => {
  const api = await launchPanel({ state: STATE })
  let saved = null
  try {
    await openLibrary(api)
    const dialogueFolder = await createFolder(api, 'Study')
    await moveRow(api, '.er-entry', 'Reviving a dream', dialogueFolder)
    await openWords(api)
    const wordFolder = await createFolder(api, 'Verbs')
    await moveRow(api, '.er-wrow', 'revive', wordFolder)

    // The panel writes its state on a short debounce; the last write is on unmount.
    await new Promise((resolve) => setTimeout(resolve, 450))
    await api.settle()
    saved = JSON.parse(window.localStorage.getItem('dsh-english-reader:state:v2'))
    assert.ok(Array.isArray(saved.folders), 'the panel stores folders with the library')
    assert.deepEqual(saved.folders.map((folder) => folder.name).sort(), ['Study', 'Verbs'])
    assert.equal(saved.items.find((item) => item.id === 'doc-1').folderId, dialogueFolder)
    assert.equal(saved.words.find((word) => word.id === 'revive').folderId, wordFolder)
  } finally {
    await api.unmount()
  }

  // What the reload reads: the same state, as a fresh browser session would.
  const again = await launchPanel({ state: saved })
  try {
    await openLibrary(again)
    assert.deepEqual(chipTexts(again), ['All', 'Study', 'Uncategorized'], 'the dialogue folder came back')
    await again.click(chip(again, chipByText(again, 'Study')))
    assert.deepEqual(rowTitles(again), ['Reviving a dream'], 'the dialogue is still filed')

    await openWords(again)
    assert.deepEqual(chipTexts(again), ['All', 'Verbs', 'Uncategorized'], 'the word folder came back')
    await again.click(chip(again, chipByText(again, 'Verbs')))
    assert.deepEqual(wordTitles(again), ['revive'], 'the word is still filed')
    assert.deepEqual(again.errors, [])
  } finally {
    await again.unmount()
  }
})