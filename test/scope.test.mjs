/**
 * A local helper declared inside one function does not exist in any other.
 *
 * Four bugs of exactly this shape reached the panel: `commitWidth` (the custom
 * width), `modelLoaded`, `cardHeight` (the word card), and `field` (the
 * add-source dialog). Each one compiled, booted, and then threw a
 * `ReferenceError` the first time its branch rendered — the panel replaced
 * itself with "English reader failed to render".
 *
 * This check reads client.js, tokenizes it, and for every pair of top-level
 * functions in the factory flags a name that is *declared* at the top level of
 * one and *used* in another without being declared there or at factory scope.
 * It is a static approximation: it cannot see inside strings or templates, and
 * a name that is also a property key is skipped. That is enough for the bug it
 * guards.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')

/** `=>` and friends have to be single tokens, or arrow params look like uses. */
const PAIRS = new Set(['=>', '?.', '&&', '||', '??'])
/** After these tokens a `/` opens a regular expression, not a division. */
const REGEX_AFTER = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^',
  'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'yield',
  'await', '=>', '&&', '||', '??',
])
const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends '
  + 'finally for function if import in instanceof let new return super switch this throw try typeof var void '
  + 'while with yield async await of static get set true false null undefined').split(' '))

/** Next index after a string literal starting at `i`. */
function skipString(text, i, quote) {
  i += 1
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue }
    if (text[i] === quote) return i + 1
    i += 1
  }
  return i
}

/** Next index after a template literal starting at `i`, `${…}` included. */
function skipTemplate(text, i) {
  i += 1
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue }
    if (text[i] === '`') return i + 1
    if (text[i] === '$' && text[i + 1] === '{') { i = skipBraced(text, i + 2); continue }
    i += 1
  }
  return i
}

/** Next index after the `}` that closes a `${` block already entered. */
function skipBraced(text, i) {
  let depth = 1
  while (i < text.length) {
    const char = text[i]
    if (char === '\\') { i += 2; continue }
    if (char === "'" || char === '"') { i = skipString(text, i, char); continue }
    if (char === '`') { i = skipTemplate(text, i); continue }
    if (char === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl === -1 ? text.length : nl; continue }
    if (char === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end === -1 ? text.length : end + 2; continue }
    if (char === '{') depth += 1
    if (char === '}') { depth -= 1; if (depth === 0) return i + 1 }
    i += 1
  }
  return i
}

/** Next index after a regular expression literal starting at `i`, flags included. */
function skipRegex(text, i) {
  i += 1
  let inClass = false
  while (i < text.length) {
    const char = text[i]
    if (char === '\\') { i += 2; continue }
    if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '\n') return i + 1
    else if (char === '/' && !inClass) {
      let end = i + 1
      while (end < text.length && /[a-z]/.test(text[end])) end += 1
      return end
    }
    i += 1
  }
  return i
}

/** Source without whitespace, comments, strings, templates, or regex bodies. */
function tokenize(text) {
  const tokens = []
  let previous = ''
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { i += 1; continue }
    if (char === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl === -1 ? text.length : nl; continue }
    if (char === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end === -1 ? text.length : end + 2; continue }
    if (char === '/' && REGEX_AFTER.has(previous)) { i = skipRegex(text, i); previous = '/'; continue }
    if (char === "'" || char === '"') { i = skipString(text, i, char); previous = 'string'; continue }
    if (char === '`') { i = skipTemplate(text, i); previous = 'string'; continue }
    if (/[A-Za-z_$]/.test(char)) {
      let end = i + 1
      while (end < text.length && /[\w$]/.test(text[end])) end += 1
      tokens.push({ type: 'name', value: text.slice(i, end) })
      previous = text.slice(i, end)
      i = end
      continue
    }
    if (/[0-9]/.test(char)) {
      let end = i + 1
      while (end < text.length && /[\w.]/.test(text[end])) end += 1
      tokens.push({ type: 'number', value: text.slice(i, end) })
      previous = 'number'
      i = end
      continue
    }
    const pair = text.slice(i, i + 2)
    if (PAIRS.has(pair)) {
      tokens.push({ type: 'punct', value: pair })
      previous = pair
      i += 2
      continue
    }
    tokens.push({ type: 'punct', value: char })
    previous = char
    i += 1
  }
  return tokens
}

const TOKENS = tokenize(SOURCE)

/** Index of the brace that closes the one at `index`. */
function closing(tokens, index) {
  let depth = 0
  for (let i = index; i < tokens.length; i += 1) {
    if (tokens[i].value === '{') depth += 1
    if (tokens[i].value === '}') { depth -= 1; if (depth === 0) return i }
  }
  return tokens.length - 1
}

/** Every `function name(...) { ... }` in the file, with its body range. */
function functions() {
  const out = []
  for (let i = 0; i < TOKENS.length; i += 1) {
    if (TOKENS[i].type !== 'name' || TOKENS[i].value !== 'function') continue
    const name = TOKENS[i + 1]
    if (name === undefined || name.type !== 'name') continue
    let at = i + 2
    while (at < TOKENS.length && TOKENS[at].value !== '(') at += 1
    if (at === TOKENS.length) continue
    const params = at
    // Skip the parameter list, then expect the body.
    let depth = 0
    for (; at < TOKENS.length; at += 1) {
      if (TOKENS[at].value === '(') depth += 1
      if (TOKENS[at].value === ')') { depth -= 1; if (depth === 0) break }
    }
    at += 1
    if (TOKENS[at]?.value !== '{') continue
    const end = closing(TOKENS, at)
    out.push({ name: name.value, bodyStart: at, bodyEnd: end, keyword: i, params })
  }
  return out
}

const FUNCTIONS = functions()
/** Sibling scopes: a function that no other function contains. */
const UNITS = FUNCTIONS.filter((fn) => !FUNCTIONS.some((other) => other !== fn
  && other.bodyStart < fn.bodyStart && other.bodyEnd > fn.bodyEnd))

/**
 * Names a `const`/`let`/`var`/`function` declares inside one unit, with the
 * brace depth of the declaration (0 = the unit's own top level).
 */
function declarations(unit) {
  const out = new Map()
  let depth = 0
  for (let i = unit.bodyStart + 1; i < unit.bodyEnd; i += 1) {
    const token = TOKENS[i]
    if (token.value === '{' || token.value === '[') { depth += 1; continue }
    if (token.value === '}' || token.value === ']') { depth -= 1; continue }
    if (token.type !== 'name') continue
    if (['const', 'let', 'var'].includes(token.value)) {
      const target = TOKENS[i + 1]
      if (target?.value === '{' || target?.value === '[') {
        // Destructuring declares every leaf: `{ a, b: c, d = 1 }` → a, c, d.
        const open = target.value
        let inner = 0
        for (let j = i + 1; j < unit.bodyEnd; j += 1) {
          const value = TOKENS[j].value
          if (value === '{' || value === '[') inner += 1
          if (value === '}' || value === ']') { inner -= 1; if (inner === 0) break }
          if (j === i + 1 || TOKENS[j].type !== 'name' || KEYWORDS.has(value)) continue
          // `a: b` declares b, not a.
          if (TOKENS[j + 1]?.value === ':' && open === '{') continue
          out.set(value, depth)
        }
        continue
      }
      if (target?.type === 'name') out.set(target.value, depth)
      continue
    }
    if (token.value === 'function' && TOKENS[i + 1]?.type === 'name') out.set(TOKENS[i + 1].value, depth)
  }
  return out
}

/** Every identifier between two parens: params, destructuring, defaults included. */
function paramsIn(open) {
  const out = []
  let depth = 0
  for (let i = open; i < TOKENS.length; i += 1) {
    if (TOKENS[i].value === '(') depth += 1
    if (TOKENS[i].value === ')') { depth -= 1; if (depth === 0) break }
    if (i > open && TOKENS[i].type === 'name' && !KEYWORDS.has(TOKENS[i].value)) out.push(TOKENS[i].value)
  }
  return out
}

/**
 * Names a unit declares in any nested scope or parameter list. Passing one of
 * these to the unit itself is not a leak; only its own top level escapes.
 */
function ownNames(unit) {
  const out = new Set([...declarations(unit).keys(), ...paramsIn(unit.params)])
  for (let i = unit.bodyStart; i < unit.bodyEnd; i += 1) {
    const token = TOKENS[i]
    if (token.value === 'function') {
      let at = i + 2
      while (at < unit.bodyEnd && TOKENS[at].value !== '(') at += 1
      if (TOKENS[at]?.value === '(') for (const name of paramsIn(at)) out.add(name)
      continue
    }
    // Arrow parameters: `x =>` and `( … ) =>`.
    if (token.type === 'name' && TOKENS[i + 1]?.value === '=>') { out.add(token.value); continue }
    if (token.value === ')' && TOKENS[i + 1]?.value === '=>') {
      let depth = 0
      for (let at = i; at >= unit.bodyStart; at -= 1) {
        if (TOKENS[at].value === ')') depth += 1
        if (TOKENS[at].value === '(') {
          depth -= 1
          if (depth === 0) { for (const name of paramsIn(at)) out.add(name); break }
        }
      }
    }
  }
  return out
}

/** Identifiers the unit reads: no property access, no object keys, no declarations. */
function uses(unit) {
  const out = new Set()
  for (let i = unit.bodyStart; i <= unit.bodyEnd; i += 1) {
    const token = TOKENS[i]
    if (token.type !== 'name' || KEYWORDS.has(token.value)) continue
    const previous = TOKENS[i - 1]?.value
    const next = TOKENS[i + 1]?.value
    const before = TOKENS[i - 2]?.value
    if (previous === '.' || previous === '?.') continue
    if (['const', 'let', 'var', 'function', 'catch'].includes(previous)) continue
    if (next === ':' && previous !== '?' && before !== '?') continue
    out.add(token.value)
  }
  return out
}

/** Declarations that belong to no unit: the factory's own helpers and constants. */
function factoryNames() {
  const out = new Map()
  let unit = 0
  for (let i = 0; i < TOKENS.length; i += 1) {
    if (unit < UNITS.length && i === UNITS[unit].bodyStart) {
      i = UNITS[unit].bodyEnd
      unit += 1
      continue
    }
    const token = TOKENS[i]
    if (token.type !== 'name') continue
    if (['const', 'let', 'var'].includes(token.value) && TOKENS[i + 1]?.type === 'name') {
      out.set(TOKENS[i + 1].value, token.value)
    }
    if (token.value === 'function' && TOKENS[i + 1]?.type === 'name') out.set(TOKENS[i + 1].value, 'function')
  }
  return out
}

test('no function uses a local name declared inside another function', () => {
  const factory = factoryNames()
  const byUnit = UNITS.map(declarations)
  const owners = new Map() // name -> units that declare it at their own top level
  for (let index = 0; index < UNITS.length; index += 1) {
    const unitNames = new Set()
    for (const [name, depth] of byUnit[index]) if (depth === 0) unitNames.add(name)
    for (const name of paramsIn(UNITS[index].params)) unitNames.add(name)
    for (const name of unitNames) {
      if (!owners.has(name)) owners.set(name, [])
      owners.get(name).push(UNITS[index].name)
    }
  }
  const leaks = []
  for (let index = 0; index < UNITS.length; index += 1) {
    const unit = UNITS[index]
    // Names the unit declares anywhere are its own, even in a nested block.
    const mine = ownNames(unit)
    for (const name of uses(unit)) {
      if (mine.has(name) || factory.has(name)) continue
      const declaredBy = (owners.get(name) ?? []).filter((owner) => owner !== unit.name)
      if (declaredBy.length === 0) continue
      leaks.push(`${name}: declared in ${declaredBy.join(', ')}, used in ${unit.name}`)
    }
  }
  assert.deepEqual(leaks, [], `names that do not exist outside the function that declared them:\n${leaks.join('\n')}`)
})