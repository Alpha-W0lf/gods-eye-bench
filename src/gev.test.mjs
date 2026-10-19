import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertPinnedCheckout, checkoutCommit, gevDir } from './gev.js';

test('gevDir prefers GEV_DIR and defaults to a folder named for the commit', () => {
  assert.equal(gevDir({ GEV_DIR: '/tmp/x' }), '/tmp/x');
  assert.match(gevDir({}, 'aa16b7c3b0166a89'), /\.gev\/aa16b7c3b016$/);
});

test('assertPinnedCheckout refuses a missing, unpinned or uninstalled checkout', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'geb-gev-'));
  try {
    assert.throws(
      () => assertPinnedCheckout(dir, 'f'.repeat(40)),
      /No God's Eye View checkout/,
    );
    const git = (...args) =>
      execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
    git('init', '--quiet');
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    git('add', '.');
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '--quiet',
      '-m',
      'a',
    );
    const commit = checkoutCommit(dir);
    assert.match(commit, /^[0-9a-f]{40}$/);
    assert.throws(
      () => assertPinnedCheckout(dir, 'f'.repeat(40)),
      /pinned to ffffffffffff/,
    );
    assert.throws(() => assertPinnedCheckout(dir, commit), /no node_modules/);
    mkdirSync(path.join(dir, 'node_modules'));
    assert.equal(assertPinnedCheckout(dir, commit), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
