# Dialogue reader

Paste an English dialogue into the right sidebar and it reads it aloud, sentence by
sentence, with two alternating voices — one per speaker. The sentence being spoken is
highlighted and scrolled into view. Dialogues are kept in a small library, and each one
remembers how far you got, so you can switch between them and pick up where you stopped.

Two engines, switchable at any time:

- **Edge online** — Microsoft's Edge neural voices. Nothing to install, needs a network
  connection, and the text is sent to Microsoft.
- **Local model** — [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)
  (Apache-2.0, 82M parameters, ~89 MB quantized) running on this machine. One click
  downloads it, and after that it works with no network at all and the text never leaves
  the machine.

## Where it lives

- A **Dialogue reader** tab in the right sidebar. It also appears as a card on the right
  sidebar's guide page.
- A headset button at the left of the composer tool row opens the panel in one click.

## The library

The panel keeps up to 60 dialogues with their title, text, and reading position. The
library lists them newest-created first, with the sentence count and where each one was
left. Open one to resume it; delete with the × (press twice to confirm).

**New dialogue** opens the editor. Editing an existing dialogue and pressing **Save and
read** replaces that dialogue rather than creating a copy. If the text changed, the saved
position goes back to the first sentence, because the old sentence numbers no longer apply.

Everything is stored in this browser's local storage. The plugin's first release kept a
single dialogue; that text is migrated into the library automatically on first open.

## Reading

1. Paste the dialogue, choose a voice for each of the two roles, choose a speed, and press
   **Start reading**.
2. Lines that start with a short label and a colon (`Emma: …`, `A: …`, or a full-width
   `：`) become turns. At most two words count as a label, so ordinary prose containing a
   colon stays prose. The first two speakers get voice A and voice B, further speakers
   alternate between them, and lines without a label are read with voice A as narration.
3. A dialogue with no labels at all alternates voices turn by turn, so a pasted two-person
   conversation without names still sounds like a conversation.

## Article or dialogue

Not everything pasted here is a conversation. The panel decides which it is and says so:

- **Dialogue** — several distinct short labels act as turns. Each speaker gets a voice, and
  narration lines use voice A. Only a dialogue shows the speaker chips.
- **Article** — everything else, including prose that happens to contain one `Note:` line,
  and a transcript where a single speaker says every line. It is read in one voice.

**Read as** in the editor overrides the decision when the guess is wrong; the choice is
stored with that dialogue.

Text arrives hard-wrapped at every visual line end, so a line that does not finish a
sentence is joined to the next one before anything is split. That keeps a sentence from
being synthesized as two fragments with a stop in the middle. A blank line, a speaker
label, or a finished sentence all end a turn; blank lines also separate paragraphs, which
show as extra spacing.

## Controls

| Control | What it does |
| --- | --- |
| Play / pause | Pauses the audio in place; pressing again resumes the same sentence |
| Previous / next sentence | Jumps one sentence and starts speaking it |
| Loop | Repeats the current sentence until you turn it off |
| Start over | Returns to the first sentence and plays it |
| Speed | 0.5× to 2×, applied to playback so the pitch does not change and nothing is re-synthesized |
| Click a sentence | Jumps there and starts speaking |
| Library / Edit | Switch views; playback pauses |

With the panel focused, <kbd>Space</kbd> plays or pauses and <kbd>←</kbd> / <kbd>→</kbd>
move one sentence. The panel keeps its own keyboard handling, so it does not take these
keys away from the composer.

The transport shows the sentence you are on (`7 / 24`), and **Finished** once the last
sentence ends; the play button then starts the dialogue again from the top.

## Translation

Every sentence can carry a translation underneath it, set in a serif face so it never
reads as part of the English. The translate button in the header shows it; the first
press fetches it, and the whole dialogue goes in one request so the lines stay aligned
with the sentences. The translation is stored with the dialogue, so reopening it costs
nothing. Editing the text — or changing how it is split between article and dialogue —
retires the translation, because the sentence numbers it was aligned to no longer apply.

**Translate with** in the editor chooses the source:

| Source | Needs | Notes |
| --- | --- | --- |
| This Harness model | nothing | The default. Pick any provider route this Harness already has configured, then any model that route advertises. Best quality. |

### Speech sources

Edge is built in and cannot be removed. Everything else is a source you add with **Add a source**, which opens a small centered dialog offering two shapes:

| Shape | What you give it | Notes |
| --- | --- | --- |
| TTS API | endpoint, protocol, model, key | Three protocols: OpenAI-compatible `/audio/speech`, Alibaba DashScope native, and Azure Speech. The domain alone is enough — the path is probed and remembered. Voices are free text. |

**Why the protocol is required**: one vendor's endpoints do not share a path or a request body. Alibaba's OpenAI-compatible prefix serves chat and embeddings only; speech lives at the native `api/v1/services/aigc/multimodal-generation/generation` and returns a download URL. The protocol decides what gets sent.
| Local model | a model folder | Point it at a directory holding `config.json` and an `onnx/` model, using the host's own directory dialog. Leave the folder empty to use the bundled Kokoro download instead. |

The host rejects a folder that does not look like a model (`400 bad-model-path`) and keeps the loaded engine per folder, so switching between two local models reloads only when the folder changes. Without marks from the engine, word highlighting falls back to an estimate spread over the clip length.

Keys never reach the browser: the API key comes from the plugin config (`ttsApiKey`) or `DSH_ENGLISH_READER_TTS_API_KEY`. Endpoints, models, folders and voices live in this browser's local storage. The same environment names set a default endpoint: `DSH_ENGLISH_READER_TTS_BASE_URL`, `_MODEL`, `_VOICE`, `_FORMAT`.

Microsoft and Tencent read their keys from the plugin row's config, which the panel cannot write, so they are not offered as choices.
`DSH_ENGLISH_READER_TARGET` says otherwise.

## The local model

Choosing **Local model** on the engine switch shows what is installed:

- Not installed — the panel offers **Download and use**, which starts the ~89 MB download
  on the machine running DSH and shows a progress bar.
- Downloading or loading — the bar shows the percentage, and asking for a sentence while
  it downloads reports that the model is being prepared instead of waiting.
- Downloaded — it reports *works offline*, and the voices become the local ones. After a
  restart it says *loads on the first sentence*: the weights are on disk, and the engine reads
  them the first time a sentence is asked for in this run, which takes a moment.

Switching engines pauses playback and forgets the sentence that was already loaded, so the
next press fetches it again from the engine you switched to.

The model lives in `~/.dsh/dsh-english-reader/models/` and is loaded on the first sentence
asked of it after a restart. Synthesis runs on the CPU, one sentence at a time; on a
24-core desktop a sentence takes about a second, which is comfortably faster than the
audio it produces, so playback does not stall.

## Audio

Clips are cached in the host process (last 64 sentences) so repeating a sentence is
instant, and the next three sentences are synthesized ahead of the one playing.

## Limitations

- **Edge needs a network connection.** The text of each sentence is sent to Microsoft. This
  is an unofficial endpoint that Microsoft can change or close; the panel then reports that
  the speech service refused the sentence and stops.
- **The local model is English and CPU-only.** It is Kokoro-82M, which is fast but not as
  natural as the best cloud voices, and the first sentence after a restart waits for the
  model to load.
- **The library is per browser.** Dialogues and positions live in this browser's local
  storage, not in a DSH session or on the host, so a different browser or cleared site data
  starts fresh. Only the downloaded model is per machine.
- **The dialogue decision is a heuristic.** Two or more distinct labels covering at least
  a quarter of the lines make a dialogue; otherwise the text is read as an article. Prose
  with two incidental `Word:` lines can be misread, and a transcript with one speaker is
  read as an article — **Read as** fixes either case.
- **Paragraphs are recovered from blank lines only.** A paste with no blank lines reads as
  one flowing paragraph, which is what the wrapping allows; sentences are still joined and
  split correctly across the hard-wrapped lines.
- **One sentence per request, 800 characters at most.** A single paragraph with no
  punctuation can exceed that; the panel then reports that the sentence is too long to
  synthesize. Add punctuation to break it up.
- **Only two sources are offered.** The Harness model and the keyless Google endpoint;
  every other provider would need a key the panel cannot collect.
- **The Google endpoint is unofficial.** It is the same service a browser uses, with no
  account and no quota agreement, so it can rate-limit, change, or stop working.
- **The routes have no authentication.** Like other DSH plugin web routes, they answer any
  caller that can reach the DSH web port. They read no files and hold no credentials. An
  outside caller could make this machine synthesize speech, and could start the model
  download once.
- **No audio is saved to disk.** Cached clips are in memory only and disappear when the
  host process restarts.

## Continuous playback

A switch right of the loop control decides what happens when a sentence ends. With it off, playback stops there and the position is kept; pressing play resumes from the same sentence.

## Dictionaries

Show, Chinese source and English source are three independent settings:

- **Show** decides which languages the card prints.
- **Chinese source** offers iciba or the model; **English source** offers WordNet, Wiktionary, Collins or the model.
- Choosing the model expands that slot's own provider and model beneath it, so each language can use a different model.
- Only the languages being shown are queried.
- The Collins key lives on the host in `dictionary.json` (mode 0600); the browser only learns whether one exists.
- Model entries are cached per `word|source|model`, so switching never pays twice.
