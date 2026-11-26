/**
 * Checks that read source files instead of running them: copy parity between the
 * two languages, and every class the panel applies having a rule to apply.
 *
 * These used to be manual greps before a commit. They are the cheapest tests in
 * the suite and they catch the two mistakes that are invisible until a user
 * switches language or sees an unstyled control.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { internals } from './harness.mjs'

const CLIENT = fileURLToPath(new URL('../client.js', import.meta.url))
const SOURCE = readFileSync(CLIENT, 'utf8')
const { DICT } = internals

/** Every `className` value in the source, as one blob. */
function classNameText() {
  const out = []
  const pattern = /className:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g
  let match
  while ((match = pattern.exec(SOURCE)) !== null) out.push(match[1] ?? match[2] ?? match[3] ?? '')
  return out.join(' ')
}

/** Every `.er-…` selector that appears anywhere in the file, including the CSS. */
function definedClasses() {
  const set = new Set()
  const pattern = /\.(er-[a-z0-9-]+)/g
  let match
  while ((match = pattern.exec(SOURCE)) !== null) set.add(match[1])
  return set
}

test('both languages define exactly the same keys', () => {
  const en = Object.keys(DICT.en).sort()
  const zh = Object.keys(DICT.zh).sort()
  const missingZh = en.filter((key) => !(key in DICT.zh))
  const missingEn = zh.filter((key) => !(key in DICT.en))
  assert.deepEqual(missingZh, [], `missing from zh: ${missingZh.join(', ')}`)
  assert.deepEqual(missingEn, [], `missing from en: ${missingEn.join(', ')}`)
  assert.deepEqual(en, zh)
})

test('no translation is empty in either language', () => {
  for (const [key, value] of Object.entries(DICT.en)) {
    assert.equal(typeof value, 'string', `en ${key} is not a string`)
    assert.notEqual(value.trim(), '', `en ${key} is empty`)
  }
  for (const [key, value] of Object.entries(DICT.zh)) {
    assert.equal(typeof value, 'string', `zh ${key} is not a string`)
    assert.notEqual(value.trim(), '', `zh ${key} is empty`)
  }
})

test('every literal copy key the panel asks for exists', () => {
  const wanted = new Set()
  const pattern = /\bt\('([A-Za-z][A-Za-z0-9_.]*)'/g
  let match
  while ((match = pattern.exec(SOURCE)) !== null) wanted.add(match[1])
  // Keys the panel builds by interpolation, resolved here so the check is not
  // satisfied by a key that only exists in one language.
  for (const kind of ['both', 'en', 'zh']) wanted.add(`dict.kind.${kind}`)
  for (const step of ['narrow', 'mid', 'wide']) wanted.add(`display.width.${step}`)
  for (const step of ['s', 'm', 'l']) wanted.add(`display.font.${step}`)
  for (const source of ['iciba', 'model']) wanted.add(`dict.src.${source}`)
  for (const source of ['wordnet', 'wiktionary', 'collins']) wanted.add(`dict.src.${source}`)
  const missing = [...wanted].filter((key) => !(key in DICT.en) || !(key in DICT.zh))
  assert.deepEqual(missing, [], `copy keys the panel asks for but the dictionary lacks: ${missing.join(', ')}`)
})

test('every class the panel applies has a rule', () => {
  const used = new Set(classNameText().match(/er-[a-z0-9-]+/g) ?? [])
  const defined = definedClasses()
  const orphan = [...used].filter((name) => !defined.has(name))
  assert.deepEqual(orphan, [], `classes without a rule: ${orphan.join(', ')}`)
})

test('every icon the panel draws is defined', () => {
  // The follow switch shipped with `ICON.follow` undefined: the button was there,
  // the glyph was not — an empty <svg> looks like a missing feature.
  const used = new Set([...SOURCE.matchAll(/ICON\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
  const block = SOURCE.slice(SOURCE.indexOf('const ICON = {'), SOURCE.indexOf('\n    }', SOURCE.indexOf('const ICON = {')))
  const defined = new Set([...block.matchAll(/^\s{6}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]))
  const missing = [...used].filter((name) => !defined.has(name))
  assert.deepEqual(missing, [], `icons used but not defined: ${missing.join(', ')}`)
})
