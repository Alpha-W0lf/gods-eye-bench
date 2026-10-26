/**
 * Results: every finished run, rescored from its logs, in one data file
 * (results/results.json). Held-out logs never leave the maintainer's machine,
 * so their aggregate is kept beside the run as heldout.json and reused when
 * the logs are absent (ADR 0007).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoPath } from './config.js';
import { partialResults } from './partial.js';
import { FINAL_LOG, readTrials, RUN_RECORD, runQuestions } from './runfiles.js';
import { aggregateTrials } from './score/aggregate.ts';
import { sha256 } from './snapshot/key.ts';
import { stableJson } from './snapshot/store.ts';

/** 2: per-run bench versions, held-out question set, new measures. */
export const RESULTS_SCHEMA = 2;
export { readTrials, runQuestions };

export const RUN_STATUSES = Object.freeze(['verified', 'community']);

/** Finished runs under `runs/<status>/`, as `{ dir, run }`, in a stable order. */
export function listRuns(root = repoPath()) {
  return RUN_STATUSES.flatMap((status) => {
    const base = path.join(root, 'runs', status);
    if (!existsSync(base)) return [];
    return readdirSync(base)
      .sort()
      .map((name) => path.join(base, name))
      .filter((dir) => existsSync(path.join(dir, RUN_RECORD)))
      .map((dir) => ({
        dir,
        run: JSON.parse(readFileSync(path.join(dir, RUN_RECORD), 'utf8')),
      }))
      .filter(
        ({ dir, run }) =>
          run.finished_at && run.status === status && !heldoutRunning(dir),
      );
  });
}

/**
 * Whether a run's held-out split has started here but not finished. Such a
 * run waits for it, so a model never enters the results half-done (a
 * model on a daily request quota can finish its public questions weeks
 * before the rest).
 */
function heldoutRunning(dir) {
  const file = path.join(dir, 'heldout', RUN_RECORD);
  return (
    existsSync(file) && !JSON.parse(readFileSync(file, 'utf8')).finished_at
  );
}

/**
 * The held-out aggregate of a run: computed from local held-out logs when they
 * exist (and written to heldout.json when `save`), otherwise read from
 * heldout.json.
 */
export function heldoutResult(dir, root = repoPath(), save = false) {
  const saved = path.join(dir, 'heldout.json');
  const runFile = path.join(dir, 'heldout', RUN_RECORD);
  const trialsFile = path.join(dir, 'heldout', FINAL_LOG);
  if (existsSync(runFile) && existsSync(trialsFile)) {
    const run = JSON.parse(readFileSync(runFile, 'utf8'));
    const questions = run.finished_at ? runQuestions(run, root) : null;
    if (questions) {
      const result = {
        ...aggregateTrials(questions, readTrials(trialsFile)),
        // Which held-out set was asked: its checksum ties every published
        // held-out score to one secret question file.
        question_set: {
          checksum: run.questions.checksum,
          count: run.questions.count,
        },
        trials_sha256: sha256(readFileSync(trialsFile)),
      };
      if (save) writeFileSync(saved, stableJson(result));
      return result;
    }
  }
  return existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')) : null;
}

/** The first bench version: nothing ran before it. */
const FIRST_VERSION = '0.1.0';

/**
 * Every bench version that ran a run's trials. Trials from before per-trial
 * stamps carry none, and their run record kept only its last session's
 * version, so they ran on that version or an earlier one ("≤0.1.2").
 */
function benchVersions(run, trials) {
  const recorded =
    run.sessions?.find((session) => session.recorded)?.bench_version ??
    run.bench_version;
  const unstamped = recorded === FIRST_VERSION ? recorded : `≤${recorded}`;
  const versions = new Set(
    trials.map((trial) => trial.bench_version ?? unstamped),
  );
  // "≤0.1.2" already covers trials stamped 0.1.2.
  if (unstamped !== recorded && versions.has(unstamped))
    versions.delete(recorded);
  const plain = (version) => version.replace('≤', '');
  return [...versions].sort((a, b) =>
    plain(a).localeCompare(plain(b), 'en', { numeric: true }),
  );
}

/** One run's entry in the results file. */
export function runResult({ dir, run }, root = repoPath(), save = false) {
  const trialsFile = path.join(dir, FINAL_LOG);
  const questions = runQuestions(run, root);
  if (!questions)
    throw new Error(`${run.run_id}: ${run.questions.file} is missing`);
  const trials = readTrials(trialsFile);
  const reported = [
    ...new Set(trials.map((trial) => trial.model_reported).filter(Boolean)),
  ];
  return {
    run_id: run.run_id,
    status: run.status,
    label: run.model.label,
    model: { ...run.model, reported },
    harness: run.harness,
    trials_per_question: run.trials_per_question,
    public: aggregateTrials(questions, trials),
    heldout: heldoutResult(dir, root, save),
    provenance: {
      bench_version: run.bench_version,
      bench_versions: benchVersions(run, trials),
      prompt_version: run.prompt_version,
      gev: run.gev,
      snapshot: run.snapshot,
      questions: run.questions,
      trials_file: path.relative(root, trialsFile),
      trials_sha256: sha256(readFileSync(trialsFile)),
      started_at: run.started_at,
      finished_at: run.finished_at,
      host: run.host,
    },
  };
}

/**
 * The whole results file: complete runs sorted by status, then public
 * accuracy, and incomplete runs apart (src/partial.js).
 * `save` writes each run's held-out aggregate beside it (`geb score` only).
 */
export function buildResults({ root = repoPath(), save = false } = {}) {
  const listed = listRuns(root);
  const runs = listed
    .map((entry) => runResult(entry, root, save))
    .sort(
      (a, b) =>
        RUN_STATUSES.indexOf(a.status) - RUN_STATUSES.indexOf(b.status) ||
        b.public.accuracy - a.public.accuracy ||
        a.label.localeCompare(b.label),
    );
  const complete = listed
    .filter(({ run }) => run.status === 'verified')
    .map(({ dir, run }) => ({
      harness: run.harness,
      questions: run.questions.checksum,
      prompt: run.prompt_version,
      trials: readTrials(path.join(dir, FINAL_LOG)),
    }));
  return {
    schema: RESULTS_SCHEMA,
    runs,
    partial: partialResults(complete, root),
  };
}
