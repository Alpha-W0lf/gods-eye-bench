/**
 * Harder questions: the tools hold the data, but the agent must page past the
 * default 25 rows, filter on several fields, convert units, or compute what no
 * tool returns (distances, time gaps, averages).
 */

import { distanceKm, splitByRadius } from '../../world/geo.js';
import {
  circleArea,
  defineTemplate,
  describeCircle,
  firstData,
  locationRadii,
} from '../template.ts';
import type {
  FeedName,
  SingleFeedTemplate,
  ToolResult,
  Params,
  Value,
} from '../template.ts';
import { LOCATIONS } from '../locations.ts';

const FEET_TO_M = 0.3048;
const KNOT_TO_KMH = 1.852;
const HOUR_MS = 3600 * 1000;
const rowsOf = (results: ToolResult[]) => firstData(results).rows ?? [];
const WORLD = { bbox: [-180, -90, 180, 90] };
const hard = <K extends FeedName, P extends Params, V extends Value>(
  template: SingleFeedTemplate<K, P, V>,
) => defineTemplate({ difficulty: 'hard', ...template });

/** "2026-10-03T06:00:00Z" style labels for a window's ends. */
const isoMinute = (ms: number) =>
  new Date(ms).toISOString().replace(':00.000Z', 'Z');

export const aircraftAbove = hard({
  id: 'mil-above-altitude',
  domain: 'military aircraft',
  feed: 'military',
  answer: { type: 'integer' },
  params: () =>
    [10000, 15000, 20000, 25000, 30000, 35000, 40000].map((feet) => ({ feet })),
  prompt: ({ feet }) =>
    `How many military aircraft reporting a position anywhere in the world are flying higher than ${feet.toLocaleString('en-US')} feet right now?`,
  value: ({ aircraft }, { feet }) => {
    const known = aircraft.filter(
      (plane) => plane.altitudeFt != null && !plane.onGround,
    );
    if (known.some((plane) => Math.abs(plane.altitudeFt! - feet) <= 50))
      return undefined;
    return (
      known.filter((plane) => plane.altitudeFt! > feet).length || undefined
    );
  },
  plan: ({ feet }) => [
    [
      'aircraft_in_area',
      {
        area: WORLD,
        military: true,
        min_altitude_m: feet * FEET_TO_M,
        limit: 200,
      },
    ],
  ],
  read: (results) => firstData(results).total,
});

export const cycloneDistance = hard({
  id: 'cy-distance',
  domain: 'cyclones',
  feed: 'cyclones',
  answer: { type: 'number', unit: 'kilometres', relativeTolerance: 0.01 },
  params: (world) =>
    (world.cyclones.storms ?? []).flatMap(({ name }) =>
      ['Honolulu', 'Mexico City', 'Los Angeles', 'San Diego'].map((place) => {
        const { lat, lon } = LOCATIONS.find(
          (location) => location.name === place,
        )!;
        return { name, location: place, lat, lon };
      }),
    ),
  prompt: ({ name, location, lat, lon }) =>
    `How far, in kilometres along the Earth's surface, is the current centre of tropical cyclone ${name} from latitude ${lat}, longitude ${lon} (${location})?`,
  value: ({ storms }, { name, lat, lon }) => {
    const storm = storms.find((item) => item.name === name);
    return storm?.lat == null
      ? undefined
      : Math.round(distanceKm(storm, { lat, lon }));
  },
  plan: () => [['get_cyclones', {}]],
  read: (results, { name, lat, lon }) => {
    const storm = firstData(results).storms!.find((item) => item.name === name);
    return Math.round(distanceKm(storm, { lat, lon }));
  },
});

export const cycloneWindKmh = hard({
  id: 'cy-wind-kmh',
  domain: 'cyclones',
  feed: 'cyclones',
  answer: { type: 'number', unit: 'kilometres per hour', tolerance: 1 },
  params: (world) =>
    (world.cyclones.storms ?? []).map(({ name }) => ({ name })),
  prompt: ({ name }) =>
    `What is the maximum sustained wind of tropical cyclone ${name} in kilometres per hour, from the latest advisory?`,
  value: ({ storms }, { name }) => {
    const wind = storms.find((item) => item.name === name)?.windKt;
    return wind == null ? undefined : Number((wind * KNOT_TO_KMH).toFixed(1));
  },
  plan: () => [['get_cyclones', {}]],
  read: (results, { name }) =>
    Number(
      (
        firstData(results).storms!.find((item) => item.name === name)!
          .wind_kt! * KNOT_TO_KMH
      ).toFixed(1),
    ),
});

export const launchGap = hard({
  id: 'launch-gap-hours',
  domain: 'launches',
  feed: 'launches',
  answer: { type: 'number', unit: 'hours', tolerance: 0.05 },
  params: (world) =>
    [
      ...new Set(
        (world.launches.launches ?? []).map((launch) => launch.provider),
      ),
    ]
      .sort()
      .map((provider) => ({ provider })),
  prompt: ({ provider }) =>
    `How many hours passed between the two most recent launches by ${provider} in the last 30 days, going by their launch times?`,
  value: ({ launches }, { provider }) => {
    const times = launches
      .filter((launch) => launch.provider === provider && launch.net)
      .map((launch) => Date.parse(launch.net!))
      .sort((a, b) => b - a);
    return times.length < 2
      ? undefined
      : Number(((times[0] - times[1]) / HOUR_MS).toFixed(2));
  },
  plan: () => [['get_recent_launches', { limit: 200 }]],
  read: (results, { provider }) => {
    const times = rowsOf(results)
      .filter((row) => row.provider === provider)
      .map((row) => Date.parse(row.time))
      .sort((a, b) => b - a);
    return Number(((times[0] - times[1]) / HOUR_MS).toFixed(2));
  },
});

export const launchProviderOrbit = hard({
  id: 'launch-provider-orbit',
  domain: 'launches',
  feed: 'launches',
  answer: { type: 'integer' },
  params: (world) => {
    const pairs = new Set(
      (world.launches.launches ?? []).map((launch) =>
        JSON.stringify([launch.provider, launch.orbit]),
      ),
    );
    return [...pairs]
      .sort()
      .map((pair) => JSON.parse(pair))
      .filter(([, orbit]) => orbit && orbit !== 'Unknown')
      .map(([provider, orbit]) => ({ provider, orbit }));
  },
  prompt: ({ provider, orbit }) =>
    `How many of ${provider}'s launches in the last 30 days had their mission orbit listed as "${orbit}"?`,
  value: ({ launches }, { provider, orbit }) => {
    const own = launches.filter((launch) => launch.provider === provider);
    const count = own.filter((launch) => launch.orbit === orbit).length;
    return count && count < own.length ? count : undefined;
  },
  plan: () => [['get_recent_launches', { limit: 200 }]],
  read: (results, { provider, orbit }) =>
    rowsOf(results).filter(
      (row) => row.provider === provider && row.orbit === orbit,
    ).length,
});

export const meanMagnitude = hard({
  id: 'eq-mean-magnitude',
  domain: 'earthquakes',
  feed: 'earthquakes',
  answer: { type: 'number', tolerance: 0.006 },
  params: () => [3.5, 4, 4.5].map((minMagnitude) => ({ minMagnitude })),
  prompt: ({ minMagnitude }) =>
    `What is the average magnitude of all earthquakes of magnitude ${minMagnitude} or greater recorded worldwide in the last 24 hours? Round to two decimal places.`,
  value: ({ events }, { minMagnitude }) => {
    const chosen = events.filter((event) => event.magnitude >= minMagnitude);
    if (chosen.length < 5) return undefined;
    const mean =
      chosen.reduce((sum, event) => sum + event.magnitude, 0) / chosen.length;
    // A mean that sits on a rounding boundary has two defensible answers.
    return Math.abs(((mean * 100) % 1) - 0.5) < 0.05
      ? undefined
      : Number(mean.toFixed(2));
  },
  plan: ({ minMagnitude }) => [
    ['get_earthquakes', { min_magnitude: minMagnitude, limit: 200 }],
  ],
  read: (results) => {
    const rows = rowsOf(results);
    return Number(
      (rows.reduce((sum, row) => sum + row.magnitude, 0) / rows.length).toFixed(
        2,
      ),
    );
  },
});

export const countInWindow = hard({
  id: 'eq-count-window',
  domain: 'earthquakes',
  feed: 'earthquakes',
  answer: { type: 'integer' },
  params: (world) => {
    const end = world.clockMs;
    const first = Math.ceil((end - 24 * HOUR_MS) / (3 * HOUR_MS)) * 3 * HOUR_MS;
    const starts = [];
    for (let start = first; start + 6 * HOUR_MS <= end; start += 3 * HOUR_MS)
      starts.push(start);
    return starts.map((start) => ({
      from: isoMinute(start),
      to: isoMinute(start + 6 * HOUR_MS),
    }));
  },
  prompt: ({ from, to }) =>
    `How many earthquakes of magnitude 2.5 or greater occurred worldwide from ${from} up to (not including) ${to}?`,
  value: ({ events }, { from, to }) => {
    const [start, end] = [Date.parse(from), Date.parse(to)];
    const near = (time: number) =>
      Math.abs(time - start) < 60000 || Math.abs(time - end) < 60000;
    if (events.some((event) => near(event.time))) return undefined;
    return (
      events.filter((event) => event.time >= start && event.time < end)
        .length || undefined
    );
  },
  plan: () => [['get_earthquakes', { limit: 200 }]],
  read: (results, { from, to }) =>
    rowsOf(results).filter((row) => {
      const time = Date.parse(row.time);
      return time >= Date.parse(from) && time < Date.parse(to);
    }).length,
});

export const topOperator = hard({
  id: 'infra-top-operator',
  domain: 'infrastructure',
  feed: 'infrastructure',
  answer: { type: 'string' },
  params: () => locationRadii([25, 50]),
  prompt: (params) =>
    `Which operator has the most datacenters mapped in OpenStreetMap ${describeCircle(params)}? Give the operator's name.`,
  value: ({ datacenters }, params) => {
    const { inside, edge } = splitByRadius(
      datacenters,
      params,
      params.radiusKm,
    );
    if (
      edge.length ||
      inside.length > 200 ||
      inside.some((record) => record.operatorUnclear)
    )
      return undefined;
    const counts = new Map();
    for (const { operator } of inside)
      if (operator) counts.set(operator, (counts.get(operator) ?? 0) + 1);
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    // Only a clear leader, ahead by at least two, and not visible in the
    // default 25 rows alone.
    if (
      ranked.length < 2 ||
      ranked[0][1] - ranked[1][1] < 2 ||
      inside.length <= 25
    )
      return undefined;
    return ranked[0][0];
  },
  plan: (params) => [
    [
      'find_infrastructure',
      { kind: 'datacenters', area: circleArea(params), limit: 200 },
    ],
  ],
  read: (results) => {
    const counts = new Map();
    for (const { operator } of firstData(results).rows ?? [])
      if (operator) counts.set(operator, (counts.get(operator) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  },
});
