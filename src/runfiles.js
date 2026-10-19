/**
 * A run's files, read and written in one place: the gzipped trial log of a
 * finished run, the append-only partial log of a running one, and the
 * questions a run used.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { repoPath } from './config.js';
import { sha256 } from './snapshot/key.js';

/** A run folder's files: its record, and its final and partial trial logs. */
export const RUN_RECORD = 'run.json';
export const FINAL_LOG = 'trials.jsonl.gz';
export const PARTIAL_LOG = 'trials.partial.jsonl';

/** A decompressed trial log may be at most this large (a guard on input). */
const MAX_LOG_BYTES = 512 * 1024 * 1024;

/**
 * Records from JSON-lines text. A last line cut short by a crash mid-write
 * is dropped (its trial simply runs again); a bad line anywhere else throws.
 */
export function parseJsonLines(text) {
  const lines = text.split('\n');
  const complete = text.endsWith('\n') ? lines : lines.slice(0, -1);
  return complete.filter(Boolean).map((line) => JSON.parse(line));
}

/** Read a run's gzipped trial log. */
export function readTrials(file) {
  return parseJsonLines(
    gunzipSync(readFileSync(file), { maxOutputLength: MAX_LOG_BYTES }).toString(
      'utf8',
    ),
  );
}

/** Read an append-only partial log; a missing file is an empty log. */
export function readPartialLog(file) {
  return existsSync(file) ? parseJsonLines(readFileSync(file, 'utf8')) : [];
}

/**
 * Whether a run folder holds any trials. A committed run record alone (a run
 * still going on another machine, its logs not yet in git) does not count.
 */
export function hasTrials(dir) {
  return [FINAL_LOG, PARTIAL_LOG].some((name) =>
    existsSync(path.join(dir, name)),
  );
}

/**
 * Write a gzipped trial log atomically: to a temporary file, then renamed,
 * so a crash never leaves a half-written log in place.
 */
export function writeTrials(file, records) {
  const temporary = `${file}.tmp`;
  writeFileSync(
    temporary,
    gzipSync(records.map((record) => `${JSON.stringify(record)}\n`).join('')),
  );
  renameSync(temporary, file);
}

/** The questions a run used, refusing a file whose checksum changed. */
export function runQuestions(run, root = repoPath()) {
  // A run record may come from a contributor: its questions file must be one
  // of this repo's question files, not a path elsewhere.
  if (!/^questions\/[\w.-]+\.json$/.test(run.questions?.file ?? ''))
    throw new Error(
      `${run.run_id}: unexpected questions file ${run.questions?.file}`,
    );
  const file = path.join(root, run.questions.file);
  if (!existsSync(file)) return null;
  const content = readFileSync(file);
  if (sha256(content) !== run.questions.checksum)
    throw new Error(
      `${run.run_id}: ${run.questions.file} has changed since the run`,
    );
  return JSON.parse(content).questions;
}

/**
 * macOS per-user temporary folders by shape, from any machine: as a path
 * (also its /private real path), URL-encoded, and as harnesses spell paths
 * in folder names, with every other character turned into a dash.
 */
const MAC_TEMP = [
  [/(?:\/private)?\/var\/folders\/[\w-]+\/[\w-]+\/T(?![\w-])/g, '$TMPDIR'],
  [
    /(?:%2Fprivate)?%2Fvar%2Ffolders%2F[\w-]+%2F[\w-]+%2FT(?![\w-])/gi,
    '$TMPDIR',
  ],
  [/(?:private-)?var-folders-[\w-]+?-T(?![A-Za-z0-9])/g, 'TMPDIR'],
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace one folder in every spelling a log uses: the path itself (a whole
 * path only: /Users/x must not turn /Users/xavier into ~avier, and
 * /Users/x.backup is another folder), URL-encoded, and dashed as in folder
 * names, with or without the leading dash.
 */
function replaceFolder(text, dir, token, dashedToken) {
  const dashed = dir.replace(/[^A-Za-z0-9]/g, '-').replace(/^-/, '');
  return text
    .replace(new RegExp(`${escape(dir)}(?![\\w-]|\\.[\\w-])`, 'g'), token)
    .replace(
      new RegExp(`${escape(encodeURIComponent(dir))}(?![\\w-])`, 'gi'),
      token,
    )
    .replace(
      new RegExp(`(-?)${escape(dashed)}(?![A-Za-z0-9])`, 'g'),
      (_, dash) => `${dash}${dashedToken}`,
    );
}

/**
 * A harness log with local paths generalised: the temporary directory as
 * `$TMPDIR` (`TMPDIR` inside a folder name) and the home directory as `~`
 * (`HOME`), so committed logs carry neither the user name nor the machine's
 * per-user folder.
 */
export function redactLocalPaths(text, home = homedir(), temp = tmpdir()) {
  if (typeof text !== 'string') return text;
  const trimmed = (dir) => (dir ?? '').replace(/[/\\]+$/, '');
  let result = MAC_TEMP.reduce(
    (current, [pattern, token]) => current.replace(pattern, token),
    text,
  );
  if (trimmed(temp)) {
    for (const dir of [`/private${trimmed(temp)}`, trimmed(temp)])
      result = replaceFolder(result, dir, '$TMPDIR', 'TMPDIR');
    result = result.replaceAll('/private$TMPDIR', '$TMPDIR');
  }
  return trimmed(home)
    ? replaceFolder(result, trimmed(home), '~', 'HOME')
    : result;
}
