# Tests

The panel is a state machine over asynchronous lookups: a right-click, a saved
word, a dictionary change, a voice change and a slow network all write to state
that is rendered in the same place. Every bug that survived a manual check so far
was of that shape — the state was fine in the order a person happened to try, and
wrong in the order a user actually hit.

So the suite runs the real `client.js` in a real React root and clicks the real
controls. A test that does not fail when the code is broken is worse than no
test; the two runs below were checked by removing the fix on purpose.

## Run it

```bash
npm install      # once; react, react-dom and jsdom are devDependencies
npm test         # whole suite, about a second
```

One file at a time while fixing something:

```bash
node --test test/panel.dict.test.mjs
```

## What is covered

| File | What it holds |
| --- | --- |
| `test/panel.dict.test.mjs` | The dictionary end to end: right-click, save, expand a saved word, look up from the pinned card, switch dictionary, two lookups racing |
| `test/panel.smoke.test.mjs` | Every view mounts and responds: reader, sentence stepper, saved words, library, editor, settings, Chinese locale. Any render crash or `console.error` fails the test |
| `test/internals.test.mjs` | Sentence splitting (abbreviations, decimals, quotes, wrapped lines), dialogue detection, titles, word normalisation, speech-mark alignment |
| `test/host.test.mjs` | Host routes exist for every path the panel calls, and the dictionary routes parse real answer shapes: iciba, Datamuse, Wiktionary markup, misses, bad words, bad sources |
| `test/copy.test.mjs` | Both languages define the same keys, every key the panel asks for exists, no copy is empty, every class the panel applies has a rule |

The panel tests use `test/harness.mjs`, which:

1. installs a jsdom window, `localStorage`, `requestAnimationFrame` and a
   `ResizeObserver` that reports a fixed panel size;
2. loads `client.js` the way the host does — through
   `window.__ModuleLoader__.load(...)` — and calls the plugin's `apply(ctx)` with
   a fake context, so a slot that fails to register fails the test;
3. mounts the registered component with real `react-dom`, and answers every
   `fetch` from a mock host with per-word latency;
4. hands the test `click`, `rightClick`, `type`, `key`, `choose`, `waitFor` and
   `settle` helpers, all wrapped in `act`.

`launchPanel({ state, host, locale })` takes a stored panel state (the same JSON
the panel keeps in `localStorage`), latency overrides for the mock host, and the
locale. Fixtures for a saved dialogue, a saved word and three dictionary entries
live in the harness.

## What is not covered

Be explicit about this with users rather than implying the suite is exhaustive:

- **No browser.** jsdom has no layout and no paint. Text overflow, focus rings,
  dark-mode contrast, the settings card's position, scroll behaviour and
  animations are not verified by any test.
- **No audio.** Nothing checks synthesized speech, timing quality, or that a
  voice sounds right. The tests assert which request the panel made, not what
  came back.
- **No real network.** Dictionaries, translation services, Edge and the local
  Kokoro model are stubbed. A vendor changing its response shape is caught only
  by the parsers' fixture tests, and those fixtures are ours.
- **No DSH shell.** The panel is mounted on its own, so slot wiring inside the
  sidebar, the composer launcher and the full-page view are only checked by the
  registration assertions, not visually.
- **Timing.** `settle()` and `waitFor()` drive promises and short timers. A
  regression that depends on a real-time race longer than a second would need its
  own test.

## When a bug is reported

1. Write the failing test first, in the file that owns the area, using the same
   controls the user used. Run it and keep the failure output — that is the
   reproduction.
2. Fix the code until it passes, then run the whole suite.
3. If the fix changed a shared behaviour, add one test for the behaviour that
   must *stay* true, next to the one that broke (see "expanding a saved word
   still shows its own entry" and "changing the dictionary refreshes the expanded
   saved word" for the pair that guards the dictionary fix).