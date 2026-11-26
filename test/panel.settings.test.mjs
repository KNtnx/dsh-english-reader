/**
 * The settings card, and the controls that only run once it is open.
 *
 * These are the branches a reader reaches by opening one thing and then another
 * — the custom font size, the four sections, a Collins key, the folder picker —
 * so a helper left behind by a refactor only fails here. The display bar's
 * custom *width* has its own test in panel.smoke; this file is the font-size
 * sibling, plus the card's other deferred branches.
 *
 * Two cases used to be `{ todo }` because the panel could not reach them (a
 * helper declared in another view, and a rename field with no control to open
 * it). Both are wired now, so they assert like the rest.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launchPanel, FIXTURE_STATE } from './harness.mjs'

/** A source the user added: it gets the edit and delete controls. */
const SOURCE_STATE = {
  ...FIXTURE_STATE,
  sources: [{ id: 's1', kind: 'local', name: 'My voice', modelPath: '/home/user/models/kokoro' }],
}

/** A saved word, so "my words" is a real list and not just the empty note. */
const SAVED = {
  ...FIXTURE_STATE,
  words: [{ id: 'dream', word: 'dream', context: '', senses: [], translation: [], addedAt: 1 }],
}

function assertHealthy(api, where) {
  assert.doesNotMatch(api.container.textContent, /failed to render/, `${where}: the panel crashed`)
  assert.deepEqual(api.errors, [], `${where}: the panel logged a console error`)
}

/** Open the settings card from the header capsule. */
async function openSettings(api) {
  const capsule = api.q('.er-capsule')
  assert.ok(capsule !== null, 'the header has the settings capsule')
  assert.equal(capsule.getAttribute('aria-expanded'), 'false', 'the card starts closed')
  await api.click(capsule)
  assert.ok(api.q('.er-card') !== null, 'the settings card opened')
  assert.equal(capsule.getAttribute('aria-expanded'), 'true')
}

/** The section toggle whose title contains `title`. */
function sectionToggle(api, title) {
  return api.qa('.er-sect-toggle').find((node) => node.textContent.includes(title))
}

test('the custom font size field opens and applies a number', async () => {
  // The sister of panel.smoke's custom-width test: the display bar renders the
  // two segmented controls from the same branch, and a helper that fell out of
  // one of them only throws when its own field is committed.
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    // Two groups both end in a button called "Custom": width first, size second.
    const group = (label) => api.qa('.er-display [role="radiogroup"]')
      .find((node) => node.getAttribute('aria-label') === label)
    const customOf = (label) => [...group(label).querySelectorAll('.er-seg-btn')]
      .find((node) => node.textContent === 'Custom')

    const size = group('Size')
    assert.ok(size !== undefined, 'the display bar has a reading-size group')
    assert.equal(customOf('Size').getAttribute('aria-checked'), 'false', 'no custom size yet')

    await api.click(customOf('Size'))
    await api.waitFor(() => api.q('.er-display input[aria-label="Reading font size in pixels"]') !== null,
      { label: 'the custom font size field' })
    // Re-query: the first render's node is replaced when the field mounts.
    await api.type(api.q('.er-display input'), '20')
    await api.key(api.q('.er-display input'), 'Enter')
    await api.settle()

    const applied = customOf('Size')
    assert.equal(applied.getAttribute('aria-checked'), 'true', 'the typed font size was applied')
    assert.equal(api.q('.er-display input'), null, 'the field closed again')
    // The width control is the other "Custom": committing one must not select it.
    assert.equal(customOf('Width').getAttribute('aria-checked'), 'false', 'the width choice is untouched')
    assertHealthy(api, 'custom font size')
  } finally {
    await api.unmount()
  }
})

test('every settings section opens and shows its own contents', async () => {
  // Engine starts open, the other three start closed. Each toggle is pressed at
  // least once, and each body must render its own controls — a section that
  // throws or renders an empty body fails here.
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    await openSettings(api)
    const expected = [
      ['Engine', 'Edge'],
      ['Voices', 'Voice A'],
      ['Dictionary', 'English source'],
      ['Translation', 'Show translation'],
    ]
    for (const [title, signature] of expected) {
      const toggle = sectionToggle(api, title)
      assert.ok(toggle !== undefined, `the settings card has a ${title} section`)
      // Engine is open on arrival; close it first so this toggle's open branch
      // is the one being tested, not the initial state.
      if (toggle.getAttribute('aria-expanded') === 'true') await api.click(toggle)
      await api.click(toggle)
      assert.equal(toggle.getAttribute('aria-expanded'), 'true', `${title} opened`)
      const body = toggle.closest('.er-sect').querySelector('.er-sect-body')
      assert.ok(body !== null, `${title} has a body once opened`)
      assert.notEqual(body.textContent.trim(), '', `${title} body is not empty`)
      assert.ok(body.textContent.includes(signature), `${title} body shows its own controls`)
    }
    assert.equal(api.qa('.er-sect-body').length, 4, 'all four sections are open at once')
    assert.doesNotMatch(api.text('.er-root'), /failed to render/, 'the panel did not crash')
    assertHealthy(api, 'settings sections')
  } finally {
    await api.unmount()
  }
})

test('renaming a speech source updates the list without deleting it', async () => {
  const api = await launchPanel({ state: SOURCE_STATE })
  try {
    await openSettings(api)
    // The row keeps its name span even while the rename field replaces it.
    const rowOf = (name) => api.qa('.er-source')
      .find((node) => node.querySelector('.er-source-name')?.textContent === name)
    const row = rowOf('My voice')
    assert.ok(row !== undefined, 'the local source is listed')
    assert.ok(row.querySelector('.er-source-del') !== null, 'the row offers delete')

    // @todo Real bug: the inline rename field in renderSettingsCard
    // (`renamingSource === entry.id` → <input class="er-input">) can never be
    // opened. Nothing in client.js calls setRenamingSource(entry.id); only the
    // field's own Escape and renameSource's reset call it. The reachable
    // alternative ("Edit settings" gear → dialog) crashes on open as well (see
    // the folder-picker test). Remove the todo once a control calls
    // setRenamingSource(entry.id); the rest of this test is the expectation.
    const rename = [...row.querySelectorAll('button')]
      .find((node) => /rename/i.test(`${node.title} ${node.getAttribute('aria-label') ?? ''}`))
    assert.ok(rename !== undefined, 'the source row offers a rename control')

    await api.click(rename)
    // The row's name span becomes the field, so look the field up inside the list.
    await api.waitFor(() => api.q('.er-source .er-input') !== null, { label: 'the inline rename field' })
    const input = api.q('.er-source .er-input')
    await api.type(input, 'Studio voice')
    await api.key(input, 'Enter')
    await api.waitFor(() => api.texts('.er-source-name').includes('Studio voice'),
      { label: 'the renamed source' })
    assert.deepEqual(api.texts('.er-source-name'), ['Edge', 'Studio voice'])
    const removed = api.host.calls.filter((call) => call.method === 'DELETE'
      || (call.method === 'POST' && call.path.endsWith('/tts/sources')))
    assert.deepEqual(removed, [], 'renaming a local source neither deleted nor rewrote it')
  } finally {
    await api.unmount()
  }
})

test('the Collins key is saved on the host and never printed into the panel', async () => {
  // The key row only exists on the Collins branch of a dictionary slot. Its
  // save handler posts the key and forgets it; the DOM must never hold it.
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    await openSettings(api)
    const dictionary = sectionToggle(api, 'Dictionary')
    assert.ok(dictionary !== undefined, 'the settings card has a dictionary section')
    if (dictionary.getAttribute('aria-expanded') !== 'true') await api.click(dictionary)

    const english = api.qa('.er-sect-body select')
      .find((select) => [...select.options].some((option) => option.value === 'collins'))
    assert.ok(english !== undefined, 'the English slot offers Collins')
    await api.choose(english, 'collins')

    const input = api.q('.er-key-row input')
    assert.ok(input !== null, 'choosing Collins asks for a key')
    assert.equal(input.type, 'password', 'the key is typed blind')
    assert.match(input.placeholder, /Collins|key/i)
    await api.type(input, '1234-5678')

    const save = api.q('.er-key-row button')
    assert.equal(save.disabled, false, 'the save button came alive')
    await api.click(save)
    await api.waitFor(() => api.host.calls.some((call) => call.method === 'POST' && call.path.endsWith('/dict/key')),
      { label: 'the key POST' })

    const posts = api.host.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/dict/key'))
    assert.equal(posts.length, 1, 'the key was handed to the host once')
    assert.deepEqual(JSON.parse(posts[0].body), { key: '1234-5678' })

    await api.waitFor(() => api.q('.er-key-row button')?.textContent === 'Saved',
      { label: 'the saved state' })
    assert.match(api.text('.er-key-row'), /Stored on the host, never in this browser\./)
    assert.equal(api.q('.er-key-row input').value, '', 'the field forgot the key')
    assert.doesNotMatch(api.text('.er-root'), /1234-5678/, 'the key is nowhere in the DOM')
    assertHealthy(api, 'collins key')
  } finally {
    await api.unmount()
  }
})

test('choosing a model directory from the add dialog shows the chosen path', async () => {
  let picked = 0
  const folder = '/home/user/models/kokoro'
  const api = await launchPanel({
    state: FIXTURE_STATE,
    // The picker is a host capability, not a route: it answers with a folder.
    pickDirectory: async () => { picked += 1; return folder },
    host: { validate: { ok: true } },
  })
  try {
    await openSettings(api)
    const addSource = api.qa('.er-add').find((node) => node.textContent.includes('Add a source'))
    assert.ok(addSource !== undefined, 'the engine section offers to add a source')
    await api.click(addSource)
    await api.settle()

    // @todo Real bug: pressing "Add a source" (or the row's "Edit settings"
    // gear) throws before the dialog exists — renderAddDialog calls `field`,
    // which is declared inside renderSettingsCard and is out of scope there
    // (8 uses). The error boundary replaces the panel with
    // "English reader failed to render / ReferenceError: field is not defined".
    // This is the same refactor class as the custom-width crash fixed in
    // 9717b66, and it exists at that commit too. Remove the todo and the
    // message in the assertion below once the dialog renders.
    const fatal = api.text('.er-fatal-body').split('\n')[0]
    assert.ok(api.q('.er-dialog') !== null,
      `the add-source dialog opened${fatal === '' ? '' : ` — the panel crashed instead: ${fatal}`}`)

    const local = api.qa('.er-dialog .er-seg-btn').find((node) => node.textContent === 'Local model')
    assert.ok(local !== undefined, 'the dialog offers a local model')
    await api.click(local)

    const pathField = () => api.q('.er-dialog .er-dir input')
    assert.equal(pathField().value, '', 'no folder is chosen yet')
    const add = api.q('.er-dialog .er-cta-strong')
    assert.equal(add.disabled, true, 'nothing can be added before a folder is chosen')
    const choose = api.qa('.er-dialog button').find((node) => node.textContent === 'Choose…')
    assert.ok(choose !== undefined, 'the folder field has a choose button')
    await api.click(choose)
    await api.waitFor(() => pathField()?.value === folder, { label: 'the chosen folder in the field' })
    assert.equal(picked, 1, 'the host picker was asked once')
    assert.equal(add.disabled, false, 'the chosen folder is ready to add')

    await api.click(add)
    await api.waitFor(() => api.texts('.er-source-name').includes('Local model'),
      { label: 'the new local source' })
    const added = api.qa('.er-source')
      .find((node) => node.querySelector('.er-source-name')?.textContent === 'Local model')
    assert.equal(added.querySelector('.er-source-meta').textContent, '~/models/kokoro',
      'the list shows the chosen folder')
  } finally {
    await api.unmount()
  }
})

test('the settings capsule opens the card from the saved words page', async () => {
  // Reported as suspicious from the browser. The header is the same on every
  // view, so this branch is just openSettings() from a page that is not the
  // reader; the card must still mount.
  const api = await launchPanel({ state: SAVED })
  try {
    await api.click(api.q('button.er-glyph[title="Saved words"]'))
    assert.ok(api.q('.er-words') !== null, 'the saved words page is open')
    assert.equal(api.q('.er-card'), null, 'no settings card yet')
    const capsule = api.q('.er-capsule')
    assert.ok(capsule !== null, 'the words page still renders the settings capsule')

    await api.click(capsule)
    await api.waitFor(() => api.q('.er-card') !== null, { label: 'the settings card' })
    const card = api.q('.er-card')
    assert.equal(card.getAttribute('role'), 'dialog')
    assert.equal(card.getAttribute('aria-label'), 'Reading settings')
    assert.equal(capsule.getAttribute('aria-expanded'), 'true', 'the capsule reports the card is open')
    assert.ok(api.qa('.er-sect-toggle').length === 4, 'the card has all four sections')
    assert.ok(api.q('.er-words') !== null, 'the words page is still behind the card')
    assert.doesNotMatch(api.text('.er-root'), /failed to render/, 'the panel did not crash')
    assertHealthy(api, 'capsule from saved words')
  } finally {
    await api.unmount()
  }
})