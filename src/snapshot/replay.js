/**
 * The replay fetch: answers every request from a snapshot, under a scenario,
 * and never touches the network.
 */

import { requestKey } from './key.js';
import { applyScenario, scenarioRules } from './scenarios.js';

/** The body a request the snapshot lacks receives, with status 404. */
export const MISS_BODY = JSON.stringify({ error: 'not_in_snapshot' });

/**
 * A fetch over `responses` (a Map from `loadSnapshot`). `onMiss(key)` is told
 * about each request the snapshot cannot answer.
 */
export function createReplayFetch({
  responses,
  scenario = 'baseline',
  onMiss = () => {},
}) {
  const rules = scenarioRules(scenario);
  return async (input, init = {}) => {
    init.signal?.throwIfAborted();
    const key = requestKey(input, init);
    const recorded = responses.get(key);
    if (!recorded) {
      onMiss(key);
      return new Response(MISS_BODY, {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const { status, headers, body } = applyScenario(recorded, rules);
    return new Response(status === 204 || status === 304 ? null : body, {
      status,
      headers,
    });
  };
}

/** Make `globalThis.fetch` throw, so only the replay fetch can answer. */
export function blockNetwork() {
  globalThis.fetch = async (input) => {
    throw new Error(
      `Network access is blocked during replay: ${String(input?.url ?? input)}`,
    );
  };
}
