/**
 * Generate questions from the templates: enumerate each template's parameter
 * sets, compute the truth in the scenario's world, drop ambiguous instances,
 * and draw the public and held-out sets with seeded randomness. The held-out
 * draw never repeats a public question.
 */

import { sha256 } from '../snapshot/key.ts';
import { buildWorld } from '../world/index.js';
import { QUESTION_PLAN } from './catalog.js';
import { seededRandom, shuffled } from './rng.js';

export const QUESTIONS_SCHEMA = 1;
export const PUBLIC_SEED = 'public';

/** A stable id for one template, scenario and parameter set. */
export function questionId(template, scenario, params) {
  const suffix = scenario === 'baseline' ? '' : `-${scenario}`;
  return `${template.id}${suffix}-${sha256(JSON.stringify(params)).slice(0, 8)}`;
}

/** The truth for one instance, or null when the instance must be skipped. */
export function instanceTruth(template, world, params) {
  const keys = template.feeds ?? [template.feed];
  const statuses = keys.map((key) => world[key].status ?? 'complete');
  if (statuses.includes('unavailable'))
    return { status: 'unavailable', value: null, accept: [] };
  const feed = template.feeds
    ? Object.fromEntries(keys.map((key) => [key, world[key]]))
    : world[template.feed];
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
export function storedPlan(plan) {
  return plan.map(([name, args]) => [
    name,
    typeof args === 'function' ? { from_earlier_results: true } : args,
  ]);
}

/**
 * Every valid instance of a template under a scenario, in a stable order,
 * optionally only parameter sets that pass `filter`.
 */
export function candidates(template, scenario, worlds, filter = () => true) {
  const world = worlds[scenario];
  return template
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
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Draw the public set, and the held-out set when `heldoutSeed` is given.
 * Throws when a template has too few valid instances for its counts.
 */
export function selectQuestions(
  snapshot,
  infrastructure,
  { heldoutSeed = null } = {},
) {
  const scenarios = new Set([
    'baseline',
    ...QUESTION_PLAN.map(([, scenario]) => scenario),
  ]);
  const worlds = Object.fromEntries(
    [...scenarios].map((scenario) => [
      scenario,
      buildWorld(snapshot, scenario, infrastructure),
    ]),
  );
  const result = { public: [], heldout: [] };
  for (const [
    template,
    scenario,
    publicCount,
    heldoutCount,
    filter,
  ] of QUESTION_PLAN) {
    const pool = candidates(template, scenario, worlds, filter);
    const draw = (seed) =>
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
export function questionFile(snapshot, split, questions) {
  return {
    schema: QUESTIONS_SCHEMA,
    split,
    snapshot: { id: snapshot.manifest.id, checksum: snapshot.checksum },
    gev: snapshot.manifest.gev,
    questions,
  };
}
