/**
 * Provenance checks for every run (ADR 0008): the snapshot and question
 * checksums, the God's Eye View commit, the prompt, and a complete set of
 * trials. Returns a list of problems; an empty list means the run checks out.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BENCH, repoPath } from './config.js';
import { snapshotDir } from './paths.js';
import { buildPrompt, PROMPT_VERSION } from './prompt.js';
import { listRuns, readTrials, runQuestions } from './results.js';
import { loadSnapshot } from './snapshot/store.ts';
import { isFinal, MAX_ATTEMPTS, scoreable } from './trials.js';
import { FINAL_LOG, RUN_RECORD } from './runfiles.js';

/** Problems with one run. */
export function verifyRun({ dir, run }) {
  const problems = [];
  const fail = (message) => problems.push(`${run.run_id}: ${message}`);
  if (run.gev?.commit !== BENCH.gev.commit)
    fail(
      `ran against God's Eye View ${run.gev?.commit?.slice(0, 12)}, not the pinned ${BENCH.gev.commit.slice(0, 12)}`,
    );
  let snapshotPath = null;
  try {
    snapshotPath = snapshotDir(run.snapshot?.id);
  } catch (error) {
    fail(error.message);
  }
  if (snapshotPath && !existsSync(snapshotPath))
    fail(`snapshot ${run.snapshot?.id} is missing`);
  else if (snapshotPath) {
    try {
      if (loadSnapshot(snapshotPath).checksum !== run.snapshot.checksum)
        fail(`snapshot ${run.snapshot.id} checksum differs`);
    } catch (error) {
      fail(error.message);
    }
  }
  let questions = null;
  try {
    questions = runQuestions(run);
    if (!questions) fail(`${run.questions.file} is missing`);
  } catch (error) {
    fail(error.message);
  }
  if (!questions) return problems;
  const trialsFile = path.join(dir, FINAL_LOG);
  if (!existsSync(trialsFile))
    return [...problems, `${run.run_id}: trials.jsonl.gz is missing`];
  const trials = readTrials(trialsFile);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const expected = questions.length * run.trials_per_question;
  if (trials.length !== expected)
    fail(`${trials.length} trials, expected ${expected}`);
  const seen = new Set();
  for (const trial of trials) {
    const question = byId.get(trial.question_id);
    const key = `${trial.question_id}#${trial.trial}`;
    if (!question) fail(`trial for unknown question ${trial.question_id}`);
    else if (
      run.prompt_version === PROMPT_VERSION &&
      trial.prompt !== buildPrompt(question)
    )
      fail(`${key} was not given the benchmark's prompt`);
    if (seen.has(key)) fail(`${key} appears twice`);
    seen.add(key);
    problems.push(...trialProblems(run, question, trial));
  }
  return problems;
}

/**
 * Problems with one final trial record: it must be one the rules score (a
 * success, or the agent's own failure after its retry), within the run's
 * trial count, and asked in its question's scenario.
 */
function trialProblems(run, question, trial) {
  const key = `${run.run_id}: ${trial.question_id}#${trial.trial}`;
  const problems = [];
  if (!scoreable(trial))
    problems.push(
      `${key} ended in a ${trial.error_kind} error, which is never scored`,
    );
  else if (!isFinal(trial))
    problems.push(
      `${key} is a ${trial.error_kind} failure that never got its retry`,
    );
  if (!(trial.trial >= 1 && trial.trial <= run.trials_per_question))
    problems.push(
      `${key} is outside the run's ${run.trials_per_question} trials`,
    );
  if ((trial.attempt ?? 1) > MAX_ATTEMPTS)
    problems.push(`${key} is attempt ${trial.attempt}, above ${MAX_ATTEMPTS}`);
  if (question && trial.scenario !== question.scenario)
    problems.push(`${key} ran in ${trial.scenario}, not ${question.scenario}`);
  return problems;
}

/** Problems with an incomplete run: provenance only, since trials are missing. */
export function verifyPartialRun({ dir, run }) {
  const problems = [];
  const fail = (message) =>
    problems.push(`${run.run_id} (partial): ${message}`);
  if (run.gev?.commit !== BENCH.gev.commit)
    fail("ran against another God's Eye View commit");
  try {
    if (
      loadSnapshot(snapshotDir(run.snapshot?.id)).checksum !==
      run.snapshot.checksum
    )
      fail('snapshot checksum differs');
    if (!runQuestions(run)) fail(`${run.questions.file} is missing`);
  } catch (error) {
    fail(error.message);
  }
  const trialsFile = path.join(dir, FINAL_LOG);
  if (!existsSync(trialsFile)) fail('trials.jsonl.gz is missing');
  else
    for (const trial of readTrials(trialsFile))
      if (!isFinal(trial))
        fail(
          `${trial.question_id}#${trial.trial} is not a final record (${trial.error_kind})`,
        );
  if (!run.stopped) fail('no reason given for stopping');
  return problems;
}

/** Problems with every finished and incomplete run. */
export function verifyAll(root = repoPath()) {
  const partialBase = path.join(root, 'runs', 'partial');
  const partial = existsSync(partialBase)
    ? readdirSync(partialBase, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => {
          const dir = path.join(partialBase, name);
          return {
            dir,
            run: JSON.parse(readFileSync(path.join(dir, RUN_RECORD), 'utf8')),
          };
        })
    : [];
  return [
    ...listRuns(root).flatMap(verifyRun),
    ...partial.flatMap(verifyPartialRun),
  ];
}
