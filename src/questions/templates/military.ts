/** Questions about military aircraft reported by adsb.lol. */

import { distanceKm, splitByRadius } from '../../world/geo.js';
import {
  circleArea,
  clearMaximum,
  defineTemplate,
  describeCircle,
  firstData,
  locationRadii,
} from '../template.ts';
import type { CircleParams, Plan, ToolResult } from '../template.ts';
import { LOCATIONS } from '../locations.ts';

const rowsOf = (results: ToolResult[]) => firstData(results).rows ?? [];
const RADII = [300, 500, 1000];
const within = (
  params: CircleParams,
  extra: Record<string, unknown> = {},
): Plan => [
  [
    'aircraft_in_area',
    { area: circleArea(params), military: true, limit: 200, ...extra },
  ],
];

export const countWithin = defineTemplate({
  id: 'mil-count-within',
  domain: 'military aircraft',
  feed: 'military',
  answer: { type: 'integer' },
  params: () => locationRadii(RADII),
  prompt: (params) =>
    `How many military aircraft reporting a position are ${describeCircle(params)} right now?`,
  value: ({ aircraft }, params) => {
    const { inside, edge } = splitByRadius(aircraft, params, params.radiusKm);
    return inside.length && !edge.length ? inside.length : undefined;
  },
  plan: (params) => within(params),
  read: (results) => firstData(results).total,
});

/** The same question where the true count is zero: absence is not unavailability. */
export const countWithinZero = defineTemplate({
  ...countWithin,
  id: 'mil-count-within-zero',
  params: () => locationRadii([200, 300]),
  value: ({ aircraft }, params) => {
    const { inside, edge } = splitByRadius(aircraft, params, params.radiusKm);
    return inside.length || edge.length ? undefined : 0;
  },
});

export const countAirborne = defineTemplate({
  id: 'mil-count-airborne',
  domain: 'military aircraft',
  feed: 'military',
  answer: { type: 'integer' },
  params: () => locationRadii(RADII),
  prompt: (params) =>
    `How many military aircraft are airborne (not on the ground) ${describeCircle(params)} right now?`,
  value: ({ aircraft }, params) => {
    const { inside, edge } = splitByRadius(aircraft, params, params.radiusKm);
    const airborne = inside.filter((plane) => !plane.onGround).length;
    return airborne && !edge.length && airborne < inside.length
      ? airborne
      : undefined;
  },
  plan: (params) => within(params, { airborne_only: true }),
  read: (results) => firstData(results).total,
});

export const highest = defineTemplate({
  id: 'mil-highest',
  domain: 'military aircraft',
  feed: 'military',
  answer: { type: 'string' },
  params: () => locationRadii(RADII),
  prompt: (params) =>
    `What is the callsign of the military aircraft flying highest ${describeCircle(params)} right now?`,
  value: ({ aircraft }, params) => {
    const { inside, edge } = splitByRadius(aircraft, params, params.radiusKm);
    if (edge.length || inside.length < 2) return undefined;
    const top = clearMaximum(
      inside,
      (plane) => plane.altitudeFt ?? -Infinity,
      500,
    );
    return top?.callsign && top.altitudeFt != null ? top.callsign : undefined;
  },
  plan: (params) => within(params),
  read: (results) =>
    clearMaximum(rowsOf(results), (row) => row.altitude_m ?? -Infinity)
      ?.callsign ?? null,
});

export const nearest = defineTemplate({
  id: 'mil-nearest',
  domain: 'military aircraft',
  feed: 'military',
  answer: { type: 'string' },
  params: () =>
    LOCATIONS.map(({ name, lat, lon }) => ({
      location: name,
      lat,
      lon,
      radiusKm: 2000,
    })),
  prompt: ({ location, lat, lon }) =>
    `What is the ICAO 24-bit hex address of the military aircraft nearest to latitude ${lat}, longitude ${lon} (${location}) right now?`,
  value: ({ aircraft }, point) => {
    const ranked = aircraft
      .map((plane) => ({ plane, km: distanceKm(point, plane) }))
      .sort((a, b) => a.km - b.km);
    if (ranked.length < 2 || ranked[0].km > point.radiusKm * 0.9)
      return undefined;
    return ranked[1].km < ranked[0].km * 1.05 ? undefined : ranked[0].plane.hex;
  },
  plan: (params) => within(params),
  read: (results) => rowsOf(results)[0]?.id ?? null,
});
