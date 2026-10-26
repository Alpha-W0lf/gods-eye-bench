import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import reference from './adapters/reference.js';
import { questionsPath, snapshotDir } from './paths.js';
import {
  runBenchmark,
  runTrial,
  slotWorkdir,
  slug,
  trialSummary,
} from './run.js';
import { redactLocalPaths } from './runfiles.js';
import { aggregateTrials } from './score/aggregate.ts';
import { finalRecords, pendingTrials, trialError } from './trials.js';

test('pendingTrials retries a timeout once, and harness errors until they pass', () => {
  const questions = [{ id: 'a' }, { id: 'b' }];
  assert.equal(pendingTrials(questions, 2, []).length, 4);
  const looped = (attempt) => ({
    question_id: 'a',
    trial: 1,
    attempt,
    error: 'No final answer after 12 turns',
    error_kind: 'agent',
  });
  assert.equal(pendingTrials([{ id: 'a' }], 1, [looped(1)]).length, 1);
  assert.equal(
    pendingTrials([{ id: 'a' }], 1, [looped(2)]).length,
    0,
    'an agent failure is retried once, then scored',
  );
  const done = [
    { question_id: 'a', trial: 1, attempt: 1, error: null },
    {
      question_id: 'a',
      trial: 2,
      attempt: 1,
      error: 'timed out',
      error_kind: 'timeout',
    },
    {
      question_id: 'b',
      trial: 1,
      attempt: 2,
      error: 'timed out',
      error_kind: 'timeout',
    },
    {
      question_id: 'b',
      trial: 2,
      attempt: 5,
      error: 'ENOTFOUND',
      error_kind: 'harness',
    },
  ];
  assert.deepEqual(
    pendingTrials(questions, 2, done).map(
      ({ question, trial, attempt }) => `${question.id}#${trial}@${attempt}`,
    ),
    ['a#2@2', 'b#2@5'],
  );
  // Follow one trial through a network error, then a timeout: the timeout
  // must still get its retry.
  const history = [];
  const step = (error_kind) => {
    const [{ attempt }] = pendingTrials([{ id: 'a' }], 1, history);
    history.push({
      question_id: 'a',
      trial: 1,
      attempt,
      error: error_kind,
      error_kind,
    });
    return attempt;
  };
  assert.deepEqual(
    [step('harness'), step('quota'), step('timeout'), step('timeout')],
    [1, 1, 1, 2],
  );
  assert.equal(
    pendingTrials([{ id: 'a' }], 1, history).length,
    0,
    'a network error before a timeout does not use up the retry',
  );
  assert.deepEqual(
    finalRecords(questions, [
      ...done,
      { question_id: 'a', trial: 2, attempt: 2, error: null },
    ]).map(
      (record) => `${record.question_id}#${record.trial}@${record.attempt}`,
    ),
    ['a#1@1', 'a#2@2', 'b#1@2', 'b#2@5'],
  );
  // The history above: a harness error and a quota stop, then two timeouts.
  // The final record keeps the count of the unscored errors.
  assert.equal(finalRecords([{ id: 'a' }], history)[0].harness_retries, 2);
});

test('redactLocalPaths hides the home and temporary directories in harness logs', () => {
  assert.equal(
    redactLocalPaths(
      'cwd /Users/x/a, /var/folders/ab/cd/T/w and /Users/x/b',
      '/Users/x',
      '/var/folders/ab/cd/T/',
    ),
    'cwd ~/a, $TMPDIR/w and ~/b',
  );
  // Harnesses log the real path, and logs may come from another machine.
  assert.equal(
    redactLocalPaths(
      'cwd /private/var/folders/ab/cd/T/w, /var/folders/ef/gh/T/v',
      '/Users/x',
      '/var/folders/ab/cd/T/',
    ),
    'cwd $TMPDIR/w, $TMPDIR/v',
  );
  // Only whole paths: a longer name that starts the same is left alone.
  assert.equal(
    redactLocalPaths(
      '/Users/x/a /Users/xavier/b /tmpfoo /tmp/c',
      '/Users/x',
      '/tmp',
    ),
    '~/a /Users/xavier/b /tmpfoo $TMPDIR/c',
  );
  assert.equal(
    redactLocalPaths('in /Users/x. and /Users/x.backup', '/Users/x', '/tmp'),
    'in ~. and /Users/x.backup',
  );
  // Harnesses also name folders after paths, with dashes for slashes.
  assert.equal(
    redactLocalPaths(
      'projects/-private-var-folders-ab-cd-T-geb-work-1 and -Users-x-repo, /private/var/folders/ab/cd/T/w',
      '/Users/x',
      '/var/folders/ab/cd/T',
    ),
    'projects/-TMPDIR-geb-work-1 and -HOME-repo, $TMPDIR/w',
  );
  // Every spelling: underscores in the id, URL-encoded, dashed with or
  // without a leading dash, and a home with a dot in it.
  assert.equal(
    redactLocalPaths(
      [
        '/private/var/folders/_z/xy_1/T/w',
        'projects/-private-var-folders--z-xy-1-T-run',
        '%2Fvar%2Ffolders%2F_z%2Fxy_1%2FT%2Fv',
        'projects/Users-a-b-repo, -Users-a-b-x, -Users-a-bc, /Users/a.b/x',
      ].join(' | '),
      '/Users/a.b',
      '/var/folders/_z/xy_1/T',
    ),
    [
      '$TMPDIR/w',
      'projects/-TMPDIR-run',
      '$TMPDIR%2Fv',
      'projects/HOME-repo, -HOME-x, -Users-a-bc, ~/x',
    ].join(' | '),
  );
  // A root home or temp folder redacts nothing rather than everything.
  assert.equal(redactLocalPaths('/etc/passwd', '/', '/'), '/etc/passwd');
  assert.equal(redactLocalPaths(null, '/Users/x', '/tmp'), null);
});

test('a trial summary shows tools, answer and verdict, never the truth', () => {
  const question = {
    truth: { value: 33, status: 'complete' },
    answer: { type: 'integer' },
    reference: [],
  };
  const record = (final_text, extra = {}) => ({
    final_text,
    trace: [{ type: 'call', tool: 'get_earthquakes', ok: true }],
    ...extra,
  });
  const answer = (value) =>
    `ANSWER: {"answer": ${value}, "data_status": "complete"}`;
  assert.equal(
    trialSummary(question, record(answer(33))),
    'get_earthquakes → 33 (complete): right',
  );
  const wrong = trialSummary(question, record(answer(32)));
  assert.equal(wrong, 'get_earthquakes → 32 (complete): wrong');
  assert.ok(!wrong.includes('33'), 'a wrong answer never shows the truth');
  assert.match(trialSummary(question, record('no idea')), /no readable answer/);
  assert.equal(
    trialSummary(question, record(null, { error: '', error_kind: 'harness' })),
    'error: harness',
  );
});

test('a held-out run logs progress but never an answer', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-log-'));
  try {
    const file = questionsPath('public');
    const publicFile = JSON.parse(readFileSync(file, 'utf8'));
    const [question] = publicFile.questions;
    const logged = async (split) => {
      const lines = [];
      await runBenchmark({
        adapter: reference,
        model: 'reference',
        questionsFile: { ...publicFile, split, questions: [question] },
        questionsPath: file,
        snapshotDir: snapshotDir(),
        outDir: path.join(dir, split),
        trials: 1,
        log: (line) => lines.push(line),
      });
      return lines.find((line) => line.startsWith('[1/1]'));
    };
    assert.match(await logged('public'), /→ .*: right$/);
    assert.equal(await logged('heldout'), `[1/1] ${question.id} #1: done`);
    // An error's message can quote the harness; only its kind is logged.
    const lines = [];
    await runBenchmark({
      adapter: {
        name: 'leaky',
        describe: async () => ({ name: 'leaky', version: '1' }),
        run: async () => {
          throw new Error(`the answer is ${question.truth.value}`);
        },
      },
      model: 'leaky',
      questionsFile: { ...publicFile, split: 'heldout', questions: [question] },
      questionsPath: file,
      snapshotDir: snapshotDir(),
      outDir: path.join(dir, 'leaky'),
      trials: 1,
      log: (line) => lines.push(line),
    });
    assert.equal(
      lines.find((line) => line.startsWith('[1/1]')),
      `[1/1] ${question.id} #1: error: harness`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a model's public and held-out runs never share a working folder", () => {
  assert.notEqual(
    slotWorkdir('cursor-agent', 'm', 0, 'public'),
    slotWorkdir('cursor-agent', 'm', 0, 'heldout'),
  );
});

test('slug keeps model ids readable', () => {
  assert.equal(slug('Claude Opus 5.5 (1M)'), 'claude-opus-5.5-1m');
});

test('the reference agent scores 100% on every public question through the replay server', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-run-'));
  try {
    const file = questionsPath('public');
    const questionsFile = JSON.parse(readFileSync(file, 'utf8'));
    const run = await runBenchmark({
      adapter: reference,
      model: 'reference',
      questionsFile,
      questionsPath: file,
      snapshotDir: snapshotDir(),
      outDir: path.join(dir, 'run'),
      trials: 1,
      concurrency: 4,
    });
    assert.ok(run.finished_at);
    assert.ok(!existsSync(path.join(dir, 'run', 'trials.partial.jsonl')));
    const trials = gunzipSync(
      readFileSync(path.join(dir, 'run', 'trials.jsonl.gz')),
    )
      .toString()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const result = aggregateTrials(questionsFile.questions, trials);
    assert.equal(result.accuracy, 1, JSON.stringify(result));
    assert.equal(result.replay_misses, 0);
    assert.equal(result.extra_calls_mean, 0);

    const files = ['run.json', 'trials.jsonl.gz'].map((name) =>
      readFileSync(path.join(dir, 'run', name)),
    );
    const again = await runBenchmark({
      adapter: reference,
      model: 'reference',
      questionsFile,
      questionsPath: file,
      snapshotDir: snapshotDir(),
      outDir: path.join(dir, 'run'),
      trials: 1,
    });
    assert.equal(
      again.finished_at,
      run.finished_at,
      'a finished run is left alone',
    );
    ['run.json', 'trials.jsonl.gz'].forEach((name, index) =>
      assert.deepEqual(readFileSync(path.join(dir, 'run', name)), files[index]),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a used-up daily quota stops the run, leaving the rest pending', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-quota-run-'));
  let calls = 0;
  const limited = {
    name: 'limited',
    describe: async () => ({ name: 'limited' }),
    run: async () => {
      calls += 1;
      throw trialError('quota', 'Daily quota used up');
    },
  };
  const messages = [];
  try {
    const file = questionsPath('public');
    const questionsFile = JSON.parse(readFileSync(file, 'utf8'));
    const run = await runBenchmark({
      adapter: limited,
      model: 'limited',
      questionsFile,
      questionsPath: file,
      snapshotDir: snapshotDir(),
      outDir: path.join(dir, 'run'),
      trials: 1,
      concurrency: 1,
      log: (message) => messages.push(message),
    });
    assert.equal(calls, 1, 'no trial starts after the quota runs out');
    assert.equal(run.finished_at, null);
    const [record] = readFileSync(
      path.join(dir, 'run', 'trials.partial.jsonl'),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(record.error_kind, 'quota');
    assert.ok(messages.some((message) => message.startsWith('Stopped early')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an adapter that waits out a rate limit gets the wait added to its limit', async () => {
  const [question] = JSON.parse(
    readFileSync(questionsPath('public'), 'utf8'),
  ).questions;
  const patient = (extend) => ({
    name: 'patient',
    run: async ({ extendDeadline, signal }) => {
      if (extend) extendDeadline(400);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 300);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      });
      return { finalText: 'ANSWER: {"answer": 1, "data_status": "complete"}' };
    },
  });
  const trial = (extend) =>
    runTrial({
      adapter: patient(extend),
      model: 'patient',
      question,
      trial: 1,
      snapshotDir: snapshotDir(),
      timeoutMs: 150,
    });
  assert.equal((await trial(false)).error_kind, 'timeout');
  assert.equal((await trial(true)).error, null);
});

test('a resumed run keeps every session and refuses a changed setup', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-sessions-'));
  try {
    const file = questionsPath('public');
    const questionsFile = JSON.parse(readFileSync(file, 'utf8'));
    questionsFile.questions = questionsFile.questions.slice(0, 2);
    const options = {
      adapter: reference,
      model: 'reference',
      questionsFile,
      questionsPath: file,
      snapshotDir: snapshotDir(),
      outDir: path.join(dir, 'run'),
      trials: 1,
    };
    await runBenchmark(options);
    // Drop the finished log so the next call resumes the same run.
    rmSync(path.join(dir, 'run', 'trials.jsonl.gz'));
    const resumed = await runBenchmark(options);
    assert.equal(resumed.sessions.length, 2);
    const [record] = gunzipSync(
      readFileSync(path.join(dir, 'run', 'trials.jsonl.gz')),
    )
      .toString()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.ok(record.bench_version && record.started_at);
    rmSync(path.join(dir, 'run', 'trials.jsonl.gz'));
    await assert.rejects(
      runBenchmark({ ...options, trials: 2 }),
      /trials per question differs/,
    );
    // A different endpoint is a different setup too.
    const runFile = path.join(dir, 'run', 'run.json');
    const saved = JSON.parse(readFileSync(runFile, 'utf8'));
    saved.harness.endpoint = 'https://elsewhere.example/v1';
    writeFileSync(runFile, JSON.stringify(saved));
    await assert.rejects(runBenchmark(options), /endpoint differs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a trial record carries its harness log with local paths redacted', async () => {
  const [question] = JSON.parse(
    readFileSync(questionsPath('public'), 'utf8'),
  ).questions;
  const record = await runTrial({
    adapter: {
      name: 'chatty',
      run: async () => ({
        finalText: 'ANSWER: {"answer": 1, "data_status": "complete"}',
        rawLog: `cwd ${homedir()}/work, scratch ${tmpdir()}/x`,
      }),
    },
    model: 'chatty',
    question,
    trial: 1,
    snapshotDir: snapshotDir(),
    timeoutMs: 5000,
  });
  assert.equal(record.raw_log, 'cwd ~/work, scratch $TMPDIR/x');
});
