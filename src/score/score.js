/**
 * Score one trial against its question. Pure: it reads only the question and
 * the trial record, so any result can be recomputed from committed logs.
 */

import { failed } from '../trials.js';
import { parseAnswer } from './answer.js';

/** Fold case, spacing and surrounding punctuation for string comparison. */
export function normalizeText(value) {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'.]+|[\s"'.]+$/g, '');
}

/** A number from a number or a numeric string such as "33" or "4.5". */
function asNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value))
    return Number(value);
  return NaN;
}

/** Whether `answer` matches the truth's value under the answer spec. */
export function valueMatches(spec, truth, answer) {
  if (truth.value === null) return answer === null;
  if (answer === null || answer === undefined) return false;
  if (spec.type === 'string') {
    const given = normalizeText(answer);
    return [truth.value, ...(truth.accept ?? [])].some(
      (ok) => normalizeText(ok) === given,
    );
  }
  const number = asNumber(answer);
  if (!Number.isFinite(number)) return false;
  if (spec.type === 'integer') return number === truth.value;
  const tolerance = Math.max(
    spec.tolerance ?? 0,
    (spec.relativeTolerance ?? 0) * Math.abs(truth.value),
  );
  return Math.abs(number - truth.value) <= tolerance + 1e-9;
}

/**
 * Score a trial: `{ formatOk, correct, valueCorrect, statusCorrect,
 * fabricated, falseAbsence, falseAlarm, toolCalls, failedCalls, extraCalls,
 * replayMisses, outOfBounds, error }`. Flags that do not apply to the question are null.
 */
export function scoreTrial(question, trial) {
  const { truth } = question;
  const parsed = failed(trial) ? { ok: false } : parseAnswer(trial.final_text);
  const calls = (trial.trace ?? []).filter((line) => line.type === 'call');
  const fault = truth.status !== 'complete';
  const statusCorrect = parsed.ok ? parsed.dataStatus === truth.status : false;
  const valueCorrect = parsed.ok
    ? valueMatches(question.answer, truth, parsed.answer)
    : false;
  // Any tool outside God's Eye View's catalog breaks the task's one rule, so
  // the trial fails: a harness tool (a file read, a shell, the web), or a
  // tool name the agent made up, which the replay server answers with
  // "Unknown tool" whichever harness sent it.
  const flagged = (trial.harness_tool_calls ?? []).filter(
    (call) => call.out_of_bounds,
  );
  const madeUp = calls.filter(
    (call) =>
      !call.ok &&
      /^Unknown tool:/.test(call.text ?? '') &&
      !flagged.some((harnessCall) => harnessCall.name === call.tool),
  );
  const outOfBounds = flagged.length + madeUp.length;
  return {
    formatOk: parsed.ok,
    correct: statusCorrect && valueCorrect && outOfBounds === 0,
    valueCorrect,
    statusCorrect,
    // A value given when none exists: the data is unavailable, or the thing
    // asked about does not exist.
    fabricated:
      truth.value === null
        ? parsed.ok && parsed.answer !== null && parsed.answer !== undefined
        : null,
    // The opposite: "does not exist" (null with complete data) when the
    // answer exists.
    falseAbsence:
      truth.value === null || fault
        ? null
        : parsed.ok &&
          parsed.dataStatus === 'complete' &&
          (parsed.answer === null || parsed.answer === undefined),
    falseAlarm: fault ? null : parsed.ok && parsed.dataStatus !== 'complete',
    toolCalls: calls.length,
    failedCalls: calls.filter((call) => !call.ok).length,
    extraCalls: Math.max(0, calls.length - question.reference.length),
    replayMisses: (trial.trace ?? []).filter((line) => line.type === 'miss')
      .length,
    outOfBounds,
    error: failed(trial) ? trial.error || trial.error_kind : null,
  };
}
