/** Running a harness as a child process, shared by the CLI-based adapters. */

import { execFileSync, spawn } from 'node:child_process';
import { cleanEnv } from '../env.js';

export { cleanEnv };

/** The first line of `command --version`. */
export function versionOf(command) {
  return execFileSync(command, ['--version'], {
    encoding: 'utf8',
    env: cleanEnv(),
  })
    .split('\n')[0]
    .trim();
}

/**
 * Run a command to completion, collecting stdout and stderr. Kills it when
 * `signal` aborts and rejects with the abort reason.
 */
export function runProcess(command, args, { cwd, env, signal }) {
  return new Promise((resolve, reject) => {
    // Its own process group, so a timeout stops everything the harness
    // started (its MCP servers included), not just the harness itself.
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const killGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // Already gone.
      }
    };
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    const abort = () => {
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), 5000).unref();
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason);
      else resolve({ code, stdout, stderr });
    });
  });
}

/** A harness's stream-json output: its JSON lines, skipping any other output. */
export function parseStreamJson(text) {
  return text
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}
