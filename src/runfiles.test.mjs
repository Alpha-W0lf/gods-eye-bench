import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  hasTrials,
  parseJsonLines,
  readPartialLog,
  readTrials,
  runQuestions,
  writeTrials,
} from './runfiles.js';

test('a partial log cut short mid-line loses only that line', () => {
  assert.deepEqual(parseJsonLines('{"a":1}\n{"b":2}\n{"c":'), [
    { a: 1 },
    { b: 2 },
  ]);
  assert.throws(() => parseJsonLines('{"a":\n{"b":2}\n'));
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-runfiles-'));
  try {
    writeFileSync(path.join(dir, 'partial.jsonl'), '{"a":1}\n{"b"');
    assert.deepEqual(readPartialLog(path.join(dir, 'partial.jsonl')), [
      { a: 1 },
    ]);
    assert.deepEqual(readPartialLog(path.join(dir, 'missing.jsonl')), []);
    writeTrials(path.join(dir, 'trials.jsonl.gz'), [{ a: 1 }, { b: 2 }]);
    assert.deepEqual(readTrials(path.join(dir, 'trials.jsonl.gz')), [
      { a: 1 },
      { b: 2 },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a run record cannot point its questions outside the repo', () => {
  for (const file of ['../secret.json', '/etc/passwd', 'questions/../x.json'])
    assert.throws(
      () => runQuestions({ run_id: 'r', questions: { file } }),
      /unexpected questions file/,
    );
});

test('a run record without trials is not a started run', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-started-'));
  try {
    writeFileSync(path.join(dir, 'run.json'), '{}');
    assert.equal(hasTrials(dir), false);
    writeFileSync(path.join(dir, 'trials.partial.jsonl'), '');
    assert.equal(hasTrials(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
