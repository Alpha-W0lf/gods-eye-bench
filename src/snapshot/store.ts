/**
 * Snapshots on disk: a manifest plus one file per recorded response, grouped
 * in a folder per source with that source's notice.
 *
 *   snapshots/<id>/manifest.json
 *   snapshots/<id>/<source>/<hash>.json   { key, status, headers, body }
 *   snapshots/<id>/<source>/NOTICE.md
 *
 * The manifest pins each file by SHA-256, so the manifest's own SHA-256 is
 * the snapshot's checksum.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from './key.ts';
import type { Source } from './sources.ts';

export const SNAPSHOT_SCHEMA = 1;

/** A response as the recorder keeps it, before it is written. */
export interface RecordedResponse {
  key: string;
  source: Source;
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** A response as a loaded snapshot holds it; `source` is the source's id. */
export interface StoredResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  source: string;
}

export interface ManifestEntry {
  key: string;
  source: string;
  file: string;
  status: number;
  sha256: string;
}

export interface Manifest {
  schema: number;
  id: string;
  recorded_at: string;
  clock_ms: number;
  gev: { commit: string; version: string };
  sources: { id: string; license: string; terms: string }[];
  entries: ManifestEntry[];
}

export interface Snapshot {
  manifest: Manifest;
  checksum: string;
  responses: Map<string, StoredResponse>;
}

/** Standard headers God's Eye View's sources read. */
const KEPT_HEADERS = new Set([
  'content-type',
  'etag',
  'last-modified',
  'retry-after',
]);

/**
 * Headers a snapshot keeps: the standard ones the sources read, and every
 * `x-` header, which carries the servers' cache and freshness signals
 * (`x-gev-cache`, `x-ads-b-cache`, `x-tle-cache` and others).
 */
export function keptHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (KEPT_HEADERS.has(lower) || lower.startsWith('x-')) kept[lower] = value;
  }
  return Object.fromEntries(Object.entries(kept).sort());
}

/** JSON with two-space indent and a final newline, as every file here uses. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function noticeFor(source: Source): string {
  return [
    `# ${source.name}`,
    '',
    `License: ${source.license}`,
    '',
    `Terms: ${source.terms}`,
    '',
    source.credit,
    '',
    'The files in this folder are recorded responses. The MIT license of the',
    'gods-eye-bench code does not apply to them.',
    '',
  ].join('\n');
}

/**
 * Write a snapshot. `responses` are `{ key, source, status, headers, body }`
 * with `source` a config/sources.json entry and `body` a string. Returns the
 * manifest.
 */
export function writeSnapshot(
  dir: string,
  {
    id,
    clockMs,
    gev,
    responses,
  }: {
    id: string;
    clockMs: number;
    gev: Manifest['gev'];
    responses: readonly RecordedResponse[];
  },
): Manifest {
  const entries: ManifestEntry[] = [];
  const used = new Map<string, Source>();
  for (const response of [...responses].sort((a, b) =>
    a.key.localeCompare(b.key),
  )) {
    const { source } = response;
    used.set(source.id, source);
    const file = `${source.id}/${sha256(response.key).slice(0, 16)}.json`;
    const content = stableJson({
      key: response.key,
      status: response.status,
      headers: response.headers,
      body: response.body,
    });
    mkdirSync(path.join(dir, source.id), { recursive: true });
    writeFileSync(path.join(dir, file), content);
    entries.push({
      key: response.key,
      source: source.id,
      file,
      status: response.status,
      sha256: sha256(content),
    });
  }
  for (const source of used.values())
    writeFileSync(path.join(dir, source.id, 'NOTICE.md'), noticeFor(source));
  const manifest: Manifest = {
    schema: SNAPSHOT_SCHEMA,
    id,
    recorded_at: new Date(clockMs).toISOString(),
    clock_ms: clockMs,
    gev,
    sources: [...used.values()]
      .map(({ id: sourceId, license, terms }) => ({
        id: sourceId,
        license,
        terms,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    entries,
  };
  writeFileSync(path.join(dir, 'manifest.json'), stableJson(manifest));
  return manifest;
}

/** The snapshot's checksum: the SHA-256 of its manifest file. */
export function snapshotChecksum(dir: string): string {
  return sha256(readFileSync(path.join(dir, 'manifest.json')));
}

/**
 * Load a snapshot and verify every file against the manifest. Resolves to
 * `{ manifest, checksum, responses }`, where `responses` maps each key to
 * `{ status, headers, body, source }`.
 */
export function loadSnapshot(dir: string): Snapshot {
  const manifest: Manifest = JSON.parse(
    readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
  );
  if (manifest.schema !== SNAPSHOT_SCHEMA)
    throw new Error(`Unsupported snapshot schema ${manifest.schema} in ${dir}`);
  const responses = new Map<string, StoredResponse>();
  for (const entry of manifest.entries) {
    const content = readFileSync(path.join(dir, entry.file));
    if (sha256(content) !== entry.sha256)
      throw new Error(
        `Snapshot file ${entry.file} does not match its checksum`,
      );
    const stored = JSON.parse(content.toString('utf8'));
    if (stored.key !== entry.key)
      throw new Error(`Snapshot file ${entry.file} holds another key`);
    responses.set(entry.key, {
      status: stored.status,
      headers: stored.headers,
      body: stored.body,
      source: entry.source,
    });
  }
  return { manifest, checksum: snapshotChecksum(dir), responses };
}
