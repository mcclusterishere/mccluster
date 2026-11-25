/* The runtime proof must not call [null] a video/poster pair. JSON.stringify turns
   undefined array entries into null, so compare only after both IDs exist. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../e2e/world-screen.e2e.mjs', import.meta.url), 'utf8');
const pairingCheck = source.split('\n').find((line) => line.includes("check(scope, 'Post sends the clip with its picture beside it'"));

function proof(vId, pId, body) {
  let passed;
  vm.runInNewContext(pairingCheck, { scope: 'poster-proof', vId, pId, sent: { body }, check(_scope, _message, ok) { passed = ok; } });
  return !!passed;
}

test('composer proof rejects an absent poster, including JSON null/undefined equivalence', () => {
  assert.equal(proof('video', undefined, { media_asset_ids: ['video'], poster_asset_ids: [null] }), false);
  assert.equal(proof('video', null, { media_asset_ids: ['video'], poster_asset_ids: [null] }), false);
  assert.equal(proof(undefined, 'poster', { media_asset_ids: [null], poster_asset_ids: ['poster'] }), false);
});

test('composer proof requires the exact real video and poster pair', () => {
  assert.equal(proof('video', 'poster', { media_asset_ids: ['video'], poster_asset_ids: ['poster'] }), true);
  assert.equal(proof('video', 'poster', { media_asset_ids: ['video'], poster_asset_ids: ['other'] }), false);
  assert.equal(proof('video', 'poster', { media_asset_ids: ['other'], poster_asset_ids: ['poster'] }), false);
});
