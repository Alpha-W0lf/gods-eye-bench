/**
 * The thin runner: a plain tool-calling loop over any OpenAI-compatible chat
 * completions API; the published runs used Ollama and Google's Gemini API.
 * It has no system prompt of its own: the model sees the replay server's MCP
 * instructions, the question and the tools, plus, once, a request for the
 * final answer when it ends with an empty reply (recorded as `nudged`). So
 * models run through it are compared on the same footing.
 *
 * The endpoint and key come from the model's entry in config/models.json
 * (`endpoint`, `apiKeyEnv`: the name of the variable holding the key), or else
 *
 *   GEB_OPENAI_BASE_URL   default http://localhost:11434/v1 (Ollama)
 *   GEB_OPENAI_API_KEY    optional bearer token, never logged
 *
 * Requests, retries and quotas are handled in chatApi.js.
 */

import { performance } from 'node:perf_hooks';
import { BENCH_VERSION } from '../config.js';
import { connectMcp, resultText } from '../mcpClient.js';
import { trialError } from '../trials.js';
import { baseUrl, complete } from './chatApi.js';

/** The most model turns one trial may take before it is cut off. */
export const MAX_TURNS = 12;

/**
 * Sent once when a model ends with an empty reply. Thinking models served by
 * Ollama can put everything in their reasoning channel and leave the reply
 * empty; real agent apps ask again, and so does this runner, once.
 */
export const EMPTY_REPLY_NUDGE =
  'Give your final answer now, ending with the ANSWER line.';

/** MCP tools the model may call, as chat-completions function tools. */
export function toFunctionTools(tools) {
  return tools
    .filter(
      (tool) =>
        !(tool._meta?.ui?.visibility ?? ['model']).every(
          (who) => who === 'app',
        ),
    )
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.inputSchema,
      },
    }));
}

/** Parse tool-call arguments; a model that sends bad JSON gets the error back. */
function parseArguments(raw) {
  if (raw && typeof raw === 'object') return { args: raw };
  try {
    return { args: raw ? JSON.parse(raw) : {} };
  } catch {
    return {
      error: `Arguments are not valid JSON: ${String(raw).slice(0, 200)}`,
    };
  }
}

export default {
  name: 'openai-compatible',
  async describe({ endpoint, requestTimeoutMs } = {}) {
    return {
      name: 'gods-eye-bench thin runner',
      version: BENCH_VERSION,
      endpoint: new URL(baseUrl(endpoint)).host,
      ...(requestTimeoutMs ? { request_timeout_ms: requestTimeoutMs } : {}),
    };
  },
  async run({
    prompt,
    model,
    mcpServer,
    signal,
    endpoint,
    apiKeyEnv,
    requestTimeoutMs,
    extendDeadline,
  }) {
    const started = performance.now();
    const client = await connectMcp(mcpServer);
    const log = [];
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      turns: 0,
      rate_limit_wait_ms: 0,
      stall_ms: 0,
    };
    const harnessToolCalls = [];
    let nudged = false;
    try {
      const tools = toFunctionTools(await client.listTools());
      const messages = [
        ...(client.instructions
          ? [{ role: 'system', content: client.instructions }]
          : []),
        { role: 'user', content: prompt },
      ];
      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        const reply = await complete(
          { model, messages, tools, stream: false },
          {
            signal,
            endpoint,
            apiKeyEnv,
            requestTimeoutMs,
            extendDeadline,
            usage,
          },
        );
        log.push(reply);
        usage.turns += 1;
        usage.input_tokens += reply.usage?.prompt_tokens ?? 0;
        usage.output_tokens += reply.usage?.completion_tokens ?? 0;
        const message = reply.choices?.[0]?.message;
        if (!message) throw new Error('Chat API returned no message');
        messages.push({
          role: 'assistant',
          content: message.content ?? '',
          tool_calls: message.tool_calls,
        });
        if (!message.tool_calls?.length) {
          if (!(message.content ?? '').trim() && !nudged) {
            nudged = true;
            messages.push({ role: 'user', content: EMPTY_REPLY_NUDGE });
            continue;
          }
          return {
            finalText: message.content ?? '',
            modelReported: reply.model ?? model,
            usage,
            nudged,
            harnessToolCalls,
            durationMs: Math.round(
              performance.now() -
                started -
                usage.rate_limit_wait_ms -
                usage.stall_ms,
            ),
            rawLog: JSON.stringify(log),
          };
        }
        for (const call of message.tool_calls) {
          const name = call.function?.name;
          harnessToolCalls.push({
            name,
            out_of_bounds: !tools.some((tool) => tool.function.name === name),
          });
          const { args, error } = parseArguments(call.function?.arguments);
          let content = error;
          if (!error) {
            const result = await client
              .callTool(name, args)
              .catch((failure) => ({
                isError: true,
                content: [{ type: 'text', text: failure.message }],
              }));
            content = `${result.isError ? 'Error: ' : ''}${resultText(result)}`;
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content });
        }
      }
      throw trialError('agent', `No final answer after ${MAX_TURNS} turns`);
    } finally {
      client.close();
    }
  },
};
