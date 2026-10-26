import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { repoPath } from './config.js';
import { connectMcp, resultText } from './mcpClient.js';
import { parseServerArgs } from './server.ts';

const SNAPSHOT = repoPath('snapshots', '2026-10-03');

function replayServer({ scenario = 'baseline', trace } = {}) {
  return connectMcp({
    command: process.execPath,
    args: [
      repoPath('src', 'server.ts'),
      '--snapshot',
      SNAPSHOT,
      '--scenario',
      scenario,
      ...(trace ? ['--trace', trace] : []),
    ],
  });
}

// The server is the first TypeScript module: Node must load it with no
// flag and no warning, since harnesses can pass the server's stderr through.
test('the replay server loads as TypeScript without a flag or a warning', () => {
  const url = pathToFileURL(repoPath('src', 'server.ts')).href;
  const { status, stderr } = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`],
    { encoding: 'utf8' },
  );
  assert.equal(stderr, '');
  assert.equal(status, 0);
});

test('parseServerArgs requires a snapshot and rejects unknown arguments', () => {
  assert.deepEqual(parseServerArgs(['--snapshot', 's']), {
    scenario: 'baseline',
    snapshot: 's',
  });
  assert.throws(() => parseServerArgs([]), /--snapshot is required/);
  assert.throws(() => parseServerArgs(['--snapshot']), /incomplete/);
  assert.throws(() => parseServerArgs(['--x', '1']), /Unknown/);
});

test("the replay server is God's Eye View's MCP server, deterministic and traced", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-server-'));
  const trace = path.join(dir, 'trace.jsonl');
  const calls = [
    ['get_earthquakes', { limit: 200 }],
    ['get_cyclones', {}],
    ['get_recent_launches', { limit: 5 }],
    [
      'aircraft_in_area',
      { area: { lat: 32.72, lon: -117.16, radius_km: 500 }, military: true },
    ],
    ['satellites_overhead', { location: { lat: 30, lon: -97 } }],
  ];
  try {
    const outputs = [];
    for (let run = 0; run < 2; run += 1) {
      const client = await replayServer({ trace });
      try {
        assert.equal(client.serverInfo.name, 'gods-eye-view');
        const tools = await client.listTools();
        assert.ok(tools.some((tool) => tool.name === 'get_earthquakes'));
        const texts = [];
        for (const [name, args] of calls)
          texts.push(resultText(await client.callTool(name, args)));
        outputs.push(texts);
      } finally {
        client.close();
      }
    }
    assert.deepEqual(outputs[0], outputs[1], 'replays are identical');
    assert.match(outputs[0][1], /active tropical cyclones/);
    assert.match(outputs[0][4], /unavailable|HTTP 404/i);

    const lines = readFileSync(trace, 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    const traced = lines.filter((line) => line.type === 'call');
    assert.equal(traced.length, calls.length * 2);
    assert.deepEqual(traced[0].args, { limit: 200 });
    assert.equal(traced[0].ok, true);
    assert.equal(traced[4].tool, 'satellites_overhead');
    assert.equal(traced[4].ok, false);
    assert.ok(
      lines.some(
        (line) => line.type === 'miss' && line.key.includes('/api/celestrak/'),
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scenarios reach the agent through the tools', async () => {
  const stale = await replayServer({ scenario: 'stale' });
  try {
    assert.match(
      resultText(await stale.callTool('get_recent_launches', {})),
      /stale/i,
    );
  } finally {
    stale.close();
  }
  const outage = await replayServer({ scenario: 'outage' });
  try {
    const result = await outage.callTool('get_earthquakes', {});
    assert.equal(result.isError, true);
    const cyclones = await outage.callTool('get_cyclones', {});
    assert.equal(cyclones.isError, true);
    assert.match(resultText(cyclones), /unavailable/i);
  } finally {
    outage.close();
  }
});
