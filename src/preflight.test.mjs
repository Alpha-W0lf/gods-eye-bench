import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import reference from './adapters/reference.js';
import { questionsPath, snapshotDir } from './paths.js';
import {
  preflight,
  preflightProblems,
  sentinelQuestions,
} from './preflight.js';

const file = questionsPath('public');
const questionsFile = JSON.parse(readFileSync(file, 'utf8'));

test('the sentinels are a plain, a calculating and an injected question', () => {
  const sentinels = sentinelQuestions(questionsFile.questions);
  assert.equal(sentinels.length, 3);
  assert.deepEqual(
    sentinels.map((question) => question.scenario),
    ['baseline', 'baseline', 'injected'],
  );
  // A question file without them fails loudly instead of preflighting nothing.
  assert.throws(
    () =>
      sentinelQuestions(
        questionsFile.questions.filter((q) => q.template !== 'cy-distance'),
      ),
    /No baseline cy-distance question/,
  );
});

test('preflightProblems names rule breaks, errors, unreadable answers and home paths', () => {
  const [question] = sentinelQuestions(questionsFile.questions);
  const trial = (extra) => ({
    question_id: question.id,
    trial: 1,
    final_text: `ANSWER: {"answer": ${question.truth.value}, "data_status": "complete"}`,
    trace: [],
    harness_tool_calls: [],
    raw_log: '',
    error: null,
    ...extra,
  });
  assert.deepEqual(
    preflightProblems(questionsFile.questions, [trial()], '/Users/x'),
    [],
  );
  const problems = preflightProblems(
    questionsFile.questions,
    [
      trial({
        harness_tool_calls: [{ name: 'shellToolCall', out_of_bounds: true }],
      }),
      trial({
        error: 'login required',
        error_kind: 'harness',
        final_text: null,
      }),
      trial({
        error: 'Trial timed out',
        error_kind: 'timeout',
        final_text: null,
      }),
      trial({ final_text: 'no answer' }),
      trial({ raw_log: 'cwd /Users/x/work' }),
    ],
    '/Users/x',
  );
  assert.equal(
    problems.length,
    4,
    "a single timeout is the model's, not a setup problem",
  );
  assert.match(problems[0], /outside the replay server: shellToolCall/);
  assert.match(problems[1], /harness error: login required/);
  assert.match(problems[2], /no readable ANSWER line/);
  assert.match(problems[3], /home directory/);
  assert.deepEqual(
    preflightProblems(questionsFile.questions, [
      trial({ error: 'Trial timed out', error_kind: 'timeout' }),
    ]),
    ['every sentinel timed out: check the model is served and not queued'],
  );
  // Some network errors have no message; the kind still names the fault.
  assert.match(
    preflightProblems(questionsFile.questions, [
      trial({ error: '', error_kind: 'harness', final_text: null }),
      trial(),
    ]).join(),
    /harness error: harness/,
  );
});

test('the reference agent passes preflight', async () => {
  const { problems, trials } = await preflight({
    adapter: reference,
    model: 'reference',
    questionsFile,
    questionsPath: file,
    snapshotDir: snapshotDir(),
  });
  assert.equal(trials.length, 3);
  assert.deepEqual(problems, []);
});
