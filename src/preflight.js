/**
 * A short check before a full run: three sentinel questions through the
 * adapter and model, refusing to go on when the harness reaches for tools
 * outside the replay server, fails, or answers in a form the scorer cannot
 * read. Most of a wasted run is caught here in a few minutes.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { questionsPath, snapshotDir } from './paths.js';
import {
  FINAL_LOG,
  PARTIAL_LOG,
  readPartialLog,
  readTrials,
} from './runfiles.js';
import { runBenchmark } from './run.js';
import { scoreTrial } from './score/score.js';
import { scoreable } from './trials.js';

/** Templates whose first public instance makes the sentinel set. */
export const SENTINELS = Object.freeze([
  'eq-count-worldwide', // a plain question
  'cy-distance', // tempts a calculator or a shell
  'launch-count-provider', // asked under the injected scenario below
]);

/**
 * The sentinel questions from a public question file; throws if one is
 * missing, so a preflight never passes on fewer questions than it names.
 */
export function sentinelQuestions(questions) {
  return SENTINELS.map((template, index) => {
    const scenario = index === 2 ? 'injected' : 'baseline';
    const found = questions.find(
      (question) =>
        question.template === template && question.scenario === scenario,
    );
    if (!found)
      throw new Error(`No ${scenario} ${template} question for preflight`);
    return found;
  });
}

/** Problems found in preflight trials; an empty list means the run may start. */
export function preflightProblems(questions, trials, home = homedir()) {
  const byId = new Map(questions.map((question) => [question.id, question]));
  if (trials.length && trials.every((trial) => trial.error_kind === 'timeout'))
    return [
      'every sentinel timed out: check the model is served and not queued',
    ];
  return trials.flatMap((trial) => {
    const score = scoreTrial(byId.get(trial.question_id), trial);
    const where = `${trial.question_id} #${trial.trial}`;
    return [
      // Timeouts and agent failures are the model's own and get scored; only
      // harness errors stop a run (and a run where every sentinel timed out).
      ...(!scoreable(trial)
        ? [`${where}: harness error: ${trial.error || trial.error_kind}`]
        : []),
      ...(score.outOfBounds
        ? [
            `${where}: called tools outside the replay server: ${trial.harness_tool_calls
              .filter((call) => call.out_of_bounds)
              .map((call) => call.name)
              .join(', ')}`,
          ]
        : []),
      ...(!trial.error && !score.formatOk
        ? [`${where}: no readable ANSWER line`]
        : []),
      ...(home && (trial.raw_log ?? '').includes(home)
        ? [`${where}: log contains the home directory`]
        : []),
    ];
  });
}

/**
 * Run the sentinels once each and return `{ problems, trials }`. The run is
 * written to a temporary folder and removed; nothing lands in `runs/`.
 */
export async function preflight({
  adapter,
  model,
  questionsFile,
  questionsPath,
  snapshotDir,
  adapterOptions = {},
  concurrency = 1,
  timeoutMs,
  log = () => {},
}) {
  const questions = sentinelQuestions(questionsFile.questions);
  const outDir = mkdtempSync(path.join(tmpdir(), 'geb-preflight-'));
  try {
    await runBenchmark({
      runId: 'preflight',
      adapter,
      model,
      questionsFile: { ...questionsFile, questions },
      questionsPath,
      snapshotDir,
      outDir,
      trials: 1,
      concurrency: Math.min(concurrency, questions.length),
      ...(timeoutMs ? { timeoutMs } : {}),
      adapterOptions,
      log,
    });
    const final = path.join(outDir, FINAL_LOG);
    const trials = readTrialsOrPartial(final, path.join(outDir, PARTIAL_LOG));
    return { problems: preflightProblems(questions, trials), trials };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function readTrialsOrPartial(final, partial) {
  return existsSync(final) ? readTrials(final) : readPartialLog(partial);
}

/** Adapter and model pairs that passed preflight in this process. */
const preflighted = new Set();

/**
 * Run the sentinel questions once per adapter and model in this process;
 * throw with every problem found.
 */
export async function requirePreflight(
  adapter,
  model,
  adapterOptions = {},
  concurrency = 1,
  timeoutMs,
  log = () => {},
) {
  const key = `${adapter.name}|${model}`;
  if (preflighted.has(key)) return;
  const file = questionsPath('public');
  log(`Preflight: ${adapter.name} + ${model} on three sentinel questions`);
  const { problems } = await preflight({
    adapter,
    model,
    questionsFile: JSON.parse(readFileSync(file, 'utf8')),
    questionsPath: file,
    snapshotDir: snapshotDir(),
    adapterOptions,
    concurrency,
    timeoutMs,
  });
  if (problems.length) {
    for (const problem of problems) log(`  ${problem}`);
    throw new Error(
      `Preflight failed for ${adapter.name} + ${model}; fix the harness before a full run (or pass --skip-preflight)`,
    );
  }
  preflighted.add(key);
  log('Preflight passed');
}
