import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { repoPath } from './config.js';
import { leaderboardSection, renderReadme, END, START } from './report.js';
import path from 'node:path';
import { buildResults, listRuns, readTrials } from './results.js';
import { round } from './score/stats.js';
import { stableJson } from './snapshot/store.ts';
import { verifyAll } from './verify.js';

test('incomplete runs report their coverage and never enter the ranking', () => {
  const results = buildResults();
  const ranked = new Set(results.runs.map((run) => run.run_id));
  for (const run of results.partial) {
    assert.ok(!ranked.has(run.run_id), `${run.run_id} is ranked`);
    assert.ok(run.trials_done < run.trials_planned);
    assert.ok(run.stopped);
  }
});

const partialDirs = () => {
  const base = repoPath('runs', 'partial');
  return existsSync(base)
    ? readdirSync(base).map((name) => ({ dir: path.join(base, name) }))
    : [];
};

/**
 * What a committed log must never contain: a local user path, or anything
 * shaped like a credential. gitleaks cannot read the gzipped logs, so this
 * scan of their decompressed text runs with every test.
 */
const FORBIDDEN_IN_LOGS = [
  [
    'an unredacted user path',
    /\/Users\/[^/~]|\/home\/[^/~]|\/var\/folders\/|var-folders-|Users-[a-z]|%2Fvar%2Ffolders|%2FUsers%2F|%2Fhome%2F/i,
  ],
  ["an account's usage line", /rate_limit_event/],
  ['a Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['an OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36}/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

test('no trial log carries a local path or a credential', () => {
  for (const { dir } of [...listRuns(), ...partialDirs()]) {
    const text = readTrials(path.join(dir, 'trials.jsonl.gz'))
      .map((trial) => JSON.stringify(trial))
      .join('\n');
    for (const [what, pattern] of FORBIDDEN_IN_LOGS)
      assert.ok(!pattern.test(text), `${dir} has ${what}`);
  }
});

test('every committed run passes its provenance checks', () => {
  assert.deepEqual(verifyAll(), []);
});

test('unstamped trials name their version as a bound', () => {
  const versions = (id) =>
    buildResults().runs.find((run) => run.run_id === `2026-10-03-${id}`)
      .provenance.bench_versions;
  // Trials before per-trial stamps show their run's recorded version as a
  // bound; stamped trials show their own.
  assert.deepEqual(versions('cursor-agent-gpt-5.6-sol-medium'), [
    '≤0.1.2',
    '0.2.0',
  ]);
  assert.deepEqual(versions('openai-compatible-geb-qwen3.5-9b'), ['≤0.1.2']);
  // 0.1.0 is the first version, so it needs no bound.
  assert.deepEqual(versions('claude-code-claude-fable-5-1'), ['0.1.0']);
});

test('results/results.json is exactly what the committed logs score to', () => {
  assert.equal(
    stableJson(buildResults()),
    readFileSync(repoPath('results', 'results.json'), 'utf8'),
    'results.json is out of date: run `npm run geb -- score`',
  );
});

test('the README leaderboard is generated from results.json', async () => {
  const readme = readFileSync(repoPath('README.md'), 'utf8');
  const results = JSON.parse(
    readFileSync(repoPath('results', 'results.json'), 'utf8'),
  );
  assert.equal(
    await renderReadme(readme, results),
    readme,
    'README leaderboard is out of date: run `npm run geb -- report`',
  );
});

test('the leaderboard separates verified and community runs', () => {
  const run = (label, status) => ({
    label,
    status,
    trials_per_question: 3,
    public: {
      questions: 2,
      accuracy: 0.5,
      accuracy_ci95: [0.25, 0.75],
      all_trials_correct: 0.5,
      honest_about_faults: 1,
      fabrication: 0,
      tool_calls_mean: 1.25,
      latency_median_s: 9.5,
      tokens_mean: 12345,
    },
    heldout: null,
    provenance: {
      snapshot: { id: 's' },
      gev: { commit: 'abcdef1234', version: '1' },
      prompt_version: 1,
    },
  });
  const section = leaderboardSection({
    runs: [run('A + B', 'verified'), run('C + D', 'community')],
  });
  assert.ok(section.startsWith(START) && section.endsWith(END));
  const [verified, community] = section.split('### Community-reported runs');
  assert.match(verified, /\| A \+ B \| \*\*50%\*\* \(25%–75%\) \|/);
  assert.match(community, /\| C \+ D \|/);
  assert.ok(!verified.includes('C + D'));
  // Verified runs with different setups cannot share one table.
  const other = run('E + F', 'verified');
  other.provenance = { ...other.provenance, prompt_version: 2 };
  assert.throws(
    () => leaderboardSection({ runs: [run('A + B', 'verified'), other] }),
    /differ in setup/,
  );
});

test('a leaderboard row rounds a share once and keeps its label on one line', () => {
  const section = leaderboardSection({
    runs: [
      {
        label: 'A |\n B',
        status: 'verified',
        trials_per_question: 3,
        public: { questions: 11, accuracy: round(5 / 11) },
        heldout: null,
        provenance: {
          snapshot: { id: 's' },
          gev: { commit: 'abcdef1234', version: '1' },
          prompt_version: 1,
        },
      },
    ],
  });
  assert.match(section, /\| A \\\| B \| \*\*45%\*\* /);
});

test('a run whose held-out split is still running stays out of the results', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'geb-listruns-'));
  try {
    const run = (finished) => ({
      status: 'verified',
      finished_at: finished ? '2026-10-05T00:00:00Z' : null,
    });
    const write = (dir, value) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'run.json'), JSON.stringify(value));
    };
    const base = path.join(root, 'runs', 'verified');
    write(path.join(base, 'done'), run(true));
    write(path.join(base, 'done', 'heldout'), run(true));
    write(path.join(base, 'half'), run(true));
    write(path.join(base, 'half', 'heldout'), run(false));
    write(path.join(base, 'public-only'), run(true));
    assert.deepEqual(
      listRuns(root).map(({ dir }) => path.basename(dir)),
      ['done', 'public-only'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every held-out score comes from one held-out question set', () => {
  const sets = new Set(
    listRuns()
      .map(({ dir }) => path.join(dir, 'heldout.json'))
      .filter((file) => existsSync(file))
      .map(
        (file) => JSON.parse(readFileSync(file, 'utf8')).question_set?.checksum,
      ),
  );
  assert.equal(sets.size, 1);
  assert.ok([...sets][0], 'each heldout.json names its question set');
});
