// E=UP event timeline slice S0 (2026-11-19): the gate's three answers, proven on the in-process environment plane, the REAL
// Worker handler over the REAL applied module-policy SQL in PGlite (scripts/test/support/eup-environment-plane.mjs). It is the
// local stand-in for "staging" (decision D1, default adopted pending Matthew's confirmation): no staging Worker or Supabase
// branch exists, and creating one is Matthew's call.
//   not installed (the store's own EUM01, production since 2026-11-17)  -> 404 module_disabled (off)
//   installed, disabled                                                  -> 404 module_disabled (off), the same bytes
//   enabled, providers with rows                                         -> 200 with events; a layer with items
//   enabled, providers with nothing                                      -> 200 with zero events, every source available (no data)
//   draining                                                             -> reads still 200
//   store unreachable; policy schema missing                             -> 503 module_policy_unavailable (outage)
// One policy read per request in every case, and no provider is asked while the gate refuses.
//   PGLITE_MODULE=<PGlite 0.3.x dist/index.js> node scripts/test/eup-environment-plane.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentPlane, memoryCache } from './support/eup-environment-plane.mjs';

const plane = await createEnvironmentPlane();
const FEED = '/v1/world/environment', EONET = '/v1/world/environment/layers/eonet';
const OFF = { ok: false, code: 'module_disabled' }, OUTAGE = { ok: false, code: 'module_policy_unavailable' };

test('not installed: off (404 module_disabled) on the feed and a layer, one policy read, no provider asked', async () => {
  for (const path of [FEED, EONET]) {
    const r = await plane.get(path);
    assert.equal(r.status, 404, path); assert.deepEqual(r.body, OFF, path);
    assert.equal(r.policyReads, 1, path); assert.equal(r.providerCalls, 0, path);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  }
});

test('installed but disabled: the same off, byte for byte', async () => {
  const notInstalled = await plane.get(FEED);
  const receipt = await plane.install();
  assert.equal(receipt.policy.state, 'disabled'); assert.equal(receipt.policy.revision, 0);
  const disabled = await plane.get(FEED);
  assert.equal(disabled.status, 404); assert.deepEqual(disabled.body, OFF);
  assert.deepEqual(disabled.body, notInstalled.body, 'a visitor cannot tell how far the owner got');
  assert.equal(disabled.providerCalls, 0);
});

test('enabled, the providers answering with rows: 200 with events, the layer with items', async () => {
  await plane.enable();
  plane.providers = 'rows';
  const cache = memoryCache();
  const feed = await plane.get(FEED, { cache });
  assert.equal(feed.status, 200); assert.equal(feed.body.schema, 'world-environment/v1');
  assert.ok(feed.body.events.some((e) => e.id === 'usgs:usplane01'), 'the quake is an event');
  assert.ok(feed.body.events.some((e) => e.id === 'eonet:EONET_PLANE_1'));
  assert.equal(feed.body.missions_unavailable, true, 'the missions table is not in production either');
  assert.equal(feed.policyReads, 1);
  const usgs = feed.body.sources.find((s) => s.id === 'usgs');
  assert.equal(usgs.status, 'available');
  assert.equal(usgs.observed_at, feed.body.events.find((e) => e.id === 'usgs:usplane01').observed_at, 'E6: the latest observation is the quake\'s origin time');
  const layer = await plane.get(EONET, { cache: memoryCache() });
  assert.equal(layer.status, 200); assert.equal(layer.body.count, 1); assert.equal(layer.body.sources[0].status, 'available');
  assert.equal(layer.policyReads, 1);
});

test('enabled, the providers answering with nothing: no data, 200 with zero events and every source available', async () => {
  plane.providers = 'empty';
  const feed = await plane.get(FEED, { cache: memoryCache() });
  assert.equal(feed.status, 200); assert.equal(feed.body.events.length, 0);
  assert.ok(feed.body.sources.every((s) => s.status === 'available'), 'no data is not an outage');
  const layer = await plane.get(EONET, { cache: memoryCache() });
  assert.deepEqual([layer.status, layer.body.count, layer.body.sources[0].status], [200, 0, 'available']);
  /* and a provider down is said per source, still 200: the module is on */
  plane.providers = 'down';
  const down = await plane.get(FEED, { cache: memoryCache() });
  assert.equal(down.status, 200); assert.ok(down.body.sources.every((s) => s.status === 'unavailable'));
});

test('draining: reads still answer', async () => {
  plane.providers = 'rows';
  await plane.drain();
  const feed = await plane.get(FEED, { cache: memoryCache() });
  assert.equal(feed.status, 200);
});

test('the store unreachable, then the policy schema missing: outage, 503 module_policy_unavailable, never off', async () => {
  plane.store = 'down';
  for (const path of [FEED, EONET]) {
    const r = await plane.get(path);
    assert.equal(r.status, 503, path); assert.deepEqual(r.body, OUTAGE, path); assert.equal(r.providerCalls, 0);
  }
  plane.store = 'up';
  await plane.unapplySchema();
  for (const path of [FEED, EONET]) {
    const r = await plane.get(path);
    assert.equal(r.status, 503, path); assert.deepEqual(r.body, OUTAGE, path); assert.equal(r.policyReads, 1); assert.equal(r.providerCalls, 0);
  }
});

test.after(() => plane.close());
