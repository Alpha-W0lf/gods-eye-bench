import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { exportPartial } from './partial.js';
import { questionsPath } from './paths.js';
import { readTrials } from './runfiles.js';
import { sha256 } from './snapshot/key.js';

test('a partial export keeps final failures and drops pending trials', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-partial-'));
  try {
    const source = path.join(dir, 'source');
    mkdirSync(source);
    const file = questionsPath('public');
    const [question] = JSON.parse(readFileSync(file, 'utf8')).questions;
    writeFileSync(
      path.join(source, 'run.json'),
      JSON.stringify({
        run_id: 'r',
        model: { id: 'm', label: 'M' },
        harness: { adapter: 'a' },
        questions: {
          split: 'public',
          file: path.relative(path.dirname(path.dirname(file)), file),
          checksum: sha256(readFileSync(file)),
        },
        trials_per_question: 3,
      }),
    );
    const record = (trial, error_kind, attempt = 1) => ({
      question_id: question.id,
      trial,
      attempt,
      error: error_kind ? 'failed' : null,
      error_kind: error_kind ?? null,
      raw_log: null,
    });
    writeFileSync(
      path.join(source, 'trials.partial.jsonl'),
      [
        record(1),
        record(2, 'timeout', 2),
        record(3, 'harness'),
        record(4, 'timeout'),
      ]
        .map((item) => `${JSON.stringify(item)}\n`)
        .join(''),
    );
    const out = path.join(dir, 'out');
    assert.equal(exportPartial(source, out, 'stopped for a test'), 2);
    assert.deepEqual(
      readTrials(path.join(out, 'trials.jsonl.gz')).map((item) => item.trial),
      [1, 2],
    );
    const run = JSON.parse(readFileSync(path.join(out, 'run.json'), 'utf8'));
    assert.equal(run.status, 'partial');
    assert.equal(run.stopped, 'stopped for a test');

    // A run with no finished trials is refused before anything is written.
    const empty = path.join(dir, 'empty');
    writeFileSync(path.join(source, 'trials.partial.jsonl'), '');
    assert.throws(
      () => exportPartial(source, empty, 'stopped'),
      /no finished trials/,
    );
    assert.equal(existsSync(empty), false);

    // A held-out run is refused before anything is written.
    const heldout = path.join(dir, 'heldout');
    writeFileSync(
      path.join(source, 'run.json'),
      JSON.stringify({ run_id: 'r', questions: { split: 'heldout' } }),
    );
    assert.throws(
      () => exportPartial(source, heldout, 'stopped'),
      /only a public run/,
    );
    assert.equal(existsSync(heldout), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
