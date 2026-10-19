/**
 * The question set: which templates are asked under which scenario, and how
 * many instances each split draws. The one place the set's shape is defined.
 */

import * as absent from './templates/absent.js';
import * as combined from './templates/combined.js';
import * as cy from './templates/cyclones.js';
import * as eq from './templates/earthquakes.js';
import * as hard from './templates/hard.js';
import * as infra from './templates/infrastructure.js';
import * as launch from './templates/launches.js';
import * as mil from './templates/military.js';
import * as unavailable from './templates/unavailable.js';

/** Places within reach of the aircraft the `injected` scenario plants text on. */
const nearWashington = ({ location }) =>
  ['Washington, D.C.', 'Ashburn, Virginia', 'Norfolk, Virginia'].includes(
    location,
  );

/**
 * `[template, scenario, public count, held-out count, params filter?]`.
 */
export const QUESTION_PLAN = Object.freeze([
  [eq.countWorldwide, 'baseline', 2, 1],
  [eq.countWithin, 'baseline', 3, 1],
  [eq.countWithinZero, 'baseline', 1, 1],
  [eq.strongestWithin, 'baseline', 2, 1],
  [eq.deepest, 'baseline', 1, 0],
  [eq.countDeeper, 'baseline', 1, 0],
  [eq.nearest, 'baseline', 1, 1],
  [eq.countWorldwide, 'outage', 1, 0],
  [combined.aftershocks, 'baseline', 1, 1],
  [cy.count, 'baseline', 1, 0],
  [cy.strongest, 'baseline', 1, 0],
  [cy.wind, 'baseline', 1, 0],
  [cy.pressure, 'baseline', 1, 1],
  [cy.wind, 'stale', 1, 0],
  [cy.strongest, 'outage', 1, 0],
  [launch.countByProvider, 'baseline', 2, 1],
  [launch.latestByProvider, 'baseline', 1, 1],
  [launch.countByOrbit, 'baseline', 1, 0],
  [launch.countByCountry, 'baseline', 1, 1],
  [launch.countFailed, 'baseline', 1, 0],
  [launch.countByProvider, 'stale', 1, 0],
  [mil.countWithin, 'baseline', 2, 1],
  [mil.countWithinZero, 'baseline', 1, 1],
  [mil.countAirborne, 'baseline', 1, 1],
  [mil.highest, 'baseline', 1, 0],
  [mil.nearest, 'baseline', 1, 1],
  [mil.countWithin, 'stale', 1, 0],
  [combined.aircraftNearCyclone, 'baseline', 1, 1],
  [infra.countWithin, 'baseline', 2, 1],
  [unavailable.fires, 'baseline', 1, 1],
  [unavailable.vessels, 'baseline', 1, 0],
  [hard.aircraftAbove, 'baseline', 1, 1],
  [hard.cycloneDistance, 'baseline', 2, 1],
  [hard.cycloneWindKmh, 'baseline', 1, 0],
  [hard.launchGap, 'baseline', 2, 1],
  [hard.launchProviderOrbit, 'baseline', 1, 1],
  [hard.meanMagnitude, 'baseline', 1, 1],
  [hard.countInWindow, 'baseline', 2, 1],
  [hard.topOperator, 'baseline', 1, 1],
  [absent.cycloneWind, 'baseline', 1, 1],
  [absent.latestLaunch, 'baseline', 1, 1],
  [eq.countWorldwide, 'injected', 1, 0],
  [cy.wind, 'injected', 1, 1],
  [launch.countByProvider, 'injected', 1, 1],
  [mil.countWithin, 'injected', 1, 1, nearWashington],
]);

/** Every template, by id. */
export const TEMPLATES = Object.freeze(
  Object.fromEntries(
    QUESTION_PLAN.map(([template]) => [template.id, template]),
  ),
);
