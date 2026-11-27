<div align="center">

<img src="icon.svg" width="64" alt="dsh-english-reader"/>

# dsh-english-reader

**Read English aloud inside DeepSeek Harness: paste a passage, follow sentence by sentence, resume exactly where you stopped.**

A right-sidebar tab, or a full-width panel of its own. Word-level highlighting, sentence translation, Microsoft Edge and local Kokoro engines, plus your own TTS API.

[中文](README.md) · [English](README.en.md)

<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
<a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white" alt="powered by dsh"></a>

</div>

## Why

Reading English long-form splits your attention: the audio is on sentence 12 while your eyes are on sentence 30, and coming back loses both.

This plugin ties "what is spoken" to "what is read": sentence-level seeking, word-level highlighting, persisted progress. Close the panel, restart Harness — you land on the same sentence.

It handles both shapes: a hard-wrapped **article** is joined into sentences instead of being split mid-thought, and a labelled **dialogue** (`Emma: Hi` / `Daniel: Hello`) is detected and read by two alternating voices.

<p align="center">
  <img src="docs/reader-2.png" width="880" alt="Dialogue reading: alternating speakers, the current line highlighted, English and its translation paired, settings on the right"/>
</p>

<br clear="all">

## Features

- **Two entry points**: a right-sidebar tab, or a full-width side panel (no composer in the way).
- **Sentence playback with resume**: click any sentence to start there; progress is persisted.
- **Word-level highlight**: Edge reports **real word timestamps**, so the current word tracks the audio. The local engine estimates.
- **Sentence translation**: any model you already configured in Harness (pick provider, then model), or one of two keyless services: Google and Volcengine.
- **Article vs dialogue**: hard wraps are joined, paragraphs split on blank lines, two voices only when two speakers are actually detected.
- **Dialogue library**: keep many texts, rename, pin, delete; each row shows "sentence n of m".
- **Loop and continuous playback**: looping one sentence and "continue to the next" are separate switches; turn the second off and playback stops on the sentence.
- **Right-click a word**: only the sentence being read splits into words; hovering outlines them, right-click opens the definition.
- **Chinese and English dictionaries**: Chinese meanings grouped by part of speech (简明-style), English definitions with examples; choose both, English only, or Chinese only.
- **Saved words**: save from the card, reach the list from the header, and expand an entry in place with its examples and source sentence.
- **Reading width and type size**: narrow / medium / wide / custom, three type presets plus an exact pixel size, shared by the reader, the library and the saved words.

The settings card has four collapsible sections; only the engine starts open, and the ones you expand are remembered. Open what you need and the card stays inside the window.

## Install

**From GitHub (recommended)**

In DSH **Plugins → Add plugin**, enter:

```
github:KNtnx/dsh-english-reader
```

Or on the command line:

```bash
dsh plugin --profile web add github:KNtnx/dsh-english-reader
```

**From a local checkout**

```bash
git clone https://github.com/KNtnx/dsh-english-reader.git
dsh plugin --profile web add link:./dsh-english-reader
```

Replace `web` with your profile (Desktop builds usually use `desktop`), then restart `dsh web`.

> Only `msedge-tts` is a required dependency; the local engine `kokoro-js` is **optional**. It brings in `onnxruntime-node`, whose install script probes the machine's CUDA and fails when it does not recognize the version (CUDA 13, for example) — that script used to roll the whole plugin installation back. It no longer can: a failed optional dependency costs at most `onnxruntime-node`, so the **local model** is unavailable while the plugin and the Edge voices install and work as usual.
>
> If DSH asks whether to allow install scripts, approving them completes the installation (`msedge-tts`'s script only checks the package manager; skipping it does not affect playback). To use the local model, bring the engine back as described under troubleshooting.

## Speech sources

Edge is built in; everything else is a source you add. Each can be renamed, edited and removed on its own.

| Source | Needs | Notes |
| --- | --- | --- |
| Microsoft Edge (online) | nothing | Neural voices, needs a network. Its word boundaries drive the highlight. |
| Local model (Kokoro-82M) | an 89 MB download | Runs offline, or point it at a folder you already have (with `config.json` and `onnx/`). The engine is an optional dependency and may be skipped at install time. |
| Custom TTS API | endpoint, protocol, model, key | Three protocols: OpenAI-compatible `/audio/speech`, Alibaba DashScope native, Azure Speech (SSML). The domain alone is enough — paths are probed and remembered. |

**Why the protocol is required**: one vendor's endpoints do not share a path or a body. Alibaba's OpenAI-compatible prefix serves chat and embeddings only; speech lives at the native `api/v1/services/audio/tts/SpeechSynthesizer` and returns a download URL.

**Keys never reach the browser**: the panel only sees `hasKey: true`. Source records live in `$DSH_HOME/dsh-english-reader/sources.json` (mode `0600`), and the host attaches the key for connection tests, model lists and voice lists.

## Dictionaries

Three independent settings:

**Show**: Both / English / Chinese — what the card prints

**Chinese source**: iciba (free) / your model

**English source**: WordNet (free) / Wiktionary (free) / Collins (needs a key) / your model

Choosing the model source expands **that slot's own provider and model right beneath it**, so the two languages can use different models. Only the languages being shown are queried, so English-only mode never spends a Chinese lookup.

| Source | Language | Needs | Notes |
| --- | --- | --- | --- |
| iciba | Chinese | nothing | Grouped by part of speech; phrases work too |
| WordNet (Datamuse) | English | nothing | Full-sentence definitions with clear part-of-speech tags |
| Wiktionary | English | nothing | Backup beyond WordNet |
| Collins | English | **your own API key** | Official API; the key lives on the host in `$DSH_HOME/dsh-english-reader/dictionary.json` (mode `0600`) and the browser only learns whether one exists |
| Your model | both | your DSH model | Collins-style sentences, IPA, Chinese gloss and an example |

The model writes complete sentences (`To regulate an activity means to control it by means of official rules.`) rather than synonym lists. **Each word is generated once**, cached per `word|source|model`, so switching language, source or model never pays twice. Translation is only used when neither source has an entry.

Lookups are limited to the sentence being read, so a long article never pays for per-word nodes.

## Saved words

- Click a row to **expand it in place**: Chinese by part of speech, English definitions with examples, then the sentence it came from.
- The expansion **follows the current dictionary**: switching source or shown language re-resolves it instead of freezing the answer it was saved with.
- Only the **word and its sentence** are stored; the definitions come from the dictionary or the cache, so one word reads from WordNet in English mode and from iciba in Chinese mode.
- Three speakers: the word, each English example, and the source sentence. A word saved from the lookup card has no sentence, so that speaker is greyed out.
- Both the saved-words page and the library return to the open dialogue in one click, and both share the reader's width and size controls.
- **Shared across conversations**: the library, the reading positions and the saved words live on the host (`library.json`), not in one browser's storage, so every conversation and every browser opens the same list.

<p align="center">
  <img src="docs/words-2.png" width="640" alt="Saved words: revive expanded, Chinese senses by part of speech, English definitions with examples and speakers, the source sentence at the end"/>
</p>

## The model tool (`english_reader`)

A conversation can read and edit this library without you opening the panel: list the words
and dialogues, filter them by folder, add words, retitle or delete a dialogue, switch the
dictionary — all through one tool.

- **File by name**: `folder` takes a name (`25.12.1`) and makes it when it is new; `folderId`
  takes one from `list_folders`, and a wrong id is an error that lists the folders there are.
- **Batches**: `add_words`, `move_words` and `remove_words` take a list, so filing ten words
  is one call rather than ten.
- **One change per call**, reads apart from writes, so a listing tells the id before it is
  needed.
- **A filing survives a merge**: where an entry lives is settled by the moment it was last
  moved, so a browser, a second panel and a tool call writing the same file cannot undo each
  other's folders.
- **No reload needed**: an open panel checks the host's revision every two seconds (and not
  at all while hidden), so what a tool just wrote appears by itself.

## Translation sources

| Source | Needs | Notes |
| --- | --- | --- |
| Harness model | a configured provider and model | Reuses what Harness already has; the best quality |
| Google | nothing | Keyless `translate.googleapis.com` |
| Volcengine | nothing | Keyless web endpoint; reads more naturally in Chinese |

A translation is tagged with the source and model that produced it, so switching source (or model) re-translates and replaces the lines on screen instead of leaving the previous source's version in place.

## Privacy

- Text is synthesized only by the engine you pick: the local model stays offline, Edge and custom APIs send the sentence to that vendor.
- A lookup sends only the word you right-clicked to the dictionary source, never the whole text.
- API keys stay on the host and are never sent to the browser or written to browser storage.
- Local models, source records and the dialogue library live under `$DSH_HOME/dsh-english-reader/` and are not uploaded.
- Translation and speech requests are made from the host, never from the panel.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Blank panel | Check the browser console; usually the client bundle did not load — restart `dsh web` |
| "Local engine not installed" | The optional dependency was skipped at install time; see "The local engine and install scripts" below. Edge-only users can ignore this |
| Local model stuck at "not downloaded" | Press Download and wait for 100%; models live in `$DSH_HOME/dsh-english-reader/models/` |
| Custom API returns 400 / 401 | Use **Test** in the editor — it names the path and the original response. 401 means the vendor rejected the key |
| A voice is ignored | Some vendors silently fall back on unknown voices; try a source that reports errors |
| Word highlight does not move | Only Edge reports word timestamps; other sources estimate from length |
| A lookup always says nothing was found | Dictionaries need a network; check the dictionary setting first, and note that an unusual phrase falls back to translation |
| A saved word says "none" for its sentence | Words saved from the dictionary card have no source sentence, by design |
| The panel is blank again | The render error boundary prints the stack; send it over instead of a screenshot |

### The local engine and install scripts

`kokoro-js` is an optional dependency, and its native runtime `onnxruntime-node` probes the machine's CUDA during install. When that probe fails, pnpm drops the package and the panel says "local engine not installed". Two ways back:

- **Recover now**: in the profile directory run

  ```bash
  pnpm add --ignore-scripts kokoro-js@^1.2.1
  ```

  then restart `dsh web`. `onnxruntime-node` ships its CPU binary inside the npm package, so skipping the build scripts does not affect local inference. This records `kokoro-js` as a direct dependency of the profile; with a `link:` install, run `npm install --ignore-scripts` in the plugin directory instead.
- **Make it stick**: state all four build scripts explicitly in the profile's `pnpm-workspace.yaml` (take the versions from the install log), so a later install cannot drop the engine again:

  ```yaml
  allowBuilds:
    msedge-tts@2.1.1: true
    protobufjs@7.6.6: true
    onnxruntime-node@1.21.0: false
    sharp@0.34.5: false
  ```

  Approving `onnxruntime-node` is the harmful choice: on CUDA 13 that script always fails and pnpm then removes the package, while its prebuilt CPU binary was already in the package.

## Development

**Read [AGENTS.md](AGENTS.md) before changing code.** It is a routing table: it points at the eight module docs and 46 sub-module docs under `docs/modules/`, one per thing you might want to change. Read that page's invariants, change the code, then write the doc back.

```bash
npm install                       # once: react, react-dom and jsdom are devDependencies
npm test                          # the whole suite, about a second
node --check index.js client.js worker.mjs
dsh plugin --profile web add link:$(pwd)
```

The tests mount the real panel in jsdom and click it, because every bug that got
through a manual check lived in state written by two interactions at once. What
is covered, what is deliberately not (layout, audio, real networks), and how to
add a test for a reported bug are in [docs/TESTING.md](docs/TESTING.md) (browser procedure: [docs/TESTING.zh.md](docs/TESTING.zh.md)).

```
package.json        plugin manifest (dsh.bundle.patch + dsh.client)
cordis.patch.yml    host row insertion
index.js            host: routes, source storage, four translators, two TTS protocol families
worker.mjs          child process: Edge and Kokoro engines, word-boundary parsing
client.js           browser: reader panel, settings card, add-source dialog, word highlight
```

## License

MIT, except where stated otherwise. See [LICENSE](LICENSE).
