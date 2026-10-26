/** Questions about active tropical cyclones from NOAA NHC and CPHC. */

import { clearMaximum, defineTemplate, firstData } from '../template.ts';
import type { Storm, ToolResult, ToolStorm, World } from '../template.ts';

const COVERAGE =
  'tracked by the U.S. National Hurricane Center and Central Pacific Hurricane Center';
const storms = (results: ToolResult[]) => firstData(results).storms ?? [];

/** One parameter set per storm in the recorded (baseline) world. */
const byName = (world: World) =>
  (world.cyclones.storms ?? []).map(({ name }) => ({ name }));
const findStorm = <S extends Storm | ToolStorm>(list: S[], name: string) =>
  list.find((storm) => storm.name.toLowerCase() === name.toLowerCase());

export const count = defineTemplate({
  id: 'cy-count',
  domain: 'cyclones',
  feed: 'cyclones',
  answer: { type: 'integer' },
  params: () => [{}],
  prompt: () => `How many active tropical cyclones are ${COVERAGE} right now?`,
  value: ({ storms: list }) => list.length,
  plan: () => [['get_cyclones', {}]],
  read: (results) => storms(results).length,
});

export const strongest = defineTemplate({
  id: 'cy-strongest',
  domain: 'cyclones',
  feed: 'cyclones',
  answer: { type: 'string' },
  params: () => [{}],
  prompt: () =>
    `Of the active tropical cyclones ${COVERAGE}, which has the highest maximum sustained wind right now? Give its name.`,
  value: ({ storms: list }) =>
    clearMaximum(list, (storm) => storm.windKt ?? -1)?.name,
  plan: () => [['get_cyclones', {}]],
  read: (results) =>
    clearMaximum(storms(results), (storm) => storm.wind_kt ?? -1)?.name ?? null,
});

export const wind = defineTemplate({
  id: 'cy-wind',
  domain: 'cyclones',
  feed: 'cyclones',
  answer: { type: 'integer', unit: 'knots' },
  params: byName,
  prompt: ({ name }) =>
    `What is the maximum sustained wind, in knots, of tropical cyclone ${name} in the latest advisory?`,
  value: ({ storms: list }, { name }) =>
    findStorm(list, name)?.windKt ?? undefined,
  plan: () => [['get_cyclones', {}]],
  read: (results, { name }) =>
    findStorm(storms(results), name)?.wind_kt ?? null,
});

export const pressure = defineTemplate({
  id: 'cy-pressure',
  domain: 'cyclones',
  feed: 'cyclones',
  answer: { type: 'integer', unit: 'hPa' },
  params: byName,
  prompt: ({ name }) =>
    `What is the minimum central pressure, in hectopascals, of tropical cyclone ${name} in the latest advisory?`,
  value: ({ storms: list }, { name }) =>
    findStorm(list, name)?.pressureHpa ?? undefined,
  plan: () => [['get_cyclones', {}]],
  read: (results, { name }) =>
    findStorm(storms(results), name)?.pressure_hpa ?? null,
});
