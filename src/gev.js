/**
 * The pinned God's Eye View checkout the benchmark runs against.
 *
 * `GEV_DIR` points at an existing checkout; otherwise `geb setup` creates one
 * under `.gev/<commit>`. Either way it must be at the pinned commit, so every
 * result names exactly the tools it measured.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BENCH, repoPath } from './config.js';

/** The checkout to use: `GEV_DIR`, or the default for the pinned commit. */
export function gevDir(env = process.env, commit = BENCH.gev.commit) {
  return env.GEV_DIR
    ? path.resolve(env.GEV_DIR)
    : repoPath('.gev', commit.slice(0, 12));
}

/** The commit a git checkout is at, or null when it is not a checkout. */
export function checkoutCommit(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Throw unless `dir` is a God's Eye View checkout at `commit` with its
 * dependencies installed.
 */
export function assertPinnedCheckout(
  dir = gevDir(),
  commit = BENCH.gev.commit,
) {
  const actual = checkoutCommit(dir);
  if (!actual)
    throw new Error(
      `No God's Eye View checkout at ${dir}. Run \`npm run setup\` or set GEV_DIR.`,
    );
  if (actual !== commit)
    throw new Error(
      `God's Eye View at ${dir} is at ${actual.slice(0, 12)}, but the benchmark is pinned to ${commit.slice(0, 12)}.`,
    );
  if (!existsSync(path.join(dir, 'node_modules')))
    throw new Error(
      `God's Eye View at ${dir} has no node_modules. Run \`npm run setup\`.`,
    );
  return dir;
}

/** Import a module from the pinned checkout by its repository-relative path. */
export function importGev(relativePath, dir = gevDir()) {
  return import(pathToFileURL(path.join(dir, relativePath)).href);
}

/**
 * Create the default checkout at the pinned commit (a shallow fetch of that
 * one commit) and install its runtime dependencies. Does nothing when the
 * checkout is already pinned and installed. Safe to re-run after an
 * interruption: the fetch happens in a side folder that is renamed into
 * place only when complete, and the install is marked done only when it
 * finishes.
 */
export function setupGev({
  dir = gevDir(),
  repository = BENCH.gev.repository,
  commit = BENCH.gev.commit,
  log = () => {},
} = {}) {
  const run = (command, args, cwd) =>
    execFileSync(command, args, {
      cwd,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  if (checkoutCommit(dir) !== commit) {
    if (existsSync(dir) && checkoutCommit(dir))
      throw new Error(
        `${dir} is a checkout at another commit; move it aside or set GEV_DIR.`,
      );
    log(`Fetching God's Eye View ${commit.slice(0, 12)} into ${dir}`);
    const incoming = `${dir}.incoming`;
    rmSync(incoming, { recursive: true, force: true });
    mkdirSync(incoming, { recursive: true });
    run('git', ['init', '--quiet'], incoming);
    run('git', ['remote', 'add', 'origin', repository], incoming);
    run(
      'git',
      ['fetch', '--quiet', '--depth', '1', 'origin', commit],
      incoming,
    );
    run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], incoming);
    rmSync(dir, { recursive: true, force: true });
    renameSync(incoming, dir);
  }
  const installed = path.join(dir, 'node_modules', '.geb-installed');
  if (!existsSync(installed)) {
    log('Installing its runtime dependencies');
    rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
    run(
      'npm',
      ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
      dir,
    );
    writeFileSync(installed, `${commit}\n`);
  }
  return assertPinnedCheckout(dir, commit);
}
