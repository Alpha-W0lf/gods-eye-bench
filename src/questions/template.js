/**
 * What a question template is, and the helpers templates share.
 *
 * A template asks one kind of question about one feed. For each parameter set
 * it computes the truth from the parsed world (never through the tools), and
 * it carries a reference plan: the tool calls a careful agent would make, and
 * how to read the answer from their results.
 */

import { LOCATIONS } from './locations.js';

/** Data statuses an answer can report. */
export const DATA_STATUSES = Object.freeze([
  'complete',
  'stale',
  'unavailable',
]);

/**
 * Validate and freeze a template:
 *
 * - `difficulty`: `standard` (the default) or `hard`.
 * - `id`, `domain`, `feed` (the world key it reads; or `feeds`, several
 *   keys, in which case `value` receives `{ [key]: feed }`), `answer` (the answer
 *   spec: `{ type: 'integer' | 'number' | 'string', tolerance?, unit? }`).
 * - `params(world)`: every parameter set, in a stable order. `world` is the
 *   baseline world, so names asked about exist even when a scenario hides
 *   the feed.
 * - `prompt(params)`: the question text.
 * - `value(feed, params)`: the true value, or `undefined` when this parameter
 *   set makes an ambiguous or uninteresting question and must be skipped.
 *   Not called when the feed is unavailable.
 * - `accept(value, feed, params)`: optional extra accepted strings.
 * - `plan(params)`: the reference tool calls, `[[name, args], ...]`. `args`
 *   may be a function of the earlier calls' results, for multi-step questions.
 * - `read(results, params)`: the answer from the plan's structured results.
 */
export function defineTemplate(template) {
  for (const key of [
    'id',
    'domain',
    'answer',
    'params',
    'prompt',
    'value',
    'plan',
    'read',
  ])
    if (template[key] === undefined)
      throw new TypeError(`Template needs ${key}`);
  if (!template.feed === !template.feeds)
    throw new TypeError(`${template.id}: give exactly one of feed and feeds`);
  if (!['integer', 'number', 'string'].includes(template.answer.type))
    throw new TypeError(`${template.id}: unknown answer type`);
  if (!['standard', 'hard'].includes(template.difficulty ?? 'standard'))
    throw new TypeError(`${template.id}: unknown difficulty`);
  return Object.freeze({ difficulty: 'standard', ...template });
}

/** Every pairing of a location with each radius. */
export function locationRadii(radii, locations = LOCATIONS) {
  return locations.flatMap((location) =>
    radii.map((radiusKm) => ({
      location: location.name,
      lat: location.lat,
      lon: location.lon,
      radiusKm,
    })),
  );
}

/** "within 500 km of 35.68, 139.69 (Tokyo)": the area as questions state it. */
export function describeCircle({ radiusKm, lat, lon, location }) {
  return `within ${radiusKm} km of latitude ${lat}, longitude ${lon} (${location})`;
}

/** The tools' circle argument for a radius question. */
export function circleArea({ lat, lon, radiusKm }) {
  return { lat, lon, radius_km: radiusKm };
}

/**
 * The data status a set of tool results shows: unavailable when any call
 * failed, stale when any result says its data may be stale, else complete.
 */
export function toolStatus(results) {
  if (results.some((result) => result?.isError)) return 'unavailable';
  const stale = results.some((result) => {
    const data = result?.structuredContent;
    return data?.stale === true || data?.freshness === 'stale';
  });
  return stale ? 'stale' : 'complete';
}

/** The structured data of the plan's first result. */
export function firstData(results) {
  return results[0]?.structuredContent ?? {};
}

/** The one maximum of `items` by `score`, or undefined when the top two tie within `gap`. */
export function clearMaximum(items, score, gap = 0) {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  if (!sorted.length) return undefined;
  if (sorted.length > 1 && score(sorted[0]) - score(sorted[1]) <= gap)
    return undefined;
  return sorted[0];
}
