/** Questions about USGS earthquakes of magnitude 2.5 or more, last 24 hours. */

import { distanceKm, splitByRadius } from '../../world/geo.js';
import {
  circleArea,
  clearMaximum,
  defineTemplate,
  describeCircle,
  firstData,
  locationRadii,
} from '../template.ts';
import type { ToolResult } from '../template.ts';
import { LOCATIONS } from '../locations.ts';

const ALL = { limit: 200 };
const rowsOf = (results: ToolResult[]) => firstData(results).rows ?? [];

export const countWorldwide = defineTemplate({
  id: 'eq-count-worldwide',
  domain: 'earthquakes',
  feed: 'earthquakes',
  answer: { type: 'integer' },
  params: () => [3, 3.5, 4, 4.5, 5].map((minMagnitude) => ({ minMagnitude })),
  prompt: ({ minMagnitude }) =>
    `How many earthquakes of magnitude ${minMagnitude} or greater were recorded worldwide in the last 24 hours?`,
  value: ({ events }, { minMagnitude }) =>
    events.filter((event) => event.magnitude >= minMagnitude).length ||
    undefined,
  plan: ({ minMagnitude }) => [
    ['get_earthquakes', { min_magnitude: minMagnitude, limit: 200 }],
  ],
  read: (results) => firstData(results).total,
});

export const countWithin = defineTemplate({
  id: 'eq-count-within',
  domain: 'earthquakes',
  feed: 'earthquakes',
  answer: { type: 'integer' },
  params: () => locationRadii([500, 1000, 2000]),
  prompt: (params) =>
    `How many earthquakes of magnitude 2.5 or greater occurred ${describeCircle(params)} in the last 24 hours?`,
  value: ({ events }, params) => {
    const { inside, edge } = splitByRadius(events, params, params.radiusKm);
    return inside.length && !edge.length ? inside.length : undefined;
  },
  plan: (params) => [['get_earthquakes', { area: circleArea(params), ...ALL }]],
  read: (results) => firstData(results).total,
});

/** The same question where the true count is zero: absence is not unavailability. */
export const countWithinZero = defineTemplate({
  ...countWithin,
  id: 'eq-count-within-zero',
  params: () => locationRadii([200, 300]),
  value: ({ events }, params) => {
    const { inside, edge } = splitByRadius(events, params, params.radiusKm);
    return inside.length || edge.length ? undefined : 0;
  },
});

export const strongestWithin = defineTemplate({
  id: 'eq-strongest-within',
  domain: 'earthquakes',
  feed: 'earthquakes',
  answer: { type: 'number', tolerance: 0.05 },
  params: () => locationRadii([500, 1000, 2000]),
  prompt: (params) =>
    `What was the magnitude of the strongest earthquake ${describeCircle(params)} in the last 24 hours?`,
  value: ({ events }, params) => {
    const { inside, edge } = splitByRadius(events, params, params.radiusKm);
    if (!inside.length) return undefined;
    const strongest = Math.max(...inside.map((event) => event.magnitude));
    return edge.some((event) => event.magnitude >= strongest)
      ? undefined
      : strongest;
  },
  plan: (params) => [['get_earthquakes', { area: circleArea(params), ...ALL }]],
  read: (results) => rowsOf(results)[0]?.magnitude ?? null,
});

export const deepest = defineTemplate({
  id: 'eq-deepest',
  domain: 'earthquakes',
  feed: 'earthquakes',
  answer: { type: 'number', tolerance: 0.5, unit: 'km' },
  params: () => [2.5, 3, 3.5, 4].map((minMagnitude) => ({ minMagnitude })),
  prompt: ({ minMagnitude }) =>
    `In the last 24 hours, how deep, in kilometres, was the deepest earthquake of magnitude ${minMagnitude} or greater anywhere in the world?`,
  value: ({ events }, { minMagnitude }) =>
    clearMaximum(
      events.filter(
        (event) => event.magnitude >= minMagnitude && event.depthKm != null,
      ),
      (event) => event.depthKm!,
      1,
    )?.depthKm,
  plan: ({ minMagnitude }) => [
    ['get_earthquakes', { min_magnitude: minMagnitude, limit: 200 }],
  ],
  read: (results) =>
    Math.max(...rowsOf(results).map((row) => row.depth_km ?? -Infinity)),
});

export const countDeeper = defineTemplate({
  id: 'eq-count-deeper',
  domain: 'earthquakes',
  feed: 'earthquakes',
  answer: { type: 'integer' },
  params: () => [30, 50, 70, 100].map((depthKm) => ({ depthKm })),
  prompt: ({ depthKm }) =>
    `How many earthquakes of magnitude 2.5 or greater in the last 24 hours, worldwide, were deeper than ${depthKm} km?`,
  value: ({ events }, { depthKm }) => {
    const known = events.filter((event) => event.depthKm != null);
    if (known.some((event) => Math.abs(event.depthKm! - depthKm) <= 0.5))
      return undefined;
    return (
      known.filter((event) => event.depthKm! > depthKm).length || undefined
    );
  },
  plan: () => [['get_earthquakes', ALL]],
  read: (results, { depthKm }) =>
    rowsOf(results).filter(
      (row) => row.depth_km != null && row.depth_km > depthKm,
    ).length,
});

export const nearest = defineTemplate({
  id: 'eq-nearest',
  domain: 'earthquakes',
  feed: 'earthquakes',
  answer: { type: 'number', tolerance: 0.05 },
  params: () =>
    LOCATIONS.map(({ name, lat, lon }) => ({ location: name, lat, lon })),
  prompt: ({ location, lat, lon }) =>
    `Of the earthquakes of magnitude 2.5 or greater in the last 24 hours, which was nearest to latitude ${lat}, longitude ${lon} (${location})? Give its magnitude.`,
  value: ({ events }, point) => {
    const ranked = events
      .map((event) => ({ event, km: distanceKm(point, event) }))
      .sort((a, b) => a.km - b.km);
    if (ranked.length < 2 || ranked[1].km < ranked[0].km * 1.05)
      return undefined;
    return ranked[0].event.magnitude;
  },
  plan: () => [['get_earthquakes', ALL]],
  read: (results, point) =>
    [...rowsOf(results)].sort(
      (a, b) => distanceKm(point, a) - distanceKm(point, b),
    )[0]?.magnitude ?? null,
});
