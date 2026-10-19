/**
 * The rules for a trial record's outcome, in one place. A record failed when
 * it has an error kind; only the agent's own failures (a timeout, an agent
 * failure) are scored, and only after their retry. Harness and quota errors
 * say nothing about the agent: the trial stays pending until it succeeds.
 */

/** Error kinds that are the agent's own, kept and scored. */
export const SCORED_ERRORS = ['timeout', 'agent'];

/**
 * An error an adapter throws to say what kind of failure a trial had:
 * `agent` (the agent's own, scored after one retry), `quota` (the harness's
 * usage or daily quota ran out: the run stops and resumes later) or
 * `harness` (anything else outside the agent: retried until it succeeds).
 * Timeouts are recognised by the trial's own deadline, not thrown.
 */
export function trialError(kind, message, options) {
  return Object.assign(new Error(message, options), { kind });
}

/** A harness message that says its usage or rate limit ran out. */
export const USAGE_LIMIT = /usage limit|hit your (usage )?limit|out of usage/i;

/** Whether a record failed, whatever its message (some errors have none). */
export function failed(record) {
  return Boolean(record.error_kind ?? record.error);
}

/** Whether a record counts toward a score: a success or the agent's failure. */
export function scoreable(record) {
  return !failed(record) || SCORED_ERRORS.includes(record.error_kind);
}

/**
 * Whether a record is a trial's final one: a success, or the agent's own
 * failure after it used its retry. Anything else is still pending.
 */
export function isFinal(record) {
  return (
    !failed(record) ||
    (scoreable(record) && (record.attempt ?? 1) >= MAX_ATTEMPTS)
  );
}

/**
 * A readable message for any thrown value. Node's network errors can be an
 * `AggregateError` with an empty message, so fall back to its parts.
 */
export function errorMessage(error) {
  if (!(error instanceof Error)) return String(error);
  return (
    error.message ||
    (error.errors ?? [])
      .map((part) => part.message || part.code)
      .filter(Boolean)
      .join('; ') ||
    error.code ||
    error.name
  );
}

/**
 * A trial that times out, or that the adapter reports as the agent's own
 * failure (such as a tool loop that never answers), is retried once; a second
 * failure is kept and scored. Any other error (network, login, an unavailable
 * model) says nothing about the agent, so the trial stays pending until a
 * rerun succeeds.
 */
export const MAX_ATTEMPTS = 2;

/**
 * The trials still to run: every question and trial number with no record,
 * or whose latest record is a harness or quota error, or a scored failure
 * with attempts left. Each comes with the attempt number it will be; only
 * scored failures use up an attempt, so a network or quota error in between
 * never costs an agent its retry.
 */
export function pendingTrials(questions, trials, done) {
  const latest = new Map(
    done.map((record) => [`${record.question_id}#${record.trial}`, record]),
  );
  return questions.flatMap((question) =>
    Array.from({ length: trials }, (_, index) => index + 1).flatMap((trial) => {
      const record = latest.get(`${question.id}#${trial}`);
      if (!record) return [{ question, trial, attempt: 1 }];
      if (!failed(record)) return [];
      const attempt = record.attempt ?? 1;
      if (!scoreable(record)) return [{ question, trial, attempt }];
      return attempt < MAX_ATTEMPTS
        ? [{ question, trial, attempt: attempt + 1 }]
        : [];
    }),
  );
}

/**
 * Keep the last record of each question and trial, in question order. A
 * trial retried after harness errors (never scored) says how many it had
 * in `harness_retries`, so the final log still shows them.
 */
export function finalRecords(questions, records) {
  const key = (record) => `${record.question_id}#${record.trial}`;
  const last = new Map(records.map((record) => [key(record), record]));
  const retries = new Map();
  for (const record of records)
    if (record !== last.get(key(record)) && !scoreable(record))
      retries.set(key(record), (retries.get(key(record)) ?? 0) + 1);
  return questions.flatMap((question) =>
    [...last.values()]
      .filter((record) => record.question_id === question.id)
      .sort((a, b) => a.trial - b.trial)
      .map((record) =>
        retries.has(key(record))
          ? { ...record, harness_retries: retries.get(key(record)) }
          : record,
      ),
  );
}
