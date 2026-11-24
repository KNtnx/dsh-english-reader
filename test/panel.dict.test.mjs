/**
 * The dictionary, driven the way a reader drives it: right-click a word, save
 * it, open it again from the saved list.
 *
 * These are the cases that kept breaking: the panel keeps the entry the card
 * shows in the same state as the entry a saved word expands, so one can quietly
 * overwrite the other.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launchPanel, FIXTURE_STATE, wordSpan } from './harness.mjs'

/** A saved word, so the words page has a row to expand. */
const SAVED_DREAM = {
  ...FIXTURE_STATE,
  words: [{ id: 'dream', word: 'dream', context: '', senses: [], translation: [], addedAt: 1 }],
}

/** Open the words page, expand one saved row, and come back to the dialogue. */
async function expandSavedWord(api, word) {
  const wordsButton = api.q('button.er-glyph[title="Saved words"]')
  assert.ok(wordsButton !== null, 'the header has a saved-words button')
  await api.click(wordsButton)
  const head = api.qa('.er-wrow .er-entry-open')
    .find((node) => node.textContent.includes(word))
  assert.ok(head !== undefined, `the saved list has a row for ${word}`)
  await api.click(head)
  const back = api.q('.er-back-row')
  assert.ok(back !== null, 'the words page has a way back')
  await api.click(back)
}

test('a right-click shows the word that was clicked', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    assert.ok(api.qa('.er-w').length > 0, 'the sentence on screen is split into word spans')
    await api.rightClick(wordSpan(api, 'revive'))
    assert.equal(api.text('.er-wordcard-word'), 'revive')
    assert.match(api.text('.er-wordcard-body'), /bring back to life/)
  } finally {
    await api.unmount()
  }
})

test('a saved word expanded in the list does not hijack the next lookup', async () => {
  const api = await launchPanel({ state: SAVED_DREAM })
  try {
    await expandSavedWord(api, 'dream')
    await api.rightClick(wordSpan(api, 'revive'))
    // The reported bug: the card came up with "dream" — the word left open in
    // the saved list — and only a second right-click showed "revive".
    assert.equal(api.text('.er-wordcard-word'), 'revive')
    assert.match(api.text('.er-wordcard-body'), /bring back to life/)
    assert.doesNotMatch(api.text('.er-wordcard-body'), /imaginary events/)
  } finally {
    await api.unmount()
  }
})

test('expanding a saved word still shows its own entry', async () => {
  const api = await launchPanel({ state: SAVED_DREAM })
  try {
    const wordsButton = api.q('button.er-glyph[title="Saved words"]')
    await api.click(wordsButton)
    await api.click(api.qa('.er-wrow .er-entry-open')[0])
    const body = api.text('.er-wrow-body')
    assert.match(body, /imaginary events/, 'the expansion shows the English entry')
    assert.match(body, /梦/, 'the expansion shows the Chinese entry')
  } finally {
    await api.unmount()
  }
})

test('saving a word from the card adds it to the list, once', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    await api.rightClick(wordSpan(api, 'revive'))
    const save = api.qa('.er-add').find((node) => node.textContent.includes('Save word'))
    assert.ok(save !== undefined, 'the card offers to save the word')
    await api.click(save)
    assert.equal(save.textContent.trim(), 'Saved', 'the same card now says it is saved')
    await api.click(api.q('button.er-glyph[title="Saved words"]'))
    const rows = api.qa('.er-wrow .er-entry-title').map((node) => node.textContent.trim())
    assert.deepEqual(rows, ['revive'])
  } finally {
    await api.unmount()
  }
})

test('a slow answer never lands on top of a newer lookup', async () => {
  // "they" is answered 80ms late; "revive" right after is instant. Without a
  // sequence guard the late answer would repaint the card with the old word.
  const api = await launchPanel({ state: FIXTURE_STATE, host: { latency: { they: 80 } } })
  try {
    await api.rightClick(wordSpan(api, 'they'))
    await api.rightClick(wordSpan(api, 'revive'))
    await api.waitFor(() => api.text('.er-wordcard-word') === 'revive', { label: 'the second word' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await api.settle()
    assert.equal(api.text('.er-wordcard-word'), 'revive', 'the late answer for "they" was dropped')
    assert.match(api.text('.er-wordcard-body'), /bring back to life/)
  } finally {
    await api.unmount()
  }
})

test('the dictionary button opens a card that can look up a typed word', async () => {
  const api = await launchPanel({ state: SAVED_DREAM })
  try {
    // The saved word stays expanded while the pinned card is used; the two must
    // not write over each other.
    await api.click(api.q('button.er-glyph[title="Saved words"]'))
    await api.click(api.qa('.er-wrow .er-entry-open')[0])
    await api.click(api.q('.er-back-row'))
    await api.click(api.q('.er-display-dict'))
    const input = api.q('.er-wordcard input')
    assert.ok(input !== null, 'the pinned card has a word box')
    await api.type(input, 'revive')
    await api.key(input, 'Enter')
    await api.waitFor(() => api.text('.er-wordcard-body').includes('bring back to life'), { label: 'the typed word' })
    assert.equal(api.text('.er-wordcard-word'), '', 'a pinned card shows the box, not the old word')
  } finally {
    await api.unmount()
  }
})

test('leaving the dialogue closes the floating card', async () => {
  const api = await launchPanel({ state: SAVED_DREAM })
  try {
    await api.rightClick(wordSpan(api, 'revive'))
    assert.equal(api.text('.er-wordcard-word'), 'revive')
    // The saved words page is a different view: a card pointing at a sentence
    // from the dialogue would float over the list and cover its rows.
    await api.click(api.q('button.er-glyph[title="Saved words"]'))
    assert.equal(api.q('.er-wordcard'), null, 'the card did not follow the reader to the list')
  } finally {
    await api.unmount()
  }
})

test('changing the dictionary refreshes the expanded saved word', async () => {
  const api = await launchPanel({ state: SAVED_DREAM })
  try {
    await api.click(api.q('button.er-glyph[title="Saved words"]'))
    await api.click(api.qa('.er-wrow .er-entry-open')[0])
    assert.match(api.text('.er-wrow-body'), /imaginary events/)
    const asked = () => api.host.calls
      .filter((call) => call.path.endsWith('/dict') && call.search.includes('wiktionary')).length
    assert.equal(asked(), 0, 'Wiktionary was not asked while the other source was selected')
    // Switch the English slot to Wiktionary: the expansion must be fetched again,
    // not left on the previous source's answer.
    await api.click(api.q('.er-capsule'))
    const section = api.qa('.er-sect-toggle').find((node) => node.textContent.includes('Dictionary'))
    assert.ok(section !== undefined, 'the settings card has a dictionary section')
    await api.click(section)
    const select = api.qa('.er-sect-body select').find((node) => [...node.options].some((option) => option.value === 'wiktionary'))
    assert.ok(select !== undefined, 'the settings card offers a dictionary per language')
    await api.choose(select, 'wiktionary')
    assert.equal(asked(), 1, 'the open word was resolved again through the new source')
    assert.match(api.text('.er-wrow-body'), /imaginary events/, 'the expansion still shows the entry')
  } finally {
    await api.unmount()
  }
})

test('a word saved in another session is already in the list', async () => {
  // What the host holds is what every conversation sees; this browser has never
  // saved anything.
  const api = await launchPanel({
    state: FIXTURE_STATE,
    host: { store: { savedAt: 1, items: [], words: [{ id: 'lantern', word: 'lantern', addedAt: 1 }] } },
  })
  try {
    await api.click(api.q('button.er-glyph[title="Saved words"]'))
    assert.deepEqual(api.texts('.er-wrow .er-entry-title'), ['lantern'])
  } finally {
    await api.unmount()
  }
})

test('saving a word writes it to the shared library on the host', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    await api.rightClick(wordSpan(api, 'revive'))
    const save = api.qa('.er-add').find((node) => node.textContent.includes('Save word'))
    await api.click(save)
    // The state write and the store write are both debounced, so this settles a
    // little after the click rather than inside it.
    await api.waitFor(() => api.host.store?.words?.length === 1, {
      timeout: 4000, label: 'the shared library on the host',
    })
    const posted = api.host.calls.filter((call) => call.path === '/api-dsh-english-reader/store' && call.method === 'POST')
    assert.ok(posted.length > 0, 'the panel posted the shared half to the host')
    assert.deepEqual(api.host.store.words.map((word) => word.id), ['revive'])
  } finally {
    await api.unmount()
  }
})

const TACKLE_ROW = {
  ...FIXTURE_STATE,
  words: [{ id: 'tackle', word: 'tackle', context: '', senses: [], translation: [], addedAt: 1 }],
  aiEntries: {
    'tackle|wordnet': {
      word: 'tackle', phonetic: '',
      senses: [{ pos: 'n', def: '(sports, countable) A play where a player takes the ball', example: '' }],
      translation: [], source: 'wordnet',
    },
  },
}

test('Chinese-only mode never prints an English gloss in the list', async () => {
  const api = await launchPanel({ state: { ...TACKLE_ROW, dictShow: 'zh' } })
  try {
    await api.click(api.q('button.er-glyph[title="Saved words"]'))
    assert.equal(api.text('.er-wrow .er-entry-meta'), 'No definition stored',
      'the English definition was cached, but this mode does not show English')
  } finally {
    await api.unmount()
  }
})

test('with both languages the list prefers the Chinese gloss', async () => {
  const state = {
    ...TACKLE_ROW,
    dictShow: 'both',
    aiEntries: {
      ...TACKLE_ROW.aiEntries,
      'tackle|iciba': {
        word: 'tackle', phonetic: '', senses: [],
        translation: [{ pos: 'v', def: '着手处理；应付' }], source: 'iciba',
      },
    },
  }
  const api = await launchPanel({ state })
  try {
    await api.click(api.q('button.er-glyph[title="Saved words"]'))
    assert.equal(api.text('.er-wrow .er-entry-meta'), '着手处理；应付')
  } finally {
    await api.unmount()
  }
})

test('a model-written entry is found by the list, not only by the card', async () => {
  // The model slot caches under `word|model|<provider>/<model>`. The list used to
  // look under `word|model`, so it never saw the answer and printed the other
  // language's gloss instead.
  const state = {
    ...FIXTURE_STATE,
    dictShow: 'both',
    dictCn: 'model',
    dictModelCn: { provider: 'test-provider', model: 'test-model' },
    words: [{ id: 'tackle', word: 'tackle', context: '', senses: [], translation: [], addedAt: 1 }],
    aiEntries: {
      'tackle|wordnet': {
        word: 'tackle', phonetic: '',
        senses: [{ pos: 'n', def: '(sports, countable) A play where a player takes the ball', example: '' }],
        translation: [], source: 'wordnet',
      },
      'tackle|model|test-provider/test-model': {
        word: 'tackle', phonetic: '', senses: [],
        translation: [{ pos: 'v', def: '着手处理；应付' }], source: 'model',
      },
    },
  }
  const api = await launchPanel({ state })
  try {
    await api.click(api.q('button.er-glyph[title="Saved words"]'))
    assert.equal(api.text('.er-wrow .er-entry-meta'), '着手处理；应付')
  } finally {
    await api.unmount()
  }
})
