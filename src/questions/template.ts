/**
 * What a question template is, and the helpers templates share.
 *
 * A template asks one kind of question about one feed. For each parameter set
 * it computes the truth from the parsed world (never through the tools), and
 * it carries a reference plan: the tool calls a careful agent would make, and
 * how to read the answer from their results.
 */

import { LOCATIONS } from './locations.ts';
import type { Location } from './locations.ts';

/** The world's feeds, by the key a template names in `feed` or `feeds`. */
export type FeedName =
  | 'earthquakes'
  | 'cyclones'
  | 'launches'
  | 'military'
  | 'fires'
  | 'vessels'
  | 'infrastructure';

export type FeedStatus = 'complete' | 'stale' | 'unavailable';

// The records src/world parses. That module is JavaScript, so these are the
// shapes its parsers produce, written down here; they are not checked
// against it.
export interface Earthquake {
  id: string;
  magnitude: number;
  place: string | null;
  time: number;
  lat: number;
  lon: number;
  depthKm: number | null;
}

export interface Storm {
  name: string;
  classification: string | null;
  basin: string | null;
  windKt: number | null;
  pressureHpa: number | null;
  lat: number | null;
  lon: number | null;
}

export interface Launch {
  name: string;
  net: string | null;
  outcome: string | null;
  provider: string | null;
  rocket: string | null;
  mission: string | null;
  orbit: string | null;
  location: string | null;
  countryCode: string | null;
}

export interface Aircraft {
  hex: string;
  callsign: string;
  lat: number;
  lon: number;
  onGround: boolean;
  altitudeFt: number | null;
}

export interface InfrastructureRecord {
  id: string;
  name: string | null;
  operator: string | null;
  operatorUnclear: boolean;
  lat: number;
  lon: number;
}

export type Infrastructure = Record<
  'datacenters' | 'dams',
  InfrastructureRecord[]
>;

/** What `value` receives for each feed key once the feed is available. */
export interface FeedData {
  earthquakes: { events: Earthquake[] };
  cyclones: { storms: Storm[] };
  launches: { launches: Launch[] };
  military: { aircraft: Aircraft[] };
  fires: Record<string, never>;
  vessels: Record<string, never>;
  infrastructure: Infrastructure;
}

/** The world a question is asked about; an unavailable feed has no records. */
export type World = {
  scenario: string;
  clockMs: number;
} & { [K in FeedName]: { status?: FeedStatus } & Partial<FeedData[K]> };

/** A true value: a number, a string, or null where nothing exists. */
export type Value = number | string | null;

/** A template's parameter set; each template narrows it. */
export type Params = Record<string, unknown>;

export interface AnswerSpec {
  type: 'integer' | 'number' | 'string';
  tolerance?: number;
  relativeTolerance?: number;
  unit?: string;
}

/**
 * One row of a tool's structured result. Tools put different fields in their
 * rows; each template reads the ones its own tool returns. Not validated.
 */
export interface ToolRow {
  id: string;
  name: string;
  provider: string;
  orbit: string;
  location: string;
  status: string;
  time: string;
  magnitude: number;
  depth_km: number | null;
  altitude_m: number | null;
  callsign: string;
  operator: string | null;
  lat: number;
  lon: number;
}

export interface ToolStorm {
  name: string;
  wind_kt: number | null;
  pressure_hpa: number | null;
  lat: number;
  lon: number;
}

/** The structured content of a tool result; a tool fills only its own fields. */
export interface ToolData {
  rows?: ToolRow[];
  storms?: ToolStorm[];
  total?: number;
  stale?: boolean;
  freshness?: string;
}

export interface ToolResult {
  isError?: boolean;
  structuredContent?: ToolData;
}

/** A plan step's arguments, or a function of the earlier results. */
export type PlanArgs =
  | Record<string, unknown>
  | ((results: ToolResult[]) => Record<string, unknown>);

/** The reference tool calls: `[[tool name, arguments], ...]`. */
export type Plan = [string, PlanArgs][];

interface TemplateBase<P extends Params> {
  id: string;
  domain: string;
  difficulty?: 'standard' | 'hard';
  answer: AnswerSpec;
  params(world: World): P[];
  prompt(params: P): string;
  plan(params: P): Plan;
  read(results: ToolResult[], params: P): Value | undefined;
}

/** A template that reads one feed. */
export type SingleFeedTemplate<
  K extends FeedName,
  P extends Params,
  V extends Value,
> = TemplateBase<P> & {
  feed: K;
  feeds?: undefined;
  value(feed: FeedData[K], params: P): V | undefined;
  accept?(value: V, feed: FeedData[K], params: P): string[];
};

/** A template that reads several feeds; `value` receives `{ [key]: feed }`. */
export type MultiFeedTemplate<
  K extends FeedName,
  P extends Params,
  V extends Value,
> = TemplateBase<P> & {
  feeds: readonly K[];
  feed?: undefined;
  value(feeds: { [Key in K]: FeedData[Key] }, params: P): V | undefined;
  accept?(value: V, feeds: { [Key in K]: FeedData[Key] }, params: P): string[];
};

/** A defined template with its parameter and value types erased. */
export type Template = TemplateBase<Params> & {
  difficulty: 'standard' | 'hard';
  feed?: FeedName;
  feeds?: readonly FeedName[];
  value(feed: unknown, params: Params): Value | undefined;
  accept?(value: Value, feed: unknown, params: Params): string[];
};

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
export function defineTemplate<
  K extends FeedName,
  P extends Params,
  V extends Value,
>(
  template: SingleFeedTemplate<K, P, V>,
): Readonly<SingleFeedTemplate<K, P, V> & { difficulty: 'standard' | 'hard' }>;
export function defineTemplate<
  K extends FeedName,
  P extends Params,
  V extends Value,
>(
  template: MultiFeedTemplate<K, P, V>,
): Readonly<MultiFeedTemplate<K, P, V> & { difficulty: 'standard' | 'hard' }>;
export function defineTemplate(
  template:
    | SingleFeedTemplate<FeedName, Params, Value>
    | MultiFeedTemplate<FeedName, Params, Value>,
) {
  for (const key of [
    'id',
    'domain',
    'answer',
    'params',
    'prompt',
    'value',
    'plan',
    'read',
  ] as const)
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

/** A place and a radius around it, as radius questions take them. */
export type CircleParams = {
  location: string;
  lat: number;
  lon: number;
  radiusKm: number;
};

/** Every pairing of a location with each radius. */
export function locationRadii(
  radii: readonly number[],
  locations: readonly Location[] = LOCATIONS,
): CircleParams[] {
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
export function describeCircle({
  radiusKm,
  lat,
  lon,
  location,
}: CircleParams): string {
  return `within ${radiusKm} km of latitude ${lat}, longitude ${lon} (${location})`;
}

/** The tools' circle argument for a radius question. */
export function circleArea({
  lat,
  lon,
  radiusKm,
}: Pick<CircleParams, 'lat' | 'lon' | 'radiusKm'>) {
  return { lat, lon, radius_km: radiusKm };
}

/**
 * The data status a set of tool results shows: unavailable when any call
 * failed, stale when any result says its data may be stale, else complete.
 */
export function toolStatus(
  results: readonly (ToolResult | undefined)[],
): FeedStatus {
  if (results.some((result) => result?.isError)) return 'unavailable';
  const stale = results.some((result) => {
    const data = result?.structuredContent;
    return data?.stale === true || data?.freshness === 'stale';
  });
  return stale ? 'stale' : 'complete';
}

/** The structured data of the plan's first result. */
export function firstData(
  results: readonly (ToolResult | undefined)[],
): ToolData {
  return results[0]?.structuredContent ?? {};
}

/** The one maximum of `items` by `score`, or undefined when the top two tie within `gap`. */
export function clearMaximum<T>(
  items: readonly T[],
  score: (item: T) => number,
  gap = 0,
): T | undefined {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  if (!sorted.length) return undefined;
  if (sorted.length > 1 && score(sorted[0]) - score(sorted[1]) <= gap)
    return undefined;
  return sorted[0];
}
