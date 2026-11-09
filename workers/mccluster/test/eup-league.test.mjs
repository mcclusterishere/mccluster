// E=Up League Worker contract with a fake service REST: owner-only routing, request shaping,
// idempotency/revision requirements, SQLSTATE mapping, and no reach into held consumer paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEup } from '../src/eup/router.js';
import { CAMPAIGN_FIXTURE } from '../src/eup/league-fixture.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', ALLOWED_ORIGINS: 'https://matthew.mccluster.org' };
const owner = async () => ({ id: OWNER });
const req = (path, init) => new Request(`https://fixture.invalid/v1/eup/${path}`, init);
const post = (path, body) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function fake(reply) {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url: String(url), body: JSON.parse(options.body) }); return typeof reply === 'function' ? reply(calls.at(-1)) : Response.json(reply); };
  return { calls, fetchImpl };
}

test('mutations require an idempotency key and never reach storage without one', async () => {
  const { calls, fetchImpl } = fake({});
  const r = await handleEup(post('league/campaigns', { campaign: { slug: 'x-y', title: 't', purpose: 'p' } }), env, { requireHouseOwner: owner, fetchImpl });
  assert.equal(r.status, 400); assert.equal((await r.json()).reason, 'idempotency_key_required'); assert.equal(calls.length, 0);
  const bad = await handleEup(post(`league/campaigns/${ID}/transition`, { idempotency_key: 'route-key-0001', to: 'released' }), env, { requireHouseOwner: owner, fetchImpl });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).reason, 'expected_revision_required'); assert.equal(calls.length, 0);
});

test('every league command goes to the one service RPC with the acting owner, nothing else', async () => {
  const { calls, fetchImpl } = fake({ id: ID, state: 'draft', revision: 1 });
  const r = await handleEup(post('league/campaigns', { idempotency_key: 'route-key-0002', campaign: { slug: 'x-y', title: 't', purpose: 'p' } }), env, { requireHouseOwner: owner, fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://fixture.invalid/rest/v1/rpc/eup_league_command');
  assert.deepEqual(calls[0].body, { p_action: 'campaigns.create', p_actor: OWNER, p_id: '', p_document: { slug: 'x-y', title: 't', purpose: 'p' }, p_revision: null, p_key: 'route-key-0002' });
  await handleEup(req('league/applications?mission=' + ID + '&status=submitted'), env, { requireHouseOwner: owner, fetchImpl });
  await handleEup(post(`league/applications/${ID}/decision`, { idempotency_key: 'route-key-0003', expected_revision: 1, decision: 'approved', reason: 'ok' }), env, { requireHouseOwner: owner, fetchImpl });
  await handleEup(post(`league/proofs/${ID}/review`, { idempotency_key: 'route-key-0004', proof_revision: 2, decision: 'needs_changes' }), env, { requireHouseOwner: owner, fetchImpl });
  await handleEup(post(`league/proofs/${ID}/consent`, { idempotency_key: 'route-key-0005', proof_revision: 2, consent: { purpose: 'publish_proof', audience: 'public', notice_revision: 'n1', granted: true } }), env, { requireHouseOwner: owner, fetchImpl });
  assert.ok(calls.every((c) => c.url.endsWith('/rest/v1/rpc/eup_league_command')), 'no held consumer path (action_environment, network_groups, world_environment) is ever requested');
  assert.deepEqual(calls.map((c) => c.body.p_action), ['campaigns.create', 'applications.list', 'applications.decide', 'proofs.review', 'consents.set']);
  assert.deepEqual(calls[1].body.p_document, { status: 'submitted' });
  assert.equal(calls[3].body.p_revision, 2);
});

test('SQLSTATEs map to actionable statuses and reasons', async () => {
  const cases = [['40001', 409, 'revision_conflict'], ['EU001', 409, 'capacity_exhausted'], ['EU002', 403, 'self_review_denied'], ['EU003', 409, 'idempotency_conflict'], ['P0002', 404, 'not_found'], ['22023', 422, 'invalid'], ['42501', 403, 'owner_required'], ['XX000', 503, 'storage_unavailable']];
  for (const [code, status, reason] of cases) {
    const { fetchImpl } = fake(() => Response.json({ code, message: 'synthetic' }, { status: 400 }));
    const r = await handleEup(post(`league/campaigns/${ID}/transition`, { idempotency_key: 'route-key-0006', expected_revision: 1, to: 'paused' }), env, { requireHouseOwner: owner, fetchImpl });
    assert.equal(r.status, status, code); assert.equal((await r.json()).reason, reason, code);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  }
});

test('an unapplied schema is reported, not hidden', async () => {
  const { fetchImpl } = fake(() => Response.json({ code: 'PGRST202', message: 'Could not find the function public.eup_league_command' }, { status: 404 }));
  const r = await handleEup(req('league/campaigns'), env, { requireHouseOwner: owner, fetchImpl });
  assert.equal(r.status, 503); assert.equal((await r.json()).reason, 'schema_not_applied');
  const none = await handleEup(req('league/campaigns'), { ALLOWED_ORIGINS: env.ALLOWED_ORIGINS }, { requireHouseOwner: owner, fetchImpl });
  assert.equal(none.status, 503); assert.equal((await none.json()).reason, 'storage_unavailable');
});

test('publication, broadcast, points and payouts are explicitly not implemented', async () => {
  const { calls, fetchImpl } = fake({});
  for (const p of ['publish', 'broadcast', 'points', 'payouts']) {
    const r = await handleEup(post(`league/${p}`, {}), env, { requireHouseOwner: owner, fetchImpl });
    assert.equal(r.status, 501); assert.equal((await r.json()).reason, 'not_implemented');
  }
  assert.equal(calls.length, 0);
});

test('the fixture catalogue is unpublished, unpriced and policy-free', async () => {
  const { fetchImpl } = fake({});
  const r = await handleEup(req('league/fixture'), env, { requireHouseOwner: owner, fetchImpl });
  const { fixture } = await r.json();
  assert.equal(fixture.audience, 'admin_preview'); assert.equal(fixture.points_policy, null); assert.equal(fixture.payment_policy, null);
  assert.equal(fixture.live_broadcast_enabled, false); assert.equal(fixture.missions[0].slug, 'write-a-song');
  assert.equal(CAMPAIGN_FIXTURE.missions.length, 5);
  assert.ok(CAMPAIGN_FIXTURE.missions.every((m) => !('points' in m) && !('price' in m) && !('start' in m)));
});

test('overview reports held, dormant and partial modules and never claims live data', async () => {
  const { fetchImpl } = fake((call) => call.body.p_action === 'overview' ? Response.json({ campaigns: { drafts: 2, released: 0 }, queues: { applications: 1, proofs: 0, reviews: 0 }, latest_change: '2026-11-09T12:00:00Z' }) : Response.json({}));
  const r = await handleEup(req('overview'), env, { requireHouseOwner: owner, fetchImpl, now: () => 0 });
  const o = await r.json();
  assert.equal(r.status, 200);
  const state = Object.fromEntries(o.modules.map((m) => [m.id, m.state]));
  assert.equal(state.consumer_environment, 'held'); assert.equal(state.arcade, 'dormant'); assert.equal(state.c5, 'partial'); assert.equal(state.league, 'draft');
  assert.equal(o.campaigns.drafts, 2); assert.equal(o.queues.applications, 1); assert.equal(o.geography.selected, null);
  assert.ok(o.blockers.some((b) => b.id === 'points_payment_unset'));
  const broken = fake(() => Response.json({ code: 'PGRST202', message: 'Could not find the function' }, { status: 404 }));
  const r2 = await handleEup(req('overview'), env, { requireHouseOwner: owner, fetchImpl: broken.fetchImpl });
  const o2 = await r2.json();
  assert.equal(r2.status, 200); assert.ok(o2.blockers.some((b) => b.id === 'league_schema' && b.gate === 'schema'));
  assert.equal(o2.freshness.find((f) => f.id === 'league').state, 'unknown');
});
