import assert from 'node:assert/strict';
import test from 'node:test';

import { haloAccessTier } from '../src/seek-first/equity-uprise-halo.js';

test('Halo access tiers never turn an Equity Uprise admin into a house owner', () => {
  assert.equal(haloAccessTier('visitor'), 'public');
  assert.equal(haloAccessTier('member'), 'member');
  assert.equal(haloAccessTier('host'), 'member');
  assert.equal(haloAccessTier('client'), 'member');
  assert.equal(haloAccessTier('editor'), 'staff');
  assert.equal(haloAccessTier('admin'), 'staff');
  assert.equal(haloAccessTier('owner'), 'owner-admin');
  assert.equal(haloAccessTier('unexpected'), 'public');
});
