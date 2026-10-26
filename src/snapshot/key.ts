/** Request keys: how a snapshot names the response to one request. */

import { createHash } from 'node:crypto';

/**
 * The app address the record and replay servers use. Tools request the app's
 * own `/api/...` paths against it; keys write it as `app:`.
 */
export const APP_BASE = 'http://localhost:4173';

/** SHA-256 of a string or bytes, as lowercase hex. */
export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The URL string of a fetch input: a string, URL or Request. */
export function inputUrl(input: RequestInfo | URL): string {
  return String(input instanceof Request ? input.url : input);
}

/**
 * `METHOD url`, with query parameters sorted and the app's origin written as
 * `app:`, so the same request has one key on any port. A non-GET request with
 * a string body adds its hash, since its body is part of what is asked.
 */
export function requestKey(
  input: RequestInfo | URL,
  init: RequestInit = {},
): string {
  const url = new URL(inputUrl(input), APP_BASE);
  url.searchParams.sort();
  const method = (
    init.method || (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  const isApp = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const where = `${isApp ? 'app:' : url.origin}${url.pathname}${url.search}`;
  const body =
    method !== 'GET' && typeof init.body === 'string'
      ? ` #${sha256(init.body).slice(0, 16)}`
      : '';
  return `${method} ${where}${body}`;
}
