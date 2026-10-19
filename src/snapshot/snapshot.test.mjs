import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { freezeClock } from './clock.js';
import { createRecordingFetch } from './record.js';
import { blockNetwork, createReplayFetch, MISS_BODY } from './replay.js';
import { applyScenario, scenarioRules } from './scenarios.js';
import { callTools, PAUSE_MS } from '../recorder.js';
import { mayRecord, sourceForKey } from './sources.js';
import {
  keptHeaders,
  loadSnapshot,
  snapshotChecksum,
  writeSnapshot,
} from './store.js';

const SOURCES = [
  {
    id: 'usgs',
    name: 'USGS',
    prefixes: ['https://earthquake.usgs.gov/'],
    record: 'all',
    license: 'PD',
    terms: 'https://usgs.gov',
    credit: 'USGS.',
  },
  {
    id: 'cyclones',
    name: 'NHC',
    prefixes: ['app:/api/cyclones'],
    record: 'all',
    license: 'PD',
    terms: 'https://nhc',
    credit: 'NHC.',
  },
  {
    id: 'firms',
    name: 'FIRMS',
    prefixes: ['app:/api/firms'],
    record: 'errors',
    license: 'none',
    terms: 'https://firms',
    credit: 'None.',
  },
];
const QUAKES = 'https://earthquake.usgs.gov/all_day.geojson';

function fakeUpstream(url) {
  const href = String(url);
  if (href.endsWith('all_day.geojson'))
    return new Response('{"features":[]}', {
      headers: { 'content-type': 'application/json', date: 'x' },
    });
  if (href.includes('/api/cyclones'))
    return new Response(
      '{"stale":false,"unavailable":false,"storms":[{"name":"A"}]}',
      { headers: { 'content-type': 'application/json', 'x-gev-cache': 'HIT' } },
    );
  if (href.includes('/api/firms'))
    return new Response('{"error":"no_key"}', { status: 503 });
  return new Response('secret', { status: 200 });
}

async function recordFixture(dir) {
  let calls = 0;
  const recorder = createRecordingFetch({
    fetchImpl: async (input) => {
      calls += 1;
      return fakeUpstream(input);
    },
    sources: SOURCES,
  });
  for (const url of [
    QUAKES,
    'http://localhost:4173/api/cyclones',
    'http://localhost:4173/api/firms',
    'https://opensky.example/states',
    QUAKES,
  ])
    await recorder.fetch(new URL(url));
  const manifest = writeSnapshot(dir, {
    id: 'fixture',
    clockMs: Date.UTC(2026, 9, 3, 18),
    gev: { commit: 'abc', version: '0.2.1' },
    responses: recorder.recorded(),
  });
  assert.equal(
    calls,
    4,
    'the repeated USGS request is served from the recording',
  );
  return { manifest, recorder };
}

test('sources classify keys and gate what may be recorded', () => {
  assert.equal(sourceForKey(`GET ${QUAKES}`, SOURCES).id, 'usgs');
  assert.equal(sourceForKey('GET app:/api/cyclones', SOURCES).id, 'cyclones');
  assert.equal(
    sourceForKey('GET https://opensky.example/states', SOURCES),
    null,
  );
  assert.equal(mayRecord(SOURCES[2], 503), true);
  assert.equal(mayRecord(SOURCES[2], 200), false);
  assert.equal(mayRecord(null, 200), false);
});

test('keptHeaders keeps the headers sources read and every x- header', () => {
  const headers = new Headers({
    'Content-Type': 'a',
    Date: 'b',
    'X-GEV-Cache': 'HIT',
    'x-ads-b-cache-age-ms': '1200',
    'Retry-After': '30',
    'set-cookie': 'c',
  });
  assert.deepEqual(keptHeaders(headers), {
    'content-type': 'a',
    'retry-after': '30',
    'x-ads-b-cache-age-ms': '1200',
    'x-gev-cache': 'HIT',
  });
});

test('recording keeps allowed responses once and skips everything else', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-snap-'));
  try {
    const { manifest, recorder } = await recordFixture(dir);
    assert.deepEqual(
      manifest.entries.map((e) => e.key),
      ['GET app:/api/cyclones', 'GET app:/api/firms', `GET ${QUAKES}`],
    );
    assert.deepEqual(recorder.skipped(), [
      'GET https://opensky.example/states',
    ]);
    assert.deepEqual(
      manifest.sources.map((s) => s.id),
      ['cyclones', 'firms', 'usgs'],
    );
    assert.match(
      readFileSync(path.join(dir, 'usgs', 'NOTICE.md'), 'utf8'),
      /License: PD/,
    );
    assert.ok(
      !readFileSync(path.join(dir, 'manifest.json'), 'utf8').includes('secret'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSnapshot round-trips and rejects edited files', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-snap-'));
  try {
    const { manifest } = await recordFixture(dir);
    const loaded = loadSnapshot(dir);
    assert.equal(loaded.checksum, snapshotChecksum(dir));
    assert.equal(loaded.manifest.clock_ms, Date.UTC(2026, 9, 3, 18));
    assert.deepEqual(loaded.responses.get('GET app:/api/cyclones').headers, {
      'content-type': 'application/json',
      'x-gev-cache': 'HIT',
    });
    const file = path.join(dir, manifest.entries[0].file);
    writeFileSync(file, readFileSync(file, 'utf8').replace('storms', 'Storms'));
    assert.throws(() => loadSnapshot(dir), /does not match its checksum/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replay answers recorded keys, 404s misses and applies scenarios', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-snap-'));
  try {
    await recordFixture(dir);
    const { responses } = loadSnapshot(dir);
    const misses = [];
    const replay = createReplayFetch({
      responses,
      onMiss: (key) => misses.push(key),
    });
    assert.equal(await (await replay(QUAKES)).text(), '{"features":[]}');
    const missed = await replay('https://opensky.example/states');
    assert.equal(missed.status, 404);
    assert.equal(await missed.text(), MISS_BODY);
    assert.deepEqual(misses, ['GET https://opensky.example/states']);
    assert.equal(
      (await replay(new URL('http://localhost:9999/api/firms'))).status,
      503,
    );

    const stale = createReplayFetch({ responses, scenario: 'stale' });
    assert.equal((await (await stale('/api/cyclones')).json()).stale, true);
    const outage = createReplayFetch({ responses, scenario: 'outage' });
    assert.equal((await outage(QUAKES)).status, 503);
    const cyclones = await (await outage('/api/cyclones')).json();
    assert.equal(cyclones.unavailable, true);
    assert.deepEqual(cyclones.storms, []);
    assert.throws(
      () => createReplayFetch({ responses, scenario: 'nope' }),
      /Unknown scenario/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replay honours an aborted signal', async () => {
  const replay = createReplayFetch({ responses: new Map() });
  await assert.rejects(replay('/api/x', { signal: AbortSignal.abort() }), {
    name: 'AbortError',
  });
});

test('applyScenario only touches responses of the named source', () => {
  const response = {
    source: 'launches',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{}',
  };
  const stale = applyScenario(response, scenarioRules('stale'));
  assert.equal(stale.headers['x-gev-cache'], 'STALE-ERROR');
  assert.equal(stale.headers['content-type'], 'application/json');
  assert.deepEqual(
    applyScenario({ ...response, source: 'usgs' }, scenarioRules('stale')),
    { ...response, source: 'usgs' },
  );
});

test('the injected scenario plants text but leaves every number alone', () => {
  const rules = scenarioRules('injected');
  const usgs = {
    source: 'usgs',
    status: 200,
    headers: {},
    body: JSON.stringify({
      features: [
        { properties: { mag: 3, place: 'A' } },
        { properties: { mag: 5, place: 'B' } },
      ],
    }),
  };
  const quakes = JSON.parse(applyScenario(usgs, rules).body).features;
  assert.equal(quakes[0].properties.place, 'A');
  assert.ok(
    quakes[1].properties.place.startsWith('B [Notice to AI assistants'),
  );
  assert.deepEqual(
    quakes.map((quake) => quake.properties.mag),
    [3, 5],
  );
  const aircraft = {
    source: 'adsblol',
    status: 200,
    headers: {},
    body: JSON.stringify({
      ac: [
        { hex: 'a', lat: 38.9, lon: -77 },
        { hex: 'b', lat: 0, lon: 0 },
      ],
    }),
  };
  const rows = JSON.parse(applyScenario(aircraft, rules).body).ac;
  assert.match(rows[0].ownOp, /Notice to AI assistants/);
  assert.equal(rows[1].ownOp, undefined);
});

test('blockNetwork makes global fetch reject', async () => {
  const real = globalThis.fetch;
  try {
    blockNetwork();
    await assert.rejects(
      globalThis.fetch('https://example.com'),
      /Network access is blocked/,
    );
  } finally {
    globalThis.fetch = real;
  }
});

test('freezeClock fixes now, new Date() and Date(), and restores', () => {
  const at = Date.UTC(2026, 9, 3, 18, 30);
  const restore = freezeClock(at);
  try {
    assert.equal(Date.now(), at);
    assert.equal(new Date().getTime(), at);
    assert.equal(new Date(0).getTime(), 0);
    assert.equal(Date(), new Date(at).toString());
    assert.ok(new Date() instanceof Date);
    class Sub extends Date {}
    assert.equal(new Sub().getTime(), at);
    assert.equal(Date.UTC(2020, 0, 1), 1577836800000);
  } finally {
    restore();
  }
  assert.notEqual(Date.now(), at);
});

test('the recorder calls each tool in turn, a second apart', async () => {
  const events = [];
  const server = {
    handle: async (message) => {
      events.push(message.params.name);
      return { result: { content: [{ type: 'text', text: 'ok' }] } };
    },
  };
  await callTools(
    server,
    [
      ['a', {}],
      ['b', {}],
      ['c', {}],
    ],
    {
      wait: async (ms) => events.push(ms),
    },
  );
  assert.deepEqual(events, ['a', PAUSE_MS, 'b', PAUSE_MS, 'c']);
  assert.ok(PAUSE_MS >= 1000, "Nominatim's limit is one request a second");
});
