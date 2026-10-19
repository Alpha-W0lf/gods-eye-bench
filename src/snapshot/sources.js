/**
 * The sources a snapshot may store (config/sources.json): which requests
 * belong to each, its license, and whether its data may be recorded at all.
 */

import { readConfig } from '../config.js';

/** Every source in config/sources.json, in file order. */
export const SOURCES = Object.freeze(readConfig('sources').sources);

/** The source a request key belongs to, or null when no source claims it. */
export function sourceForKey(key, sources = SOURCES) {
  const where = key.slice(key.indexOf(' ') + 1);
  return (
    sources.find((source) =>
      source.prefixes.some((prefix) => where.startsWith(prefix)),
    ) ?? null
  );
}

/**
 * Whether a response may be written to a snapshot. Sources that need keys
 * keep only their keyless error answers, which hold no data.
 */
export function mayRecord(source, status) {
  if (!source) return false;
  if (source.record === 'all') return true;
  if (source.record === 'errors') return status >= 400;
  return false;
}
