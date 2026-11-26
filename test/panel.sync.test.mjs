/**
 * The panel keeping up with a library that changed somewhere else.
 *
 * A conversation can file words through `english_reader`, and a second panel can
 * write the same file. The panel used to learn about either only on reload, so
 * these tests say what the user sees while the page stays open.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { internals, launchPanel, wordSpan } from './harness.mjs'

// Every panel in this file asks the host on a timer; two seconds is the real
// answer to "how soon does the user see it", and far too long for a test.
internals.sync.pollMs = 20

const STATE = {
  version: 3,
  activeId: 'doc-1',
  items: [{ id: 'doc-1', title: 'Reviving a dream', text: 'They revive it.\nThe dream returns.', index: 0, mode: 'article', createdAt: 1, updatedAt: 1 }],
  words: [{ id: 'dream', word: 'dream', context: 'The dream returns.', senses: [], translation: [], addedAt: 2 }],
}

/** The words page, where a changed word list is plain to see. */
async function openWords(api) {
  await api.click(api.q('button.er-glyph[title="Saved words"]'))
}

const wordTitles = (api) => api.qa('.er-wrow .er-entry-title').map((node) => node.textContent.trim())

/**
 * What the host holds. The panel boots from `localStorage` in these tests, so the
 * host starts empty — writing this is what a tool call or a second panel does.
 */
const HOST_STATE = { savedAt: 1, items: STATE.items, words: STATE.words, folders: [], removed: [] }

/** The store reads the panel made, which is how "it caught up" is measured. */
const storeReads = (api) => api.host.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/store')).length

test('a word filed elsewhere appears without a reload', async () => {
  const api = await launchPanel({ state: STATE })
  try {
    await openWords(api)
    assert.deepEqual(wordTitles(api), ['dream'])

    // A tool call writes the same file the panel reads.
    api.host.write({
      ...HOST_STATE,
      words: [...HOST_STATE.words, { id: 'lantern', word: 'lantern', addedAt: 9, senses: [], translation: [] }],
    })
    await api.waitFor(() => wordTitles(api).includes('lantern'), { label: 'the word a tool call saved' })
    assert.equal(wordTitles(api).length, 2, 'the panel kept what it had and took the new word')
  } finally {
    await api.unmount()
  }
})

test('a word deleted elsewhere leaves the panel without a reload', async () => {
  const api = await launchPanel({ state: STATE })
  try {
    await openWords(api)
    assert.deepEqual(wordTitles(api), ['dream'])

    // The panel deleted "dream" from another window: a tombstone travels, so a
    // copy that never saw the deletion cannot put it back.
    api.host.write({ ...HOST_STATE, words: [], removed: [{ kind: 'word', id: 'dream', at: 99 }] })
    await api.waitFor(() => wordTitles(api).length === 0, { label: 'the word to disappear' })
  } finally {
    await api.unmount()
  }
})

test('the panel does not pull its own save back', async () => {
  // The pool of revisions is what keeps this from looping: a save records the
  // revision it produced, so the next check finds "nothing new" and stops. A
  // panel that forgot would re-read the whole library after every save.
  const api = await launchPanel({ state: STATE })
  try {
    // The panel saves once on its own after mounting; that save is over before
    // the window this test measures.
    await api.idle(600)
    const settled = storeReads(api)

    await api.rightClick(wordSpan(api, 'revive'))
    const save = api.qa('.er-add').find((node) => node.textContent.includes('Save word'))
    await api.click(save)
    await api.waitFor(() => (api.host.store?.words ?? []).some((word) => word.id === 'revive'),
      { timeout: 4000, label: "the panel's own save" })

    // Ten rounds of the check the panel runs on its own timer.
    await api.idle(200)
    assert.equal(storeReads(api), settled, 'a write of its own is not news to the panel')
  } finally {
    await api.unmount()
  }
})

test('a save the host had to correct is read back at once', async () => {
  // A panel can hold a library the host does not: it never saw the tool call that
  // filed a word, or the deletion of one. Its own save then gets merged, and the
  // answer says so — otherwise the browser would keep showing a library nobody
  // else has until the page is reloaded.
  const api = await launchPanel({ state: STATE })
  // Out of reach: this test is about what the save's answer does, not the timer.
  const poll = internals.sync.pollMs
  internals.sync.pollMs = 100000
  try {
    await api.idle(600)
    // The host holds a word this browser has never seen.
    api.host.write({
      ...HOST_STATE,
      words: [...HOST_STATE.words, { id: 'lantern', word: 'lantern', addedAt: 9, senses: [], translation: [] }],
    })

    await api.rightClick(wordSpan(api, 'revive'))
    const save = api.qa('.er-add').find((node) => node.textContent.includes('Save word'))
    await api.click(save)
    await api.waitFor(() => api.host.writes > 0, { timeout: 4000, label: "the panel's save" })

    await openWords(api)
    await api.waitFor(() => wordTitles(api).includes('lantern'),
      { label: 'the word the host corrected in' })
    assert.ok(wordTitles(api).includes('revive'), 'what the panel saved is there as well')
  } finally {
    internals.sync.pollMs = poll
    await api.unmount()
  }
})

test('a dictionary chosen on the host shows up in the panel', async () => {
  const api = await launchPanel({ state: STATE })
  try {
    api.host.write({
      ...HOST_STATE,
      settings: { dictionary: { show: 'zh', chinese: 'model', english: 'collins' }, updatedAt: 99 },
    })
    // The settings card only exists once opened; the choice lives in the panel's
    // state, which the card renders.
    const capsule = api.q('.er-capsule')
    assert.ok(capsule !== null, 'the header has the settings capsule')
    await api.click(capsule)
    await api.waitFor(() => api.q('.er-card') !== null, { label: 'the settings card' })

    const dictionary = api.qa('.er-sect-toggle').find((node) => node.textContent.includes('Dictionary'))
    assert.ok(dictionary !== undefined, 'the card has a dictionary section')
    if (dictionary.getAttribute('aria-expanded') !== 'true') await api.click(dictionary)

    const english = api.qa('.er-sect-body select').find((select) => [...select.options].some((option) => option.value === 'collins'))
    const chinese = api.qa('.er-sect-body select').find((select) => [...select.options].some((option) => option.value === 'iciba'))
    assert.equal(english?.value, 'collins', 'the English slot followed the host')
    assert.equal(chinese?.value, 'model', 'the Chinese slot followed the host')
    const shown = api.qa('.er-sect-body [role="radio"][aria-checked="true"]').map((node) => node.textContent.trim())
    assert.ok(shown.includes('Chinese'), `the card shows what the host chose, got ${JSON.stringify(shown)}`)
  } finally {
    await api.unmount()
  }
})
