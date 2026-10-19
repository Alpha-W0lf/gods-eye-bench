/**
 * The harness adapters. Each is one file exporting:
 *
 *   {
 *     name: 'my-harness',
 *     async describe({ model, ...options }) -> { name, version, ... },
 *     async run({ prompt, model, mcpServer, workdir, timeoutMs, signal,
 *                 extendDeadline, question, ...options })
 *       -> { finalText, usage, durationMs, harnessToolCalls, nudged, rawLog }
 *   }
 *
 * `mcpServer` is `{ command, args }` for the replay server. `usage` is
 * `{ input_tokens, output_tokens, ... }` as the harness reports it, or null.
 * `harnessToolCalls` lists the harness's own tool calls as
 * `{ name, out_of_bounds }`. `nudged` is true when the harness had to ask the
 * model again for an answer (the thin runner does so once on an empty reply). Model adapters must use
 * only `prompt`; `question` exists for the scripted reference agent.
 * `options` are the model entry's own settings (an endpoint, a key variable).
 * An adapter that waits out a provider's limit calls `extendDeadline(ms)` so
 * the wait is not the agent's time. Throwing (or `signal` aborting) records
 * the trial as an error; throw `trialError(kind, message)` from
 * `src/trials.js` to say whether the agent itself failed (`agent`, scored
 * after one retry) or a usage quota ran out (`quota`, the run stops). Other
 * errors are the harness's and are retried until they succeed.
 */

import claudeCode from './claude-code.js';
import cursorAgent from './cursor-agent.js';
import openaiCompatible from './openai-compatible.js';
import reference from './reference.js';

export const ADAPTERS = Object.freeze(
  Object.fromEntries(
    [reference, claudeCode, cursorAgent, openaiCompatible].map((adapter) => [
      adapter.name,
      adapter,
    ]),
  ),
);

/** The adapter with this name; unknown names throw. */
export function getAdapter(name) {
  if (!Object.hasOwn(ADAPTERS, name))
    throw new Error(
      `Unknown adapter "${name}"; expected one of ${Object.keys(ADAPTERS).join(', ')}`,
    );
  return ADAPTERS[name];
}
