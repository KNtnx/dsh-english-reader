/**
 * Playback: the panel asks the host for one sentence of audio at a time.
 *
 * The suite used to stop at "the panel renders" and never pressed play, so a
 * host that could not synthesize at all still passed. These cases cover the
 * request the panel makes and what it shows when the host refuses one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launchPanel, FIXTURE_STATE } from './harness.mjs'

const playButton = (api) => api.q('.er-play')
const ttsCalls = (api) => api.host.calls.filter((call) => call.path === '/api-dsh-english-reader/tts')

test('pressing play asks the host for the sentence on screen', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    assert.equal(ttsCalls(api).length, 0, 'nothing is synthesized before play')
    await api.click(playButton(api))
    await api.waitFor(() => ttsCalls(api).length > 0, { label: 'a synthesis request' })
    const first = ttsCalls(api)[0]
    assert.equal(first.method, 'GET')
    assert.match(decodeURIComponent(first.search), /text=They revive it\./, 'it asks for the current sentence')
    assert.match(decodeURIComponent(first.search), /provider=edge/, 'it names the selected engine')
    await api.waitFor(() => playButton(api)?.getAttribute('aria-label') === 'Pause', { label: 'playback to start' })
  } finally {
    await api.unmount()
  }
})

test('moving to the next sentence synthesizes that one', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    await api.click(playButton(api))
    await api.waitFor(() => ttsCalls(api).length > 0, { label: 'the first clip' })
    await api.click(api.q('button[aria-label="Next sentence"]'))
    await api.waitFor(() => ttsCalls(api).some((call) => decodeURIComponent(call.search).includes('text=The dream returns.')),
      { label: 'the second sentence' })
  } finally {
    await api.unmount()
  }
})

test('a refused sentence is reported instead of silently doing nothing', async () => {
  // What a broken worker looks like from the panel: 502 with a plain-text reason.
  const api = await launchPanel({ state: FIXTURE_STATE, host: { tts: 'fail' } })
  try {
    await api.click(playButton(api))
    await api.waitFor(() => api.q('.er-notice-err') !== null, { label: 'the error bar' })
    assert.match(api.text('.er-notice-err'), /speech service refused this sentence/i)
    assert.notEqual(playButton(api)?.getAttribute('aria-label'), 'Pause', 'playback did not start')
  } finally {
    await api.unmount()
  }
})

test('a local engine skipped at install time is named instead of blamed on the sentence', async () => {
  // The engine is an optional peer and is not installed by default; Edge still
  // works. Pressing play on the local source must say that, not "the speech
  // service refused this sentence".
  const api = await launchPanel({
    state: { ...FIXTURE_STATE, activeSourceId: 'bundled' },
    host: {
      tts: 'engine-missing',
      localStatus: {
        installed: false, phase: 'error', onDisk: true, dir: '/tmp/model',
        code: 'engine-missing', error: 'local engine unavailable',
      },
    },
  })
  try {
    await api.waitFor(() => api.text('.er-capsule-text') === 'Kokoro-82M', { label: 'the bundled local source' })
    await api.click(playButton(api))
    await api.waitFor(() => api.q('.er-notice-err') !== null, { label: 'the error bar' })
    assert.match(api.text('.er-notice-err'), /local voice engine is not installed/i)
    assert.match(decodeURIComponent(ttsCalls(api)[0].search), /provider=local/, 'it asked the local engine')
    assert.notEqual(playButton(api)?.getAttribute('aria-label'), 'Pause', 'playback did not start')
  } finally {
    await api.unmount()
  }
})

test('the audio is fetched once per sentence while it is cached', async () => {
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    const asked = (text) => ttsCalls(api)
      .filter((call) => decodeURIComponent(call.search).includes(`text=${text}`)).length
    await api.click(playButton(api))
    await api.waitFor(() => asked('They revive it.') === 1, { label: 'the first clip' })
    // Away and back: the clip cache answers, so the host is not asked twice.
    await api.click(api.q('button[aria-label="Next sentence"]'))
    await api.settle()
    await api.click(api.q('button[aria-label="Previous sentence"]'))
    await api.waitFor(() => api.text('.er-count').startsWith('1 /'), { label: 'the first sentence again' })
    await api.settle()
    assert.equal(asked('They revive it.'), 1, 'the first sentence was not synthesized twice')
  } finally {
    await api.unmount()
  }
})

test('changing the voice re-reads the sentence that is playing', async () => {
  // The clip already downloaded belonged to the old voice; keeping it was the bug.
  const api = await launchPanel({ state: FIXTURE_STATE })
  try {
    const voiceOf = (call) => new URL(`http://x${call.search}`).searchParams.get('voice')
    await api.click(playButton(api))
    await api.waitFor(() => ttsCalls(api).length > 0, { label: 'the first clip' })
    await api.waitFor(() => playButton(api)?.getAttribute('aria-label') === 'Pause', { label: 'playback to start' })

    await api.click(api.q('.er-capsule'))
    const section = api.qa('.er-sect').find((node) => node.textContent.startsWith('Voices'))
    assert.ok(section !== undefined, 'the settings card has a voices section')
    await api.click(section.querySelector('.er-sect-toggle'))
    await api.settle()
    const select = section.querySelectorAll('select')[0]
    assert.ok([...select.options].some((option) => option.value === 'en-US-GuyNeural'), 'voices are listed')

    await api.choose(select, 'en-US-GuyNeural')
    await api.waitFor(() => ttsCalls(api).some((call) => voiceOf(call) === 'en-US-GuyNeural'),
      { label: 'the sentence in the new voice' })
    assert.equal(voiceOf(ttsCalls(api).at(-1)), 'en-US-GuyNeural')
  } finally {
    await api.unmount()
  }
})

test('the page follows the reading line until the switch is turned off', async () => {
  // Asked for: when a reader scrolls away to study a paragraph, the next sentence
  // must not pull the page back.
  const api = await launchPanel({ state: FIXTURE_STATE })
  const scrolled = []
  const original = Element.prototype.scrollTo
  Element.prototype.scrollTo = function scrollTo(options) { scrolled.push({ node: this, top: options?.top }) }
  try {
    await api.click(playButton(api))
    await api.waitFor(() => ttsCalls(api).length > 0, { label: 'the first clip' })
    await api.click(api.q('button[aria-label="Next sentence"]'))
    await api.waitFor(() => scrolled.length > 0, { label: 'the page following the sentence' })

    const follow = api.q('button[aria-label="Follow the sentence being read"]')
    assert.ok(follow !== null, 'the transport has a follow switch')
    assert.equal(follow.getAttribute('aria-checked'), 'true', 'it follows by default')
    await api.click(follow)
    await api.settle()
    assert.equal(api.q('button[aria-label="Follow the sentence being read"]').getAttribute('aria-checked'), 'false')

    const before = scrolled.length
    await api.click(api.q('button[aria-label="Next sentence"]'))
    await api.settle()
    assert.equal(scrolled.length, before, 'the page stayed where the reader put it')
  } finally {
    Element.prototype.scrollTo = original
    await api.unmount()
  }
})
