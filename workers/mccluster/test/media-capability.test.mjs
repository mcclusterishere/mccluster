// Two defects that survived the social hardening pass.
//
// 1. media/router.js resolved the org and read `role` off the membership
//    row, then never looked at it. Generation calls fal.ai and spends the
//    org's budget, so "is a member" was standing in for "may spend".
// 2. scoreMetrics clamped with Math.max(0, Number(x)), which is not a
//    clamp: Number('n/a') is NaN and Math.max(0, NaN) is NaN. The value
//    lands on social_variants.score, which the generator orders by.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createGeneration } from '../src/media/router.js';
import { scoreMetrics } from '../src/social/router.js';
import { __resetCapabilityCache } from '../src/lib/capabilities.js';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

function generationRequest() {
  return new Request('https://api.mccluster.org/v1/media/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org_id: ORG_ID, model_id: 'model-1', prompt: 'test' })
  });
}

// Answers the membership lookup with `role`, the grant table with `grants`,
// and records every URL so a test can prove where the call stopped.
function withPlane({ role, grants, grantStatus = 200 }, fn) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.includes('/rest/v1/org_members?')) {
      return jsonResponse(role ? [{ org_id: ORG_ID, role }] : []);
    }
    if (href.includes('/rest/v1/control_role_capabilities?')) {
      if (grantStatus !== 200) return new Response('nope', { status: grantStatus });
      return jsonResponse(grants);
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };
  __resetCapabilityCache();
  return Promise.resolve()
    .then(() => fn(seen))
    .finally(() => { globalThis.fetch = original; __resetCapabilityCache(); });
}

const MATRIX = [
  { role: 'owner', capability: 'media.generate', allowed: true },
  { role: 'staff', capability: 'media.generate', allowed: true },
  { role: 'viewer', capability: 'media.generate', allowed: false },
  { role: 'viewer', capability: 'social.read', allowed: true }
];

test('a viewer cannot spend the org budget on generation', async () => {
  await withPlane({ role: 'viewer', grants: MATRIX }, async (seen) => {
    await assert.rejects(
      () => createGeneration(generationRequest(), env, { id: 'user-1' }),
      (error) => error.status === 403 && /does not include media\.generate/.test(error.message)
    );
    // It must stop at the grant check — never reach the model lookup, and
    // certainly never reach fal.ai.
    assert.equal(seen.some((href) => href.includes('media_models')), false);
  });
});

test('a role missing from the matrix entirely is denied, not defaulted', async () => {
  await withPlane({ role: 'contractor', grants: MATRIX }, async () => {
    await assert.rejects(
      () => createGeneration(generationRequest(), env, { id: 'user-1' }),
      (error) => error.status === 403
    );
  });
});

test('an unreadable grant table fails closed with 503, not open', async () => {
  await withPlane({ role: 'owner', grants: [], grantStatus: 500 }, async (seen) => {
    await assert.rejects(
      () => createGeneration(generationRequest(), env, { id: 'user-1' }),
      (error) => error.status === 503
    );
    assert.equal(seen.some((href) => href.includes('media_models')), false);
  });
});

test('an empty grant table fails closed rather than granting everything', async () => {
  await withPlane({ role: 'owner', grants: [] }, async () => {
    await assert.rejects(
      () => createGeneration(generationRequest(), env, { id: 'user-1' }),
      (error) => error.status === 503
    );
  });
});

test('a permitted role passes the grant check and proceeds to the model lookup', async () => {
  await withPlane({ role: 'staff', grants: MATRIX }, async (seen) => {
    // media_models is unmocked, so the call throws there. Reaching it is
    // the assertion: authorization let this caller through.
    await assert.rejects(() => createGeneration(generationRequest(), env, { id: 'user-1' }));
    assert.equal(seen.some((href) => href.includes('media_models')), true);
  });
});

test('non-numeric metrics score as zero instead of NaN', () => {
  const scored = scoreMetrics({ views: 'n/a', likes: 12, reach: undefined, retention_3s: 'x' });
  assert.equal(Number.isFinite(scored.score), true);
  for (const [name, value] of Object.entries(scored.components)) {
    assert.equal(Number.isFinite(value), true, `component ${name} is not finite`);
  }
});

test('negative metrics floor at zero', () => {
  const scored = scoreMetrics({ views: -500, likes: -10 });
  assert.equal(scored.score, 0);
});

test('ordinary metrics still score', () => {
  const scored = scoreMetrics({ views: 1000, likes: 50, comments: 4, shares: 2, retention_3s: 0.6 });
  assert.ok(scored.score > 0 && scored.score <= 100);
});
