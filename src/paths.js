/** Where snapshots, questions and runs live. */

import path from 'node:path';
import { BENCH, repoPath } from './config.js';

/** A snapshot id is its recording date; anything else is refused. */
const SNAPSHOT_ID = /^\d{4}-\d{2}-\d{2}$/;

/** The snapshot folder for an id (default: the configured snapshot). */
export function snapshotDir(id = BENCH.snapshot) {
  if (!SNAPSHOT_ID.test(id ?? ''))
    throw new Error(`Snapshot ids are dates (YYYY-MM-DD), not "${id}"`);
  return repoPath('snapshots', id);
}

/** The question file for a snapshot and split. */
export function questionsPath(split, id = BENCH.snapshot) {
  return repoPath('questions', `${id}.${split}.json`);
}

/**
 * The run folder: `runs/<status>/<run-id>`, with held-out trials in its
 * `heldout/` subfolder, which git ignores.
 */
export function runDir(status, runId, split = 'public') {
  const dir = repoPath('runs', status, runId);
  return split === 'heldout' ? path.join(dir, 'heldout') : dir;
}
