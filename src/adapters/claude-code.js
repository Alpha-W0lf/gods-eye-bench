/**
 * Claude Code in headless mode (`claude -p`), signed in as the user. Isolation: no built-in tools, only the replay server's MCP tools, no
 * settings files or CLAUDE.md, a clean environment and an empty directory.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { trialError, USAGE_LIMIT } from '../trials.js';
import { cleanEnv, parseStreamJson, runProcess, versionOf } from './process.js';

const SERVER = 'gev';

/** Read a Claude Code stream-json log into a trial outcome. */
export function readClaudeStream(events) {
  const init = events.find(
    (event) => event.type === 'system' && event.subtype === 'init',
  );
  const result = events.findLast((event) => event.type === 'result');
  const toolCalls = events
    .filter((event) => event.type === 'assistant')
    .flatMap((event) => event.message?.content ?? [])
    .filter((item) => item.type === 'tool_use')
    .map((item) => ({
      name: item.name,
      out_of_bounds: !item.name.startsWith(`mcp__${SERVER}__`),
    }));
  const usage = result?.usage;
  return {
    init,
    result,
    finalText: typeof result?.result === 'string' ? result.result : null,
    modelReported: init?.model ?? null,
    harnessToolCalls: toolCalls,
    usage: usage
      ? {
          input_tokens:
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0),
          output_tokens: usage.output_tokens ?? 0,
          turns: result.num_turns ?? null,
        }
      : null,
  };
}

/**
 * Claude Code's stream log as kept with a trial: every line except
 * `rate_limit_event`, which reports the signed-in account's usage and plan
 * settings rather than anything about the trial.
 */
export function trialLog(stdout) {
  return stdout
    .split('\n')
    .filter((line) => !line.includes('"type":"rate_limit_event"'))
    .join('\n');
}

export default {
  name: 'claude-code',
  async describe() {
    const version = versionOf('claude').split(' ')[0];
    return { name: 'Claude Code', version };
  },
  async run({ prompt, model, mcpServer, workdir, signal }) {
    const config = path.join(workdir, 'mcp.json');
    writeFileSync(
      config,
      JSON.stringify({ mcpServers: { [SERVER]: mcpServer } }),
    );
    const started = performance.now();
    const { code, stdout, stderr } = await runProcess(
      'claude',
      [
        '-p',
        prompt,
        '--model',
        model,
        '--setting-sources',
        '',
        '--tools',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        config,
        '--allowedTools',
        `mcp__${SERVER}`,
        '--output-format',
        'stream-json',
        '--verbose',
        '--no-session-persistence',
      ],
      { cwd: workdir, env: cleanEnv(), signal },
    );
    const durationMs = Math.round(performance.now() - started);
    const outcome = readClaudeStream(parseStreamJson(stdout));
    const server = outcome.init?.mcp_servers?.find(
      (item) => item.name === SERVER,
    );
    if (outcome.init && server?.status !== 'connected')
      throw new Error(
        `Replay server not connected (${server?.status ?? 'missing'})`,
      );
    if (!outcome.result || outcome.result.is_error) {
      const message = (outcome.result?.result ?? stderr).slice(0, 300);
      // A spent usage pool stops the run; anything else is the harness's.
      throw trialError(
        USAGE_LIMIT.test(message) ? 'quota' : 'harness',
        `Claude Code failed (exit ${code}): ${message}`,
      );
    }
    return { ...outcome, durationMs, rawLog: trialLog(stdout) };
  },
};
