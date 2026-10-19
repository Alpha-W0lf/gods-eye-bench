/** Questions about feeds that need keys the benchmark does not have. */

import {
  circleArea,
  defineTemplate,
  describeCircle,
  firstData,
  locationRadii,
} from '../template.js';

export const fires = defineTemplate({
  id: 'fires-count-within',
  domain: 'fires',
  feed: 'fires',
  answer: { type: 'integer' },
  params: () => locationRadii([200, 500]),
  prompt: (params) =>
    `How many NASA FIRMS satellite fire detections are ${describeCircle(params)} in the last 24 hours?`,
  value: () => undefined,
  plan: (params) => [
    ['get_active_fires', { area: circleArea(params), limit: 200 }],
  ],
  read: (results) => firstData(results).total ?? null,
});

export const vessels = defineTemplate({
  id: 'vessels-count-within',
  domain: 'vessels',
  feed: 'vessels',
  answer: { type: 'integer' },
  params: () => locationRadii([50, 100]),
  prompt: (params) =>
    `How many ships are reporting positions by AIS ${describeCircle(params)} right now?`,
  value: () => undefined,
  plan: (params) => [
    ['vessels_in_area', { area: circleArea(params), limit: 200 }],
  ],
  read: (results) => firstData(results).total ?? null,
});
