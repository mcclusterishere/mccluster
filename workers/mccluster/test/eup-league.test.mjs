// E=Up League Worker: the owner routes, and every row of the contract's ROUTES (both surfaces) walked as a table,
// against a stubbed plane (./support/eup-league-rpc-double.mjs: the three League RPCs answered per test, storage by
// the media lane's double). What this proves is the Worker's half: routing, what is required before any RPC, request
// shaping, actor binding, the SQLSTATE mapping and the media order. The SQL is proven by
// scripts/test/eup-league.integration.mjs, and these routes against the real SQL by the journey lane.
//
// Rewritten on purpose to the frozen contract (workers/mccluster/src/eup/league-contract.js). Pinned assertions of the
// previous version that changed, and why:
//   - POST proofs/:id/review took { proof_revision, decision } and sent p_revision = proof_revision with
//     { decision }. The contract sends p_revision from expected_revision on every route ("one name for one meaning")
//     and the review document is the three dimension decisions plus asset_revision in a `review` wrapper; the old
//     body now answers 400 expected_revision_required before any RPC.
//   - POST proofs/:id/consent (owner, action consents.set) is gone: consent is the participant's own action
//     (member POST proofs/:id/consent, consents.grant). The old owner path now answers 404.
//   - The pinned p_action list ['campaigns.create', 'applications.list', 'applications.decide', 'proofs.review',
//     'consents.set'] became [..., 'proofs.review', 'missions.update'] (PATCH missions/:id replaces PUT).
//   - Overview: queues and campaign counts are null, not 0, when the read did not return them, and the answer gains
//     `league` (missions, League policy readiness, audience) with blockers for a missing policy and audience.
// Every other pinned assertion is kept with its meaning (key and revision before any RPC, the one service RPC,
// the SQLSTATE rows that existed, schema_not_applied, the 501 segments, the fixture, the overview postures).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleEup } from '../src/eup/router.js';
import { CAMPAIGN_FIXTURE } from '../src/eup/league-fixture.js';
import * as C from '../src/eup/league-contract.js';
import { MODULE_POLICY_ERRORS } from '../src/eup/modules.js';
import { leaguePlane, identities, sqlError, sampleShape, uploadRow, pathOf, sealedRow, U, OWNER, MEMBER, TENANT, SHA, T0, AT, env, ORIGIN, MEMBER_TOKEN, NAMES, TABLES, DATABASE_TEXT } from './support/eup-league-rpc-double.mjs';

const KEY = 'fixture-key-0001';
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WEBM = C.bytesFromHex(C.MAGIC_VECTORS.find((v) => v.name === 'webm').hex); // 16 bytes

/* One request through the real router. Owner routes take the owner identity; member routes the member bearer. */
async function send(plane, path, { method = 'GET', body, raw, headers = {}, ids = identities(), bearer = path.startsWith(C.PREFIX.member) ? MEMBER_TOKEN : null, rpcTimeoutMs } = {}) {
  const init = { method, headers: { origin: ORIGIN, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers } };
  if (body !== undefined || raw !== undefined) {
    init.body = raw ?? JSON.stringify(body);
    if (!Object.keys(init.headers).some((h) => h.toLowerCase() === 'content-type')) init.headers['content-type'] = 'application/json';
  }
  const response = await handleEup(new Request(`https://api.mccluster.org${path}`, init), env, { requireHouseOwner: ids.requireHouseOwner, authUser: ids.authUser, fetchImpl: plane.fetchImpl, now: () => T0, rpcTimeoutMs });
  return { response, status: response.status, body: await response.json(), ids };
}
const owner = (rest) => `${C.PREFIX.owner}/${rest}`;

/* ------------------------------------------------------------------ kept: key and revision before any RPC */

test('mutations require an idempotency key and never reach storage without one', async () => {
  const plane = leaguePlane();
  const r = await send(plane, owner('campaigns'), { method: 'POST', body: { campaign: { slug: 'x-y', title: 't', purpose: 'p' } } });
  assert.equal(r.status, 400); assert.equal(r.body.reason, 'idempotency_key_required'); assert.equal(plane.all().length, 0);
  const bad = await send(plane, owner(`campaigns/${ID}/transition`), { method: 'POST', body: { idempotency_key: 'route-key-0001', to: 'released' } });
  assert.equal(bad.status, 400); assert.equal(bad.body.reason, 'expected_revision_required'); assert.equal(plane.all().length, 0);
});

/* Review 2026-11-10: when the house-owner check itself fails (no house organisation, an upstream 5xx, a network
   failure), an owner route answered 503 "unavailable" or 500 "error", reasons the contract does not list. */
test('an owner check that cannot answer is 503 authorization_unavailable, a reason the contract lists; 401 and 403 pass through', async () => {
  const plane = leaguePlane();
  const failing = (error) => ({ ...identities(), requireHouseOwner: async () => { throw error; } });
  for (const [label, error] of [['no house organisation', Object.assign(new Error('McCluster house organization is not configured'), { status: 503 })],
    ['an upstream 500', Object.assign(new Error('upstream'), { status: 500 })], ['a network failure', new TypeError('fetch failed')]]) {
    const r = await send(plane, owner('policy'), { ids: failing(error) });
    assert.deepEqual([r.status, r.body.reason], [503, 'authorization_unavailable'], label);
    assert.ok(Object.hasOwn(C.HTTP_REASONS, r.body.reason) && C.HTTP_REASONS[r.body.reason] === r.status, `${label}: the contract lists the answer`);
    assert.doesNotMatch(JSON.stringify(r.body), /configured|upstream|fetch failed/, `${label}: no upstream text`);
  }
  for (const [status, reason] of [[401, 'authentication_required'], [403, 'owner_required']]) {
    const r = await send(plane, owner('policy'), { ids: failing(Object.assign(new Error('refused'), { status })) });
    assert.deepEqual([r.status, r.body.reason], [status, reason]);
  }
  assert.equal(plane.all().length, 0, 'no RPC and no storage call');
});

/* ------------------------------------------------------------------ rewritten: request shaping */

test('every owner command goes to the one owner RPC with the acting owner, shaped by the route table', async () => {
  const plane = leaguePlane();
  const r = await send(plane, owner('campaigns'), { method: 'POST', body: { idempotency_key: 'route-key-0002', campaign: { slug: 'x-y', title: 't', purpose: 'p' } } });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.ok(r.body.campaign);
  const [first] = plane.rpc();
  assert.equal(first.name, 'eup_league_command');
  assert.deepEqual(first.body, { p_action: 'campaigns.create', p_actor: OWNER, p_id: '', p_document: { slug: 'x-y', title: 't', purpose: 'p' }, p_revision: null, p_key: 'route-key-0002' });
  assert.deepEqual(Object.keys(first.body), [...C.RPC_ARGUMENTS.owner], 'the arguments, in the contract order, and nothing else');
  assert.deepEqual([first.method, first.redirect, first.signal, first.headers.apikey, first.headers.authorization], ['POST', 'manual', true, env.SUPABASE_SERVICE_ROLE_KEY, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`]);
  await send(plane, owner(`applications?mission=${ID}&status=submitted`));
  await send(plane, owner(`applications/${ID}/decision`), { method: 'POST', body: { idempotency_key: 'route-key-0003', expected_revision: 1, decision: 'approved', reason: 'ok', ignored: 'not a field of this route' } });
  const review = { asset_revision: SHA, mission_decision: 'pass', rights_decision: 'changes', safety_decision: 'pass', reason: 'Test fixture: the second verse needs a credit.' };
  await send(plane, owner(`proofs/${ID}/review`), { method: 'POST', body: { idempotency_key: 'route-key-0004', expected_revision: 2, review } });
  await send(plane, owner(`missions/${ID.toUpperCase()}`), { method: 'PATCH', body: { idempotency_key: 'route-key-0005', expected_revision: 3, mission: { capacity: 5 } } });
  const calls = plane.rpc();
  assert.ok(calls.every((c) => c.name === 'eup_league_command' && c.body.p_actor === OWNER), 'one function, the acting owner, no held consumer path');
  assert.deepEqual(calls.map((c) => c.body.p_action), ['campaigns.create', 'applications.list', 'applications.decide', 'proofs.review', 'missions.update']);
  assert.deepEqual([calls[1].body.p_id, calls[1].body.p_document, calls[1].body.p_key], [ID, { status: 'submitted' }, null]);
  assert.deepEqual([calls[2].body.p_document, calls[2].body.p_revision], [{ decision: 'approved', reason: 'ok' }, 1], 'only the route\'s fields are sent');
  assert.deepEqual([calls[3].body.p_document, calls[3].body.p_revision], [review, 2], 'p_revision is expected_revision, the document is the review');
  assert.deepEqual([calls[4].body.p_id, calls[4].body.p_document, calls[4].body.p_revision], [ID, { capacity: 5 }, 3], 'path ids are lower-cased');
  assert.equal(plane.storageCalls().length, 0);
});

test('participant actions left the owner surface, the old review body is refused, and no PUT route remains', async () => {
  const plane = leaguePlane();
  for (const [method, rest, body] of [
    ['POST', `assignments/${ID}/accept`, { idempotency_key: KEY, expected_revision: 1 }],
    ['POST', `assignments/${ID}/proofs`, { idempotency_key: KEY, proof: {} }],
    ['POST', `proofs/${ID}/consent`, { idempotency_key: KEY, proof_revision: 2, consent: { purpose: 'publish_proof', audience: 'public', notice_revision: 'n1', granted: true } }],
    ['PUT', `missions/${ID}`, { idempotency_key: KEY, expected_revision: 1, mission: { title: 'x' } }]
  ]) {
    const r = await send(plane, owner(rest), { method, body });
    assert.equal(r.status, 404, `${method} ${rest}`); assert.equal(r.body.reason, 'not_found');
  }
  const old = await send(plane, owner(`proofs/${ID}/review`), { method: 'POST', body: { idempotency_key: KEY, proof_revision: 2, decision: 'needs_changes' } });
  assert.equal(old.status, 400); assert.equal(old.body.reason, 'expected_revision_required');
  assert.equal(plane.all().length, 0);
});

/* ------------------------------------------------------------------ SQLSTATE mapping */

test('SQLSTATEs map to the contract\'s owner statuses and reasons, EUM codes to the shared module table, and no database text is shown', async () => {
  const cases = [['40001', 409, 'revision_conflict'], ['40P01', 409, 'retry_conflict'], ['EU001', 409, 'capacity_exhausted'], ['EU002', 403, 'self_review_denied'],
    ['EU003', 409, 'idempotency_conflict'], ['P0002', 404, 'not_found'], ['22023', 422, 'invalid'], ['23505', 409, 'exists'], ['23514', 422, 'invalid'],
    ['42501', 403, 'owner_required'], ['EU010', 503, 'policy_unavailable'], ['EU011', 422, 'audience_not_released'], ['EU012', 403, 'entitlement_required'],
    ['EU013', 409, 'requirements_changed'], ['EU014', 409, 'media_binding'], ['EU015', 409, 'consent_scope'], ['EU016', 409, 'moderation_hold'], ['EU017', 429, 'rate_limited'],
    ['PGRST202', 503, 'schema_not_applied'], ['XX000', 503, 'storage_unavailable'], ['0A000', 503, 'storage_unavailable'], ['', 503, 'storage_unavailable']];
  for (const code of ['EUM00', 'EUM01', 'EUM02', 'EUM03', 'EUM04', '55P03', '57014']) {
    assert.equal(C.errorFor(code, 'owner'), null, `${code} is not the contract's to map`);
    cases.push([code, ...MODULE_POLICY_ERRORS.guard[code]]);
  }
  for (const [code, status, reason] of cases) {
    const plane = leaguePlane({ answer: () => sqlError(code) });
    const r = await send(plane, owner(`campaigns/${ID}/transition`), { method: 'POST', body: { idempotency_key: 'route-key-0006', expected_revision: 1, to: 'paused' } });
    assert.equal(r.status, status, code); assert.equal(r.body.reason, reason, code); assert.equal(r.body.ok, false, code);
    assert.equal(r.response.headers.get('cache-control'), 'private, no-store');
    assert.doesNotMatch(JSON.stringify(r.body), /database text/, code);
    assert.equal(plane.rpc().length, 1, `${code}: one call, no retry`);
  }
  /* The draining and disabled answers say what still works (DECISIONS 10c). */
  const draining = await send(leaguePlane({ answer: () => sqlError('EUM02') }), owner('campaigns'), { method: 'POST', body: { idempotency_key: KEY, campaign: { slug: 'x-y', title: 't', purpose: 'p' } } });
  assert.match(draining.body.error, /new work is stopped/);
});

test('an unapplied schema is reported, not hidden', async () => {
  const plane = leaguePlane({ answer: () => Response.json({ code: 'PGRST202', message: 'Could not find the function public.eup_league_command' }, { status: 404 }) });
  const r = await send(plane, owner('campaigns'));
  assert.equal(r.status, 503); assert.equal(r.body.reason, 'schema_not_applied'); assert.match(r.body.error, /eup_league_v1\.sql/);
  const none = await handleEup(new Request(`https://api.mccluster.org${owner('campaigns')}`), { ALLOWED_ORIGINS: ORIGIN }, { requireHouseOwner: identities().requireHouseOwner, fetchImpl: plane.fetchImpl });
  assert.equal(none.status, 503); assert.equal((await none.json()).reason, 'storage_unavailable');
});

test('a timeout, a redirect, an unreachable store and a malformed answer are 503 with no data', async () => {
  const hang = leaguePlane({ answer: (call) => new Promise(() => {}) });
  const started = Date.now();
  const r = await send(hang, owner('campaigns'), { rpcTimeoutMs: 40 });
  assert.equal(r.status, 503); assert.equal(r.body.reason, 'storage_unavailable'); assert.ok(Date.now() - started < 5000);
  assert.deepEqual(Object.keys(r.body).sort(), ['error', 'ok', 'reason']);
  const answers = [
    ['a redirect', () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid/' } })],
    ['a redirect carrying an error body', () => Response.json({ code: '40001', message: 'x' }, { status: 303, headers: { location: 'https://elsewhere.invalid/' } })],
    ['not JSON', () => new Response('<html>gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['an empty body', () => new Response('', { status: 200 })],
    ['an object where a list is promised', () => ({ campaigns: [] })],
    ['null', () => Response.json(null)],
    ['a failed fetch', () => { throw new Error('offline'); }],
    ['a gateway error', () => new Response('bad gateway', { status: 502 })]
  ];
  for (const [label, answer] of answers) {
    const plane = leaguePlane({ answer });
    const out = await send(plane, owner('campaigns'));
    assert.equal(out.status, 503, label); assert.equal(out.body.reason, 'storage_unavailable', label);
    assert.equal(out.body.campaigns, undefined, `${label}: no data`);
    assert.doesNotMatch(JSON.stringify(out.body), /gateway|elsewhere|offline/, label);
  }
  /* A mutation result that is not the object the action promises is not shown as success either. */
  const list = await send(leaguePlane({ answer: () => [] }), owner('campaigns'), { method: 'POST', body: { idempotency_key: KEY, campaign: { slug: 'x-y', title: 't', purpose: 'p' } } });
  assert.equal(list.status, 503);
});

/* ------------------------------------------------------------------ refused before any RPC */

test('the contract\'s document check runs before any RPC: a wrong request is 422 and costs no call', async () => {
  const plane = leaguePlane();
  const refusals = [
    ['POST', 'campaigns', { idempotency_key: KEY, campaign: { slug: 'x-y', title: 't', purpose: 'p', audience: 'public' } }],
    ['POST', 'campaigns', { idempotency_key: KEY, campaign: { slug: 'x-y', title: 't', purpose: 'p', points: 10 } }],
    ['POST', 'campaigns', { idempotency_key: KEY, campaign: 'x-y' }],
    ['POST', 'campaigns', { idempotency_key: KEY }],
    ['POST', `campaigns/${ID}/audience`, { idempotency_key: KEY, expected_revision: 1, audience: 'members' }],
    ['POST', `campaigns/${ID}/transition`, { idempotency_key: KEY, expected_revision: 1, to: 'published' }],
    ['PATCH', `missions/${ID}`, { idempotency_key: KEY, expected_revision: 1, mission: {} }],
    ['POST', `applications/${ID}/decision`, { idempotency_key: KEY, expected_revision: 1, decision: 'declined' }],
    ['POST', `proofs/${ID}/publication`, { idempotency_key: KEY, expected_revision: 1, decision: 'published' }],
    ['POST', 'policy', { idempotency_key: KEY, expected_revision: 0, policy: { entitlement: 'paid' }, reason: 'x' }],
    ['GET', 'applications?status=bogus'], ['GET', 'media/due?limit=abc'], ['GET', 'media/due?limit=0'], ['GET', 'outbox?consumer=Bad%20Consumer']
  ];
  for (const [method, rest, body] of refusals) {
    const r = await send(plane, owner(rest), { method, body });
    assert.equal(r.status, 422, `${method} ${rest}`); assert.equal(r.body.reason, 'invalid', `${method} ${rest}`);
  }
  for (const rest of [`missions?campaign=not-a-uuid`, `applications/not-a-uuid/decision`, `proofs/${ID}x/media?revision=1`, 'outbox/0/ack']) {
    const r = await send(plane, owner(rest), { method: rest.endsWith('ack') || rest.endsWith('decision') ? 'POST' : 'GET', body: rest.endsWith('ack') || rest.endsWith('decision') ? { idempotency_key: KEY, expected_revision: 1, consumer: 'c', decision: 'approved' } : undefined });
    assert.equal(r.status, 404, rest); assert.equal(r.body.reason, 'not_found', rest);
  }
  for (const rest of [`proofs/${ID}/media`, `proofs/${ID}/media?revision=x`, `proofs/${ID}/media?revision=0`]) {
    const r = await send(plane, owner(rest));
    assert.equal(r.status, rest.endsWith('=0') ? 422 : 400, rest); assert.equal(r.body.reason, rest.endsWith('=0') ? 'invalid' : 'expected_revision_required', rest);
  }
  assert.equal(plane.all().length, 0);
});

test('publication beyond the audience, broadcast, points and payouts are not implemented on every method and path', async () => {
  const plane = leaguePlane();
  for (const p of C.NOT_IMPLEMENTED_SEGMENTS) {
    for (const [method, rest] of [['POST', p], ['GET', p], ['PATCH', `${p}/${ID}`], ['POST', `${p}/x/y`]]) {
      const r = await send(plane, owner(rest), { method, body: method === 'GET' ? undefined : {} });
      assert.equal(r.status, 501, `${method} ${rest}`); assert.equal(r.body.reason, 'not_implemented');
    }
  }
  assert.deepEqual([...C.NOT_IMPLEMENTED_SEGMENTS], ['publish', 'broadcast', 'points', 'payouts']);
  assert.equal(plane.all().length, 0);
});

test('the League Worker names no public projection, no held consumer path, no other bucket and no second RPC', () => {
  const files = ['league.js', 'league-member.js', 'league-media.js'].map((f) => [f, readFileSync(new URL(`../src/eup/${f}`, import.meta.url), 'utf8')]);
  for (const [file, text] of files) {
    assert.doesNotMatch(text, /\b(action_missions|action_proofs|action_cohorts|action_policy_bills|network_posts|network_media_assets|network_groups|world_environment\w*|mnet-media)\b/, file);
    assert.doesNotMatch(text, /rest\/v1\/(?!rpc\/)/, `${file}: no table read or write`);
    assert.doesNotMatch(text, /console\.|logEvent/, `${file}: nothing is logged`);
  }
  assert.deepEqual(Object.values(C.RPC).sort(), ['eup_league_command', 'eup_league_media_seal', 'eup_league_member_command']);
  assert.equal(C.MEDIA.bucket, 'equity-uprise-private');
});

test('the fixture catalogue is unpublished, unpriced and policy-free', async () => {
  const plane = leaguePlane();
  const { body } = await send(plane, owner('fixture'));
  const { fixture } = body;
  assert.equal(fixture.audience, 'admin_preview'); assert.equal(fixture.points_policy, null); assert.equal(fixture.payment_policy, null);
  assert.equal(fixture.live_broadcast_enabled, false); assert.equal(fixture.missions[0].slug, 'write-a-song');
  assert.equal(CAMPAIGN_FIXTURE.missions.length, 5);
  assert.ok(CAMPAIGN_FIXTURE.missions.every((m) => !('points' in m) && !('price' in m) && !('start' in m)));
  assert.equal(plane.all().length, 0, 'a static answer, no RPC');
});

/* ------------------------------------------------------------------ overview: League counts and blockers */

const overviewOf = async (leagueAnswer) => {
  const plane = leaguePlane({ answer: (call) => (call.name === 'eup_league_command' ? leagueAnswer(call) : Response.json({ message: 'denied' }, { status: 403 })) });
  const r = await send(plane, '/v1/eup/overview');
  return { ...r, plane };
};

test('overview reports held, dormant and partial modules and never claims live data', async () => {
  const { status, body: o } = await overviewOf((call) => (call.body.p_action === 'overview' ? { campaigns: { drafts: 2, released: 0 }, queues: { applications: 1, proofs: 0, reviews: 0 }, latest_change: '2026-11-09T12:00:00Z' } : {}));
  assert.equal(status, 200);
  const state = Object.fromEntries(o.modules.map((m) => [m.id, m.state]));
  assert.equal(state.consumer_environment, 'held'); assert.equal(state.arcade, 'dormant'); assert.equal(state.c5, 'partial'); assert.equal(state.league, 'draft');
  assert.equal(o.campaigns.drafts, 2); assert.equal(o.queues.applications, 1); assert.equal(o.geography.selected, null);
  assert.ok(o.blockers.some((b) => b.id === 'points_payment_unset'));
  const broken = await overviewOf(() => Response.json({ code: 'PGRST202', message: 'Could not find the function' }, { status: 404 }));
  assert.equal(broken.status, 200); assert.ok(broken.body.blockers.some((b) => b.id === 'league_schema' && b.gate === 'schema'));
  assert.equal(broken.body.freshness.find((f) => f.id === 'league').state, 'unknown');
});

test('overview: League counts are what the read returned (null when not returned), with the League policy and audience beside the module policy', async () => {
  const full = { campaigns: { drafts: 1, released: 1, paused: 0, withdrawn: 0 }, missions: { drafts: 0, released: 1 }, queues: { applications: 2, proofs: 1, reviews: 0, appeals: null, media_due: null },
    policy: { present: true, valid: true, media_enabled: true, revision: 3 }, audience: { invited_campaigns: 1, open_grants: 2 }, latest_change: '2026-11-10T11:00:00Z' };
  const { body, plane } = await overviewOf(() => full);
  const read = plane.rpc().filter((c) => c.name === 'eup_league_command');
  assert.equal(read.length, 1); assert.deepEqual(read[0].body, { p_action: 'overview', p_actor: OWNER, p_id: '', p_document: null, p_revision: null, p_key: null });
  assert.deepEqual(body.campaigns, full.campaigns); assert.deepEqual(body.queues, full.queues, 'appeals and media_due stay null: not computed is not zero');
  assert.deepEqual(body.league, { status: 'available', reason: null, missions: full.missions, policy: full.policy, audience: full.audience, latest_change: full.latest_change });
  assert.ok(!body.blockers.some((b) => b.id.startsWith('league_')), 'nothing blocks a member run');
  assert.ok(body.modules.find((m) => m.id === 'league').policy, 'the persisted module policy field is kept beside it');

  const fresh = await overviewOf(() => ({ ...full, policy: { present: false, valid: false, media_enabled: false, revision: 0 }, audience: { invited_campaigns: 0, open_grants: 0 } }));
  assert.deepEqual(fresh.body.blockers.filter((b) => b.id.startsWith('league_')).map((b) => [b.id, b.gate]), [['league_policy_missing', 'owner_decision'], ['league_audience_admin_preview', 'owner_decision']]);
  const mediaOff = await overviewOf(() => ({ ...full, policy: { present: true, valid: true, media_enabled: false, revision: 4 }, audience: { invited_campaigns: 2, open_grants: 0 } }));
  assert.deepEqual(mediaOff.body.blockers.filter((b) => b.id.startsWith('league_')).map((b) => b.id), ['league_media_disabled', 'league_audience_no_grants']);
  assert.match(mediaOff.body.blockers.find((b) => b.id === 'league_media_disabled').text, /accommodation path does not need media/);
  for (const b of [...fresh.body.blockers, ...mediaOff.body.blockers].filter((x) => x.id.startsWith('league_'))) assert.doesNotMatch(b.text, /pay|purchase|upgrade|subscri|price/i, 'no League blocker suggests that paying admits anyone');

  const thin = await overviewOf(() => ({ campaigns: { drafts: 'x', released: -1 }, queues: { applications: 1.5 }, policy: { present: 'yes' } }));
  assert.deepEqual(thin.body.campaigns, { drafts: null, released: null, paused: null, withdrawn: null });
  assert.deepEqual(thin.body.queues, { applications: null, proofs: null, reviews: null, appeals: null, media_due: null });
  assert.deepEqual(thin.body.league.policy, { present: null, valid: null, media_enabled: null, revision: null });
  assert.ok(!thin.body.blockers.some((b) => b.id.startsWith('league_')), 'an unknown fact blocks nothing and claims nothing');

  const failed = await overviewOf(() => sqlError('XX000'));
  assert.deepEqual(failed.body.campaigns, { drafts: null, released: null, paused: null, withdrawn: null }, 'a failed read is never shown as zero');
  assert.deepEqual([failed.body.league.status, failed.body.league.reason], ['unavailable', 'storage_unavailable']);
  assert.ok(failed.body.blockers.some((b) => b.id === 'league_schema'));
});

/* ------------------------------------------------------------------ owner media: review read and purge */

test('review read: proofs.get at the revision asked for, then one signed read per listed upload, held and stale refused first', async () => {
  let proof = null;
  const plane = leaguePlane({ answer: () => proof });
  const audio = uploadRow({ id: U(20), assignment_id: U(7) });
  plane.storage.store(pathOf(audio), WEBM, { contentType: 'audio/webm' });
  const sealed = sealedRow(plane.storage, audio, SHA);
  proof = { ...sampleShape('proof_with_media'), id: U(7), tenant: TENANT, assignment_id: U(7), participant: MEMBER, revision: 2, moderation_state: 'clear',
    media: [{ upload_id: sealed.id, kind: 'audio', mime: 'audio/webm', bytes: sealed.bytes, sha256: SHA }], uploads: [sealed] };
  const r = await send(plane, owner(`proofs/${U(7)}/media?revision=2`));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(plane.rpc().map((c) => [c.body.p_action, c.body.p_document]), [['proofs.get', { revision: 2, media: true }]]);
  assert.equal(r.body.proof.id, U(7));
  assert.deepEqual(r.body.media.map((m) => [m.upload_id, m.expires_in]), [[sealed.id, 300]]);
  assert.match(r.body.media[0].url, /\/storage\/v1\/object\/sign\/equity-uprise-private\/league\/v1\/t\//);
  for (const [code, status, reason] of [['EU016', 409, 'moderation_hold'], ['40001', 409, 'revision_conflict'], ['P0002', 404, 'not_found']]) {
    const refused = leaguePlane({ answer: () => sqlError(code) });
    const out = await send(refused, owner(`proofs/${U(7)}/media?revision=1`));
    assert.deepEqual([out.status, out.body.reason], [status, reason], code);
    assert.equal(refused.storageCalls().length, 0, `${code}: no storage call`);
  }
});

/* Rewritten deliberately (review 2026-11-10): the purge records its DECISION first (media.purging, with the request's
   own key) and only then deletes, so a policy change between the deletion and media.purged can no longer strand a row
   that claims a deleted object. It was media.due (a read) then delete then media.purged. */
test('purge: media.purging decides exactly the uploads asked with the request key, refuses before deciding or deleting, and records media.purged only after every deletion', async () => {
  const rows = [uploadRow({ id: U(60), state: 'discarded' }), uploadRow({ id: U(61), state: 'purged' })];
  const due = (patch = {}) => ({ retention_evaluated: true, uploads: rows.map((row, i) => ({ id: row.id, tenant: row.tenant, assignment_id: row.assignment_id, ext: row.ext, kind: row.kind, state: row.state, due: i === 0, reason: i === 0 ? 'discarded' : null, due_at: i === 0 ? AT : null, ...patch })) });
  const result = { purged: [U(60)], already_purged: [U(61)], publications_withdrawn: [] };
  const run = async (decision, storageHook) => {
    const plane = leaguePlane({ answer: (call) => (call.body.p_action === 'media.purging' ? (typeof decision === 'function' ? decision() : decision) : result) });
    plane.storage.store(pathOf(rows[0]), WEBM, { contentType: 'audio/webm' });
    if (storageHook) plane.storage.intercept(storageHook);
    const r = await send(plane, owner('media/purge'), { method: 'POST', body: { idempotency_key: KEY, uploads: [U(60), U(61).toUpperCase()] } });
    return { ...r, plane };
  };
  const ok = await run(due());
  assert.equal(ok.status, 200); assert.deepEqual(ok.body.purge, result);
  assert.deepEqual(ok.plane.rpc().map((c) => [c.body.p_action, c.body.p_document, c.body.p_key]), [['media.purging', { uploads: [U(60), U(61).toUpperCase()] }, KEY], ['media.purged', { uploads: [U(60), U(61).toUpperCase()] }, KEY]]);
  assert.equal(ok.plane.storage.object(pathOf(rows[0])), null, 'the due object was deleted');
  const order = ok.plane.all();
  assert.ok(order.findIndex((c) => c.kind === 'rpc' && c.body.p_action === 'media.purging') < order.findIndex((c) => c.kind === 'storage' && c.call.method === 'DELETE'), 'decided before deleted');
  assert.ok(order.findIndex((c) => c.kind === 'storage' && c.call.method === 'DELETE') < order.findIndex((c) => c.kind === 'rpc' && c.body.p_action === 'media.purged'), 'deleted before recorded');

  const notDue = await run(() => sqlError('40001'));
  assert.deepEqual([notDue.status, notDue.body.reason], [409, 'revision_conflict']);
  assert.match(notDue.body.error, /nothing was decided or deleted/);
  assert.ok(notDue.plane.storage.object(pathOf(rows[0])), 'nothing was deleted'); assert.equal(notDue.plane.storageCalls().length, 0);
  assert.deepEqual(notDue.plane.rpc().map((c) => c.body.p_action), ['media.purging'], 'media.purged is never called');

  const undecided = await run({ retention_evaluated: true, uploads: [{ ...due().uploads[0] }, { ...due().uploads[1], state: 'sealed' }] });
  assert.equal(undecided.status, 503, 'a decision that answers a row it never decides is malformed'); assert.equal(undecided.plane.storageCalls().length, 0);

  const storageDown = await run(due(), (call) => (call.method === 'DELETE' ? new Response('no', { status: 500 }) : undefined));
  assert.deepEqual([storageDown.status, storageDown.body.reason], [503, 'storage_unavailable']);
  assert.deepEqual(storageDown.plane.rpc().map((c) => c.body.p_action), ['media.purging'], 'storage failed: nothing recorded as purged (the decision stays, so the next try completes it)');

  const short = await run({ retention_evaluated: true, uploads: [due().uploads[0]] });
  assert.equal(short.status, 503, 'a decision that does not name every upload asked for is malformed'); assert.equal(short.plane.storageCalls().length, 0);
});

/* ------------------------------------------------------------------ the route table, walked */

const POLICY = { entitlement: 'none_required', media: { enabled: true, kinds: ['audio', 'video'], audio_max_bytes: 1000, video_max_bytes: 2000, max_duration_seconds: 600 },
  retention: { completed_days: 30, withdrawn_days: 7 },
  notices: { participation: { revision: 'fixture-participation-1', text: 'Test fixture notice: participation.' }, private_review: { revision: 'fixture-review-1', text: 'Test fixture notice: private review.' },
    publication: { revision: 'fixture-publication-1', text: 'Test fixture notice: publication.' } } };
const RIGHTS = { version: 'music-rights-v1', owns_master: true, controls_composition: true, samples_cleared: true, collaborators_cleared: true, parody_or_derivative: false, derivative_permissions: '' };
/* One valid document per contract document name (synthetic values only). */
const DOCS = {
  policy_set: { policy: POLICY, reason: 'Test fixture: set the League policy.' },
  campaign_create: { slug: 'fixture-campaign', title: 'Test fixture campaign', purpose: 'Test fixture purpose.' },
  transition: { to: 'paused' }, audience_set: { audience: 'invited' }, grant: { account: U(31) }, grant_revoke: { reason: 'Test fixture' },
  mission_create: { slug: 'write-a-song', title: 'Test fixture: write a song', template: 'write-a-song', proof_modes: ['audio', 'lyrics'], requirements: 'Test fixture requirements.' },
  mission_update: { title: 'Test fixture: renamed' },
  application_create: { applicant: U(31), requirements_revision: 1, statement: 'Test fixture statement.' },
  application_save: { submit: true, requirements_revision: 1, statement: 'Test fixture statement.' },
  application_decide: { decision: 'approved' },
  assignment_accept: { requirements_revision: 1, notice_revision: 'fixture-participation-1' },
  draft_save: { lyrics: 'Test fixture lyrics' },
  upload_begin: { kind: 'audio', mime: 'audio/webm', bytes: 16 },
  proof_submit: { title: 'Test fixture: river song', lyrics: 'Line one\nLine two', credits: [{ name: 'Fixture Writer', role: 'lyrics' }], rights: RIGHTS,
    accommodation: { statement: 'Test fixture statement: the words instead of a recording.' }, review_notice_revision: 'fixture-review-1' },
  proof_review: { asset_revision: SHA, mission_decision: 'pass', rights_decision: 'pass', safety_decision: 'pass' },
  proof_moderate: { hold: true, reason: 'Test fixture hold.' },
  consent_grant: { purpose: 'publish_proof', audience: 'released_audience', asset_revision: SHA, notice_revision: 'fixture-publication-1', expires_at: '2027-01-01T00:00:00Z' },
  publication_decide: { decision: 'published', consent_id: U(40) },
  appeal_open: { statement: 'Test fixture appeal.' },
  appeal_resolve: { outcome: 'upheld', reason: 'Test fixture.' },
  media_purged: { uploads: [U(60)] },
  outbox_ack: { consumer: 'fixture-consumer' },
  empty: {}
};
const SAMPLE = { id: U(7), seq: '42', operation: 'proofs.submit', key: 'fixture-key-0002' };
const QUERY_ID = U(5);
const specOf = (route) => TABLES[route.rpc][route.action];
/* A valid query value for a document field (the first enum value, the floor of an integer, a valid pattern). */
function queryValue(docName, field) {
  const spec = C.DOCUMENTS[docName].fields[field];
  if (spec.type === 'enum') return spec.values[0];
  if (spec.type === 'integer') return String(Math.max(spec.min, 1));
  if (spec.type === 'pattern') return spec.pattern === 'consumer' ? 'fixture-consumer' : 'x';
  return 'x';
}
/* The request a route needs and the document the Worker must send for it. */
function shapeFor(route) {
  const spec = route.action ? specOf(route) : null;
  const rest = route.path.split('/').map((s) => (s.startsWith(':') ? SAMPLE[s.slice(1)] : s)).join('/');
  const docName = route.rpc !== 'media' && spec?.document ? spec.document : null;
  const doc = docName ? DOCS[docName] : null;
  const query = new URLSearchParams();
  const document = docName ? {} : null;
  let id = route.id ? SAMPLE[route.id] : '';
  let body;
  if (route.method !== 'GET') {
    body = {};
    if (route.idempotency_key) body.idempotency_key = KEY;
    if (route.expected_revision) body.expected_revision = Math.max(route.revision_min, 1);
    if (route.wrapper) { body[route.wrapper] = Object.fromEntries(Object.entries(doc).filter(([k]) => !Object.hasOwn(route.fixed, k))); Object.assign(document, body[route.wrapper]); }
    for (const f of route.fields) if (doc && doc[f] !== undefined) { body[f] = doc[f]; document[f] = doc[f]; }
  }
  for (const [q, to] of Object.entries(route.query)) {
    if (to === 'id') { query.set(q, QUERY_ID); id = QUERY_ID; continue; }
    const value = queryValue(docName, to);
    query.set(q, value);
    document[to] = C.DOCUMENTS[docName].fields[to].type === 'integer' ? Number(value) : value;
  }
  for (const [p, to] of Object.entries(route.params)) document[to] = SAMPLE[p];
  if (document) Object.assign(document, route.fixed);
  const prefix = route.surface === 'owner' ? C.PREFIX.owner : C.PREFIX.member;
  const path = `${prefix}${rest ? `/${rest}` : ''}${query.size ? `?${query}` : ''}`;
  return { path, body, id, document, actor: route.surface === 'owner' ? OWNER : MEMBER };
}
/* What the stubbed store answers for the walk: contract-shaped defaults, real-looking rows where the media module reads them. */
function walkPlane() {
  const plane = leaguePlane({
    answer: (call) => {
      if (call.surface === 'media') return { ...uploadRow({ id: call.body.p_upload }), state: 'sealed', bytes: call.body.p_result.bytes, sha256: call.body.p_result.sha256, family: call.body.p_result.family, storage: call.body.p_result.storage };
      switch (call.body.p_action) {
        case 'uploads.begin': return uploadRow({ id: U(8), assignment_id: U(7) });
        case 'uploads.get': return call.body.p_document?.sign ? sealedRow(plane.storage, uploadRow({ id: U(7) }), SHA) : uploadRow({ id: U(7) });
        case 'uploads.discard': return uploadRow({ id: U(7), state: 'discarded', discarded_at: AT });
        case 'proofs.get': return { ...sampleShape('proof_with_media'), id: U(7), tenant: TENANT, assignment_id: U(7), participant: MEMBER, moderation_state: 'clear', media: [], uploads: [] };
        case 'media.due': case 'media.purging': return { retention_evaluated: true, uploads: [{ id: U(60), tenant: TENANT, assignment_id: U(7), ext: 'webm', kind: 'audio', state: 'discarded', due: true, reason: 'discarded', due_at: AT }] };
        default: return undefined;
      }
    }
  });
  plane.storage.store(pathOf(uploadRow({ id: U(7) })), WEBM, { contentType: 'audio/webm' });
  return plane;
}
/* The calls a route makes, by function and action, in order. */
function expectedCalls(route) {
  if (!route.action) return [];
  if (route.rpc === 'media') return [['member', 'uploads.get'], ['media', null]];
  return [...route.before.map((b) => [route.rpc, b]), [route.rpc, route.action]];
}

test('the route table, walked: every contract route has a handler, calls only its declared function with the session actor, and requires what the table says', async () => {
  let walked = 0;
  for (const route of C.ROUTES) {
    const at = `${route.surface} ${route.method} ${route.path}`;
    const shape = shapeFor(route);
    /* The route answers. */
    const plane = walkPlane();
    const before = plane.storage.calls.length;
    const ids = identities();
    const r = await send(plane, shape.path, { method: route.method, body: shape.body, ids });
    assert.equal(r.status, 200, `${at}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, true, at);
    assert.ok(Object.hasOwn(r.body, route.response), `${at} answers ${route.response}`);
    for (const key of route.extra) assert.ok(Object.hasOwn(r.body, key), `${at} answers ${key}`);
    assert.deepEqual(Object.keys(r.body).sort(), ['ok', route.response, ...route.extra].sort(), `${at}: nothing else in the answer`);
    assert.equal(r.response.headers.get('cache-control'), 'private, no-store', at);
    /* Exactly its declared function(s), with the session actor. */
    const calls = plane.rpc();
    assert.deepEqual(calls.map((c) => [c.surface, c.surface === 'media' ? null : c.body.p_action]), expectedCalls(route), at);
    for (const c of calls) {
      assert.equal(c.name, NAMES[c.surface === 'media' ? 'seal' : c.surface], at);
      assert.equal(c.body.p_actor, shape.actor, `${at}: p_actor is the session user`);
      assert.deepEqual(Object.keys(c.body), [...C.RPC_ARGUMENTS[c.surface === 'media' ? 'seal' : c.surface]], at);
    }
    if (route.surface === 'owner') { assert.equal(ids.seen.session, 0, `${at}: no session check`); assert.equal(ids.seen.owner, 1, at); }
    else { assert.equal(ids.seen.owner, 0, `${at}: the member branch never asks for a house owner`); assert.equal(ids.seen.session, 1, at); }
    const main = calls.find((c) => c.surface === route.rpc && (route.rpc === 'media' || c.body.p_action === route.action));
    if (main && route.rpc !== 'media') {
      assert.equal(main.body.p_id, shape.id, `${at} p_id`);
      assert.deepEqual(main.body.p_document, shape.document, `${at} p_document`);
      assert.equal(main.body.p_revision, route.expected_revision ? shape.body.expected_revision : null, `${at} p_revision`);
      assert.equal(main.body.p_key, route.idempotency_key ? KEY : null, `${at} p_key`);
    }
    if (route.rpc === 'media') {
      assert.deepEqual([calls[0].body.p_id, calls[0].body.p_document], [U(7), {}], `${at}: the participant's own row first`);
      assert.equal(calls[1].body.p_upload, U(7), at);
      assert.equal(C.checkDocument(C.DOCUMENTS.seal_result, calls[1].body.p_result), null, `${at}: the seal gets what was measured`);
    }
    if (!route.media) assert.equal(plane.storage.calls.length, before, `${at}: no storage call`);
    if (route.surface === 'member') assert.doesNotMatch(JSON.stringify(r.body), new RegExp(`"(${C.FOREIGN_ID_FIELDS.join('|')})":`), `${at}: no account-naming field`);
    /* What the table requires, refused before any call. */
    const refused = async (label, status, reason, { path = shape.path, ids: given, ...override }) => {
      const p = walkPlane();
      const n = p.storage.calls.length;
      const ids2 = given ?? identities();
      const out = await send(p, path, { method: route.method, ...override, ids: ids2 });
      assert.equal(out.status, status, `${at} ${label}: ${JSON.stringify(out.body)}`); assert.equal(out.body.reason, reason, `${at} ${label}`);
      assert.equal(p.rpc().length, 0, `${at} ${label}: no RPC`); assert.equal(p.storage.calls.length, n, `${at} ${label}: no storage call`);
      return ids2;
    };
    const without = (key) => { const b = { ...shape.body }; delete b[key]; return b; };
    if (route.idempotency_key) {
      await refused('without a key', 400, 'idempotency_key_required', { body: without('idempotency_key') });
      await refused('with a short key', 400, 'idempotency_key_required', { body: { ...shape.body, idempotency_key: 'short' } });
    }
    if (route.expected_revision) {
      await refused('without a revision', 400, 'expected_revision_required', { body: without('expected_revision') });
      await refused('below the floor', 400, 'expected_revision_required', { body: { ...shape.body, expected_revision: route.revision_min - 1 } });
      await refused('above the ceiling', 400, 'expected_revision_required', { body: { ...shape.body, expected_revision: C.LIMITS.revision_max + 1 } });
      await refused('as text', 400, 'expected_revision_required', { body: { ...shape.body, expected_revision: '1' } });
    }
    if (route.path.includes(':id')) {
      const bad = shape.path.replace(SAMPLE.id, 'not-a-uuid');
      await refused('a bad uuid', 404, route.surface === 'member' ? 'not_available' : 'not_found', { path: bad, body: shape.body });
    }
    if (route.method !== 'GET') {
      await refused('not JSON', 415, 'json_required', { body: shape.body, headers: { 'content-type': 'text/plain' } });
      await refused('over the cap', 413, 'body_too_large', { raw: JSON.stringify({ ...shape.body, pad: 'x'.repeat(C.LIMITS.body_max_bytes) }) });
      await refused('not an object', 400, 'invalid_json', { raw: '[]' });
      await refused('not JSON text', 400, 'invalid_json', { raw: '{"idempotency_key":' });
    }
    if (route.surface === 'member') {
      const anonymous = await refused('signed out', 401, 'authentication_required', { body: shape.body, bearer: null });
      assert.equal(anonymous.seen.session, 0, `${at}: no session check without a bearer`);
      if (route.method !== 'GET') {
        const nested = route.wrapper ? { ...shape.body, [route.wrapper]: { ...shape.body[route.wrapper], participant: U(9) } } : { ...shape.body, actor: U(9) };
        await refused('naming an account', 422, 'field_refused', { body: nested });
      }
    } else {
      const notOwner = await refused('not a house owner', 403, 'owner_required', { body: shape.body, ids: identities({ owner: null }) });
      assert.equal(notOwner.seen.owner, 1, at);
    }
    walked += 1;
  }
  assert.equal(walked, C.ROUTES.length); assert.equal(walked, 52);
});
