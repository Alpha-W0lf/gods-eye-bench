import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { repoPath } from './config.js';
import { readTrials, writeTrials } from './runfiles.js';
import { verifyPartialRun, verifyRun } from './verify.js';

// The reference agent's committed run, which checks out, tampered one way at
// a time: each check must name exactly what was changed.
const source = repoPath('runs', 'verified', '2026-10-03-reference-reference');
const run = JSON.parse(readFileSync(path.join(source, 'run.json'), 'utf8'));
const trials = readTrials(path.join(source, 'trials.jsonl.gz'));

function problemsWith({ runChange = {}, trialChange, verify = verifyRun }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-verify-'));
  try {
    const records = trialChange ? trialChange(structuredClone(trials)) : trials;
    writeTrials(path.join(dir, 'trials.jsonl.gz'), records);
    return verify({ dir, run: { ...structuredClone(run), ...runChange } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const first = (change) => (records) => {
  Object.assign(records[0], change);
  return records;
};

test('verify passes the untouched reference run', () => {
  assert.deepEqual(problemsWith({}), []);
});

test('verify names each tampering of a run', () => {
  const cases = [
    [{ runChange: { gev: { commit: '0'.repeat(40) } } }, /not the pinned/],
    [
      { runChange: { snapshot: { ...run.snapshot, checksum: 'x' } } },
      /snapshot 2026-10-03 checksum differs/,
    ],
    [
      { runChange: { questions: { ...run.questions, checksum: 'x' } } },
      /has changed since the run/,
    ],
    [{ trialChange: (records) => records.slice(1) }, /164 trials, expected/],
    [{ trialChange: (records) => [...records, records[0]] }, /appears twice/],
    [{ trialChange: first({ prompt: 'Something else' }) }, /prompt/],
    [{ trialChange: first({ question_id: 'nope' }) }, /unknown question nope/],
    [{ trialChange: first({ trial: 9 }) }, /outside the run's 3 trials/],
    [{ trialChange: first({ scenario: 'stale' }) }, /ran in stale/],
    [{ trialChange: first({ attempt: 3 }) }, /attempt 3, above 2/],
    [
      { trialChange: first({ error: 'fetch failed', error_kind: 'harness' }) },
      /harness error, which is never scored/,
    ],
    [
      { trialChange: first({ error: 'timed out', error_kind: 'timeout' }) },
      /never got its retry/,
    ],
  ];
  for (const [change, expected] of cases) {
    const problems = problemsWith(change);
    assert.ok(
      problems.some((problem) => expected.test(problem)),
      `${expected} not in ${problems.join('; ')}`,
    );
  }
});

test('an incomplete run must say why it stopped and hold only final records', () => {
  const partial = (change) =>
    problemsWith({ ...change, verify: verifyPartialRun });
  assert.deepEqual(partial({ runChange: { stopped: 'usage limit' } }), []);
  assert.match(partial({}).join(), /no reason given for stopping/);
  const stopped = { stopped: 'usage limit' };
  for (const [runChange, expected] of [
    [{ gev: { commit: '0'.repeat(40) } }, /another God's Eye View commit/],
    [{ snapshot: { ...run.snapshot, checksum: 'x' } }, /checksum differs/],
    [
      { questions: { ...run.questions, file: 'questions/none.json' } },
      /questions\/none.json is missing/,
    ],
  ])
    assert.match(
      partial({ runChange: { ...stopped, ...runChange } }).join(),
      expected,
    );
  assert.match(
    partial({
      runChange: { stopped: 'usage limit' },
      trialChange: first({ error: 'fetch failed', error_kind: 'harness' }),
    }).join(),
    /not a final record/,
  );
});
