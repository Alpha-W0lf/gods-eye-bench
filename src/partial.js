/**
 * Incomplete runs: models a harness stopped part-way (for example at a usage
 * limit). Their finished trials are kept under runs/partial/<run-id>/ and
 * reported apart from complete runs, with how much they covered and how the
 * complete runs in the same harness did on the same questions, never in the
 * ranking.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { repoPath } from './config.js';
import {
  FINAL_LOG,
  PARTIAL_LOG,
  readPartialLog,
  readTrials,
  redactLocalPaths,
  RUN_RECORD,
  runQuestions,
  writeTrials,
} from './runfiles.js';
import { scoreTrial } from './score/score.js';
import { mean, round } from './score/stats.js';
import { stableJson } from './snapshot/store.js';
import { finalRecords, isFinal } from './trials.js';

/**
 * Copy an interrupted run's finished trials into `destDir`: `run.json` marked
 * partial with the reason it stopped, and `trials.jsonl.gz` with the latest
 * successful record of each trial, logs redacted. Returns the trial count.
 */
export function exportPartial(sourceDir, destDir, reason) {
  const run = JSON.parse(
    readFileSync(path.join(sourceDir, RUN_RECORD), 'utf8'),
  );
  // runs/partial/ is committed; held-out logs never leave this machine.
  if (run.questions?.split !== 'public')
    throw new Error(`${run.run_id}: only a public run can be kept as partial`);
  const questions = runQuestions(run);
  const records = finalRecords(
    questions,
    readPartialLog(path.join(sourceDir, PARTIAL_LOG)),
  )
    // Pending trials (harness or quota errors, or a failure still owed its
    // retry) are left out; final failures stay, as in a complete run.
    .filter(isFinal)
    .map((record) => ({
      ...record,
      raw_log: redactLocalPaths(record.raw_log),
    }));
  if (!records.length)
    throw new Error(`${run.run_id}: no finished trials to keep`);
  mkdirSync(destDir, { recursive: true });
  writeFileSync(
    path.join(destDir, RUN_RECORD),
    stableJson({
      ...run,
      status: 'partial',
      finished_at: null,
      stopped: reason,
    }),
  );
  writeTrials(path.join(destDir, FINAL_LOG), records);
  return records.length;
}

/** Each question's share of correct trials, from trial records. */
function perQuestion(questions, trials) {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const shares = new Map();
  for (const trial of trials) {
    const list = shares.get(trial.question_id) ?? [];
    list.push(Number(scoreTrial(byId.get(trial.question_id), trial).correct));
    shares.set(trial.question_id, list);
  }
  return new Map([...shares].map(([id, list]) => [id, mean(list)]));
}

/**
 * Summaries of every run under runs/partial/: coverage, accuracy on the
 * covered questions, and the complete runs' accuracy on those same questions.
 * `complete` is the `runs` list of the results file, with each run's logs.
 */
export function partialResults(complete, root = repoPath()) {
  const base = path.join(root, 'runs', 'partial');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .sort()
    .map((name) => path.join(base, name))
    .filter((dir) => existsSync(path.join(dir, RUN_RECORD)))
    .map((dir) => {
      const run = JSON.parse(readFileSync(path.join(dir, RUN_RECORD), 'utf8'));
      const questions = runQuestions(run, root);
      const trials = readTrials(path.join(dir, FINAL_LOG));
      const shares = perQuestion(questions, trials);
      const covered = [...shares.keys()];
      // The same harness on the same question file and prompt; a question
      // a run lacks would otherwise count as wrong.
      const others = complete
        .filter(
          (entry) =>
            entry.harness.adapter === run.harness.adapter &&
            entry.questions === run.questions.checksum &&
            entry.prompt === run.prompt_version,
        )
        .map((entry) => {
          const theirs = perQuestion(questions, entry.trials);
          return mean(covered.map((id) => theirs.get(id) ?? 0));
        });
      const ofKind = (key, value) =>
        covered.filter(
          (id) =>
            questions.find((question) => question.id === id)[key] === value,
        ).length;
      return {
        run_id: run.run_id,
        label: run.model.label,
        model: run.model,
        harness: run.harness,
        stopped: run.stopped,
        trials_done: trials.length,
        trials_planned: questions.length * run.trials_per_question,
        questions_covered: covered.length,
        questions_total: questions.length,
        covered_hard: ofKind('difficulty', 'hard'),
        covered_injected: ofKind('scenario', 'injected'),
        accuracy_on_covered: round(mean([...shares.values()])),
        same_harness_runs_on_same_questions: others.length
          ? [round(Math.min(...others)), round(Math.max(...others))]
          : null,
        provenance: {
          snapshot: run.snapshot,
          gev: run.gev,
          questions: run.questions,
          prompt_version: run.prompt_version,
        },
      };
    });
}
