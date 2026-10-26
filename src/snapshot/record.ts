/**
 * The recording fetch: passes each request through and keeps the responses
 * a snapshot may store (ADR 0006). Everything else is answered but never kept.
 */

import { requestKey } from './key.ts';
import { mayRecord, sourceForKey, SOURCES, type Source } from './sources.ts';
import { keptHeaders, type RecordedResponse } from './store.ts';

/**
 * Wrap `fetchImpl` so allowed responses are collected. A request already kept
 * is answered from the recording without fetching again, so the snapshot holds
 * one consistent response per key and providers see each request once.
 * `recorded()` returns `{ key, source, status, headers, body }` entries;
 * `skipped()` lists keys that were fetched but not kept.
 */
export function createRecordingFetch({
  fetchImpl = (input, init) => globalThis.fetch(input, init),
  sources = SOURCES,
}: {
  fetchImpl?: typeof fetch;
  sources?: readonly Source[];
} = {}) {
  const kept = new Map<string, RecordedResponse>();
  const skipped = new Set<string>();
  const recordingFetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const key = requestKey(input, init);
    const known = kept.get(key);
    if (known)
      return new Response(known.body, {
        status: known.status,
        headers: known.headers,
      });
    const response = await fetchImpl(input, init);
    const body = await response.text();
    const source = sourceForKey(key, sources);
    if (source && mayRecord(source, response.status)) {
      kept.set(key, {
        key,
        source,
        status: response.status,
        headers: keptHeaders(response.headers),
        body,
      });
    } else skipped.add(key);
    return new Response(body, {
      status: response.status,
      headers: response.headers,
    });
  };
  return {
    fetch: recordingFetch,
    recorded: () => [...kept.values()],
    skipped: () => [...skipped].sort(),
  };
}
