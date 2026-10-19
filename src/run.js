/**
 * Run a benchmark: every question, several trials each, through one adapter
 * and model. Each trial gets a fresh working directory and its own replay
 * server with its own trace. Trial records are appended as they finish, so an
 * interrupted run resumes where it stopped.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { BENCH, BENCH_VERSION, repoPath } from './config.js';
import { gevDir } from './gev.js';
import { buildPrompt, PROMPT_VERSION } from './prompt.js';
import {
  FINAL_LOG,
  PARTIAL_LOG,
  readPartialLog,
  readTrials,
  redactLocalPaths,
  RUN_RECORD,
  writeTrials,
} from './runfiles.js';
import { parseAnswer } from './score/answer.js';
import { scoreTrial } from './score/score.js';
import { sha256 } from './snapshot/key.js';
import { stableJson } from './snapshot/store.js';
import { errorMessage, failed, finalRecords, pendingTrials } from './trials.js';

/**
 * 2: run.json keeps every session that ran trials (`sessions`), and each
 * trial records the bench and harness versions that ran it.
 */
export const RUN_SCHEMA = 2;

/** What must not change between sessions of one run, or its trials would mix. */
const FIXED_ACROSS_SESSIONS = [
  ['model', (run) => run.model?.id],
  ['harness', (run) => run.harness?.adapter],
  ['endpoint', (run) => run.harness?.endpoint],
  ['questions', (run) => run.questions?.checksum],
  ['prompt', (run) => run.prompt_version],
  ['snapshot', (run) => run.snapshot?.checksum],
  ["God's Eye View commit", (run) => run.gev?.commit],
  ['trials per question', (run) => run.trials_per_question],
];

/** The session record of a run.json written before sessions were kept. */
function legacySession(run) {
  return {
    started_at: run.started_at,
    bench_version: run.bench_version,
    harness: run.harness,
    timeout_ms: run.timeout_ms,
    host: run.host,
    recorded: 'from the run record of its last session',
  };
}

/** "claude-sonnet-5-5" from any model id. */
export function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The replay server command for one trial. */
export function replayServerCommand({
  snapshotDir,
  scenario,
  tracePath,
  gev = gevDir(),
}) {
  return {
    command: process.execPath,
    args: [
      repoPath('src', 'server.js'),
      '--snapshot',
      snapshotDir,
      '--scenario',
      scenario,
      '--trace',
      tracePath,
      '--gev',
      gev,
    ],
  };
}

/**
 * The working directory for one worker slot of a run. Harnesses keep state
 * per working directory (Claude Code and Cursor each make a folder in the
 * user's home for every directory they see), so slots are reused, emptied
 * between trials, instead of one new directory per trial.
 */
export function slotWorkdir(adapterName, model, slot, split = 'public') {
  return path.join(
    tmpdir(),
    `geb-work-${adapterName}-${slug(model)}-${split}-${slot}`,
  );
}

/**
 * One line on a finished public trial: the tools it called, its answer and
 * whether it scored right. A right answer is the truth, so held-out runs
 * never log this (see runBenchmark).
 */
export function trialSummary(question, record) {
  if (failed(record)) return `error: ${record.error || record.error_kind}`;
  const tools =
    (record.trace ?? [])
      .filter((line) => line.type === 'call')
      .map((line) => line.tool)
      .join(', ') || 'no tools';
  const parsed = parseAnswer(record.final_text);
  const answer = parsed.ok
    ? `${JSON.stringify(parsed.answer)} (${parsed.dataStatus})`
    : 'no readable answer';
  const { correct } = scoreTrial(question, record);
  return `${tools} → ${answer}: ${correct ? 'right' : 'wrong'}`;
}

/** Run one trial and return its record; never throws. */
export async function runTrial({
  adapter,
  model,
  question,
  trial,
  attempt = 1,
  snapshotDir,
  timeoutMs,
  workdir = slotWorkdir(adapter.name, model, 0),
  adapterOptions = {},
}) {
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
  const traceDir = mkdtempSync(path.join(tmpdir(), 'geb-trace-'));
  const tracePath = path.join(traceDir, 'trace.jsonl');
  const prompt = buildPrompt(question);
  const controller = new AbortController();
  // The limit is on the agent's own time: an adapter that waits out a rate
  // limit moves the deadline by the wait.
  let deadline = performance.now() + timeoutMs;
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        controller.abort(new Error(`Trial timed out after ${timeoutMs} ms`)),
      Math.max(0, deadline - performance.now()),
    );
  };
  arm();
  const extendDeadline = (ms) => {
    deadline += ms;
    arm();
  };
  const started = performance.now();
  const startedAt = new Date().toISOString();
  let outcome;
  // The deadline wins even when an adapter hangs where it cannot see the
  // signal (a tool call that never returns).
  const timedOut = new Promise((_, reject) =>
    controller.signal.addEventListener(
      'abort',
      () => reject(controller.signal.reason),
      { once: true },
    ),
  );
  try {
    const running = adapter.run({
      ...adapterOptions,
      prompt,
      model,
      question,
      workdir,
      timeoutMs,
      extendDeadline,
      signal: controller.signal,
      mcpServer: replayServerCommand({
        snapshotDir,
        scenario: question.scenario,
        tracePath,
      }),
    });
    running.catch(() => {}); // Settles after the deadline: nothing to report.
    outcome = await Promise.race([running, timedOut]);
  } catch (error) {
    outcome = {
      // On a timeout, say so rather than echo the aborted request.
      error: errorMessage(
        controller.signal.aborted ? controller.signal.reason : error,
      ),
      errorKind: controller.signal.aborted
        ? 'timeout'
        : ['agent', 'quota'].includes(error?.kind)
          ? error.kind
          : 'harness',
    };
  } finally {
    clearTimeout(timer);
  }
  const record = {
    question_id: question.id,
    trial,
    attempt,
    scenario: question.scenario,
    started_at: startedAt,
    prompt,
    final_text: outcome.finalText ?? null,
    model_reported: outcome.modelReported ?? null,
    usage: outcome.usage ?? null,
    duration_ms: outcome.durationMs ?? Math.round(performance.now() - started),
    harness_tool_calls: outcome.harnessToolCalls ?? [],
    nudged: outcome.nudged ?? false,
    trace: readPartialLog(tracePath),
    raw_log: redactLocalPaths(outcome.rawLog ?? null),
    error: outcome.error ?? null,
    error_kind: outcome.errorKind ?? null,
  };
  rmSync(workdir, { recursive: true, force: true });
  rmSync(traceDir, { recursive: true, force: true });
  return record;
}

/**
 * Run `questionsFile` (a parsed question file) through `adapter`, writing to
 * `outDir`: `run.json`, then `trials.jsonl.gz` when every trial has finished.
 * Returns the run record.
 */
export async function runBenchmark({
  runId,
  adapter,
  model,
  label = model,
  questionsFile,
  questionsPath,
  snapshotDir,
  outDir,
  status = 'verified',
  trials = BENCH.trials,
  concurrency = BENCH.concurrency,
  timeoutMs = BENCH.trialTimeoutMs,
  adapterOptions = {},
  log = () => {},
}) {
  mkdirSync(outDir, { recursive: true });
  const partial = path.join(outDir, PARTIAL_LOG);
  const final = path.join(outDir, FINAL_LOG);
  const runPath = path.join(outDir, RUN_RECORD);
  const previous = existsSync(runPath)
    ? JSON.parse(readFileSync(runPath, 'utf8'))
    : null;
  // Trials already finished, in the final log of a completed run or the
  // partial log of an interrupted one.
  const done = [
    ...(existsSync(final) ? readTrials(final) : []),
    ...readPartialLog(partial),
  ];
  const todo = pendingTrials(questionsFile.questions, trials, done);
  if (!todo.length && previous?.finished_at && !existsSync(partial)) {
    log(`${previous.run_id}: already complete`);
    return previous;
  }
  const harness = await adapter.describe({ model, ...adapterOptions });
  const session = {
    started_at: new Date().toISOString(),
    bench_version: BENCH_VERSION,
    harness: { adapter: adapter.name, ...harness },
    timeout_ms: timeoutMs,
    host: {
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
    },
  };
  const run = {
    schema: RUN_SCHEMA,
    run_id: runId ?? path.basename(outDir),
    status,
    model: { id: model, label },
    harness: { adapter: adapter.name, ...harness },
    bench_version: BENCH_VERSION,
    prompt_version: PROMPT_VERSION,
    gev: questionsFile.gev,
    snapshot: questionsFile.snapshot,
    questions: {
      split: questionsFile.split,
      file: path.relative(repoPath(), questionsPath),
      checksum: sha256(readFileSync(questionsPath)),
      count: questionsFile.questions.length,
    },
    trials_per_question: trials,
    timeout_ms: timeoutMs,
    started_at: previous?.started_at ?? session.started_at,
    finished_at: null,
    host: session.host,
    sessions: [
      ...(previous ? (previous.sessions ?? [legacySession(previous)]) : []),
      session,
    ],
  };
  if (previous)
    for (const [name, read] of FIXED_ACROSS_SESSIONS)
      if (read(previous) !== read(run))
        throw new Error(
          `${run.run_id}: the ${name} differs from the run being resumed (${read(previous)} → ${read(run)}); start a new run instead`,
        );
  writeFileSync(runPath, stableJson(run));
  log(`${run.run_id}: ${todo.length} trials to run`);
  let next = 0;
  let finished = 0;
  // Set when the model's daily quota runs out: no more trials start today.
  let stopped = null;
  const worker = async (slot) => {
    while (!stopped && next < todo.length) {
      const { question, trial, attempt } = todo[next++];
      const record = await runTrial({
        adapter,
        model,
        question,
        trial,
        attempt,
        snapshotDir,
        timeoutMs,
        // Per split, so a model's public and held-out runs can run at once.
        workdir: slotWorkdir(adapter.name, model, slot, questionsFile.split),
        adapterOptions,
      });
      // Each trial names the code that ran it, so a run resumed across
      // versions stays auditable.
      record.bench_version = BENCH_VERSION;
      record.harness_version = harness.version ?? null;
      appendFileSync(partial, `${JSON.stringify(record)}\n`);
      if (record.error_kind === 'quota') stopped = record.error;
      finished += 1;
      // Held-out answers stay out of every log: a right answer is the truth,
      // and an error message can quote the harness's output.
      const detail =
        questionsFile.split === 'public'
          ? trialSummary(question, record)
          : failed(record)
            ? `error: ${record.error_kind}`
            : 'done';
      log(`[${finished}/${todo.length}] ${question.id} #${trial}: ${detail}`);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, (_, slot) => worker(slot)),
  );
  if (stopped) log(`Stopped early: ${stopped}`);
  // The final log first, then the partial one, so a retried trial's newest
  // record wins.
  const records = finalRecords(questionsFile.questions, [
    ...(existsSync(final) ? readTrials(final) : []),
    ...readPartialLog(partial),
  ]);
  const remaining = pendingTrials(
    questionsFile.questions,
    trials,
    records,
  ).length;
  if (remaining) {
    log(
      `${remaining} trials still need a successful attempt; rerun the same command to retry them`,
    );
    return run;
  }
  writeTrials(final, records);
  rmSync(partial, { force: true });
  run.finished_at = new Date().toISOString();
  writeFileSync(runPath, stableJson(run));
  return run;
}
