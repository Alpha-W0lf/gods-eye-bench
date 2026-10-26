/**
 * Record a snapshot from a running God's Eye View dev server: call the tools
 * the questions use, through the recording fetch, and write what may be kept.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { BENCH } from './config.js';
import { assertPinnedCheckout, gevDir, importGev } from './gev.js';
import { LOCATIONS } from './questions/locations.js';
import { APP_BASE } from './snapshot/key.ts';
import { createRecordingFetch } from './snapshot/record.ts';
import { writeSnapshot } from './snapshot/store.ts';

/**
 * Calls that fetch every whole feed the questions read. Feeds are fetched
 * whole and filtered by the tools, so one call per feed captures the world.
 */
export const FEED_CALLS = Object.freeze([
  ['get_earthquakes', { limit: 1 }],
  ['get_cyclones', {}],
  ['get_recent_launches', { limit: 1 }],
  [
    'aircraft_in_area',
    { area: { bbox: [-180, -90, 180, 90] }, military: true, limit: 1 },
  ],
  ['get_active_fires', { area: { bbox: [-125, 32, -114, 42] } }],
  ['vessels_in_area', { area: { bbox: [-123, 37, -122, 38] } }],
]);

/** One call per location name, so its geocode is recorded. */
export function placeCalls(locations = LOCATIONS) {
  return locations.map(({ name }) => [
    'get_cyclones',
    { area: { place: name } },
  ]);
}

/**
 * The pause between recorded calls. God's Eye View already spaces its
 * Nominatim requests 1.1 s apart; the recorder spaces every call it makes as
 * well, so a recording stays within Nominatim's limit of one request a
 * second (ADR 0006).
 */
export const PAUSE_MS = 1100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call each tool through `server` in turn, pausing between calls, and log a
 * line per call.
 */
export async function callTools(
  server,
  calls,
  { pauseMs = PAUSE_MS, wait = sleep, log = () => {} } = {},
) {
  for (const [index, [name, args]] of calls.entries()) {
    if (index) await wait(pauseMs);
    const response = await server.handle(
      {
        jsonrpc: '2.0',
        id: index + 1,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      {},
    );
    const text = response.result?.content?.[0]?.text ?? response.error?.message;
    log(`${name} ${JSON.stringify(args)}: ${String(text).slice(0, 100)}`);
  }
}

/**
 * Record a snapshot into `out`. The dev server at `APP_BASE` must be running
 * from the pinned checkout. Resolves to the manifest and the keys that were
 * fetched but not kept.
 */
export async function recordSnapshot({
  id,
  out,
  gev = gevDir(),
  log = () => {},
}) {
  assertPinnedCheckout(gev);
  if (existsSync(out)) throw new Error(`${out} already exists`);
  const probe = await fetch(new URL('/api/cyclones', APP_BASE)).catch(
    () => null,
  );
  if (!probe?.ok)
    throw new Error(`No God's Eye View dev server answering at ${APP_BASE}`);
  const recorder = createRecordingFetch();
  const { createLocalMcpServer } = await importGev('server/mcp/server.js', gev);
  const server = createLocalMcpServer({
    apiBase: APP_BASE,
    fetchImpl: recorder.fetch,
  });
  const clockMs = Date.now();
  await callTools(server, [...FEED_CALLS, ...placeCalls()], { log });
  mkdirSync(out, { recursive: true });
  const manifest = writeSnapshot(out, {
    id,
    clockMs,
    gev: { commit: BENCH.gev.commit, version: BENCH.gev.version },
    responses: recorder.recorded(),
  });
  return { manifest, skipped: recorder.skipped() };
}
