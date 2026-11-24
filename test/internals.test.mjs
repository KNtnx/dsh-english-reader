/**
 * The reading logic, without a DOM: splitting a paste into sentences, deciding
 * whether it is a dialogue, and lining speech marks up with words.
 *
 * These are cheap and exact, so they run for every case that used to be checked
 * by pasting text into the panel and listening to it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { internals } from './harness.mjs'

const { splitSentences, parseDialogue, titleFor, wordsOf, normalizeWord, hashText, buildTimings, mergeStates } = internals

test('sentences split on their own punctuation', () => {
  assert.deepEqual(splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?'])
  assert.deepEqual(splitSentences('  spaced   out.  '), ['spaced out.'])
  assert.deepEqual(splitSentences(''), [])
})

test('an abbreviation never ends a sentence', () => {
  assert.deepEqual(splitSentences('Dr. Smith arrived. He sat.'), ['Dr. Smith arrived.', 'He sat.'])
  assert.deepEqual(splitSentences('That is e.g. a bird. Fine.'), ['That is e.g. a bird.', 'Fine.'])
})

test('a decimal never ends a sentence', () => {
  assert.deepEqual(splitSentences('It costs 3.5 dollars. Deal?'), ['It costs 3.5 dollars.', 'Deal?'])
})

test('closing quotes stay with the sentence they close', () => {
  assert.deepEqual(splitSentences('He said "stop!" Then left.'),
    ['He said "stop!"', 'Then left.'])
})

test('a wrapped line is joined back into one sentence', () => {
  const parsed = parseDialogue('A long line that\ncontinues here. And a second one.', 'auto')
  assert.equal(parsed.mode, 'article')
  assert.deepEqual(parsed.sentences.map((sentence) => sentence.text),
    ['A long line that continues here.', 'And a second one.'])
})

test('labelled turns are read as a dialogue with one voice each', () => {
  const parsed = parseDialogue('A: Hello there.\nB: Hi, how are you?', 'auto')
  assert.equal(parsed.mode, 'dialogue')
  assert.deepEqual(parsed.speakers, ['A', 'B'])
  assert.deepEqual(parsed.sentences.map((sentence) => sentence.slot), [0, 1])
  assert.deepEqual(parsed.sentences.map((sentence) => sentence.speaker), ['A', 'B'])
})

test('a dialogue pasted without labels still alternates', () => {
  const parsed = parseDialogue('Hello there.\nHi, how are you?', 'dialogue')
  assert.equal(parsed.mode, 'dialogue')
  assert.deepEqual(parsed.sentences.map((sentence) => sentence.slot), [0, 1])
})

test('one labelled line in prose does not make it a dialogue', () => {
  const prose = 'Note: this is prose.\nIt continues for a while.\nAnd ends here.'
  assert.equal(parseDialogue(prose, 'auto').mode, 'article')
})

test('the library title comes from the first turn, without its speaker', () => {
  assert.equal(titleFor('Emma: Hi Daniel!\nDaniel: Hello.'), 'Hi Daniel!')
  assert.equal(titleFor('\n\n  Plain opening line.  \nMore.'), 'Plain opening line.')
  assert.equal(titleFor('A'.repeat(80)).length, 46, 'a long title is cut to fit a row')
  assert.match(titleFor('A'.repeat(80)), /…$/)
})

test('words are split on whitespace and normalized for matching', () => {
  assert.deepEqual(wordsOf("a  b\tc\nd"), ['a', 'b', 'c', 'd'])
  assert.equal(normalizeWord('Dream,'), 'dream')
  assert.equal(normalizeWord('left—but'), 'leftbut')
  assert.equal(normalizeWord('"stop!"'), 'stop')
})

test('a text hash is stable and distinguishes texts', () => {
  assert.equal(hashText('hello'), hashText('hello'))
  assert.notEqual(hashText('hello'), hashText('hello!'))
  assert.match(hashText(''), /^[0-9a-z]+$/)
})

test('speech marks line up with the words that were rendered', () => {
  const words = ['left—but', 'the', '"stop!"']
  const marks = [
    { text: 'left', at: 0, dur: 100 },
    { text: 'but', at: 100, dur: 100 },
    { text: 'the', at: 250, dur: 100 },
    { text: 'stop', at: 400, dur: 100 },
  ]
  assert.deepEqual(buildTimings(words, marks, 600), [0, 250, 400])
})

test('without marks the words are spread over the clip by length', () => {
  const times = buildTimings(['antidisestablishmentarianism', 'a', 'medium'], [], 1000)
  assert.equal(times.length, 3)
  assert.ok(times[0] < times[1] && times[1] < times[2], 'times only move forward')
  assert.equal(times[0], 0)
  assert.ok(times[2] < 1000, 'the last word starts before the clip ends')
})

test('the shared library is merged by id, newer copy wins', () => {
  const local = {
    version: 3,
    fontScale: 1.2,
    items: [
      { id: 'a', title: 'Local a', updatedAt: 10 },
      { id: 'b', title: 'Local b', updatedAt: 20 },
    ],
    words: [
      { id: 'dream', word: 'dream', addedAt: 10 },
      { id: 'revive', word: 'revive', addedAt: 30 },
    ],
  }
  const remote = {
    items: [
      { id: 'a', title: 'Shared a', updatedAt: 30 },
      { id: 'c', title: 'Shared c', updatedAt: 5 },
    ],
    words: [
      { id: 'dream', word: 'dream', addedAt: 40 },
      { id: 'lantern', word: 'lantern', addedAt: 50 },
    ],
  }
  const merged = mergeStates(local, remote)
  assert.deepEqual(merged.items.map((item) => item.id).sort(), ['a', 'b', 'c'])
  assert.equal(merged.items.find((item) => item.id === 'a').title, 'Shared a', 'the newer copy of a entry wins')
  assert.deepEqual(merged.words.map((word) => word.id), ['lantern', 'dream', 'revive'], 'newest word first')
  assert.equal(merged.words.find((word) => word.id === 'dream').addedAt, 40)
  assert.equal(merged.fontScale, 1.2, 'browser settings are not taken from the host')
})

test('a panel with nothing stored adopts the shared library as it is', () => {
  const remote = { items: [{ id: 'a', updatedAt: 5 }], words: [{ id: 'w', addedAt: 5 }] }
  assert.deepEqual(mergeStates({}, remote).items, remote.items)
  assert.deepEqual(mergeStates(null, remote).words, remote.words)
  const local = { items: [{ id: 'a', updatedAt: 5 }], words: [] }
  assert.deepEqual(mergeStates(local, null), local, 'no host file means the browser copy stays')
})
