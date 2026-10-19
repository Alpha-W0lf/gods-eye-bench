import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gevDir } from '../gev.js';
import { questionsPath, snapshotDir } from '../paths.js';
import { buildPrompt } from '../prompt.js';
import { stableJson, loadSnapshot } from '../snapshot/store.js';
import { readInfrastructure } from '../world/infrastructure.js';
import { QUESTION_PLAN } from './catalog.js';
import { instanceTruth, questionFile, selectQuestions } from './generate.js';
import { seededRandom, shuffled } from './rng.js';
import * as absent from './templates/absent.js';
import * as cy from './templates/cyclones.js';
import * as hard from './templates/hard.js';
import * as eq from './templates/earthquakes.js';
import * as launch from './templates/launches.js';
import * as mil from './templates/military.js';

const event = (id, magnitude, lat, lon, depthKm = 10) => ({
  id,
  magnitude,
  lat,
  lon,
  depthKm,
});
const quakes = {
  status: 'complete',
  events: [
    event('a', 5.1, 0, 0, 600),
    event('b', 3.2, 0, 3),
    event('c', 4.4, 0, 30, 80),
  ],
};
const tokyo = { location: 'X', lat: 0, lon: 0, radiusKm: 500 };

test('earthquake templates compute truth from records', () => {
  assert.equal(eq.countWorldwide.value(quakes, { minMagnitude: 4 }), 2);
  assert.equal(eq.countWorldwide.value(quakes, { minMagnitude: 6 }), undefined);
  assert.equal(eq.countWithin.value(quakes, tokyo), 2);
  assert.equal(eq.strongestWithin.value(quakes, tokyo), 5.1);
  assert.equal(eq.deepest.value(quakes, { minMagnitude: 2.5 }), 600);
  assert.equal(eq.countDeeper.value(quakes, { depthKm: 50 }), 2);
  assert.equal(
    eq.countDeeper.value(quakes, { depthKm: 80 }),
    undefined,
    'a depth at the threshold is ambiguous',
  );
  assert.equal(
    eq.nearest.value(quakes, { location: 'X', lat: 0, lon: 2.9 }),
    3.2,
  );
  assert.equal(
    eq.nearest.value(quakes, { location: 'X', lat: 0, lon: 1.5 }),
    undefined,
    'two equally near events',
  );
});

test('cyclone, launch and aircraft templates compute truth from records', () => {
  const storms = {
    status: 'complete',
    storms: [
      { name: 'A', windKt: 50, pressureHpa: 990 },
      { name: 'B', windKt: 90, pressureHpa: 960 },
    ],
  };
  assert.equal(cy.count.value(storms, {}), 2);
  assert.equal(cy.strongest.value(storms, {}), 'B');
  assert.equal(cy.wind.value(storms, { name: 'a' }), 50);
  assert.equal(cy.pressure.value(storms, { name: 'B' }), 960);
  assert.deepEqual(cy.wind.params({ cyclones: storms }), [
    { name: 'A' },
    { name: 'B' },
  ]);

  const launches = {
    status: 'complete',
    launches: [
      {
        name: 'F9 | One',
        mission: 'One',
        net: '2026-10-02T00:00:00Z',
        provider: 'SpaceX',
        orbit: 'Low Earth Orbit',
        countryCode: 'US',
        outcome: 'Launch Successful',
      },
      {
        name: 'F9 | Two',
        mission: 'Two',
        net: '2026-10-01T00:00:00Z',
        provider: 'SpaceX',
        orbit: 'Polar Orbit',
        countryCode: 'US',
        outcome: 'Launch Failure',
      },
      {
        name: 'E | Three',
        mission: 'Three',
        net: '2026-09-30T00:00:00Z',
        provider: 'Rocket Lab',
        orbit: 'Low Earth Orbit',
        countryCode: 'NZ',
        outcome: 'Launch Successful',
      },
    ],
  };
  assert.equal(
    launch.countByProvider.value(launches, { provider: 'SpaceX' }),
    2,
  );
  assert.equal(
    launch.latestByProvider.value(launches, { provider: 'SpaceX' }),
    'F9 | One',
  );
  assert.deepEqual(launch.latestByProvider.accept('F9 | One', launches, {}), [
    'One',
    'One',
  ]);
  assert.equal(
    launch.latestByProvider.value(launches, { provider: 'Rocket Lab' }),
    undefined,
    'one launch is too easy',
  );
  assert.equal(
    launch.countByOrbit.value(launches, { orbit: 'Low Earth Orbit' }),
    2,
  );
  assert.equal(
    launch.countByCountry.value(launches, { code: 'NZ' }),
    undefined,
    'no pad location names the country',
  );
  const located = {
    status: 'complete',
    launches: [
      {
        countryCode: 'NZ',
        location: 'Rocket Lab LC-1, Mahia Peninsula, New Zealand',
      },
      {
        countryCode: 'CN',
        location: "Jiuquan Satellite Launch Center, People's Republic of China",
      },
    ],
  };
  assert.equal(launch.countByCountry.value(located, { code: 'NZ' }), 1);
  const seaLaunch = {
    countryCode: 'CN',
    location: 'Haiyang Oriental Spaceport',
  };
  assert.equal(
    launch.countByCountry.value(
      { ...located, launches: [...located.launches, seaLaunch] },
      { code: 'CN' },
    ),
    undefined,
    'a launch whose location does not name its country makes the count unanswerable from the tools',
  );
  assert.equal(launch.countFailed.value(launches, {}), 1);

  const aircraft = {
    status: 'complete',
    aircraft: [
      {
        hex: 'a1',
        callsign: 'HIGH',
        lat: 0,
        lon: 0.5,
        onGround: false,
        altitudeFt: 30000,
      },
      {
        hex: 'a2',
        callsign: 'LOW',
        lat: 0,
        lon: 1,
        onGround: false,
        altitudeFt: 5000,
      },
      {
        hex: 'a3',
        callsign: 'PARK',
        lat: 0,
        lon: 2,
        onGround: true,
        altitudeFt: null,
      },
      {
        hex: 'a4',
        callsign: 'FAR',
        lat: 40,
        lon: 40,
        onGround: false,
        altitudeFt: 40000,
      },
    ],
  };
  assert.equal(mil.countWithin.value(aircraft, tokyo), 3);
  assert.equal(mil.countAirborne.value(aircraft, tokyo), 2);
  assert.equal(mil.highest.value(aircraft, tokyo), 'HIGH');
  assert.equal(mil.nearest.value(aircraft, { ...tokyo, radiusKm: 2000 }), 'a1');
});

test('false-premise, aggregation and arithmetic templates', () => {
  const storms = {
    status: 'complete',
    storms: [{ name: 'Nolo', windKt: 100, lat: 23.2, lon: -172 }],
  };
  assert.equal(absent.cycloneWind.value(storms, { name: 'Milton' }), null);
  assert.equal(absent.cycloneWind.value(storms, { name: 'nolo' }), undefined);
  assert.deepEqual(
    absent.cycloneWind
      .params({ cyclones: storms })
      .map((p) => p.name)
      .includes('Nolo'),
    false,
  );
  assert.equal(hard.cycloneWindKmh.value(storms, { name: 'Nolo' }), 185.2);
  assert.equal(
    hard.cycloneDistance.value(storms, {
      name: 'Nolo',
      lat: 21.31,
      lon: -157.86,
    }),
    1470,
  );
  const launches = {
    status: 'complete',
    launches: [
      { provider: 'P', net: '2026-10-02T12:00:00Z', orbit: 'Low Earth Orbit' },
      { provider: 'P', net: '2026-10-02T00:00:00Z', orbit: 'Polar Orbit' },
    ],
  };
  assert.equal(absent.latestLaunch.value(launches, { provider: 'Q' }), null);
  assert.equal(hard.launchGap.value(launches, { provider: 'P' }), 12);
  assert.equal(
    hard.launchProviderOrbit.value(launches, {
      provider: 'P',
      orbit: 'Polar Orbit',
    }),
    1,
  );
  const dc = (operator, lon) => ({
    operator,
    operatorUnclear: false,
    lat: 0,
    lon,
  });
  const centre = { location: 'X', lat: 0, lon: 0, radiusKm: 50 };
  const many = [
    ...Array(20)
      .fill(0)
      .map((_, i) => dc('A', i * 0.001)),
    ...Array(10)
      .fill(0)
      .map((_, i) => dc('B', i * 0.001)),
  ];
  assert.equal(hard.topOperator.value({ datacenters: many }, centre), 'A');
  assert.equal(
    hard.topOperator.value({ datacenters: many.slice(0, 25) }, centre),
    undefined,
    'needs more than the default rows',
  );
  assert.equal(
    hard.topOperator.value(
      { datacenters: [...many, { ...dc(null, 0), operatorUnclear: true }] },
      centre,
    ),
    undefined,
  );
});

test('an unavailable feed makes the truth unavailable with no value', () => {
  const world = { earthquakes: { status: 'unavailable' } };
  assert.deepEqual(
    instanceTruth(eq.countWorldwide, world, { minMagnitude: 3 }),
    {
      status: 'unavailable',
      value: null,
      accept: [],
    },
  );
});

test('seeded shuffles repeat and differ by seed', () => {
  const items = Array.from({ length: 20 }, (_, index) => index);
  assert.deepEqual(
    shuffled(items, seededRandom('s')),
    shuffled(items, seededRandom('s')),
  );
  assert.notDeepEqual(
    shuffled(items, seededRandom('s')),
    shuffled(items, seededRandom('t')),
  );
});

test('the committed public questions regenerate exactly, and held-out never repeats them', () => {
  const snapshot = loadSnapshot(snapshotDir());
  const infrastructure = readInfrastructure(gevDir());
  const sets = selectQuestions(snapshot, infrastructure, {
    heldoutSeed: 'test-only-seed',
  });
  assert.equal(
    stableJson(questionFile(snapshot, 'public', sets.public)),
    readFileSync(questionsPath('public'), 'utf8'),
    'questions/*.public.json is out of date: run `npm run geb -- questions`',
  );
  const expected = QUESTION_PLAN.reduce((sum, [, , count]) => sum + count, 0);
  assert.equal(sets.public.length, expected);
  const publicIds = new Set(sets.public.map((question) => question.id));
  assert.ok(sets.heldout.length > 0);
  assert.ok(sets.heldout.every((question) => !publicIds.has(question.id)));
  assert.equal(
    new Set(sets.public.map((question) => question.id)).size,
    sets.public.length,
  );
});

test('every prompt states the answer format', () => {
  const { questions } = JSON.parse(
    readFileSync(questionsPath('public'), 'utf8'),
  );
  for (const question of questions) {
    const prompt = buildPrompt(question);
    assert.match(prompt, /ANSWER: \{"answer"/);
    assert.ok(prompt.includes(question.prompt));
  }
});
