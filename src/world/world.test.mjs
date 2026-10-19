import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseCyclones,
  parseEarthquakes,
  parseKeylessFeed,
  parseLaunches,
  parseMilitaryAircraft,
} from './feeds.js';
import { distanceKm, splitByRadius } from './geo.js';
import { parseInfrastructure, representativePoint } from './infrastructure.js';

const ok = (body, headers = {}) => ({
  status: 200,
  headers,
  body: JSON.stringify(body),
});

test('distanceKm matches a known great-circle distance', () => {
  // London to Paris is about 343.5 km.
  const km = distanceKm(
    { lat: 51.5074, lon: -0.1278 },
    { lat: 48.8566, lon: 2.3522 },
  );
  assert.ok(Math.abs(km - 343.5) < 1, `got ${km}`);
  assert.equal(distanceKm({ lat: 10, lon: 20 }, { lat: 10, lon: 20 }), 0);
});

test('splitByRadius separates inside, outside and edge records', () => {
  const center = { lat: 0, lon: 0 };
  const degree = distanceKm(center, { lat: 1, lon: 0 });
  const records = [
    { id: 'in', lat: 0.5, lon: 0 },
    { id: 'edge', lat: 1, lon: 0 },
    { id: 'out', lat: 2, lon: 0 },
  ];
  const { inside, edge } = splitByRadius(records, center, degree);
  assert.deepEqual(
    inside.map((record) => record.id),
    ['in'],
  );
  assert.deepEqual(
    edge.map((record) => record.id),
    ['edge'],
  );
});

test('parseEarthquakes keeps magnitude 2.5 and up, any event type', () => {
  const feature = (id, mag, type = 'earthquake') => ({
    id,
    properties: { mag, place: id, time: 1, type },
    geometry: { coordinates: [10, 20, 30] },
  });
  const world = parseEarthquakes(
    ok({
      features: [
        feature('a', 2.4),
        feature('b', 2.5),
        feature('c', 4, 'explosion'),
        feature('d', null),
      ],
    }),
  );
  assert.equal(world.status, 'complete');
  assert.deepEqual(
    world.events.map((event) => event.id),
    ['b', 'c'],
  );
  assert.deepEqual(world.events[0], {
    id: 'b',
    magnitude: 2.5,
    place: 'b',
    time: 1,
    lat: 20,
    lon: 10,
    depthKm: 30,
  });
  assert.equal(
    parseEarthquakes({ status: 503, headers: {}, body: 'down' }).status,
    'unavailable',
  );
  assert.equal(parseEarthquakes(undefined).status, 'unavailable');
});

test('parseCyclones reads stale and unavailable flags', () => {
  const storm = {
    name: 'A',
    windKt: 50,
    pressureHpa: 990,
    classification: 'TS',
    basin: 'AL',
    position: { latitude: 20, longitude: -60 },
  };
  assert.equal(
    parseCyclones(ok({ stale: false, unavailable: false, storms: [storm] }))
      .status,
    'complete',
  );
  assert.equal(
    parseCyclones(ok({ stale: true, unavailable: false, storms: [storm] }))
      .status,
    'stale',
  );
  assert.equal(
    parseCyclones(ok({ stale: false, unavailable: true, storms: [] })).status,
    'unavailable',
  );
  assert.deepEqual(parseCyclones(ok({ storms: [storm] })).storms, [
    {
      name: 'A',
      classification: 'TS',
      basin: 'AL',
      windKt: 50,
      pressureHpa: 990,
      lat: 20,
      lon: -60,
    },
  ]);
});

test('parseLaunches marks stale copies from the cache header', () => {
  const launch = {
    name: 'R | M',
    net: '2026-10-01T00:00:00Z',
    status: { name: 'Launch Successful' },
    launch_service_provider: { name: 'P' },
    mission: { name: 'M', orbit: { name: 'Low Earth Orbit' } },
    pad: { location: { country_code: 'US' } },
  };
  const fresh = parseLaunches(ok({ results: [launch, { name: '' }] }));
  assert.equal(fresh.status, 'complete');
  assert.equal(fresh.launches.length, 1);
  assert.equal(fresh.launches[0].countryCode, 'US');
  assert.equal(
    parseLaunches(ok({ results: [] }, { 'x-gev-cache': 'STALE-ERROR' })).status,
    'stale',
  );
});

test('parseMilitaryAircraft keeps positioned aircraft and reads ground and stale', () => {
  const world = parseMilitaryAircraft(
    ok(
      {
        ac: [
          { hex: 'AE1234', flight: 'RCH1 ', lat: 1, lon: 2, alt_baro: 30000 },
          {
            hex: 'ae5678',
            flight: '',
            lat: 3,
            lon: 4,
            alt_baro: 'ground',
            alt_geom: 100,
          },
          { hex: 'ae9999', flight: 'X' },
        ],
      },
      { 'x-ads-b-cache': 'STALE' },
    ),
  );
  assert.equal(world.status, 'stale');
  assert.deepEqual(world.aircraft, [
    {
      hex: 'ae1234',
      callsign: 'RCH1',
      lat: 1,
      lon: 2,
      onGround: false,
      altitudeFt: 30000,
    },
    {
      hex: 'ae5678',
      callsign: '',
      lat: 3,
      lon: 4,
      onGround: true,
      altitudeFt: 100,
    },
  ]);
});

test('parseKeylessFeed is unavailable for error answers', () => {
  assert.equal(
    parseKeylessFeed({ status: 503, headers: {}, body: '{}' }).status,
    'unavailable',
  );
  assert.equal(parseKeylessFeed(undefined).status, 'unavailable');
  assert.equal(parseKeylessFeed(ok({ rows: [] })).status, 'complete');
});

test('representativePoint averages distinct outer-ring vertices', () => {
  const square = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
  };
  assert.deepEqual(representativePoint(square), { lon: 1, lat: 1 });
  assert.deepEqual(
    representativePoint({ type: 'Point', coordinates: [5, 6] }),
    { lon: 5, lat: 6 },
  );
  assert.equal(representativePoint({ type: 'GeometryCollection' }), null);
  const lines = [
    JSON.stringify({
      id: 1,
      geometry: square,
      properties: { osm_id: 9, tags: { name: 'DC' } },
    }),
    '',
    JSON.stringify({ id: 2, geometry: null, properties: {} }),
  ].join('\n');
  assert.deepEqual(parseInfrastructure(lines), [
    {
      id: '9',
      name: 'DC',
      operator: null,
      operatorUnclear: false,
      lon: 1,
      lat: 1,
    },
  ]);
});
