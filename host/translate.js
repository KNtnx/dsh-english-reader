import { createHash } from 'node:crypto';
import { defaultModelRoute } from './model.js';

/**
 * Ask the Harness model to translate numbered lines, in one request.
 * @param {object} ctx - host context.
 * @param {string[]} texts - the lines.
 * @param {string} target - target language tag.
 * @param {{provider?: string, model?: string}} requested - the panel's choice.
 * @returns {Promise<string[]>} one translation per line.
 */
export async function translateWithModel(ctx, texts, target, requested) {
  const llm = ctx.get('llm');
  if (llm === undefined) throw new Error('this Harness exposes no model service');
  const route = (typeof requested?.provider === 'string' && typeof requested?.model === 'string' && requested.model !== '')
    ? { provider: requested.provider, model: requested.model }
    : defaultModelRoute(ctx);
  if (route === undefined || route.model === '') throw new Error('no model is configured to translate with');
  const system = [
    'You are a translation engine for a language learner.',
    `Translate every numbered line into ${target}.`,
    'Reply with exactly one line per input line, each starting with the same number and a tab character.',
    'Never merge, split, reorder, skip or explain lines. Keep punctuation natural for the target language.',
  ].join(' ');
  const body = texts.map((text, index) => `${index + 1}\t${text}`).join('\n');
  let output = '';
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: body }] }],
    temperature: 0,
  })) {
    if (chunk.type === 'text-delta') output += chunk.text;
    else if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'the model refused the translation');
    }
  }
  const byNumber = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s*[\t.:、)]\s*(.+)$/);
    if (match !== null) byNumber.set(Number(match[1]), match[2].trim());
  }
  const result = texts.map((_, index) => byNumber.get(index + 1) ?? '');
  if (result.some((line) => line === '')) throw new Error('the model did not return a line for every sentence');
  return result;
}

/**
 * Translate through the keyless Google endpoint, one request per line.
 * @param {string[]} texts - the lines.
 * @param {string} target - target language tag.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<string[]>} one translation per line.
 */
export async function translateWithGoogle(texts, target, signal) {
  const result = new Array(texts.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < texts.length) {
      const index = cursor;
      cursor += 1;
      const url = 'https://translate.googleapis.com/translate_a/single'
        + `?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(texts[index])}`;
      const response = await fetch(url, { signal, headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!response.ok) throw new Error(`Google Translate answered ${response.status}`);
      const data = await response.json();
      result[index] = (data?.[0] ?? []).map((segment) => segment?.[0] ?? '').join('');
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
  return result;
}

/**
 * Translate through the Volcengine web translator.
 *
 * Its public page uses this endpoint with no account and no key. It takes one
 * string per request, so a batch becomes a few concurrent calls.
 * @param {string[]} texts - sentences to translate.
 * @param {string} target - target language code.
 * @param {AbortSignal} signal - aborts the whole batch.
 * @returns {Promise<string[]>} one translation per sentence.
 */
export async function translateWithVolcengine(texts, target, signal) {
  const result = new Array(texts.length);
  const language = target.toLowerCase().startsWith('zh') ? 'zh' : target.split('-')[0];
  let cursor = 0;
  const worker = async () => {
    while (cursor < texts.length) {
      const index = cursor;
      cursor += 1;
      const response = await fetch('https://translate.volcengine.com/crx/translate/v1/', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          origin: 'https://translate.volcengine.com',
          referer: 'https://translate.volcengine.com/',
          'user-agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({ source_language: 'auto', target_language: language, text: texts[index] }),
      });
      if (!response.ok) throw new Error(`Volcengine answered ${response.status}`);
      const payload = await response.json();
      const line = payload?.translation;
      if (typeof line !== 'string' || line === '') throw new Error('Volcengine returned no translation');
      result[index] = line;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
  return result;
}

/**
 * Translate through Azure AI Translator.
 * @param {string[]} texts - the lines.
 * @param {string} target - target language tag.
 * @param {string} key - subscription key.
 * @param {string} region - subscription region, when the resource is regional.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<string[]>} one translation per line.
 */
export async function translateWithAzure(texts, target, key, region, signal) {
  const headers = { 'content-type': 'application/json', 'Ocp-Apim-Subscription-Key': key };
  if (region !== '') headers['Ocp-Apim-Subscription-Region'] = region;
  const response = await fetch(
    `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(target)}`,
    { method: 'POST', headers, body: JSON.stringify(texts.map((text) => ({ Text: text }))), signal },
  );
  if (!response.ok) throw new Error(`Microsoft Translator answered ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Microsoft Translator returned an unexpected body');
  return data.map((entry) => entry?.translations?.[0]?.text ?? '');
}

/** HMAC-SHA256 as a Buffer. */
export function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value, encoding ?? 'utf8').digest();
}

/**
 * Translate through Tencent Cloud TMT with a TC3-HMAC-SHA256 signature.
 * @param {string[]} texts - the lines.
 * @param {string} target - target language tag.
 * @param {string} secretId - SecretId.
 * @param {string} secretKey - SecretKey.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<string[]>} one translation per line.
 */
export async function translateWithTencent(texts, target, secretId, secretKey, signal) {
  const host = 'tmt.tencentcloudapi.com';
  const service = 'tmt';
  const payload = JSON.stringify({
    SourceTextList: texts,
    Source: 'en',
    Target: target.toLowerCase().startsWith('zh') ? 'zh' : target,
    ProjectId: 0,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:' + host + '\n';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, payloadHash(payload)].join('\n');
  const scope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), scope, payloadHash(canonicalRequest)].join('\n');
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      host,
      authorization,
      'x-tc-action': 'TextTranslateBatch',
      'x-tc-version': '2018-03-21',
      'x-tc-timestamp': String(timestamp),
    },
    body: payload,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.Response?.Error !== undefined) {
    const message = data?.Response?.Error?.Message ?? `Tencent TMT answered ${response.status}`;
    throw new Error(message);
  }
  return (data.Response.TargetTextList ?? []).map((text) => text ?? '');
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export function payloadHash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

