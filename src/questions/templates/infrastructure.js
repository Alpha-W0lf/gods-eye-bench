/** Questions about OpenStreetMap datacenters and dams bundled with God's Eye View. */

import { splitByRadius } from '../../world/geo.js';
import {
  circleArea,
  defineTemplate,
  describeCircle,
  firstData,
  locationRadii,
} from '../template.js';

export const countWithin = defineTemplate({
  id: 'infra-count-within',
  domain: 'infrastructure',
  feed: 'infrastructure',
  answer: { type: 'integer' },
  params: () =>
    ['datacenters', 'dams'].flatMap((kind) =>
      locationRadii([25, 50, 100]).map((params) => ({ kind, ...params })),
    ),
  prompt: (params) =>
    `How many ${params.kind} mapped in OpenStreetMap lie ${describeCircle(params)}?`,
  value: (infrastructure, params) => {
    const { inside, edge } = splitByRadius(
      infrastructure[params.kind],
      params,
      params.radiusKm,
    );
    return inside.length && !edge.length ? inside.length : undefined;
  },
  plan: (params) => [
    [
      'find_infrastructure',
      { kind: params.kind, area: circleArea(params), limit: 200 },
    ],
  ],
  read: (results) => firstData(results).total,
});
