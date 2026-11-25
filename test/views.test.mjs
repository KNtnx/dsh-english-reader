/**
 * The panel's views read their state through one object (`ui`), so a view that
 * uses a value nobody passes compiles fine and only fails at runtime — in the
 * browser, on the branch that touches it.
 *
 * This check reads client.js and proves, for every `renderX(ui)`, that each
 * ReaderBody-level name it uses is either destructured from `ui` or declared
 * inside the view itself.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Names a view destructures that are deliberately never in the bag: they always
 * shadow an inner variable of the same name (an object key, a callback argument).
 */
const UNFED_ALLOWED = new Set(['body', 'cardHeight'])

const SOURCE = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')

/** Names ReaderBody declares at its own level: the only things `ui` can carry. */
function panelLocals() {
  const start = SOURCE.indexOf('    function ReaderBody(props) {')
  const end = SOURCE.indexOf('    function Styles() {', start)
  assert.ok(start > 0 && end > start, 'ReaderBody is where the views say it is')
  const body = SOURCE.slice(start, end)
  const names = new Set()
  for (const m of body.matchAll(/^ {6}const \[([^\]]+)\]/gm)) {
    for (const part of m[1].split(',')) names.add(part.trim())
  }
  for (const m of body.matchAll(/^ {6}const \{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  for (const m of body.matchAll(/^ {6}(?:const|let) ([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  return names
}

/** Everything a function declares anywhere in its own body. */
function declaredIn(body) {
  const names = new Set()
  for (const m of body.matchAll(/(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1])
  for (const m of body.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const part of m[1].replace(/[{}]/g, '').split(',')) {
      const name = part.split('=')[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  for (const m of body.matchAll(/\{([^{}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return names
}

test('every view receives every panel value it uses', () => {
  const locals = panelLocals()
  const carried = new Set([...SOURCE.matchAll(/const ui = \{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(',').map((part) => part.trim()).filter(Boolean)))
  const views = [...SOURCE.matchAll(/^  function (render[A-Za-z]+)\(ui\) \{\n    const \{([^}]*)\} = ui\n/gm)]
  assert.ok(views.length >= 10, `expected the panel views, found ${views.length}`)
  const gaps = []
  for (const view of views) {
    const [match, name, params] = view
    const bodyStart = view.index + match.length
    const bodyEnd = SOURCE.indexOf('\n  }\n', bodyStart)
    assert.ok(bodyEnd > bodyStart, `${name} has a body`)
    const body = SOURCE.slice(bodyStart, bodyEnd)
      .replace(/^\s*\/\/.*$/gm, '')
      // Class names and copy read like identifiers: drop the literals first.
      .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '`x`')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
    const received = new Set(params.split(',').map((part) => part.trim()).filter(Boolean))
    const used = new Set([...body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
    const missing = [...used].filter((id) => locals.has(id) && !received.has(id) && !declaredIn(body).has(id))
    if (missing.length > 0) gaps.push(`${name} uses: ${missing.sort().join(', ')}`)
    // A view that destructures a name the ui bag never carries gets undefined —
    // how the word card lost its position (maxHeight/cardHeight went missing).
    const unfed = [...received].filter((id) => !carried.has(id) && !UNFED_ALLOWED.has(id))
    if (unfed.length > 0) gaps.push(`${name} is fed: ${unfed.sort().join(', ')}`)
  }
  assert.deepEqual(gaps, [], `views use panel values they never receive:\n${gaps.join('\n')}`)
})