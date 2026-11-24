/**
 * Everything that is not the dictionary: the library, the reader, the saved
 * words list, the editor, and the settings card.
 *
 * The point of this file is breadth, not depth: every view is mounted and
 * clicked once, so a render-time crash (the class of bug that used to leave a
 * blank panel) fails a test instead of shipping.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launchPanel, FIXTURE_STATE } from './harness.mjs'

const SAVED = {
  ...FIXTURE_STATE,
  words: [
    { id: 'dream', word: 'dream', context: 'The dream returns.', senses: [], translation: [], addedAt: 2 },
    { id: 'revive', word: 'revive', context: '', senses: [], translation: [], addedAt: 1 },
  ],
}

function assertHealthy(api, where) {
  assert.doesNotMatch(api.container.textContent, /failed to render/, `${where}: the panel crashed`)
  assert.deepEqual(api.errors, [], `${where}: the panel logged a console error`)
}

test('the reader mounts a saved dialogue', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    assertHealthy(api, 'reader')
    assert.equal(api.text('.er-title'), 'Reviving a dream')
    assert.equal(api.qa('.er-passage').length, 2, 'both sentences are listed')
    assert.equal(api.q('.er-passage[aria-current="true"] .er-line').textContent, 'They revive it.')
  } finally {
    await api.unmount()
  }
})

test('next and previous move the sentence that is being read', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    const next = api.q('button[aria-label="Next sentence"]')
    assert.ok(next !== null, 'the transport has a next button')
    await api.click(next)
    assert.equal(api.q('.er-passage[aria-current="true"] .er-line').textContent, 'The dream returns.')
    assert.equal(api.text('.er-count'), '2 / 2')
    await api.click(api.q('button[aria-label="Previous sentence"]'))
    assert.equal(api.q('.er-passage[aria-current="true"] .er-line').textContent, 'They revive it.')
    assertHealthy(api, 'sentence stepper')
  } finally {
    await api.unmount()
  }
})

test('the reading position is remembered', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    await api.click(api.q('button[aria-label="Next sentence"]'))
    // The panel writes its state on a short debounce.
    await new Promise((resolve) => setTimeout(resolve, 450))
    await api.settle()
    const saved = JSON.parse(window.localStorage.getItem('dsh-english-reader:state:v2'))
    assert.equal(saved.items[0].index, 1, 'the next sentence was persisted')
  } finally {
    await api.unmount()
  }
})

test('the saved words list can be filtered', async () => {
  const api = await launchPanel({ state: SAVED })
  try {
    await api.click(api.q('button.er-glyph[title="Saved words"]'))
    assert.deepEqual(api.texts('.er-wrow .er-entry-title'), ['dream', 'revive'])
    await api.type(api.q('.er-words-bar input'), 'dre')
    assert.deepEqual(api.texts('.er-wrow .er-entry-title'), ['dream'])
    await api.type(api.q('.er-words-bar input'), 'zzz')
    assert.equal(api.q('.er-wrow'), null, 'no row matches a filter nothing satisfies')
    assertHealthy(api, 'saved words filter')
  } finally {
    await api.unmount()
  }
})

test('the library lists dialogues and opens one', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    await api.click(api.q('button.er-glyph[title="Library"]'))
    assert.equal(api.qa('.er-entry').length, 1)
    assert.match(api.text('.er-entry-title'), /Reviving a dream/)
    assert.equal(api.text('.er-entry-meta'), 'sentence 1 of 2', 'the library shows the remembered position')
    await api.click(api.q('.er-entry .er-entry-open'))
    assert.ok(api.q('.er-passage') !== null, 'opening an entry returns to the reader')
    assertHealthy(api, 'library')
  } finally {
    await api.unmount()
  }
})

test('the settings card opens, collapses, and closes with Escape', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    const capsule = api.q('.er-capsule')
    assert.ok(capsule !== null, 'the header names the speech source')
    await api.click(capsule)
    assert.ok(api.q('.er-card') !== null, 'the settings card opened')
    const dictSection = api.qa('.er-sect-toggle').find((node) => node.textContent.includes('Dictionary'))
    assert.ok(dictSection !== undefined)
    assert.equal(dictSection.getAttribute('aria-expanded'), 'false', 'sections start collapsed')
    await api.click(dictSection)
    assert.equal(dictSection.getAttribute('aria-expanded'), 'true')
    assert.ok(api.qa('.er-sect-body').some((node) => node.textContent.includes('Show')), 'the dictionary copy is shown')
    await api.key(api.q('.er-root'), 'Escape')
    assert.equal(api.q('.er-card'), null, 'Escape closed the settings card')
    assertHealthy(api, 'settings')
  } finally {
    await api.unmount()
  }
})

test('an empty panel starts in the editor and can become a dialogue', async () => {
  const api = await launchPanel({ state: { version: 3, items: [] } })
  try {
    const box = api.q('.er-textarea')
    assert.ok(box !== null, 'with nothing saved the panel asks for text')
    await api.type(box, 'A: Good morning.\nB: Good morning to you.')
    const start = api.qa('button').find((node) => node.textContent.trim() === 'Start reading')
    assert.ok(start !== undefined, 'the editor has a start button')
    assert.equal(start.disabled, false, 'with text in the box the button is enabled')
    await api.click(start)
    assert.equal(api.qa('.er-passage').length, 2, 'the pasted dialogue became sentences')
    assert.match(api.text('.er-passage[aria-current="true"]'), /Good morning/)
    assertHealthy(api, 'editor')
  } finally {
    await api.unmount()
  }
})

test('the engine section lists the speech sources without breaking the page', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    await api.click(api.q('.er-capsule'))
    const names = api.texts('.er-source-name')
    assert.ok(names.includes('Edge'), `the built-in source is listed: ${names.join(', ')}`)
    assert.ok(api.q('.er-passage') !== null, 'the dialogue is still on screen behind the card')
    assertHealthy(api, 'engine section')
  } finally {
    await api.unmount()
  }
})

test('the panel renders in Chinese as well as English', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE, locale: 'zh' })
  try {
    assert.equal(api.text('.er-title'), 'Reviving a dream', 'a stored title is not translated')
    assert.ok(api.q('button[aria-label="下一句"]') !== null, 'the transport speaks Chinese')
    await api.click(api.q('button.er-glyph[title="我的单词"]'))
    assert.ok(api.text('.er-words').includes('还没有收藏的单词'), 'the empty list is translated')
    assertHealthy(api, 'zh')
  } finally {
    await api.unmount()
  }
})

