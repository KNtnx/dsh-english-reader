/**
 * Sentence translation: which source produced the lines on screen, and what
 * happens to them when the reader switches source.
 *
 * The reader keeps one translation per dialogue, tagged with the source that
 * produced it. Switching source must replace the lines; showing the previous
 * source's answer is the bug this file guards.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launchPanel, FIXTURE_STATE, internals } from './harness.mjs'

const LINES = ['旧的翻译：第一句', '旧的翻译：第二句']

/** The panel state for a dialogue that already carries a translation. */
function stateWith(source, overrides = {}) {
  const item = FIXTURE_STATE.items[0]
  return {
    ...FIXTURE_STATE,
    showTranslation: true,
    translateSource: 'dsh',
    items: [{
      ...item,
      translation: {
        hash: internals.hashText(item.text),
        source,
        model: null,
        target: 'zh-CN',
        lines: LINES,
      },
    }],
    ...overrides,
  }
}

const translateCalls = (api) => api.host.calls.filter((call) => call.path === '/api-dsh-english-reader/translate')
const shownLines = (api) => api.texts('.er-trans')

test('a translation from another source is replaced on open', async () => {
  // The stored lines came from Google; the selected source is the DSH model.
  const api = await launchPanel({ state: stateWith('google') })
  try {
    await api.waitFor(() => shownLines(api).length === 2, { label: 'the translated dialogue' })
    assert.equal(translateCalls(api).length, 1, 'the panel asked the selected source')
    assert.deepEqual(shownLines(api), [
      '译[dsh]:They revive it.',
      '译[dsh]:The dream returns.',
    ])
    assert.ok(!shownLines(api).includes(LINES[0]), "the old source's lines are gone")
  } finally {
    await api.unmount()
  }
})

test('a translation from the selected source is reused, not refetched', async () => {
  const api = await launchPanel({ state: stateWith('dsh') })
  try {
    await api.settle()
    assert.deepEqual(shownLines(api), LINES, 'the stored lines are shown as they are')
    assert.equal(translateCalls(api).length, 0, 'nothing was requested again')
  } finally {
    await api.unmount()
  }
})

test('switching the source in the settings replaces the lines on screen', async () => {
  const api = await launchPanel({ state: stateWith('dsh') })
  try {
    assert.deepEqual(shownLines(api), LINES)
    await api.click(api.q('.er-capsule'))
    const section = api.qa('.er-sect-toggle').find((node) => node.textContent.includes('Translation'))
    assert.ok(section !== undefined, 'the settings card has a translation section')
    await api.click(section)
    const select = api.qa('.er-sect-body select').find((node) => [...node.options].some((option) => option.value === 'google'))
    assert.ok(select !== undefined, 'the translation source is a select')
    await api.click(select)
    await api.choose(select, 'google')
    await api.waitFor(() => shownLines(api)[0]?.startsWith('译[google]'), { label: 'the new source’s lines' })
    assert.deepEqual(shownLines(api), [
      '译[google]:They revive it.',
      '译[google]:The dream returns.',
    ])
    // Closing the settings leaves the replaced translation in place.
    await api.key(api.q('.er-root'), 'Escape')
    assert.equal(shownLines(api)[0], '译[google]:They revive it.')
  } finally {
    await api.unmount()
  }
})

test('a hidden translation is fetched from the new source when shown', async () => {
  const state = { ...stateWith('google'), showTranslation: false }
  const api = await launchPanel({ state })
  try {
    assert.deepEqual(shownLines(api), [], 'nothing is printed while translation is off')
    await api.click(api.q('button[aria-label="Show translation"]'))
    await api.waitFor(() => shownLines(api).length === 2, { label: 'the translation' })
    assert.equal(shownLines(api)[0], '译[dsh]:They revive it.', 'the newly selected source answered')
  } finally {
    await api.unmount()
  }
})