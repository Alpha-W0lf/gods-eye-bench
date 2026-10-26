#!/usr/bin/env node
/** The gods-eye-bench command line. `geb --help` prints USAGE. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getAdapter } from '../src/adapters/index.js';
import { BENCH, modelEntries, repoPath } from '../src/config.js';
import { gevDir, setupGev } from '../src/gev.js';
import { questionsPath, runDir, snapshotDir } from '../src/paths.js';
import { hasTrials, RUN_RECORD } from '../src/runfiles.js';
import { questionFile, selectQuestions } from '../src/questions/generate.js';
import { exportPartial } from '../src/partial.js';
import { requirePreflight } from '../src/preflight.js';
import { recordSnapshot } from '../src/recorder.js';
import { renderReadme } from '../src/report.js';
import { heldoutSeed } from '../src/secrets.js';
import { buildResults } from '../src/results.js';
import { verifyAll } from '../src/verify.js';
import { runBenchmark, slug } from '../src/run.js';
import { loadSnapshot, stableJson } from '../src/snapshot/store.ts';
import { readInfrastructure } from '../src/world/infrastructure.js';

const USAGE = `Usage:
  geb setup                  clone and install the pinned God's Eye View
  geb record <id>            record snapshots/<id> from a running dev server
  geb questions              write the question files for the snapshot
  geb run --adapter <name> --model <id> [--label <text>] [--split public|heldout]
          [--trials <n>] [--concurrency <n>] [--status verified|community]
          [--only <id,id>] [--out <dir>]    (a subset into another folder, for smoke tests)
          [--timeout <ms>] [--skip-preflight]
  geb score                  rescore every run into results/results.json
  geb report                 regenerate the README leaderboard from results.json
  geb partial <dir> <why>    keep a stopped run's finished trials in
                             runs/partial/, reported apart from the ranking
  geb verify                 check every run's provenance
  geb preflight --adapter <name> --model <id>
                             three sentinel questions; fails on off-limits tools,
                             harness errors, unreadable answers or unredacted logs
                             (run and bench do this before a run starts, unless
                             --skip-preflight)
  geb bench [--match <text>] [--status verified|community]
                             run every entry of config/models.json (or those whose
                             label contains <text>): the public set, and the held-out
                             set when a held-out seed is available. A model that fails
                             is skipped and reported at the end. Without --match it
                             then scores and regenerates the README.
`;

const log = (line) => console.error(line);

// Local settings such as GEB_HELDOUT_SEED live in the git-ignored .env (or,
// for the seed, the macOS Keychain; see src/secrets.js).
if (existsSync(repoPath('.env'))) process.loadEnvFile(repoPath('.env'));

const COMMANDS = {
  async setup() {
    log(`God's Eye View ready at ${setupGev({ log })}`);
  },

  async record(args) {
    const [id] = args;
    if (!/^[0-9a-z][0-9a-z-]*$/.test(id ?? ''))
      throw new Error('Usage: geb record <id>, with id like 2026-10-03');
    const out = snapshotDir(id);
    const { manifest, skipped } = await recordSnapshot({ id, out, log });
    log(
      `Wrote ${manifest.entries.length} responses to ${path.relative(process.cwd(), out)}`,
    );
    log(`Fetched but not kept: ${skipped.join(', ') || 'none'}`);
  },

  async questions() {
    const snapshot = loadSnapshot(snapshotDir());
    const seed = heldoutSeed();
    const sets = selectQuestions(snapshot, readInfrastructure(gevDir()), {
      heldoutSeed: seed,
    });
    for (const split of seed ? ['public', 'heldout'] : ['public']) {
      writeFileSync(
        questionsPath(split),
        stableJson(questionFile(snapshot, split, sets[split])),
      );
      log(
        `Wrote ${sets[split].length} ${split} questions to ${path.relative(process.cwd(), questionsPath(split))}`,
      );
    }
    if (!seed)
      log(
        'No held-out seed (GEB_HELDOUT_SEED or the Keychain), so no held-out set was written.',
      );
  },

  async score() {
    const results = buildResults({ save: true });
    writeFileSync(repoPath('results', 'results.json'), stableJson(results));
    log(`Scored ${results.runs.length} runs into results/results.json`);
  },

  async report() {
    const readme = repoPath('README.md');
    const results = JSON.parse(
      readFileSync(repoPath('results', 'results.json'), 'utf8'),
    );
    writeFileSync(
      readme,
      await renderReadme(readFileSync(readme, 'utf8'), results),
    );
    log('Regenerated the README leaderboard');
  },

  async partial(args) {
    const [source, ...reason] = args;
    if (!source || !reason.length)
      throw new Error('Usage: geb partial <run folder> <why it stopped>');
    const run = JSON.parse(readFileSync(path.join(source, RUN_RECORD), 'utf8'));
    const dest = repoPath('runs', 'partial', run.run_id);
    const count = exportPartial(source, dest, reason.join(' '));
    log(
      `Kept ${count} finished trials in ${path.relative(process.cwd(), dest)}`,
    );
  },

  async verify() {
    const problems = verifyAll();
    for (const problem of problems) log(problem);
    if (problems.length)
      throw new Error(`${problems.length} provenance problems`);
    log('Every run checks out');
  },

  async run(args) {
    const { values } = parseArgs({
      args,
      options: {
        adapter: { type: 'string' },
        model: { type: 'string' },
        label: { type: 'string' },
        split: { type: 'string', default: 'public' },
        trials: { type: 'string' },
        concurrency: { type: 'string' },
        status: { type: 'string', default: 'verified' },
        only: { type: 'string' },
        out: { type: 'string' },
        'skip-preflight': { type: 'boolean', default: false },
        timeout: { type: 'string' },
      },
    });
    if (!values.adapter || !values.model)
      throw new Error('Usage: geb run --adapter <name> --model <id> [options]');
    const entry = configEntry(values.adapter, values.model);
    await runOne({
      ...entry,
      ...values,
      label: values.label ?? entry.label,
      trials: count('trials', values.trials),
      concurrency:
        count('concurrency', values.concurrency) ?? entry.concurrency,
      timeoutMs: count('timeout', values.timeout) ?? entry.timeoutMs,
      skipPreflight: values['skip-preflight'],
    });
  },

  async preflight(args) {
    const { values } = parseArgs({
      args,
      options: { adapter: { type: 'string' }, model: { type: 'string' } },
    });
    if (!values.adapter || !values.model)
      throw new Error('Usage: geb preflight --adapter <name> --model <id>');
    const entry = configEntry(values.adapter, values.model);
    await requirePreflight(
      getAdapter(values.adapter),
      values.model,
      {
        endpoint: entry.endpoint,
        apiKeyEnv: entry.apiKeyEnv,
        requestTimeoutMs: entry.requestTimeoutMs,
      },
      entry.concurrency ?? 1,
      entry.timeoutMs,
      log,
    );
  },

  async bench(args) {
    const { values } = parseArgs({
      args,
      options: {
        match: { type: 'string' },
        status: { type: 'string', default: 'verified' },
        'skip-preflight': { type: 'boolean', default: false },
      },
    });
    const entries = modelEntries().filter(
      (entry) =>
        !values.match ||
        entry.label.toLowerCase().includes(values.match.toLowerCase()),
    );
    if (!entries.length)
      throw new Error(
        `No model in config/models.json matches "${values.match}"`,
      );
    const splits = heldoutSeed() ? ['public', 'heldout'] : ['public'];
    // One model's failure (a preflight, a login) does not stop the others.
    const failures = [];
    for (const entry of entries)
      for (const split of splits)
        try {
          await runOne({
            ...entry,
            split,
            status: values.status,
            skipPreflight: values['skip-preflight'],
          });
        } catch (error) {
          failures.push(`${entry.label} (${split}): ${error.message}`);
          log(`Skipping ${entry.label} (${split}): ${error.message}`);
          break;
        }
    // The whole matrix ends in the results file and the README; a subset
    // leaves them alone, so several subsets can run side by side.
    if (!values.match) {
      await COMMANDS.score();
      await COMMANDS.report();
    }
    if (failures.length)
      throw new Error(
        `${failures.length} of ${entries.length} models did not finish:\n  ${failures.join('\n  ')}`,
      );
  },
};

/**
 * The config/models.json entry for an adapter and model, or {}: its endpoint,
 * key variable, label, concurrency and time limit are the defaults for `run`
 * and `preflight`.
 */
function configEntry(adapter, model) {
  const entry = modelEntries().find(
    (item) => item.adapter === adapter && item.model === model,
  );
  if (!entry && adapter === 'openai-compatible')
    log(
      `${model} has no entry in config/models.json: using GEB_OPENAI_BASE_URL or Ollama`,
    );
  return entry ?? {};
}

/** A positive whole number from a CLI option, or undefined when not given. */
function count(name, value) {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value))
    throw new Error(
      `--${name} must be a positive whole number, not "${value}"`,
    );
  return Number(value);
}

/** Run one adapter and model on one split. */
async function runOne({
  adapter: name,
  model,
  label,
  split = 'public',
  status = 'verified',
  trials,
  concurrency,
  only,
  out,
  skipPreflight = false,
  endpoint,
  apiKeyEnv,
  requestTimeoutMs,
  timeoutMs,
}) {
  const adapterOptions = { endpoint, apiKeyEnv, requestTimeoutMs };
  if (!['public', 'heldout'].includes(split))
    throw new Error('--split is public or heldout');
  if (!['verified', 'community'].includes(status))
    throw new Error('--status is verified or community');
  const adapter = getAdapter(name);
  const file = questionsPath(split);
  if (!existsSync(file))
    throw new Error(
      `${path.relative(process.cwd(), file)} is missing; run \`geb questions\``,
    );
  const runId = `${BENCH.snapshot}-${adapter.name}-${slug(model)}`;
  const questionsFile = JSON.parse(readFileSync(file, 'utf8'));
  if (only) {
    if (!out)
      throw new Error('--only needs --out, so a subset never lands in runs/');
    const wanted = new Set(only.split(','));
    questionsFile.questions = questionsFile.questions.filter((question) =>
      wanted.has(question.id),
    );
  }
  const outDir = out ? path.resolve(out, runId) : runDir(status, runId, split);
  // Preflight guards the start of a run; resuming one (after a quota stop or
  // an interruption) does not spend the sentinel questions again.
  if (!only && !skipPreflight && !hasTrials(outDir))
    await requirePreflight(
      adapter,
      model,
      adapterOptions,
      concurrency ?? 1,
      timeoutMs,
      log,
    );
  const run = await runBenchmark({
    runId,
    adapter,
    model,
    label: label ?? model,
    questionsFile,
    questionsPath: file,
    snapshotDir: snapshotDir(),
    outDir,
    status,
    adapterOptions,
    ...(trials ? { trials } : {}),
    ...(concurrency ? { concurrency } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    log,
  });
  log(
    run.finished_at
      ? `Run ${run.run_id} (${split}) complete`
      : `Run ${run.run_id} (${split}) incomplete`,
  );
}

const [command, ...args] = process.argv.slice(2);
try {
  if ([command, ...args].some((arg) => arg === '--help' || arg === '-h'))
    console.log(USAGE);
  else if (!Object.hasOwn(COMMANDS, command ?? '')) {
    console.error(USAGE);
    process.exitCode = 1;
  } else await COMMANDS[command](args);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
