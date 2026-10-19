/**
 * The held-out seed (ADR 0007): GEB_HELDOUT_SEED from the environment or the
 * git-ignored .env, otherwise the macOS login Keychain. It is never printed.
 */

import { execFileSync } from 'node:child_process';

/** Where `geb` looks for the seed in the macOS Keychain. */
export const KEYCHAIN_ITEM = Object.freeze({
  service: 'gods-eye-bench',
  account: 'GEB_HELDOUT_SEED',
});

/** Read a generic password from the macOS login Keychain, or null. */
export function readMacKeychain({ service, account }) {
  if (process.platform !== 'darwin') return null;
  try {
    const value = execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-a', account, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return value || null;
  } catch {
    return null;
  }
}

/** The held-out seed, or null when neither the environment nor the Keychain has one. */
export function heldoutSeed({
  env = process.env,
  readKeychain = readMacKeychain,
} = {}) {
  return env.GEB_HELDOUT_SEED || readKeychain(KEYCHAIN_ITEM) || null;
}
