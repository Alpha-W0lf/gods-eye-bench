/**
 * The Cursor Agent CLI (`agent -p`), on the user's Cursor login. Isolation:
 * the workspace holds only `.cursor/mcp.json` (the replay server) and
 * `.cursor/cli.json`, which allows the replay server's tools and denies
 * file reads anywhere, shell, writes and web fetches, so the question file
 * stays out of reach. Any other tool call is logged as out of bounds and
 * fails the trial.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { trialError, USAGE_LIMIT } from '../trials.js';
import { cleanEnv, parseStreamJson, runProcess, versionOf } from './process.js';

const SERVER = 'gev';
/** Tool-call kinds that reach the replay server or list its tools. */
const IN_BOUNDS = new Set(['mcpToolCall', 'getMcpToolsToolCall']);

/** Read a Cursor stream-json log into a trial outcome. */
export function readCursorStream(events) {
  const init = events.find(
    (event) => event.type === 'system' && event.subtype === 'init',
  );
  const result = events.findLast((event) => event.type === 'result');
  const toolCalls = events
    .filter(
      (event) => event.type === 'tool_call' && event.subtype === 'started',
    )
    .map((event) => {
      const kind =
        Object.keys(event.tool_call ?? {}).find((key) =>
          key.endsWith('ToolCall'),
        ) ?? 'unknown';
      const call = event.tool_call?.[kind] ?? {};
      const server =
        call.args?.providerIdentifier ??
        call.args?.serverIdentifier ??
        call.args?.server;
      const name =
        kind === 'mcpToolCall' ? `${server}:${call.args?.toolName}` : kind;
      return {
        name,
        out_of_bounds:
          !IN_BOUNDS.has(kind) || (kind === 'mcpToolCall' && server !== SERVER),
      };
    });
  const usage = result?.usage;
  return {
    result,
    finalText: typeof result?.result === 'string' ? result.result : null,
    modelReported: init?.model ?? null,
    harnessToolCalls: toolCalls,
    usage: usage
      ? {
          input_tokens:
            (usage.inputTokens ?? 0) +
            (usage.cacheReadTokens ?? 0) +
            (usage.cacheWriteTokens ?? 0),
          output_tokens: usage.outputTokens ?? 0,
        }
      : null,
  };
}

/** Names of the MCP servers in the user's global Cursor configuration. */
export function userMcpServers(home = homedir()) {
  try {
    const config = JSON.parse(
      readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8'),
    );
    return Object.keys(config.mcpServers ?? {});
  } catch {
    return [];
  }
}

/**
 * Cursor's permission file for a trial: the replay server only. File reads
 * are denied everywhere (without this, Cursor read the question file), as
 * are shell, writes, web fetches and the user's own MCP servers, which also
 * load in a headless run.
 */
export function cursorPermissions(userServers) {
  return {
    permissions: {
      allow: [`Mcp(${SERVER}:*)`],
      deny: [
        'Read(**)',
        'Read(/**)',
        'Shell(*)',
        'Write(**)',
        'WebFetch(*)',
        ...userServers
          .filter((name) => name !== SERVER)
          .map((name) => `Mcp(${name}:*)`),
      ],
    },
  };
}

export default {
  name: 'cursor-agent',
  async describe() {
    return { name: 'Cursor Agent CLI', version: versionOf('agent') };
  },
  async run({ prompt, model, mcpServer, workdir, signal }) {
    const settings = path.join(workdir, '.cursor');
    mkdirSync(settings, { recursive: true });
    writeFileSync(
      path.join(settings, 'mcp.json'),
      JSON.stringify({ mcpServers: { [SERVER]: mcpServer } }),
    );
    writeFileSync(
      path.join(settings, 'cli.json'),
      JSON.stringify(cursorPermissions(userMcpServers())),
    );
    const started = performance.now();
    const { code, stdout, stderr } = await runProcess(
      'agent',
      [
        '-p',
        '--trust',
        '--approve-mcps',
        '--model',
        model,
        '--output-format',
        'stream-json',
        prompt,
      ],
      { cwd: workdir, env: cleanEnv(), signal },
    );
    const durationMs = Math.round(performance.now() - started);
    const outcome = readCursorStream(parseStreamJson(stdout));
    if (!outcome.result || outcome.result.is_error) {
      const message = (outcome.result?.result ?? stderr).slice(0, 300);
      // A spent usage pool stops the run; anything else is the harness's.
      throw trialError(
        USAGE_LIMIT.test(message) ? 'quota' : 'harness',
        `Cursor agent failed (exit ${code}): ${message}`,
      );
    }
    return { ...outcome, durationMs, rawLog: stdout };
  },
};
