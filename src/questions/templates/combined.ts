/** Multi-step questions: the answer to one query sets the area of the next. */

import { splitByRadius } from '../../world/geo.js';
import {
  circleArea,
  clearMaximum,
  defineTemplate,
  firstData,
} from '../template.ts';
import type { Earthquake } from '../template.ts';

const strongestQuake = (events: Earthquake[]) =>
  clearMaximum(events, (event) => event.magnitude);

export const aftershocks = defineTemplate({
  id: 'eq-aftershocks',
  domain: 'earthquakes',
  feed: 'earthquakes',
  answer: { type: 'integer' },
  params: () => [100, 200, 300].map((radiusKm) => ({ radiusKm })),
  prompt: ({ radiusKm }) =>
    `Find the strongest earthquake recorded worldwide in the last 24 hours. Not counting that earthquake itself, how many other earthquakes of magnitude 2.5 or greater occurred within ${radiusKm} km of its epicentre in the same period?`,
  value: ({ events }, { radiusKm }) => {
    const strongest = strongestQuake(events);
    if (!strongest) return undefined;
    const others = events.filter((event) => event.id !== strongest.id);
    const { inside, edge } = splitByRadius(others, strongest, radiusKm);
    return edge.length ? undefined : inside.length;
  },
  plan: ({ radiusKm }) => [
    ['get_earthquakes', { limit: 1 }],
    [
      'get_earthquakes',
      (results) => {
        const [top] = firstData(results).rows!;
        return {
          area: circleArea({ lat: top.lat, lon: top.lon, radiusKm }),
          limit: 200,
        };
      },
    ],
  ],
  read: (results) => results[1].structuredContent!.total! - 1,
});

export const aircraftNearCyclone = defineTemplate({
  id: 'mil-near-cyclone',
  domain: 'military aircraft',
  feeds: ['cyclones', 'military'],
  answer: { type: 'integer' },
  params: (world) =>
    (world.cyclones.storms ?? []).flatMap(({ name }) =>
      [500, 1000].map((radiusKm) => ({ name, radiusKm })),
    ),
  prompt: ({ name, radiusKm }) =>
    `How many military aircraft reporting a position are within ${radiusKm} km of the current centre of tropical cyclone ${name}?`,
  value: ({ cyclones, military }, { name, radiusKm }) => {
    const storm = cyclones.storms.find((item) => item.name === name);
    if (!storm || storm.lat == null) return undefined;
    const { inside, edge } = splitByRadius(military.aircraft, storm, radiusKm);
    return edge.length ? undefined : inside.length;
  },
  plan: ({ name, radiusKm }) => [
    ['get_cyclones', {}],
    [
      'aircraft_in_area',
      (results) => {
        const storm = firstData(results).storms!.find(
          (item) => item.name === name,
        )!;
        return {
          area: circleArea({ lat: storm.lat, lon: storm.lon, radiusKm }),
          military: true,
          limit: 200,
        };
      },
    ],
  ],
  read: (results) => results[1].structuredContent!.total,
});
