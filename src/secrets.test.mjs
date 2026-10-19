import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heldoutSeed, KEYCHAIN_ITEM } from './secrets.js';

test('the environment seed wins, then the Keychain, then none', () => {
  const asked = [];
  const keychain = (item) => {
    asked.push(item);
    return 'from-keychain';
  };
  assert.equal(
    heldoutSeed({
      env: { GEB_HELDOUT_SEED: 'from-env' },
      readKeychain: keychain,
    }),
    'from-env',
  );
  assert.deepEqual(asked, []);
  assert.equal(
    heldoutSeed({ env: {}, readKeychain: keychain }),
    'from-keychain',
  );
  assert.deepEqual(asked, [KEYCHAIN_ITEM]);
  assert.equal(heldoutSeed({ env: {}, readKeychain: () => null }), null);
});
