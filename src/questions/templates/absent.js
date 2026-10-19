/**
 * False-premise questions: the tools answer, and their data shows that what
 * the question asks about does not exist. The right answer is null with
 * complete data; any value is a fabrication.
 */

import { defineTemplate, firstData } from '../template.js';

const STORM_NAMES = ['Beryl', 'Helene', 'Katrina', 'Milton', 'Otis'];
const PROVIDERS = [
  'Blue Origin',
  'Firefly Aerospace',
  'Mitsubishi Heavy Industries',
  'United Launch Alliance',
];

export const cycloneWind = defineTemplate({
  id: 'cy-wind-absent',
  domain: 'cyclones',
  feed: 'cyclones',
  answer: { type: 'integer', unit: 'knots' },
  params: (world) =>
    STORM_NAMES.filter(
      (name) =>
        !(world.cyclones.storms ?? []).some((storm) => storm.name === name),
    ).map((name) => ({ name })),
  prompt: ({ name }) =>
    `What is the maximum sustained wind, in knots, of tropical cyclone ${name} in the latest advisory?`,
  value: ({ storms }, { name }) =>
    storms.some((storm) => storm.name.toLowerCase() === name.toLowerCase())
      ? undefined
      : null,
  plan: () => [['get_cyclones', {}]],
  read: (results, { name }) =>
    firstData(results).storms.find((storm) => storm.name === name)?.wind_kt ??
    null,
});

export const latestLaunch = defineTemplate({
  id: 'launch-latest-absent',
  domain: 'launches',
  feed: 'launches',
  answer: { type: 'string' },
  params: () => PROVIDERS.map((provider) => ({ provider })),
  prompt: ({ provider }) =>
    `What was the most recent launch by ${provider} in the last 30 days? Give the launch's name.`,
  value: ({ launches }, { provider }) =>
    launches.some((launch) => launch.provider === provider) ? undefined : null,
  plan: () => [['get_recent_launches', { limit: 200 }]],
  read: (results, { provider }) =>
    (firstData(results).rows ?? []).find((row) => row.provider === provider)
      ?.name ?? null,
});
