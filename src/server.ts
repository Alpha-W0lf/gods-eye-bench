/**
 * The replay MCP server: God's Eye View's own local MCP server, reading a
 * snapshot instead of the live feeds, with the clock frozen at the snapshot's
 * time and the network blocked. Every tool call is written to a trace.
 *
 *   node src/server.ts --snapshot snapshots/<id> [--scenario baseline]
 *                      [--trace trace.jsonl] [--gev <checkout>]
 */

import { appendFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPinnedCheckout, gevDir, importGev } from './gev.js';
import { freezeClock } from './snapshot/clock.js';
import { APP_BASE } from './snapshot/key.js';
import { blockNetwork, createReplayFetch } from './snapshot/replay.js';
import { loadSnapshot } from './snapshot/store.js';

export interface ServerOptions {
  snapshot: string;
  scenario: string;
  trace?: string;
  gev?: string;
}

/**
 * The parts of a JSON-RPC message and tool result the trace reads. God's Eye
 * View's server is imported untyped, so these are not checked against it.
 */
interface RpcMessage {
  method?: string;
  params?: { name?: string; arguments?: unknown };
}
interface ToolResult {
  isError?: boolean;
  content?: { type: string; text?: unknown }[];
}
interface RpcResponse {
  result?: ToolResult;
  error?: { message?: string };
}
interface McpServer {
  handle(
    message: RpcMessage,
    context?: unknown,
  ): Promise<RpcResponse | undefined>;
}

type Trace = (line: Record<string, unknown>) => void;

/** Read `--snapshot`, `--scenario`, `--trace` and `--gev` from arguments. */
export function parseServerArgs(argv: string[]): ServerOptions {
  const options: Partial<ServerOptions> = { scenario: 'baseline' };
  const names: Record<string, keyof ServerOptions> = {
    '--snapshot': 'snapshot',
    '--scenario': 'scenario',
    '--trace': 'trace',
    '--gev': 'gev',
  };
  for (let index = 0; index < argv.length; index += 2) {
    const name = names[argv[index]];
    if (!name || argv[index + 1] === undefined)
      throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    options[name] = argv[index + 1];
  }
  if (!options.snapshot) throw new Error('--snapshot is required');
  return options as ServerOptions;
}

/** The text of a tool result's first content item, shortened for the trace. */
function firstText(result: ToolResult | undefined): string | null {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  return typeof text === 'string' ? text.slice(0, 500) : null;
}

/**
 * Wrap an MCP server so each `tools/call` is traced as one JSON line:
 * `{ type: 'call', tool, args, ok, text, ms }`. `trace(line)` receives each.
 */
export function traceToolCalls(server: McpServer, trace: Trace): McpServer {
  return {
    handle: async (message, context) => {
      if (message?.method !== 'tools/call')
        return server.handle(message, context);
      const started = performance.now();
      const response = await server.handle(message, context);
      trace({
        type: 'call',
        tool: message.params?.name ?? null,
        args: message.params?.arguments ?? {},
        ok: response?.result != null && response.result.isError !== true,
        text: firstText(response?.result) ?? response?.error?.message ?? null,
        ms: Math.round(performance.now() - started),
      });
      return response;
    },
  };
}

/**
 * Build the replay server for a snapshot and scenario. Freezes the clock and
 * blocks the network for this process before God's Eye View is imported.
 * Resolves to `{ server, manifest, checksum }`.
 */
export async function createReplayServer({
  snapshot,
  scenario = 'baseline',
  gev = gevDir(),
  trace = () => {},
}: {
  snapshot: string;
  scenario?: string;
  gev?: string;
  trace?: Trace;
}) {
  assertPinnedCheckout(gev);
  const { manifest, checksum, responses } = loadSnapshot(snapshot);
  freezeClock(manifest.clock_ms);
  blockNetwork();
  const fetchImpl = createReplayFetch({
    responses,
    scenario,
    onMiss: (key: string) => trace({ type: 'miss', key }),
  });
  const { createLocalMcpServer } = await importGev('server/mcp/server.js', gev);
  const server = createLocalMcpServer({ apiBase: APP_BASE, fetchImpl });
  return { server: traceToolCalls(server, trace), manifest, checksum };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    const options = parseServerArgs(process.argv.slice(2));
    const tracePath = options.trace;
    const write: Trace = tracePath
      ? (line) => appendFileSync(tracePath, `${JSON.stringify(line)}\n`)
      : () => {};
    const gev = options.gev ? path.resolve(options.gev) : gevDir();
    const { server, manifest } = await createReplayServer({
      ...options,
      gev,
      trace: write,
    });
    const { serveStdio } = await importGev('server/mcp/stdio.js', gev);
    console.error(
      `gods-eye-bench replay: snapshot ${manifest.id}, scenario ${options.scenario}`,
    );
    await serveStdio(server, { input: process.stdin, output: process.stdout });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
