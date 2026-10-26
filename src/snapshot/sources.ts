/**
 * The sources a snapshot may store (config/sources.json): which requests
 * belong to each, its license, and whether its data may be recorded at all.
 */

import { readConfig } from '../config.js';

/** One entry of config/sources.json. */
export interface Source {
  id: string;
  name: string;
  /** Request-key prefixes (after the method) that belong to this source. */
  prefixes: string[];
  /** `all` keeps every response; `errors` keeps only error answers. */
  record: 'all' | 'errors';
  license: string;
  terms: string;
  credit: string;
}

/** Every source in config/sources.json, in file order. */
export const SOURCES: readonly Source[] = Object.freeze(
  readConfig('sources').sources,
);

/** The source a request key belongs to, or null when no source claims it. */
export function sourceForKey(
  key: string,
  sources: readonly Source[] = SOURCES,
): Source | null {
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
export function mayRecord(source: Source | null, status: number): boolean {
  if (!source) return false;
  if (source.record === 'all') return true;
  if (source.record === 'errors') return status >= 400;
  return false;
}
