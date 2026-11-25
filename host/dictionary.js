import { defaultModelRoute } from './model.js';

export const DICTIONARY_LIMIT = 200;

/** Entries the model produced, kept so a word is only paid for once. */
export const modelEntries = new Map();

/** Definitions already fetched, so a second look at a word is free. */
export const dictionaryCache = new Map();

/** Chinese meanings, grouped by part of speech, the way a 简明 dictionary lists them. */
export const chineseCache = new Map();

/** Trim a word down to what a dictionary accepts: no quotes, punctuation or possessive. */
export function dictKey(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[’']s$/, '')
    .replace(/^[^a-z]+|[^a-z]+$/g, '')
    .trim();
}

/** Wiktionary definitions arrive as HTML; the card wants plain sentences. */
export function plainText(html) {
  return String(html ?? '')
    // Drop style and reference blocks with their contents, not just their tags.
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s*\.[a-z-]+\{[^}]*\}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collins Dictionary API entry; the key is the user's own. */
export async function lookUpCollins(word, key) {
  if (key === '') throw new Error('no Collins API key is configured');
  try {
    const response = await fetch(
      `https://api.collinsdictionary.com/api/v1/dictionaries/english/entries/${encodeURIComponent(word)}`,
      { headers: { accessKey: key, accept: 'application/json' }, signal: AbortSignal.timeout(12000) },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const entries = payload?.entries ?? [];
    const senses = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const sense of entry.senses ?? []) {
        const def = String(sense?.definition ?? '').replace(/\s+/g, ' ').trim();
        if (def === '') continue;
        senses.push({
          pos: String(entry.pos ?? '').trim(),
          def,
          example: String((sense.examples ?? [])[0] ?? '').replace(/\s+/g, ' ').trim(),
        });
        if (senses.length >= 6) break;
      }
      if (senses.length >= 6) break;
    }
    if (senses.length === 0) return null;
    return { word, phonetic: '', senses, source: 'collins' };
  } catch {
    return null;
  }
}

/**
 * Fetch one word from Wiktionary.
 *
 * A miss is normal: this endpoint only knows single English words, so phrases
 * fall through to the translation source on the panel side.
 * @param {string} word - the normalized word.
 * @returns {Promise<object|null>} the entry, or null when it is unknown.
 */
/** WordNet definitions through Datamuse; free, keyless, and already tagged by part of speech. */
export async function lookUpWordNet(word) {
  try {
    const response = await fetch(
      `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=dp&max=1`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const first = Array.isArray(payload) ? payload[0] : null;
    if (first === null || String(first.word ?? '').toLowerCase() !== word) return null;
    const senses = [];
    for (const line of first.defs ?? []) {
      const [pos, ...rest] = String(line).split('\t');
      const meaning = rest.join(' ').trim();
      if (meaning === '') continue;
      senses.push({ pos: String(pos).trim(), def: meaning, example: '' });
      if (senses.length >= 6) break;
    }
    if (senses.length === 0) return null;
    return { word, phonetic: '', senses, source: 'wordnet' };
  } catch {
    return null;
  }
}

export async function lookUpWord(word) {
  if (dictionaryCache.has(word)) return dictionaryCache.get(word);
  let payload;
  try {
    const response = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }
  const groups = Array.isArray(payload?.en) ? payload.en : [];
  const senses = [];
  for (const group of groups) {
    for (const definition of group.definitions ?? []) {
      if (senses.length >= 6) break;
      const text = plainText(definition.definition);
      if (text === '') continue;
      senses.push({
        pos: plainText(group.partOfSpeech ?? ''),
        def: text.length > 260 ? `${text.slice(0, 257)}…` : text,
        example: plainText(Array.isArray(definition.examples) ? definition.examples[0] : ''),
      });
    }
    if (senses.length >= 6) break;
  }
  if (senses.length === 0) return null;
  const entry = { word, phonetic: '', senses, source: 'wiktionary' };
  dictionaryCache.set(word, entry);
  if (dictionaryCache.size > DICTIONARY_LIMIT) {
    const oldest = dictionaryCache.keys().next();
    if (!oldest.done) dictionaryCache.delete(oldest.value);
  }
  return entry;
}

export async function lookUpChinese(word) {
  if (chineseCache.has(word)) return chineseCache.get(word);
  let payload;
  try {
    const response = await fetch(
      `https://dict-mobile.iciba.com/interface/index.php?c=word&m=getsuggest&nums=1&is_need_mean=1&word=${encodeURIComponent(word)}`,
      { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(9000) },
    );
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }
  const first = Array.isArray(payload?.message) ? payload.message[0] : null;
  if (first === null) return null;
  const senses = [];
  for (const group of first.means ?? []) {
    const meanings = (group.means ?? []).filter((text) => typeof text === 'string' && text !== '');
    if (meanings.length === 0) continue;
    senses.push({ pos: String(group.part ?? ''), def: meanings.join('；') });
    if (senses.length >= 6) break;
  }
  if (senses.length === 0) return null;
  const entry = { word: String(first.key ?? word), phonetic: '', senses, source: 'iciba' };
  chineseCache.set(word, entry);
  if (chineseCache.size > DICTIONARY_LIMIT) {
    const oldest = chineseCache.keys().next();
    if (!oldest.done) chineseCache.delete(oldest.value);
  }
  return entry;
}

/**
 * Ask the configured model for a dictionary entry.
 *
 * The prompt is written to produce what a good learner's dictionary prints:
 * a full-sentence English definition rather than a synonym list, a short
 * Chinese gloss, and one natural example. Strict JSON keeps the parsing
 * boring, and the reply is cached per word so switching dictionary kinds
 * never pays for the same word twice.
 */
export async function defineWithModel(ctx, word, requested) {
  const cached = modelEntries.get(word);
  if (cached !== undefined) return cached;
  const llm = ctx.get('llm');
  if (llm === undefined) throw new Error('this Harness exposes no model service');
  const route = (typeof requested?.provider === 'string' && typeof requested?.model === 'string' && requested.model !== '')
    ? { provider: requested.provider, model: requested.model }
    : defaultModelRoute(ctx);
  if (route === undefined || route.model === '') throw new Error('no model is configured');
  const system = [
    'You are the editor of a learner\'s dictionary in the style of Collins COBUILD and the',
    'Concise Oxford: full sentences that explain a word through its use, never bare synonym',
    'lists, no encyclopaedic padding, no etymology unless it changes the meaning.',
    'For the given English word or phrase, reply with JSON only, no prose and no code fences:',
    '{"word":"as asked","phonetic":"IPA without slashes, or empty","senses":[{"pos":"v.","en":"one complete English sentence defining this sense in context, 12-22 words","zh":"简体中文释义，一个短语，不加句号","example":"a short natural sentence using the word"}]}',
    'Rules: 1-4 senses, most common first; pos uses the short form (v., n., adj., adv., phr.);',
    'the English definition must be a sentence a learner can read aloud; the example must not',
    'repeat the definition; if the word has a common figurative sense, include it after the literal one.',
  ].join(' ');
  let output = '';
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: word }] }],
    temperature: 0.3,
  })) {
    if (chunk.type === 'text-delta') output += chunk.text;
    else if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'the model refused to define the word');
    }
  }
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('the model did not answer with JSON');
  let parsed;
  try {
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch {
    throw new Error('the model answered with JSON that does not parse');
  }
  const senses = (Array.isArray(parsed.senses) ? parsed.senses : [])
    .filter((sense) => sense !== null && typeof sense === 'object')
    .map((sense) => ({
      pos: String(sense.pos ?? '').trim(),
      def: String(sense.en ?? '').trim(),
      zh: String(sense.zh ?? '').trim(),
      example: String(sense.example ?? '').trim(),
    }))
    .filter((sense) => sense.def !== '');
  if (senses.length === 0) throw new Error('the model returned no usable sense');
  const entry = {
    word: String(parsed.word ?? word),
    phonetic: String(parsed.phonetic ?? '').replace(/^\/+|\/+$/g, ''),
    senses,
    source: 'model',
  };
  modelEntries.set(word, entry);
  if (modelEntries.size > DICTIONARY_LIMIT) {
    const oldest = modelEntries.keys().next();
    if (!oldest.done) modelEntries.delete(oldest.value);
  }
  return entry;
}

