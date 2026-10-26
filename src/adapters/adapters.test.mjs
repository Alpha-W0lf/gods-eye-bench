import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { snapshotDir } from '../paths.js';
import { replayServerCommand } from '../run.js';
import { readClaudeStream, trialLog } from './claude-code.js';
import {
  cursorPermissions,
  readCursorStream,
  userMcpServers,
} from './cursor-agent.js';
import { apiKey, backoffMs, baseUrl, postJson, readLimit } from './chatApi.js';
import openaiCompatible, {
  EMPTY_REPLY_NUDGE,
  toFunctionTools,
} from './openai-compatible.js';
import { parseStreamJson, runProcess } from './process.js';
import { USAGE_LIMIT } from '../trials.js';

test('readClaudeStream reads the answer, usage and out-of-bounds tools', () => {
  const events = [
    {
      type: 'system',
      subtype: 'init',
      model: 'claude-x',
      mcp_servers: [{ name: 'gev', status: 'connected' }],
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'mcp__gev__get_cyclones' },
          { type: 'tool_use', name: 'WebSearch' },
        ],
      },
    },
    {
      type: 'result',
      result: 'ANSWER: {}',
      is_error: false,
      num_turns: 2,
      usage: {
        input_tokens: 5,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 1,
        output_tokens: 7,
      },
    },
  ];
  const outcome = readClaudeStream(events);
  assert.equal(outcome.finalText, 'ANSWER: {}');
  assert.equal(outcome.modelReported, 'claude-x');
  assert.deepEqual(outcome.usage, {
    input_tokens: 16,
    output_tokens: 7,
    turns: 2,
  });
  assert.deepEqual(outcome.harnessToolCalls, [
    { name: 'mcp__gev__get_cyclones', out_of_bounds: false },
    { name: 'WebSearch', out_of_bounds: true },
  ]);
});

test('readCursorStream separates replay-server calls from other tools', () => {
  const started = (call) => ({
    type: 'tool_call',
    subtype: 'started',
    tool_call: call,
  });
  const events = [
    { type: 'system', subtype: 'init', model: 'Model X' },
    started({ getMcpToolsToolCall: { args: { pattern: 'gev' } } }),
    started({
      mcpToolCall: {
        args: { providerIdentifier: 'gev', toolName: 'get_cyclones' },
      },
    }),
    started({ shellToolCall: { args: { command: 'curl' } } }),
    {
      type: 'tool_call',
      subtype: 'completed',
      tool_call: { shellToolCall: {} },
    },
    {
      type: 'result',
      result: 'done',
      is_error: false,
      usage: { inputTokens: 3, cacheReadTokens: 4, outputTokens: 2 },
    },
  ];
  const outcome = readCursorStream(events);
  assert.equal(outcome.modelReported, 'Model X');
  assert.deepEqual(outcome.usage, { input_tokens: 7, output_tokens: 2 });
  assert.deepEqual(outcome.harnessToolCalls, [
    { name: 'getMcpToolsToolCall', out_of_bounds: false },
    { name: 'gev:get_cyclones', out_of_bounds: false },
    { name: 'shellToolCall', out_of_bounds: true },
  ]);
});

test('parseStreamJson skips lines that are not JSON', () => {
  assert.deepEqual(parseStreamJson('warning\n{"a":1}\n{bad\n'), [{ a: 1 }]);
});

test('the thin runner backs off politely and reads its endpoint per model', () => {
  assert.equal(backoffMs(1, null), 5000);
  assert.equal(backoffMs(3, null), 20000);
  assert.equal(backoffMs(9, null), 60000);
  assert.equal(backoffMs(1, '12'), 12000);
  assert.equal(backoffMs(1, '9999'), 120000);
  assert.equal(baseUrl('https://example.com/v1/'), 'https://example.com/v1');
});

/** A chat server on a free port; `reply(body, count)` answers each request. */
async function chatServer(reply) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push(JSON.parse(body));
      reply(response, requests.length);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    requests,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

test('postJson waits as long as the reply takes, and stops on abort', async () => {
  const server = await chatServer((response) =>
    setTimeout(() => response.end('{"ok":true}'), 400),
  );
  try {
    const reply = await postJson(`${server.url}/v1/x`, { a: 1 });
    assert.equal(reply.status, 200);
    assert.equal(reply.text, '{"ok":true}');
    assert.deepEqual(server.requests[0], { a: 1 });
    await assert.rejects(
      postJson(`${server.url}/v1/x`, {}, { signal: AbortSignal.timeout(100) }),
    );
  } finally {
    server.close();
  }
});

const GOOGLE_DAILY = JSON.stringify([
  {
    error: {
      code: 429,
      message: 'You exceeded your current quota.',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              quotaId: 'GenerateRequestsPerDayPerProjectPerModel',
              quotaValue: '100',
            },
          ],
        },
        {
          '@type': 'type.googleapis.com/google.rpc.RetryInfo',
          retryDelay: '37s',
        },
      ],
    },
  },
]);

test('readLimit tells a used-up daily quota from a per-minute limit', () => {
  assert.deepEqual(readLimit(GOOGLE_DAILY), { daily: true, retryAfter: '37' });
  assert.deepEqual(
    readLimit(
      GOOGLE_DAILY.replace(
        'GenerateRequestsPerDayPerProjectPerModel',
        'GenerateRequestsPerMinutePerProjectPerModel',
      ),
    ),
    { daily: false, retryAfter: '37' },
  );
  assert.deepEqual(readLimit('rate limited'), {
    daily: false,
    retryAfter: null,
  });
});

test('the thin runner stops at a used-up daily quota without retrying', async () => {
  const server = await chatServer((response) => {
    response.statusCode = 429;
    response.end(GOOGLE_DAILY);
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-quota-'));
  try {
    await assert.rejects(
      openaiCompatible.run({
        prompt: 'How many cyclones?',
        model: 'fake',
        endpoint: `${server.url}/v1`,
        mcpServer: replayServerCommand({
          snapshotDir: snapshotDir(),
          scenario: 'baseline',
          tracePath: path.join(dir, 't.jsonl'),
        }),
      }),
      (error) => error.kind === 'quota',
    );
    assert.equal(server.requests.length, 1);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rate-limit waits move the trial deadline and are not counted as time', async () => {
  const server = await chatServer((response, count) => {
    response.setHeader('content-type', 'application/json');
    if (count === 1) {
      response.statusCode = 429;
      response.end(
        GOOGLE_DAILY.replace('PerDay', 'PerMinute').replace('37s', '1s'),
      );
      return;
    }
    if (count === 2) {
      // A transient server fault, as Google's endpoint sometimes answers.
      response.statusCode = 500;
      response.setHeader('retry-after', '1');
      response.end('[{"error":{"code":500,"status":"INTERNAL"}}]');
      return;
    }
    if (count === 3) {
      // Anthropic's API answers 529 when it is overloaded.
      response.statusCode = 529;
      response.setHeader('retry-after', '1');
      response.end('{"type":"error","error":{"type":"overloaded_error"}}');
      return;
    }
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ANSWER: {"answer": 2, "data_status": "complete"}',
            },
          },
        ],
      }),
    );
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-wait-'));
  const extended = [];
  try {
    const started = performance.now();
    const outcome = await openaiCompatible.run({
      prompt: 'How many cyclones?',
      model: 'fake',
      endpoint: `${server.url}/v1`,
      extendDeadline: (ms) => extended.push(ms),
      mcpServer: replayServerCommand({
        snapshotDir: snapshotDir(),
        scenario: 'baseline',
        tracePath: path.join(dir, 't.jsonl'),
      }),
    });
    assert.deepEqual(extended, [1000, 1000, 1000]);
    assert.equal(outcome.usage.rate_limit_wait_ms, 3000);
    // The agent's time is the wall time less the waits, whatever the load.
    const wall = performance.now() - started;
    assert.ok(outcome.durationMs <= wall - 3000 + 50);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a request the provider never answers is retried, and not the agent's time", async () => {
  const server = await chatServer((response, count) => {
    if (count === 1) return; // Hold the request open, as a stalled endpoint does.
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ANSWER: {"answer": 2, "data_status": "complete"}',
            },
          },
        ],
      }),
    );
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-stall-'));
  const extended = [];
  try {
    const started = performance.now();
    const outcome = await openaiCompatible.run({
      prompt: 'How many cyclones?',
      model: 'fake',
      endpoint: `${server.url}/v1`,
      requestTimeoutMs: 300,
      extendDeadline: (ms) => extended.push(ms),
      mcpServer: replayServerCommand({
        snapshotDir: snapshotDir(),
        scenario: 'baseline',
        tracePath: path.join(dir, 't.jsonl'),
      }),
    });
    assert.match(outcome.finalText, /"answer": 2/);
    assert.equal(server.requests.length, 2);
    assert.deepEqual(extended, [300]);
    assert.equal(outcome.usage.stall_ms, 300);
    const wall = performance.now() - started;
    assert.ok(outcome.durationMs <= wall - 300 + 50);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the thin runner asks once when a model ends with an empty reply', async () => {
  const replies = [
    { role: 'assistant', content: '', reasoning: 'thinking only' },
    {
      role: 'assistant',
      content: 'ANSWER: {"answer": 2, "data_status": "complete"}',
    },
  ];
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push(JSON.parse(body));
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [{ message: replies[requests.length - 1] }],
          usage: {},
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-nudge-'));
  try {
    const outcome = await openaiCompatible.run({
      prompt: 'How many cyclones?',
      model: 'fake',
      endpoint: `http://127.0.0.1:${server.address().port}/v1`,
      mcpServer: replayServerCommand({
        snapshotDir: snapshotDir(),
        scenario: 'baseline',
        tracePath: path.join(dir, 't.jsonl'),
      }),
    });
    assert.match(outcome.finalText, /"answer": 2/);
    assert.equal(outcome.nudged, true);
    assert.equal(requests[1].messages.at(-1).content, EMPTY_REPLY_NUDGE);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('toFunctionTools hides tools meant only for the app panel', () => {
  const tools = toFunctionTools([
    { name: 'get_cyclones', description: 'd', inputSchema: { type: 'object' } },
    {
      name: 'panel_request',
      inputSchema: { type: 'object' },
      _meta: { ui: { visibility: ['app'] } },
    },
  ]);
  assert.deepEqual(
    tools.map((tool) => tool.function.name),
    ['get_cyclones'],
  );
});

test('the thin runner loops over tool calls against a chat API', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      const toolTurn = requests.length === 1;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          model: parsed.model,
          usage: { prompt_tokens: 100, completion_tokens: 10 },
          choices: [
            {
              message: toolTurn
                ? {
                    role: 'assistant',
                    content: '',
                    tool_calls: [
                      {
                        id: 'c1',
                        type: 'function',
                        function: { name: 'get_cyclones', arguments: '{}' },
                      },
                    ],
                  }
                : {
                    role: 'assistant',
                    content: 'ANSWER: {"answer": 2, "data_status": "complete"}',
                  },
            },
          ],
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-thin-'));
  process.env.GEB_OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const outcome = await openaiCompatible.run({
      prompt: 'How many cyclones?',
      model: 'fake',
      mcpServer: replayServerCommand({
        snapshotDir: snapshotDir(),
        scenario: 'baseline',
        tracePath: path.join(dir, 't.jsonl'),
      }),
    });
    assert.match(outcome.finalText, /"answer": 2/);
    assert.deepEqual(outcome.usage, {
      input_tokens: 200,
      output_tokens: 20,
      turns: 2,
      rate_limit_wait_ms: 0,
      stall_ms: 0,
    });
    assert.equal(requests[0].messages[0].role, 'system');
    assert.ok(
      requests[0].tools.some(
        (tool) => tool.function.name === 'get_earthquakes',
      ),
    );
    const toolMessage = requests[1].messages.find(
      (message) => message.role === 'tool',
    );
    assert.match(toolMessage.content, /active tropical cyclones/);
  } finally {
    delete process.env.GEB_OPENAI_BASE_URL;
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a key goes only to its own provider, and never over plain http', () => {
  const env = { GEMINI_API_KEY: 'g', GEB_OPENAI_API_KEY: 'o' };
  assert.equal(apiKey('https://example.com/v1', 'GEMINI_API_KEY', env), 'g');
  assert.equal(
    apiKey('https://example.com/v1', 'GEMINI_API_KEY', {
      GEB_OPENAI_API_KEY: 'o',
    }),
    null,
    'no fallback to another provider key',
  );
  // The generic key goes only to GEB_OPENAI_BASE_URL (here the local default),
  // never to an entry's own endpoint.
  assert.equal(apiKey(undefined, undefined, env), 'o');
  assert.equal(apiKey('https://openrouter.ai/api/v1', undefined, env), null);
  // Only a key variable can be sent: not the held-out seed, say.
  assert.throws(
    () => apiKey('https://example.com/v1', 'GEB_HELDOUT_SEED', env),
    /\*_API_KEY/,
  );
  assert.throws(
    () => apiKey('http://example.com/v1', 'GEMINI_API_KEY', env),
    /plain http/,
  );
});

test('a harness that reports a spent usage pool stops the run as a quota', () => {
  assert.ok(
    USAGE_LIMIT.test("ActionRequiredError: You've hit your usage limit"),
  );
  assert.ok(USAGE_LIMIT.test('Claude AI usage limit reached'));
  assert.ok(!USAGE_LIMIT.test('Replay server not connected'));
});

test('Cursor runs block every MCP server the user configured globally', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'geb-home-'));
  try {
    assert.deepEqual(userMcpServers(home), []);
    mkdirSync(path.join(home, '.cursor'));
    writeFileSync(
      path.join(home, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { github: {}, Playwright: {} } }),
    );
    assert.deepEqual(userMcpServers(home), ['github', 'Playwright']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test(
  'a timed-out harness is stopped with everything it started',
  { timeout: 10000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'geb-group-'));
    const pidFile = path.join(dir, 'pid');
    try {
      const controller = new AbortController();
      const done = runProcess(
        'sh',
        ['-c', `sleep 30 & echo $! > ${pidFile}; wait`],
        { cwd: dir, env: process.env, signal: controller.signal },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const grandchild = Number(readFileSync(pidFile, 'utf8'));
      controller.abort(new Error('timed out'));
      await assert.rejects(done, /timed out/);
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.throws(
        () => process.kill(grandchild, 0),
        'the grandchild is gone',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("Cursor may use only the replay server's tools", () => {
  const { allow, deny } = cursorPermissions(['gev', 'github']).permissions;
  assert.deepEqual(allow, ['Mcp(gev:*)']);
  for (const rule of ['Read(**)', 'Read(/**)', 'Shell(*)', 'Write(**)'])
    assert.ok(deny.includes(rule), `${rule} is not denied`);
  assert.ok(deny.includes('Mcp(github:*)'), "the user's own server is allowed");
  assert.ok(!deny.includes('Mcp(gev:*)'), 'the replay server is denied');
});

test("a Claude Code trial log keeps the trial, not the account's usage", () => {
  const lines = [
    '{"type":"system","subtype":"init"}',
    '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}',
    '{"type":"result","result":"ANSWER: {}"}',
  ];
  assert.equal(trialLog(lines.join('\n')), [lines[0], lines[2]].join('\n'));
});
