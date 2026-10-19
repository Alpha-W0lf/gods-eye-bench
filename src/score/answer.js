/** Read an agent's final `ANSWER:` line. */

import { DATA_STATUSES } from '../questions/template.js';

/**
 * Parse the last `ANSWER: {...}` line of a reply. Returns
 * `{ ok: true, answer, dataStatus }`, or `{ ok: false, reason }` when the line
 * is missing or malformed. Markdown code ticks around the JSON are tolerated.
 */
export function parseAnswer(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'no reply' };
  const lines = text.split('\n').filter((line) => /ANSWER:/.test(line));
  if (!lines.length) return { ok: false, reason: 'no ANSWER line' };
  const raw = lines
    .at(-1)
    .slice(lines.at(-1).indexOf('ANSWER:') + 'ANSWER:'.length)
    .trim()
    .replace(/^`+|`+$/g, '')
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'ANSWER is not JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { ok: false, reason: 'ANSWER is not an object' };
  if (!Object.hasOwn(parsed, 'answer'))
    return { ok: false, reason: 'ANSWER has no "answer"' };
  if (!DATA_STATUSES.includes(parsed.data_status))
    return { ok: false, reason: 'ANSWER has no valid "data_status"' };
  return { ok: true, answer: parsed.answer, dataStatus: parsed.data_status };
}
