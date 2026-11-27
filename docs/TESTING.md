# Tests

The panel is a state machine over asynchronous lookups: a right-click, a saved
word, a dictionary change, a voice change and a slow network all write to state
that is rendered in the same place. Nearly every bug that survived a manual check
was of that shape.

Four incidents shaped this document, because in each one the suite was green
while a feature was broken:

| What broke | Why the suite missed it |
| --- | --- |
| Every sentence failed to play (`502 speech worker stopped (code 1)`) | the host was split into `host/*.js` and the worker path became `host/worker.mjs`; every route test mocks speech |
| The settings sheet crashed the panel (`modelLoaded is not defined`) | the view split lost values used only on the local-engine branch, and the suite runs the Edge branch |
| A changed translation source kept showing the old translation | the stored translation was validated by hash and line count, not by source |
| The plugin could not be installed at all (`ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED`) | a transitive native package (`onnxruntime-node`, pulled in by the local engine) failed its postinstall and pnpm rolled the package back; nothing read the manifest |

So: a test that does not fail when the code is broken is worse than no test.

The browser procedure — the twelve-step pass that every release and every structural change needs — is in [TESTING.zh.md](TESTING.zh.md).

## Run it

```bash
npm install     # once; react, react-dom and jsdom are devDependencies
npm test        # every file under test/, ~3 s, 134 cases
```

While fixing something, one file at a time:

```bash
node --test test/panel.dict.test.mjs
node --test --test-name-pattern "gloss" test/
```

Always bound a test run (`timeout 300 node --test test/` in a shell): a hung
lookup once kept a machine busy for minutes.

## The five layers

| Layer | Files | Answers |
| --- | --- | --- |
| Install contract | `install.test.mjs` | is the local engine still optional, and does a worker without it answer `engine-missing` instead of dying? |
| Static contracts | `copy.test.mjs`, `views.test.mjs`, `host.test.mjs` ("every route…", "every module points at files that exist") | do the client and host agree on paths, keys, classes, and file locations? |
| Pure logic | `internals.test.mjs` | sentence splitting, marks, merge, tombstones, hashes |
| Host routes | `host.test.mjs` | one route at a time against a temporary `$DSH_HOME`, with a stubbed `fetch` for upstreams |
| Panel interaction | `panel.smoke.test.mjs`, `panel.dict.test.mjs`, `panel.translate.test.mjs`, `panel.playback.test.mjs`, `panel.sync.test.mjs` | real `client.js`, real React 19, real click/type/right-click events, mock host |

The panel layer is the important one: it mounts the actual bundle through
`__ModuleLoader__`, so a missing hook, a wrong element type, or a lost parameter
fails there rather than in the browser.

## Every bug so far, and the test that now guards it

| Bug (symptom → cause) | Guard |
| --- | --- |
| Every sentence failed with `502 speech worker stopped (code 1)` — the worker path pointed at `host/worker.mjs` after the split | `host.test.mjs` "every module points at files that exist"; `panel.playback.test.mjs` (7 cases) |
| The plugin could not be installed at all — `kokoro-js` pulled in `onnxruntime-node`, whose postinstall failed on CUDA 13, and pnpm rolled the whole package back | `install.test.mjs` (two cases); `panel.playback.test.mjs` "a local engine skipped at install time is named instead of blamed on the sentence" |
| The panel crashed on the local engine: `modelLoaded is not defined` — the view split lost values | `views.test.mjs` "every view receives every panel value it uses" |
| Chinese-only mode still printed an English gloss — the row fell back to the English cache | `panel.dict.test.mjs` "Chinese-only mode never prints an English gloss in the list" |
| A model-written entry never appeared in the list — it was cached as `word\|model` but stored as `word\|model\|provider/model` | `panel.dict.test.mjs` "a model-written entry is found by the list, not only by the card" |
| Expanding a saved word overwrote the right-click card — both used one request token | `panel.dict.test.mjs` "a saved word expanded in the list does not hijack the next lookup" |
| A slow answer landed on top of a newer lookup — last response won | `panel.dict.test.mjs` "a slow answer never lands on top of a newer lookup" |
| Changing the translation source kept the old translation — only hash and line count were checked | `panel.translate.test.mjs` (4 cases) |
| The floating word card stayed over the saved-words page | `panel.smoke.test.mjs` "leaving the dialogue closes the floating card" |
| Deleted words and dialogues came back after a sync — union merge cannot delete | `host.test.mjs` "the host forgets what a panel deleted"; `internals.test.mjs` tombstone cases |
| A folder assignment made by hand (or by the tool) was erased by a browser that never saw the move — the host merged on `addedAt`, which a move does not touch | `host.test.mjs` "a move survives a save that never saw it" and "the browser and the host settle a filing the same way" |
| Unloading the plugin threw `Assignment to constant variable` — but only after a first synthesis had started the worker, so no test saw it (another module assigned to an ESM import binding) | `host.test.mjs` "the plugin unloads after the speech worker started" |
| A tool call needed a page reload to show up — the panel read the library once, on mount | `panel.sync.test.mjs` (four cases: added, deleted, its own save is not news, a corrected save is read back) |
| Sessions did not share words or dialogues — state lived in `localStorage` per origin | `host.test.mjs` "the library is shared through the host, not one browser"; `panel.dict.test.mjs` "a word saved in another session is already in the list" |
| React key warning on every mount — array child without keys | `panel.smoke.test.mjs` "the panel mounts without console errors" |
| Changing the voice did not re-read the current sentence — the clip was already downloaded | `panel.playback.test.mjs` "changing the voice re-reads the sentence that is playing" |
| The reading position was not remembered | `panel.smoke.test.mjs` "the reading position is remembered" |
| Escape did not close the settings sheet | `panel.smoke.test.mjs` "the settings card opens, collapses, and closes with Escape" |
| Next/previous moved a different sentence than the one being read | `panel.smoke.test.mjs` "next and previous move the sentence that is being read" |
| The engine section broke the page | `panel.smoke.test.mjs` "the engine section lists the speech sources without breaking the page" |
| A possessive was looked up as-is (`students'`) | `host.test.mjs` "a possessive is looked up by its base word" |
| Non-words were sent to the dictionaries | `host.test.mjs` "a word that is not a word is refused before any request goes out" |
| The Collins key was returned to the panel | `host.test.mjs` "the panel is told whether a Collins key exists, never the key" |
| The store accepted payloads it could not keep | `host.test.mjs` "the store refuses what it cannot keep" |
| A legacy dictionary record (string senses, lost example) broke the card | `internals.test.mjs` dictionary-shape cases |
| Sentence splitting cut abbreviations and decimals, joined wrapped lines, lost closing quotes | `internals.test.mjs` (seven splitting cases) |
| Word marks drifted from the rendered words when the host sent none | `internals.test.mjs` "without marks the words are spread over the clip by length" |

## What is deliberately not automated

These need eyes or a real machine, and the manual checklist below is the only
guard:

- whether audio actually makes a sound, its speed, and the word highlight moving
  with it;
- the layout: settings sheet height, wrapping in a narrow panel, the three font
  scales, the display bar;
- real dictionary and translation quality, real model download and first-sentence
  latency;
- real network failure (offline, timeouts) beyond the one synthetic 502;
- anything GPU-related.

jsdom has no layout engine: a test can prove an element exists, never that it
fits.

## Manual browser checklist

Do this before a release, and after any change to the host's files or the panel's
structure. Open the panel from the sidebar (对话朗读) and walk the list:

1. **Read** — sentences and translations line up; the counter says `n / total`.
2. **Play** — the first sentence is spoken within a second, the play button turns
   into Pause, the highlighted word moves, and the next sentence follows.
3. **Navigate** — next/previous land on the sentence the counter names.
4. **Change voice while playing** — the same sentence is read again, in the new
   voice, without stopping.
5. **Settings** — the sheet opens over the page, all four sections expand, it
   closes on Escape and on the catcher, and it never grows past the window.
6. **Dictionary** — right-click a word: the card matches the click; switch the
   display mode: a Chinese-only card shows no English definition.
7. **Save a word** — it appears in 我的单词 at once, with a Chinese gloss.
8. **Drag it** — the card follows the pointer when dragged by its head or grip, and stays put on release (the pinned 查单词 dialog drags by its grip, and its field still takes typing).
9. **Expand it** — its own entry shows, and a later right-click does not overwrite
   it (and vice versa).
10. **Switch the translation source** — the lines are replaced, not kept.
11. **Reload the page** — the reading position, words and dialogues are all still
    there.
12. **Play again** — audio still works after the reload (this is the one the
    worker-path bug broke).

## Rules when adding or changing a test

1. **Prove it fails first.** Break the fix on purpose (or revert it), run the new
   test, watch it fail, restore. A test never seen red is not a test.
2. **Mock the real shape.** The speech mock returned `200` for a route that was
   returning `502 speech worker stopped` in production. If the host can answer
   `503 {code:'preparing'}`, `413`, `502` or a network error, a case should say so.
3. **Test the action, not the markup.** Click the control a user clicks
   (`aria-label`, visible text); do not assert on internal class names unless a
   contract test already owns that name.
4. **After any split or rename**, run `test/views.test.mjs` and the static
   contracts first — they are the cheap half of the browser checklist.
5. **A new route, path, or file the host spawns** needs a contract test: the
   client calls only routes that exist, and modules point only at files that
   exist.

## Before every commit

```bash
for f in index.js client.js host/*.js worker.mjs; do node --check "$f"; done
timeout 300 node --test test/
```

Then, if the host or the panel's structure changed: reload the plugin, check
`/api-dsh-english-reader/store` and one real `/tts` request, and walk the manual
checklist above.