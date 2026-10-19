/** Environments for child processes. */

/**
 * A minimal environment: enough to find a program and its login, nothing
 * else. Keys and the held-out seed loaded from `.env` never reach a child.
 */
export function cleanEnv(extra = {}) {
  const env = { TERM: 'dumb', LANG: 'en_US.UTF-8' };
  for (const key of ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR'])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  return { ...env, ...extra };
}
