/* core/src/compute/device-grant.mjs: the one-click opt-in grant, and js/device-node.js's signing matching Core's. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { issueGrant, verifyGrant, authorizeOwnerSession, enrollCredential, GRANT_TTL_MS } from '../../core/src/compute/device-grant.mjs';
import { canonicalRequest, nodeIdFromPublicKey } from '../../core/src/compute/signature.mjs';
import { ENROLLMENT_PINNED_LABELS, heartbeatLabels } from '../../core/src/compute/protocol.mjs';

const KEY = 'k'.repeat(32), ORG = '00000000-0000-4000-8000-00000000c0de', USER = '00000000-0000-4000-8000-0000000000a1';

test('a grant verifies, carries who and what, and expires in 15 minutes', () => {
  const now = 1_800_000_000_000;
  const g = issueGrant({ key: KEY, orgId: ORG, userId: USER, kind: 'browser', now });
  assert.match(g.grant, /^mccg1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(Date.parse(g.expires_at) - now, GRANT_TTL_MS);
  const c = verifyGrant(g.grant, { key: KEY, now: now + 1000 });
  assert.equal(c.org, ORG); assert.equal(c.sub, USER); assert.equal(c.kind, 'browser');
  assert.throws(() => verifyGrant(g.grant, { key: KEY, now: now + GRANT_TTL_MS + 1 }), (e) => e.code === 'GRANT_EXPIRED');
  assert.throws(() => verifyGrant(g.grant, { key: 'x'.repeat(32), now }), (e) => e.code === 'INVALID_GRANT');
  const [p, body, sig] = g.grant.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), org: '00000000-0000-4000-8000-00000000beef' })).toString('base64url');
  assert.throws(() => verifyGrant(`${p}.${forged}.${sig}`, { key: KEY, now }), (e) => e.code === 'INVALID_GRANT');
  assert.throws(() => verifyGrant('nope', { key: KEY }), (e) => e.code === 'INVALID_GRANT');
});

test('issuing refuses a weak key, a missing org or a bad kind', () => {
  assert.throws(() => issueGrant({ key: 'short', orgId: ORG, userId: USER }), (e) => e.code === 'AUTH_NOT_CONFIGURED');
  assert.throws(() => issueGrant({ key: KEY, orgId: '', userId: USER }), (e) => e.code === 'ORG_NOT_CONFIGURED');
  assert.throws(() => issueGrant({ key: KEY, orgId: ORG, userId: USER, kind: 'root' }), (e) => e.code === 'INVALID_GRANT_KIND');
});

test('only the owner gets a grant: session checked, then ops.use on the house org', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) return { ok: init.headers.authorization === 'Bearer good', json: async () => ({ id: USER }) };
    const b = JSON.parse(init.body);
    return { ok: true, json: async () => [{ allowed: b.p_actor === USER && b.p_capability === 'ops.use' && b.p_org === ORG }] };
  };
  const opts = { supabaseUrl: 'https://sb.example', apiKey: 'sb_secret_x', orgId: ORG, fetchImpl };
  assert.deepEqual(await authorizeOwnerSession('good', opts), { userId: USER });
  await assert.rejects(authorizeOwnerSession('bad', opts), (e) => e.status === 401);
  await assert.rejects(authorizeOwnerSession('', opts), (e) => e.status === 401);
  await assert.rejects(authorizeOwnerSession('good', { ...opts, orgId: '00000000-0000-4000-8000-00000000beef' }), (e) => e.status === 403);
  assert.deepEqual(enrollCredential({ 'x-mccluster-enroll-grant': ' g ' }), { grant: 'g' });
  assert.deepEqual(enrollCredential({}), { token: true });
});

test('who opted a device in is pinned: a heartbeat cannot rewrite or invent it', () => {
  for (const k of ['opted_in_by', 'enrolled_via', 'enrolled_grant']) assert.ok(ENROLLMENT_PINNED_LABELS.includes(k), k);
  const stored = { trust: 'owned', role: 'browser-phone', opted_in_by: USER, enrolled_via: 'browser', enrolled_grant: 'n'.repeat(24) };
  const out = heartbeatLabels(stored, { ...stored, opted_in_by: 'someone', enrolled_via: 'website', site: 'browser' });
  assert.equal(out.opted_in_by, USER); assert.equal(out.enrolled_via, 'browser'); assert.equal(out.site, 'browser');
  assert.equal(heartbeatLabels({ trust: 'owned' }, { opted_in_by: USER }).opted_in_by, undefined, 'a token-enrolled node cannot claim it');
});

test('the browser node signs exactly what Core verifies, and names itself the way Core does', () => {
  const D = createRequire(import.meta.url)('../../js/device-node.js');
  const args = ['POST', '/v1/compute/heartbeat', 'node_' + 'a'.repeat(32), '2026-11-24T00:00:00.000Z', crypto.randomUUID(), 'digest'];
  assert.equal(D._test.canonical(...args), canonicalRequest({ method: args[0], path: args[1], nodeId: args[2], timestamp: args[3], nonce: args[4], digest: args[5] }));
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const browserPem = D._test.pem(spki);
  assert.equal(nodeIdFromPublicKey(browserPem), nodeIdFromPublicKey(publicKey.export({ type: 'spki', format: 'pem' }).toString()));
  assert.deepEqual(D._test.capabilities({}), [], 'no runner, no advertised work');
  assert.deepEqual(D._test.labels({ mobile: true }), { trust: 'owned', role: 'browser-phone', site: 'browser' });
});

test('the gateway takes a grant at enrol, owner-only grants, and an allowlisted origin, never a wildcard', () => {
  const src = readFileSync(new URL('../../core/src/compute/gateway.mjs', import.meta.url), 'utf8');
  assert.match(src, /url\.pathname === '\/v1\/compute\/device-grants' && req\.method === 'POST'\) \{\s*const orgId = process\.env\.MCCLUSTER_ORG_ID;\s*const \{ userId \} = await authorizeOwnerSession/);
  assert.match(src, /if \(credential\.grant\) claims = verifyGrant\(credential\.grant/);
  assert.match(src, /else requireSecret\(req, 'CORE_COMPUTE_ENROLL_TOKEN', 'Compute enrollment'\);/);
  assert.match(src, /code: 'GRANT_USED'/);
  assert.doesNotMatch(src, /access-control-allow-origin', '\*'/);
});
