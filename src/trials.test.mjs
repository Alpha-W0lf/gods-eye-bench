import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  errorMessage,
  failed,
  isFinal,
  pendingTrials,
  scoreable,
} from './trials.js';

test('a failure with an empty message is still a failure, and stays pending', () => {
  const record = {
    question_id: 'a',
    trial: 1,
    attempt: 1,
    error: '',
    error_kind: 'harness',
  };
  assert.equal(failed(record), true);
  assert.equal(scoreable(record), false);
  assert.deepEqual(
    pendingTrials([{ id: 'a' }], 1, [record]).map(({ attempt }) => attempt),
    [1],
  );
});

test("successes and the agent's own failures are scoreable", () => {
  assert.equal(scoreable({ error: null }), true);
  assert.equal(scoreable({ error: 'slow', error_kind: 'timeout' }), true);
  assert.equal(scoreable({ error: 'loop', error_kind: 'agent' }), true);
  assert.equal(scoreable({ error: 'quota', error_kind: 'quota' }), false);
});

test('errorMessage reads errors that have no message of their own', () => {
  const network = new AggregateError([
    Object.assign(new Error(''), { code: 'ECONNREFUSED' }),
    new Error('connect ETIMEDOUT 1.2.3.4:443'),
  ]);
  assert.equal(network.message, '');
  assert.equal(
    errorMessage(network),
    'ECONNREFUSED; connect ETIMEDOUT 1.2.3.4:443',
  );
  assert.equal(
    errorMessage(Object.assign(new Error(''), { code: 'EPIPE' })),
    'EPIPE',
  );
  assert.equal(errorMessage('plain'), 'plain');
});

test('a scored failure is final only after its retry', () => {
  const failure = (attempt) => ({
    error: 'slow',
    error_kind: 'timeout',
    attempt,
  });
  assert.equal(isFinal(failure(1)), false);
  assert.equal(isFinal(failure(2)), true);
  assert.equal(isFinal({ error: null, attempt: 1 }), true);
  assert.equal(
    isFinal({ error: '', error_kind: 'harness', attempt: 2 }),
    false,
  );
});
