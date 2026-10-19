/**
 * A minimal MCP client over stdio: newline-delimited JSON-RPC to a child
 * process. Used by the reference agent, the thin runner and tests.
 */

import { spawn } from 'node:child_process';
import { cleanEnv } from './env.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';

/**
 * Start `command args` and complete the MCP handshake. Resolves to a client
 * with `request(method, params)`, `listTools()`, `callTool(name, args)` and
 * `close()`. Requests reject on JSON-RPC errors and when the process exits.
 */
export async function connectMcp({
  command,
  args = [],
  env,
  cwd,
  stderr = 'ignore',
}) {
  const child = spawn(command, args, {
    cwd,
    // The replay server imports God's Eye View and its dependencies; it
    // gets a clean environment, never this process's keys.
    env: cleanEnv(env),
    stdio: ['pipe', 'pipe', stderr],
  });
  const pending = new Map();
  let nextId = 0;
  let buffer = '';
  let exitError = null;
  const failAll = (error) => {
    exitError = error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  child.on('error', failAll);
  child.on('exit', (code, signal) =>
    failAll(new Error(`MCP server exited (${signal ?? code})`)),
  );
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // Not JSON-RPC (a stray log line): not ours to answer.
      }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error)
        waiter.reject(
          Object.assign(new Error(message.error.message), {
            code: message.error.code,
          }),
        );
      else waiter.resolve(message.result);
    }
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params = {}) =>
    exitError
      ? Promise.reject(exitError)
      : new Promise((resolve, reject) => {
          const id = (nextId += 1);
          pending.set(id, { resolve, reject });
          send({ jsonrpc: '2.0', id, method, params });
        });

  const initialized = await request('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'gods-eye-bench', version: '0' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    serverInfo: initialized.serverInfo,
    instructions: initialized.instructions ?? null,
    request,
    async listTools() {
      return (await request('tools/list')).tools;
    },
    callTool(name, args = {}) {
      return request('tools/call', { name, arguments: args });
    },
    close() {
      child.stdin.end();
      if (child.exitCode === null) child.kill();
    },
  };
}

/** The text of a tool result, its content items joined by newlines. */
export function resultText(result) {
  return (result?.content ?? [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}
