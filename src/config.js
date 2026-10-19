/** The benchmark's configuration files and repository paths, read once. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Absolute path of the repository root. */
export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Absolute path of a file or folder inside the repository. */
export function repoPath(...parts) {
  return path.join(ROOT, ...parts);
}

/** Parse a JSON file from the repository's `config/` folder. */
export function readConfig(name) {
  return JSON.parse(readFileSync(repoPath('config', `${name}.json`), 'utf8'));
}

/** The benchmark settings: the pinned God's Eye View commit and run defaults. */
export const BENCH = Object.freeze(readConfig('bench'));

/** The benchmark's own version, recorded with every run. */
export const BENCH_VERSION = JSON.parse(
  readFileSync(repoPath('package.json'), 'utf8'),
).version;

/** Fields a model entry may have; a misspelt one would be silently ignored. */
const ENTRY_FIELDS = new Set([
  'adapter',
  'model',
  'label',
  'concurrency',
  'timeoutMs',
  'endpoint',
  'apiKeyEnv',
  'requestTimeoutMs',
]);

/** The entries of config/models.json, each checked for unknown fields. */
export function modelEntries() {
  const { models } = readConfig('models');
  for (const entry of models) {
    const unknown = Object.keys(entry).filter((key) => !ENTRY_FIELDS.has(key));
    if (unknown.length || !entry.adapter || !entry.model || !entry.label)
      throw new Error(
        `config/models.json: entry ${entry.label ?? entry.model} has ${unknown.length ? `unknown fields ${unknown.join(', ')}` : 'no adapter, model or label'}`,
      );
  }
  return models;
}
