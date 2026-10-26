/**
 * The world a question is asked about: a snapshot under one scenario, parsed
 * into plain records by code that never calls the tools under test.
 */

import { applyScenario, scenarioRules } from '../snapshot/scenarios.ts';
import {
  parseCyclones,
  parseEarthquakes,
  parseKeylessFeed,
  parseLaunches,
  parseMilitaryAircraft,
} from './feeds.js';

/** The recorded response of the first key from `source`, under a scenario. */
function sourceResponse(responses, source, rules) {
  for (const response of responses.values())
    if (response.source === source) return applyScenario(response, rules);
  return undefined;
}

/**
 * Build the world for `scenario` from a loaded snapshot. `infrastructure` is
 * the bundled data from `readInfrastructure`, shared by every scenario.
 */
export function buildWorld({ manifest, responses }, scenario, infrastructure) {
  const rules = scenarioRules(scenario);
  const response = (source) => sourceResponse(responses, source, rules);
  return {
    scenario,
    clockMs: manifest.clock_ms,
    earthquakes: parseEarthquakes(response('usgs')),
    cyclones: parseCyclones(response('cyclones')),
    launches: parseLaunches(response('launches')),
    military: parseMilitaryAircraft(response('adsblol')),
    fires: parseKeylessFeed(response('firms')),
    vessels: parseKeylessFeed(response('ais')),
    infrastructure,
  };
}
