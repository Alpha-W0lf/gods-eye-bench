/** Questions about Launch Library 2 launches in the last 30 days. */

import { defineTemplate, firstData } from '../template.ts';
import type { Launch, Plan, ToolResult } from '../template.ts';

const rowsOf = (results: ToolResult[]) => firstData(results).rows ?? [];
const ALL: Plan = [['get_recent_launches', { limit: 200 }]];
// `filter(Boolean)` drops the nulls, which the type cannot see.
const distinct = <T extends string>(values: (T | null)[]) =>
  [...new Set(values.filter(Boolean) as T[])].sort();

/** Country names as questions say them, and the words pad locations use. */
interface Country {
  name: string;
  words: string[];
}

export const COUNTRIES: Readonly<Record<string, Country>> = Object.freeze({
  US: { name: 'the United States', words: ['USA', 'United States'] },
  CN: { name: 'China', words: ['China'] },
  NZ: { name: 'New Zealand', words: ['New Zealand'] },
  RU: { name: 'Russia', words: ['Russia'] },
  KZ: { name: 'Kazakhstan', words: ['Kazakhstan'] },
  GF: { name: 'French Guiana', words: ['French Guiana'] },
  IN: { name: 'India', words: ['India'] },
  NO: { name: 'Norway', words: ['Norway'] },
  JP: { name: 'Japan', words: ['Japan'] },
});

export const countByProvider = defineTemplate({
  id: 'launch-count-provider',
  domain: 'launches',
  feed: 'launches',
  answer: { type: 'integer' },
  params: (world) =>
    distinct(world.launches.launches?.map((l) => l.provider) ?? []).map(
      (provider) => ({ provider }),
    ),
  prompt: ({ provider }) =>
    `How many launches did ${provider} make in the last 30 days?`,
  value: ({ launches }, { provider }) =>
    launches.filter((launch) => launch.provider === provider).length ||
    undefined,
  plan: () => ALL,
  read: (results, { provider }) =>
    rowsOf(results).filter((row) => row.provider === provider).length,
});

export const latestByProvider = defineTemplate({
  id: 'launch-latest-provider',
  domain: 'launches',
  feed: 'launches',
  answer: { type: 'string' },
  params: (world) =>
    distinct(world.launches.launches?.map((l) => l.provider) ?? []).map(
      (provider) => ({ provider }),
    ),
  prompt: ({ provider }) =>
    `What was the most recent launch by ${provider} in the last 30 days? Give the launch's name.`,
  value: ({ launches }, { provider }) => {
    const own = launches.filter(
      (launch) => launch.provider === provider && launch.net,
    );
    if (own.length < 2) return undefined;
    const sorted = own.sort((a, b) => b.net!.localeCompare(a.net!));
    return sorted[0].net === sorted[1].net ? undefined : sorted[0].name;
  },
  accept: (value, { launches }) => {
    const launch = launches.find((item) => item.name === value);
    return [launch?.mission, value.split(' | ').at(-1)].filter(
      Boolean,
    ) as string[];
  },
  plan: () => ALL,
  read: (results, { provider }) =>
    rowsOf(results)
      .filter((row) => row.provider === provider)
      .sort((a, b) => String(b.time).localeCompare(String(a.time)))[0]?.name ??
    null,
});

export const countByOrbit = defineTemplate({
  id: 'launch-count-orbit',
  domain: 'launches',
  feed: 'launches',
  answer: { type: 'integer' },
  params: (world) =>
    distinct(world.launches.launches?.map((l) => l.orbit) ?? [])
      .filter((orbit) => orbit !== 'Unknown')
      .map((orbit) => ({ orbit })),
  prompt: ({ orbit }) =>
    `How many launches in the last 30 days have their mission orbit listed as "${orbit}"?`,
  value: ({ launches }, { orbit }) =>
    launches.filter((launch) => launch.orbit === orbit).length || undefined,
  plan: () => ALL,
  read: (results, { orbit }) =>
    rowsOf(results).filter((row) => row.orbit === orbit).length,
});

export const countByCountry = defineTemplate({
  id: 'launch-count-country',
  domain: 'launches',
  feed: 'launches',
  answer: { type: 'integer' },
  params: (world) =>
    distinct(world.launches.launches?.map((l) => l.countryCode) ?? [])
      .filter((code) => Object.hasOwn(COUNTRIES, code))
      .map((code) => ({ code, country: COUNTRIES[code].name })),
  prompt: ({ country }) =>
    `How many launches in the last 30 days lifted off from ${country}?`,
  value: ({ launches }, { code }) => {
    const named = (launch: Launch) =>
      COUNTRIES[code].words.some((word) =>
        String(launch.location).includes(word),
      );
    const own = launches.filter((launch) => launch.countryCode === code);
    // Answerable from the tools only if every launch's pad location names its
    // country and no other country's does (a sea launch may name neither).
    if (!own.length || !own.every(named)) return undefined;
    if (launches.some((launch) => launch.countryCode !== code && named(launch)))
      return undefined;
    return own.length;
  },
  plan: () => ALL,
  read: (results, { code }) =>
    rowsOf(results).filter((row) =>
      COUNTRIES[code].words.some((word) => String(row.location).includes(word)),
    ).length,
});

export const countFailed = defineTemplate({
  id: 'launch-count-failed',
  domain: 'launches',
  feed: 'launches',
  answer: { type: 'integer' },
  params: () => [{}],
  prompt: () =>
    'How many of the launches in the last 30 days ended in failure, including partial failures?',
  value: ({ launches }) =>
    launches.filter((launch) => /failure/i.test(launch.outcome ?? '')).length,
  plan: () => ALL,
  read: (results) =>
    rowsOf(results).filter((row) => /failure/i.test(row.status ?? '')).length,
});
