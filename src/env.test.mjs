import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanEnv } from './env.js';
import { connectMcp } from './mcpClient.js';

test('child processes never see keys or the held-out seed', async () => {
  process.env.GEMINI_API_KEY = 'not-a-real-key';
  process.env.GEB_HELDOUT_SEED = 'not-a-real-seed';
  try {
    const env = cleanEnv({ EXTRA: '1' });
    assert.equal(env.GEMINI_API_KEY, undefined);
    assert.equal(env.GEB_HELDOUT_SEED, undefined);
    assert.equal(env.EXTRA, '1');
    // A stand-in MCP server that answers every request with its own
    // environment's variable names.
    const server = `process.stdin.on('data', (chunk) => {
      for (const line of String(chunk).split('\\n').filter(Boolean)) {
        const { id } = JSON.parse(line);
        if (id !== undefined)
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { names: Object.keys(process.env) } }) + '\\n');
      }
    });`;
    const client = await connectMcp({
      command: process.execPath,
      args: ['-e', server],
    });
    try {
      const { names } = await client.request('env');
      assert.ok(!names.includes('GEMINI_API_KEY'));
      assert.ok(!names.includes('GEB_HELDOUT_SEED'));
    } finally {
      client.close();
    }
  } finally {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEB_HELDOUT_SEED;
  }
});
