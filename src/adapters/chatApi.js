/**
 * Talking to an OpenAI-compatible chat API: one POST per model turn over
 * node:http, with the key scoped to its provider, retries for rate limits,
 * server faults and stalled requests, and a clean stop on a used-up daily
 * quota. The thin runner's agent loop lives in openai-compatible.js.
 */

import http from 'node:http';
import https from 'node:https';
import { trialError } from '../trials.js';

/** Tries per request before a rate limit or outage becomes a harness error. */
export const MAX_REQUEST_TRIES = 6;

/**
 * Rate limits and transient server faults, retried with backoff. 529 is
 * Anthropic's "overloaded".
 */
export const RETRIED_STATUSES = [429, 500, 502, 503, 504, 529];

/** The chat API's base URL for an entry, without a trailing slash. */
export function baseUrl(endpoint) {
  return (
    endpoint ||
    process.env.GEB_OPENAI_BASE_URL ||
    'http://localhost:11434/v1'
  ).replace(/\/$/, '');
}

/** Milliseconds to wait before retry `attempt` (1-based), honouring Retry-After. */
export function backoffMs(attempt, retryAfter) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0)
    return Math.min(seconds, 120) * 1000;
  return Math.min(5000 * 2 ** (attempt - 1), 60000);
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });

/**
 * POST a JSON body and read the whole reply. Node's `fetch` gives up when a
 * reply's headers take more than 300 s, and a local model can think longer
 * than that in one turn, so this uses node:http, whose only time limit is the
 * trial's own abort signal.
 */
export function postJson(url, body, { headers = {}, signal } = {}) {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = client.request(
      target,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
        signal,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

/**
 * What a rate-limit reply says: whether a per-day quota is used up, and the
 * delay the server suggests. Google names the quota it hit (for example
 * `GenerateRequestsPerDayPerProjectPerModel`) and suggests a delay in
 * a `RetryInfo` detail.
 */
export function readLimit(text) {
  let details = [];
  try {
    const parsed = JSON.parse(text);
    details =
      (Array.isArray(parsed) ? parsed[0] : parsed)?.error?.details ?? [];
  } catch {
    // Not JSON: fall back to the text itself.
  }
  const quotaIds = details
    .flatMap((detail) => detail.violations ?? [])
    .map((violation) => violation.quotaId ?? '');
  const delay = details.find((detail) => detail.retryDelay)?.retryDelay;
  return {
    daily: quotaIds.length
      ? quotaIds.some((id) => /PerDay/i.test(id))
      : /PerDay/i.test(text),
    retryAfter: delay ? String(parseFloat(delay)) : null,
  };
}

/**
 * The bearer key for an endpoint: the model entry's own `*_API_KEY` variable
 * when it names one, or GEB_OPENAI_API_KEY for GEB_OPENAI_BASE_URL when the
 * entry names no endpoint. An entry's endpoint never gets another provider's
 * key, and a key is sent only over https or to this machine.
 */
export function apiKey(endpoint, apiKeyEnv, env = process.env) {
  if (apiKeyEnv && !/^[A-Z0-9_]+_API_KEY$/.test(apiKeyEnv))
    throw new Error(
      `apiKeyEnv must name a *_API_KEY variable, not ${apiKeyEnv}`,
    );
  const key = apiKeyEnv
    ? env[apiKeyEnv]
    : endpoint
      ? null
      : env.GEB_OPENAI_API_KEY;
  if (!key) return null;
  const { protocol, hostname } = new URL(baseUrl(endpoint));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (protocol !== 'https:' && !local)
    throw new Error(
      `Refusing to send an API key over plain http to ${hostname}`,
    );
  return key;
}

export async function complete(
  body,
  { signal, endpoint, apiKeyEnv, requestTimeoutMs, extendDeadline, usage },
) {
  const key = apiKey(endpoint, apiKeyEnv);
  for (let attempt = 1; ; attempt += 1) {
    // A hosted endpoint can hold a request open without ever answering; with
    // a per-request limit that is a provider stall, retried like a fault.
    const stall = requestTimeoutMs
      ? AbortSignal.timeout(requestTimeoutMs)
      : null;
    let response;
    try {
      response = await postJson(`${baseUrl(endpoint)}/chat/completions`, body, {
        headers: key ? { authorization: `Bearer ${key}` } : {},
        signal: stall
          ? AbortSignal.any([signal, stall].filter(Boolean))
          : signal,
      });
    } catch (error) {
      if (!stall?.aborted || signal?.aborted) throw error;
      extendDeadline?.(requestTimeoutMs);
      usage.stall_ms += requestTimeoutMs;
      if (attempt < MAX_REQUEST_TRIES) continue;
      throw new Error(
        `No reply within ${requestTimeoutMs} ms, ${MAX_REQUEST_TRIES} times`,
        { cause: error },
      );
    }
    if (response.status >= 200 && response.status < 300)
      return JSON.parse(response.text);
    const limit = readLimit(response.text);
    if (response.status === 429 && limit.daily)
      throw trialError(
        'quota',
        `Daily quota used up for ${body.model}; it resets at midnight Pacific`,
      );
    if (
      RETRIED_STATUSES.includes(response.status) &&
      attempt < MAX_REQUEST_TRIES
    ) {
      const wait = backoffMs(
        attempt,
        response.headers['retry-after'] ?? limit.retryAfter,
      );
      // Waiting out the provider (a limit or a fault) is not the agent's time.
      extendDeadline?.(wait);
      usage.rate_limit_wait_ms += wait;
      await sleep(wait, signal);
      continue;
    }
    throw new Error(
      `Chat API HTTP ${response.status}: ${response.text.slice(0, 200)}`,
    );
  }
}
