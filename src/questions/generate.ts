/**
 * Generate questions from the templates: enumerate each template's parameter
 * sets, compute the truth in the scenario's world, drop ambiguous instances,
 * and draw the public and held-out sets with seeded randomness. The held-out
 * draw never repeats a public question.
 */

import { sha256 } from '../snapshot/key.ts';
import { buildWorld } from '../world/index.js';
import { QUESTION_PLAN } from './catalog.ts';
import type { ParamsFilter } from './catalog.ts';
import { seededRandom, shuffled } from './rng.ts';
import type { Snapshot } from '../snapshot/store.ts';
import type {
  AnswerSpec,
  FeedName,
  FeedStatus,
  Infrastructure,
  Params,
  Plan,
  Template,
  Value,
  World,
} from './template.ts';

export const QUESTIONS_SCHEMA = 1;
export const PUBLIC_SEED = 'public';

/** What the tools should answer, and the extra strings that count as right. */
export interface Truth {
  status: FeedStatus;
  value: Value;
  accept: string[];
}

/** A plan as a question file stores it. */
export type StoredPlan = [
  string,
  Record<string, unknown> | { from_earlier_results: true },
][];

/** One question as the question file holds it. */
export interface Question {
  id: string;
  template: string;
  domain: string;
  difficulty: 'standard' | 'hard';
  scenario: string;
  params: Params;
  prompt: string;
  answer: AnswerSpec;
  truth: Truth;
  reference: StoredPlan;
}

/** A stable id for one template, scenario and parameter set. */
export function questionId(
  template: Pick<Template, 'id'>,
  scenario: string,
  params: Params,
): string {
  const suffix = scenario === 'baseline' ? '' : `-${scenario}`;
  return `${template.id}${suffix}-${sha256(JSON.stringify(params)).slice(0, 8)}`;
}

/** The truth for one instance, or null when the instance must be skipped. */
export function instanceTruth(
  template: Template,
  world: World,
  params: Params,
): Truth | null {
  // defineTemplate guarantees exactly one of feed and feeds.
  const keys = template.feeds ?? [template.feed as FeedName];
  const statuses = keys.map((key) => world[key].status ?? 'complete');
  if (statuses.includes('unavailable'))
    return { status: 'unavailable', value: null, accept: [] };
  const feed = template.feeds
    ? Object.fromEntries(keys.map((key) => [key, world[key]]))
    : world[template.feed as FeedName];
  const value = template.value(feed, params);
  if (value === undefined) return null;
  const accept = template.accept ? template.accept(value, feed, params) : [];
  return {
    status: statuses.includes('stale') ? 'stale' : 'complete',
    value,
    accept,
  };
}

/** A plan as the question file stores it: steps that depend on earlier results are marked. */
export function storedPlan(plan: Plan): StoredPlan {
  return plan.map(([name, args]) => [
    name,
    typeof args === 'function' ? { from_earlier_results: true } : args,
  ]);
}

/**
 * Every valid instance of a template under a scenario, in a stable order,
 * optionally only parameter sets that pass `filter`.
 */
export function candidates(
  template: Template,
  scenario: string,
  worlds: Record<string, World>,
  filter: ParamsFilter = () => true,
): Question[] {
  const world = worlds[scenario];
  const instances = template
    .params(worlds.baseline)
    .filter(filter)
    .map((params) => {
      const truth = instanceTruth(template, world, params);
      return (
        truth && {
          id: questionId(template, scenario, params),
          template: template.id,
          domain: template.domain,
          difficulty: template.difficulty,
          scenario,
          params,
          prompt: template.prompt(params),
          answer: template.answer,
          truth,
          reference: storedPlan(template.plan(params)),
        }
      );
    });
  // Skipped instances are null.
  return (instances.filter(Boolean) as Question[]).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

/**
 * Draw the public set, and the held-out set when `heldoutSeed` is given.
 * Throws when a template has too few valid instances for its counts.
 */
export function selectQuestions(
  snapshot: Snapshot,
  infrastructure: Infrastructure,
  { heldoutSeed = null }: { heldoutSeed?: string | null } = {},
) {
  const scenarios = new Set([
    'baseline',
    ...QUESTION_PLAN.map(([, scenario]) => scenario),
  ]);
  // src/world is JavaScript; World writes down the shapes its parsers build.
  const worlds = Object.fromEntries(
    [...scenarios].map((scenario) => [
      scenario,
      buildWorld(snapshot, scenario, infrastructure),
    ]),
  ) as Record<string, World>;
  const result: { public: Question[]; heldout: Question[] } = {
    public: [],
    heldout: [],
  };
  for (const [
    template,
    scenario,
    publicCount,
    heldoutCount,
    filter,
  ] of QUESTION_PLAN) {
    const pool = candidates(template, scenario, worlds, filter);
    const draw = (seed: string) =>
      shuffled(pool, seededRandom(`${seed}:${template.id}:${scenario}`));
    const chosen = draw(PUBLIC_SEED).slice(0, publicCount);
    if (chosen.length < publicCount)
      throw new Error(
        `${template.id} (${scenario}) has ${pool.length} valid instances; ${publicCount} needed`,
      );
    result.public.push(...chosen);
    if (heldoutSeed && heldoutCount) {
      const taken = new Set(chosen.map((question) => question.id));
      const held = draw(heldoutSeed)
        .filter((question) => !taken.has(question.id))
        .slice(0, heldoutCount);
      if (held.length < heldoutCount)
        throw new Error(
          `${template.id} (${scenario}) has too few instances for the held-out set`,
        );
      result.heldout.push(...held);
    }
  }
  return result;
}

/** The question file for one split. */
export function questionFile(
  snapshot: Snapshot,
  split: string,
  questions: Question[],
) {
  return {
    schema: QUESTIONS_SCHEMA,
    split,
    snapshot: { id: snapshot.manifest.id, checksum: snapshot.checksum },
    gev: snapshot.manifest.gev,
    questions,
  };
}
