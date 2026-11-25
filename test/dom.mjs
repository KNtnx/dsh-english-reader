/**
 * A browser-shaped environment for the panel, without a browser.
 *
 * The panel is a plain browser script: it talks to `window.__ModuleLoader__`,
 * reads `window.localStorage`, measures itself with `ResizeObserver`, and calls
 * bare `fetch`. This module installs all of that on the Node globals *before*
 * React DOM is loaded, and exposes helpers the tests drive the panel with.
 *
 * Keep every browser assumption the panel makes in this one file: when the
 * panel starts using a new API, the tests should fail here, not in the app.
 */

import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1/',
  pretendToBeVisual: true,
})
const { window } = dom

/** Globals a React DOM tree needs to believe it is in a browser. */
const GLOBALS = [
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'HTMLElement', 'HTMLAnchorElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
  'HTMLButtonElement', 'HTMLAudioElement', 'HTMLMediaElement', 'SVGElement', 'Element', 'Node',
  'DocumentFragment', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'InputEvent',
  'CustomEvent', 'getComputedStyle', 'matchMedia', 'DOMParser', 'NodeFilter', 'MutationObserver',
]

for (const name of GLOBALS) {
  if (window[name] === undefined) continue
  // Every one of these is an accessor or missing on the Node global, so define
  // the property instead of assigning to it.
  Object.defineProperty(globalThis, name, {
    value: typeof window[name] === 'function' ? window[name].bind(window) : window[name],
    configurable: true,
    writable: true,
  })
}
// `bind` above is wrong for constructors (React does `new window.HTMLElement`),
// so put the real classes back untouched.
for (const name of GLOBALS) {
  if (typeof window[name] === 'function' && /^[A-Z]/.test(name)) {
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true })
  }
}

globalThis.self = window
globalThis.window = window
globalThis.document = window.document
// jsdom reports 1024x768 for the window but not as own properties of globalThis.
Object.defineProperty(globalThis, 'innerWidth', { value: 1024, writable: true })
Object.defineProperty(globalThis, 'innerHeight', { value: 900, writable: true })

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// jsdom ships requestAnimationFrame only on the window; the panel calls it bare.
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0)
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle)
// Only used to hand a synthesized clip to an <audio> element, never in tests.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:test'
  URL.revokeObjectURL = () => {}
}
// jsdom leaves smooth scrolling and media out; the panel only ever calls them
// for convenience, so a no-op keeps layout-independent behaviour testable.
window.Element.prototype.scrollTo = function scrollTo() {}
window.Element.prototype.scrollIntoView = function scrollIntoView() {}
window.HTMLMediaElement.prototype.play = function play() { return Promise.resolve() }
window.HTMLMediaElement.prototype.pause = function pause() {}
window.HTMLMediaElement.prototype.load = function load() {}
// Rendering can read faces, but never in tests: report a small panel so the
// measured-layout code paths still run.
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback }
  observe(target) {
    this.callback([{ target, contentRect: { width: 900, height: 700 } }])
  }
  unobserve() {}
  disconnect() {}
}

export { dom, window }