/** Read an agent's final `ANSWER:` line. */

import { DATA_STATUSES } from '../questions/template.ts';
import type { FeedStatus } from '../questions/template.ts';

/** An agent's reply read: its answer and the data status it reported. */
export type ParsedAnswer =
  | { ok: true; answer: unknown; dataStatus: FeedStatus }
  | { ok: false; reason: string };

const isDataStatus = (value: unknown): value is FeedStatus =>
  DATA_STATUSES.some((status) => status === value);

/**
 * Parse the last `ANSWER: {...}` line of a reply. Returns
 * `{ ok: true, answer, dataStatus }`, or `{ ok: false, reason }` when the line
 * is missing or malformed. Markdown code ticks around the JSON are tolerated.
 */
export function parseAnswer(text: unknown): ParsedAnswer {
  if (typeof text !== 'string') return { ok: false, reason: 'no reply' };
  const lines = text.split('\n').filter((line) => /ANSWER:/.test(line));
  const last = lines.at(-1);
  if (last === undefined) return { ok: false, reason: 'no ANSWER line' };
  const raw = last
    .slice(last.indexOf('ANSWER:') + 'ANSWER:'.length)
    .trim()
    .replace(/^`+|`+$/g, '')
    .trim();
  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'ANSWER is not JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { ok: false, reason: 'ANSWER is not an object' };
  if (!Object.hasOwn(parsed, 'answer'))
    return { ok: false, reason: 'ANSWER has no "answer"' };
  if (!isDataStatus(parsed.data_status))
    return { ok: false, reason: 'ANSWER has no valid "data_status"' };
  return { ok: true, answer: parsed.answer, dataStatus: parsed.data_status };
}
