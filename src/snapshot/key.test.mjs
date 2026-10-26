import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestKey, sha256 } from './key.ts';

test('requestKey writes the app origin as app: and sorts the query', () => {
  assert.equal(
    requestKey(new URL('http://localhost:4173/api/geocode?q=Japan&a=1')),
    'GET app:/api/geocode?a=1&q=Japan',
  );
  assert.equal(
    requestKey('http://127.0.0.1:5173/api/geocode?a=1&q=Japan'),
    'GET app:/api/geocode?a=1&q=Japan',
  );
  assert.equal(requestKey('/api/cyclones'), 'GET app:/api/cyclones');
});

test('requestKey keeps external origins and reads Request inputs', () => {
  const url = 'https://earthquake.usgs.gov/feed/all_day.geojson';
  assert.equal(requestKey(url), `GET ${url}`);
  assert.equal(requestKey(new Request(url)), `GET ${url}`);
  assert.equal(requestKey(new Request(url, { method: 'HEAD' })), `HEAD ${url}`);
});

test('requestKey hashes the body of a non-GET request', () => {
  const a = requestKey('/api/terrain', { method: 'post', body: '{"a":1}' });
  const b = requestKey('/api/terrain', { method: 'POST', body: '{"a":2}' });
  assert.match(a, /^POST app:\/api\/terrain #[0-9a-f]{16}$/);
  assert.notEqual(a, b);
  assert.equal(a.slice(-16), sha256('{"a":1}').slice(0, 16));
});
