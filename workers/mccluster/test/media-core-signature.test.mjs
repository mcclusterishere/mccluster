import test from 'node:test';
import assert from 'node:assert/strict';

import { signCoreRequest, signEdgeRequest } from '../../../core/src/broker-edge-auth.mjs';
import {
  __resetCoreNonces,
  houseOwnerActor,
  isCoreSigned,
  verifyCoreSignature
} from '../src/media/core-signature.js';

const SECRET = 'shared-core-edge-key';
const PATH = '/v1/media/mcp';
const env = { CORE_EDGE_SIGNING_KEY: SECRET, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

function signedRequest(payload, { signer = signCoreRequest, secret = SECRET, path = PATH, timestamp } = {}) {
  const body = JSON.stringify(payload);
  const headers = signer({ secret, method: 'POST', path, bodyBytes: Buffer.from(body), ...(timestamp ? { timestamp } : {}) });
  return { request: new Request(`https://api.mccluster.org${PATH}`, { method: 'POST', headers, body }), body };
}

async function verify(request, body, extra = {}) {
  return verifyCoreSignature({ request, env, path: PATH, bodyBytes: new TextEncoder().encode(body), ...extra });
}

test('a request signed by Core verifies on the Worker', async () => {
  __resetCoreNonces();
  const { request, body } = signedRequest({ method: 'tools/call', params: { name: 'media.models.search' } });
  assert.equal(isCoreSigned(request), true);
  assert.equal(await verify(request, body), true);
});

test('a replayed nonce is refused', async () => {
  __resetCoreNonces();
  const { request, body } = signedRequest({ method: 'tools/list' });
  await verify(request, body);
  await assert.rejects(verify(request, body), /already used/);
});

test('a body swapped after signing is refused', async () => {
  __resetCoreNonces();
  const { request } = signedRequest({ params: { name: 'media.models.search' } });
  await assert.rejects(verify(request, JSON.stringify({ params: { name: 'model3d.generate' } })), /digest mismatch/);
});

test('the wrong key is refused', async () => {
  __resetCoreNonces();
  const { request, body } = signedRequest({ method: 'tools/list' }, { secret: 'another-key' });
  await assert.rejects(verify(request, body), /not valid/);
});

test('a signature for another path is refused', async () => {
  __resetCoreNonces();
  const { request, body } = signedRequest({ method: 'tools/list' }, { path: '/v1/core/mcp' });
  await assert.rejects(verify(request, body), /not valid/);
});

test('a stale timestamp is refused', async () => {
  __resetCoreNonces();
  const { request, body } = signedRequest({ method: 'tools/list' }, { timestamp: new Date(Date.now() - 5 * 60_000).toISOString() });
  await assert.rejects(verify(request, body), /outside the accepted window/);
});

test('a Worker -> Core (edge) signature never passes as a Core signature', async () => {
  __resetCoreNonces();
  const { request, body } = signedRequest({ method: 'tools/list' }, { signer: signEdgeRequest });
  assert.equal(isCoreSigned(request), false);
  await assert.rejects(verify(request, body), /not valid/);
});

test('without the key configured the Worker fails closed', async () => {
  __resetCoreNonces();
  const { request, body } = signedRequest({ method: 'tools/list' });
  await assert.rejects(
    verifyCoreSignature({ request, env: { ...env, CORE_EDGE_SIGNING_KEY: '' }, path: PATH, bodyBytes: new TextEncoder().encode(body) }),
    (error) => error.status === 503
  );
});

function withOwners(owners, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/rest/v1/orgs?')) return new Response(JSON.stringify([{ id: 'house-org' }]), { status: 200 });
    if (href.includes('/rest/v1/org_members?')) {
      assert.match(href, /org_id=eq\.house-org/);
      assert.match(href, /role=eq\.owner/);
      return new Response(JSON.stringify(owners), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}

test('a verified Core call acts as the single house owner', async () => {
  await withOwners([{ profile_id: 'owner-1' }], async () => {
    assert.deepEqual(await houseOwnerActor(env), { id: 'owner-1', actor_source: 'core-signature' });
  });
});

test('zero or several house owners are refused, not guessed', async () => {
  await withOwners([], async () => { await assert.rejects(houseOwnerActor(env), /exactly one house owner/); });
  await withOwners([{ profile_id: 'a' }, { profile_id: 'b' }], async () => {
    await assert.rejects(houseOwnerActor(env), /exactly one house owner/);
  });
});
