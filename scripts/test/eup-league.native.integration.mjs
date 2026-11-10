// Environmental Justice League under REAL concurrency: native PostgreSQL, one connection per session.
// The serial PGlite test (eup-league.integration.mjs) proves the rules; this file proves what one session cannot:
//    1. the same idempotency key raced on N sessions returns the identical stored result N times, with one effect
//       (the reproduced defect answered 23505 to all but one);
//    2. the same key with different payloads: one success, every other EU003;
//    3. capacity K with N concurrent approvals: exactly K assignments, every other EU001;
//    4. two submissions replacing the same proof revision: one wins, the others 40001;
//    5. a 200-round mix of every command class on twelve sessions, the owner-control set included (consent,
//       publication, revocation, hold, appeal): no deadlock (40P01), no leaked error, the invariants checked after
//       every round, and a consumer paging the outbox by "after" meanwhile that misses no event (the reproduced
//       defect deadlocked decide against transition: 58 in 40 rounds);
//    6. a mission pause waits for an in-flight member write and then closes the mission for the next one;
//    7. a module drain waits for an in-flight League write; a late writer is refused EUM02; reduce-only actions
//       (member and owner) are admitted, new work is refused, reads answer;
//    8. anon and authenticated are denied every League table and function by the server itself;
//    9. accept racing a requirements change never leaves an accepted assignment on a stale requirements revision;
//   10. proof submission racing review: every review names one existing revision and its digest, none is reviewed twice;
//   11. consent revocation racing publication: never a live publication on a revoked consent;
//   12. submissions racing for one upload: one wins; a discard racing a submission that lists the upload: one wins.
// Loopback only. Synthetic data only. It creates its own database and drops it; with EMBEDDED_PG_MODULE it also
// starts its own server and removes it.
//
// A disposable local server (PostgreSQL 16 run as the postgres user, data directory directly under /tmp, TCP only):
//   ALLOW_LOCAL_EUP_DB_TESTS=1 EUP_PG_PORT=<port> PG_MODULE_DIR=<dir holding node_modules/pg> node scripts/test/eup-league.native.integration.mjs
// Or embedded PostgreSQL 17.x, started here (the repository's EMBEDDED_PG_MODULE convention). Postgres refuses to run
// as root; as root, launch the whole test in a user namespace mapped to the postgres account:
//   unshare --user --map-user=$(id -u postgres) --map-group=$(id -g postgres) env ALLOW_LOCAL_EUP_DB_TESTS=1 \
//     EMBEDDED_PG_MODULE=<embedded-postgres/dist/index.js> PG_MODULE_DIR=<...> node scripts/test/eup-league.native.integration.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as C from '../../workers/mccluster/src/eup/league-contract.js';

if (process.env.ALLOW_LOCAL_EUP_DB_TESTS !== '1') {
  console.error('eup-league.native.integration.mjs creates and drops a local database. Set ALLOW_LOCAL_EUP_DB_TESTS=1 and EUP_PG_PORT (or EMBEDDED_PG_MODULE) to run it.');
  process.exit(1);
}
const require = createRequire(process.env.PG_MODULE_DIR ? path.join(process.env.PG_MODULE_DIR, 'x') : import.meta.url);
const { Client } = require('pg');
const file = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');

const OWNER = '11111111-1111-4111-8111-111111111111';
const REVIEWER = '33333333-3333-4333-8333-333333333333';
const TESTERS = Array.from({ length: 12 }, (_, i) => `4${String(i).padStart(7, '0')}-4444-4444-8444-444444444444`);
const ROUNDS = Number(process.env.EUP_LEAGUE_NATIVE_ROUNDS || 200);
const DB = `eup_league_native_${process.pid}`;
const NOTICE = (id) => ({ revision: `fixture-${id}-1`, text: `TEST FIXTURE notice (${id}). Not real policy text.` });
// Synthetic values for the tests only (D3: the code ships none).
const POLICY = { entitlement: 'none_required', media: { enabled: true, kinds: ['audio', 'video'], audio_max_bytes: 1000, video_max_bytes: 2000, max_duration_seconds: 30 },
  retention: { completed_days: 2, withdrawn_days: 1 },
  notices: { participation: NOTICE('participation'), private_review: NOTICE('review'), publication: NOTICE('publication') } };
const SONG = { slug: 'write-a-song', title: 'Test fixture: write a song', template: 'write-a-song', proof_modes: ['audio', 'video', 'lyrics'], requirements: 'Fixture requirements.' };
const RIGHTS = { version: 'music-rights-v1', owns_master: true, controls_composition: true, samples_cleared: true, collaborators_cleared: true, parody_or_derivative: false, derivative_permissions: '' };
const WORDS = (lyrics = 'Line one\nLine two') => ({ title: 'Test fixture song', lyrics, credits: [{ name: 'Fixture Person', role: 'writer' }], rights: RIGHTS,
  accommodation: { statement: 'Test fixture: I cannot record.' }, review_notice_revision: POLICY.notices.private_review.revision });

let embedded = null; let embeddedDir = null;
let port = Number(process.env.EUP_PG_PORT || 0);
if (!port) {
  assert.ok(process.env.EMBEDDED_PG_MODULE, 'set EUP_PG_PORT for a running local server, or EMBEDDED_PG_MODULE to start one');
  const { default: EmbeddedPostgres } = await import(pathToFileURL(process.env.EMBEDDED_PG_MODULE).href);
  embeddedDir = await mkdtemp(path.join(tmpdir(), 'eup-league-native-'));
  port = 56000 + (process.pid % 900);
  embedded = new EmbeddedPostgres({ databaseDir: embeddedDir, port, persistent: false, user: 'postgres', password: 'local-review-only', onLog: () => {}, onError: console.error, postgresFlags: ['-h', '127.0.0.1', '-k', ''] });
  await embedded.initialise(); await embedded.start();
}
const clients = [];
const connect = async (database = DB) => { const c = new Client({ host: '127.0.0.1', port, user: 'postgres', password: process.env.EUP_PG_PASSWORD || 'local-review-only', database }); clients.push(c); await c.connect(); return c; };
const session = async () => { const c = await connect(); await c.query('set role service_role'); c.pid = (await c.query('select pg_backend_pid() as p')).rows[0].p; return c; };

let count = 0; let keys = 0;
const ok = (c, m) => { assert.ok(c, m); count += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); count += 1; };
const key = (label) => `native-${label}-${process.pid}-${keys += 1}`.padEnd(12, '0');
const call = (name) => (c, action, { actor, id, document, revision, key: k } = {}) => c.query(`select public.${name}($1, $2, $3, $4::jsonb, $5, $6) as r`,
  [action, actor, id ?? '', document === undefined ? null : JSON.stringify(document), revision ?? null, k ?? null]).then((r) => r.rows[0].r);
const owner = call(C.RPC.owner);
const member = call(C.RPC.member);
const settle = (promises) => Promise.all(promises.map((p) => p.then((value) => ({ value }), (error) => ({ code: error.code || 'client', message: error.message }))));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) { const end = Date.now() + 15000; for (;;) { if (await check()) return; if (Date.now() > end) throw new Error(`timeout: ${label}`); await sleep(15); } }

let admin0 = null; let admin = null;
try {
  admin0 = await connect('postgres');
  await admin0.query(`create database ${DB}`);
  admin = await connect();
  const version = (await admin.query("select current_setting('server_version') as v")).rows[0].v;
  // Supabase-shaped stand-ins with the default privileges ON; service_role cannot read auth.users (as in production).
  await admin.query((await file('supabase/tests/supabase_api_roles.stub.sql')));
  await admin.query(`alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create table public.orgs(id uuid primary key, slug text unique); create table public.org_members(org_id uuid, profile_id uuid, role text);
    insert into auth.users(id) values ('${OWNER}'), ('${REVIEWER}'), ${TESTERS.map((t) => `('${t}')`).join(', ')};
    insert into public.orgs values ('${OWNER}', 'mccluster');
    insert into public.org_members values ('${OWNER}', '${OWNER}', 'owner'), ('${OWNER}', '${REVIEWER}', 'owner');`);
  await admin.query(await file('supabase/pending/eup_module_policy_v1.sql'));
  const leagueSql = await file('supabase/pending/eup_league_v1.sql');
  await admin.query(leagueSql);
  await admin.query(await file('supabase/pending/eup_league_v1.rollback.sql'));
  await admin.query(leagueSql);
  ok(true, 'the League SQL applies, rolls back and applies again on a native server');

  const S = await Promise.all(Array.from({ length: 12 }, () => session()));
  const [s0, s1, s2, s3] = S;
  await s0.query(`select public.eup_module_policy_install($1, 'league', $2, 'Test fixture: install.')`, [OWNER, key('install')]);
  await s0.query(`select public.eup_module_policy_command($1, 'league', 'enabled', 0, $2, 'Test fixture: enable.')`, [OWNER, key('enable')]);
  await owner(s0, 'policy.set', { actor: OWNER, document: { policy: POLICY, reason: 'Test fixture: first policy.' }, revision: 0, key: key('policy') });

  // 8. Roles: the server itself denies anon and authenticated every League table and function.
  const guest = await connect();
  const leagueTables = (await admin.query(`select c.relname as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'eup\\_%' and c.relname not like 'eup\\_module%' order by 1`)).rows.map((r) => r.t);
  // The signature with argument TYPES only (pg_get_function_identity_arguments also prints argument names, which a
  // ::regprocedure cast cannot parse), and a call of it with every argument a typed null.
  const leagueFunctions = (await admin.query(`select p.oid::regprocedure::text as f, p.oid as oid,
      format('select public.%I(%s)', p.proname, (select coalesce(string_agg(format('null::%s', format_type(t.typ, null)), ', ' order by t.ord), '') from unnest(p.proargtypes::oid[]) with ordinality t(typ, ord))) as call
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'eup\\_league\\_%' order by 1`)).rows;
  ok(leagueTables.length >= 20 && leagueFunctions.length > 30, `the League tables (${leagueTables.length}) and functions (${leagueFunctions.length}) exist`);
  for (const role of ['anon', 'authenticated']) {
    await guest.query(`set role ${role}`);
    for (const t of leagueTables) eq(await guest.query(`select * from public.${t} limit 1`).then(() => 'ok', (e) => e.code), '42501', `${role} is denied ${t}`);
    for (const f of leagueFunctions) {
      eq((await admin.query(`select has_function_privilege($1, $2::oid, 'EXECUTE') as x`, [role, f.oid])).rows[0].x, false, `${role} holds no EXECUTE on ${f.f}`);
      eq(await guest.query(f.call).then(() => 'ok', (e) => e.code), '42501', `${role} calling ${f.f} is refused by the server`);
    }
    eq(await guest.query(`select public.${C.RPC.owner}('campaigns.list', $1, '', null, null, null)`, [OWNER]).then(() => 'ok', (e) => e.code), '42501', `${role} calling the owner command is refused by the server`);
    eq(await guest.query(`select public.${C.RPC.member}('me.get', $1, '', null, null, null)`, [OWNER]).then(() => 'ok', (e) => e.code), '42501', `${role} calling the member command is refused by the server`);
    await guest.query('reset role');
  }
  await guest.query('set role service_role');
  eq(await guest.query('select count(*) from auth.users').then(() => 'ok', (e) => e.code), '42501', 'service_role cannot read auth.users here, as in production');
  await guest.query('reset role');

  // Fixture helpers (serial, on one session).
  const newCampaign = async (slug) => {
    let c = await owner(s0, 'campaigns.create', { actor: OWNER, document: { slug, title: 'Test fixture campaign', purpose: 'Synthetic.' }, key: key('campaign') });
    c = await owner(s0, 'campaigns.transition', { actor: OWNER, id: c.id, document: { to: 'released' }, revision: c.revision, key: key('release') });
    c = await owner(s0, 'campaigns.audience.set', { actor: OWNER, id: c.id, document: { audience: 'invited' }, revision: c.revision, key: key('audience') });
    for (const t of TESTERS) await owner(s0, 'audience.grants.grant', { actor: OWNER, id: c.id, document: { account: t }, key: key('grant') });
    return c;
  };
  const newMission = async (campaign, slug, extra = {}) => {
    const m = await owner(s0, 'missions.create', { actor: OWNER, id: campaign.id, document: { ...SONG, slug, ...extra }, key: key('mission') });
    return owner(s0, 'missions.transition', { actor: OWNER, id: m.id, document: { to: 'released' }, revision: m.revision, key: key('release') });
  };
  const mission = async (id) => (await admin.query('select * from public.eup_missions where id = $1', [id])).rows[0];
  const apply = (c, actor, m) => member(c, 'applications.save', { actor, id: m.id, document: { submit: true, requirements_revision: m.requirements_revision, statement: 'Test fixture statement.' }, revision: 0, key: key('apply') });
  const rows = async (sql, params) => (await admin.query(sql, params)).rows;
  const approve = (c, application, actor = OWNER) => owner(c, 'applications.decide', { actor, id: application.id, document: { decision: 'approved' }, revision: application.revision, key: key('approve') });
  const accept = (c, tester, seat, m) => member(c, 'assignments.accept', { actor: tester, id: seat.id, document: { requirements_revision: m.requirements_revision, notice_revision: POLICY.notices.participation.revision }, revision: seat.revision, key: key('accept') });
  const enroll = async (tester, m) => accept(s0, tester, (await approve(s0, await apply(s0, tester, m))).assignment, m);
  const submit = (c, tester, seat, document = WORDS(), revision = 0) => member(c, 'proofs.submit', { actor: tester, id: seat.id, document, revision, key: key('submit') });
  const reviewAs = (c, proof, outcome = 'pass', actor = REVIEWER) => owner(c, 'proofs.review', { actor, id: proof.id, revision: proof.revision, key: key('review'),
    document: { asset_revision: proof.asset_revision, mission_decision: outcome, rights_decision: 'pass', safety_decision: 'pass', ...(outcome === 'pass' ? {} : { reason: 'Test fixture.' }) } });
  const expiry = (days) => new Date(Date.now() + days * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
  const publishConsent = (proof) => ({ purpose: 'publish_proof', audience: 'released_audience', asset_revision: proof.asset_revision, notice_revision: POLICY.notices.publication.revision, expires_at: expiry(30) });
  const consentFor = (c, tester, proof) => member(c, 'consents.grant', { actor: tester, id: proof.id, document: publishConsent(proof), revision: proof.revision, key: key('consent') });
  const publish = (c, proof, consent) => owner(c, 'publications.decide', { actor: OWNER, id: proof.id, document: { decision: 'published', consent_id: consent.id }, revision: proof.revision, key: key('publish') });
  // The Worker's measurement of a stored object, as the seal takes it (synthetic: no object exists anywhere).
  const sealAs = (c, tester, upload, sha256) => c.query(`select public.${C.RPC.seal}($1, $2, $3::jsonb) as r`, [upload.id, tester,
    JSON.stringify({ outcome: 'sealed', bytes: upload.declared_bytes, sha256, family: 'ebml', storage: { object_id: randomUUID(), etag: '"fixture"', size: upload.declared_bytes } })]).then((r) => r.rows[0].r);
  const tally = (into, outcomes) => { for (const o of outcomes) into[o] = (into[o] || 0) + 1; return into; };
  const outcome = (label, promise) => promise.then(() => `${label}:ok`, (error) => `${label}:${error.code || 'client'}`);
  const campaign = await newCampaign('native-campaign');

  // 1. Same key, same payload, N sessions at once: one effect, N identical answers.
  const raceKey = key('same-key');
  const raceDocument = { slug: 'raced-campaign', title: 'Raced', purpose: 'Synthetic.' };
  const raced = await settle(S.map((c) => owner(c, 'campaigns.create', { actor: OWNER, document: raceDocument, key: raceKey })));
  eq(raced.map((r) => r.code ?? 'ok'), S.map(() => 'ok'), `the same key raced on ${S.length} sessions: every session gets an answer, none a constraint error`);
  ok(raced.every((r) => JSON.stringify(r.value) === JSON.stringify(raced[0].value)), 'and it is the identical stored result');
  eq([(await admin.query(`select count(*)::int as n from public.eup_campaigns where slug = 'raced-campaign'`)).rows[0].n, (await admin.query('select count(*)::int as n from public.eup_command_receipts where idempotency_key = $1', [raceKey])).rows[0].n], [1, 1], 'with exactly one campaign and one receipt');
  const m1 = await newMission(campaign, 'race-one');
  const memberKey = key('same-key-member');
  const memberRace = await settle(S.map((c) => member(c, 'applications.save', { actor: TESTERS[0], id: m1.id, document: { submit: true, requirements_revision: 1, statement: 'Raced statement.' }, revision: 0, key: memberKey })));
  ok(memberRace.every((r) => !r.code && JSON.stringify(r.value) === JSON.stringify(memberRace[0].value)), 'the member command replays a raced key the same way');
  eq((await admin.query('select count(*)::int as n from public.eup_applications where mission_id = $1', [m1.id])).rows[0].n, 1, 'with one application');

  // 2. Same key, different payloads: one success, the rest EU003.
  const conflictKey = key('conflict');
  const conflicts = await settle(S.map((c, i) => owner(c, 'campaigns.create', { actor: OWNER, document: { slug: `conflict-${i}`, title: 'Conflict', purpose: 'Synthetic.' }, key: conflictKey })));
  eq(conflicts.map((r) => r.code ?? 'ok').sort(), ['ok', ...S.slice(1).map(() => 'EU003')].sort(), 'one key with different payloads: exactly one success, every other EU003');
  eq((await admin.query(`select count(*)::int as n from public.eup_campaigns where slug like 'conflict-%'`)).rows[0].n, 1, 'and one campaign');
  // Two first applications of one account under different keys: one row, the other is told to reload (not 23505).
  const m1b = await newMission(campaign, 'race-first-application');
  const firsts = await settle(S.slice(0, 6).map((c) => member(c, 'applications.save', { actor: TESTERS[1], id: m1b.id, document: { submit: false, requirements_revision: 1 }, revision: 0, key: key('first') })));
  eq(firsts.map((r) => r.code ?? 'ok').sort(), ['40001', '40001', '40001', '40001', '40001', 'ok'], 'six devices creating the first application: one creates it, five get a revision conflict');

  // 3. Capacity is atomic: K seats, N concurrent approvals.
  const K = 3;
  const m2 = await newMission(campaign, 'capacity', { capacity: K });
  const applications = [];
  for (const t of TESTERS) applications.push(await apply(s0, t, m2));
  const approvals = await settle(applications.map((a, i) => owner(S[i], 'applications.decide', { actor: i % 2 ? OWNER : REVIEWER, id: a.id, document: { decision: 'approved' }, revision: a.revision, key: key('approve') })));
  eq(approvals.map((r) => r.code ?? 'ok').sort(), [...Array(TESTERS.length - K).fill('EU001'), ...Array(K).fill('ok')], `${TESTERS.length} concurrent approvals for ${K} seats: exactly ${K} succeed, the rest EU001`);
  eq((await admin.query('select count(*)::int as n from public.eup_assignments where mission_id = $1', [m2.id])).rows[0].n, K, `and exactly ${K} assignments exist`);

  // 4. Two submissions replacing the same proof revision (different keys): one wins.
  const m3 = await newMission(campaign, 'two-submissions');
  const a3 = await apply(s0, TESTERS[0], m3);
  const seat3 = (await owner(s0, 'applications.decide', { actor: OWNER, id: a3.id, document: { decision: 'approved' }, revision: a3.revision, key: key('approve') })).assignment;
  await member(s0, 'assignments.accept', { actor: TESTERS[0], id: seat3.id, document: { requirements_revision: 1, notice_revision: POLICY.notices.participation.revision }, revision: seat3.revision, key: key('accept') });
  const submissions = await settle(S.slice(0, 6).map((c, i) => member(c, 'proofs.submit', { actor: TESTERS[0], id: seat3.id, document: WORDS(`Take ${i}\nline two`), revision: 0, key: key('submit') })));
  eq(submissions.map((r) => r.code ?? 'ok').sort(), ['40001', '40001', '40001', '40001', '40001', 'ok'], 'six first submissions under different keys: one wins, the others are told to reload');
  eq((await admin.query('select revision, (select count(*)::int from public.eup_proof_revisions r where r.proof_id = p.id) as revisions, (select count(*)::int from public.eup_consents k where k.proof_id = p.id) as consents from public.eup_proofs p where p.assignment_id = $1', [seat3.id])).rows[0],
    { revision: 1, revisions: 1, consents: 1 }, 'one proof at revision 1 with one revision row and one consent');

  // 6. A mission pause waits for an in-flight member write, then closes the mission for the next one.
  const m4 = await newMission(campaign, 'pause-waits');
  await s1.query('begin');
  const inflight = await apply(s1, TESTERS[2], m4);
  const pausing = owner(s2, 'missions.transition', { actor: OWNER, id: m4.id, document: { to: 'paused' }, revision: m4.revision, key: key('pause') });
  await until(async () => (await admin.query('select pg_blocking_pids($1) as b', [s2.pid])).rows[0].b.includes(s1.pid), 'the pause waits for the member transaction');
  ok(true, 'the owner pause is blocked by the member transaction that holds the mission row');
  await s1.query('commit');
  ok((await pausing).state === 'paused' && inflight.status === 'submitted', 'the member write that was in flight commits; then the pause completes');
  eq(await apply(s3, TESTERS[3], m4).then(() => 'ok', (e) => e.code), 'EU011', 'and the next application meets the paused mission');

  // 9. Accept racing a requirements change. The update returns accepted assignments to offered under the mission row
  //    lock and moves their revision; an accept that read the old values is told to reload. Whatever the order, no
  //    accepted assignment ever sits on a stale requirements revision.
  const m9 = await newMission(campaign, 'accept-race');
  for (const t of TESTERS.slice(0, 8)) await approve(s0, await apply(s0, t, m9));
  const outcomes9 = {};
  for (let r = 0; r < 25; r += 1) {
    const m = await mission(m9.id);
    const offered = await rows(`select * from public.eup_assignments where mission_id = $1 and status = 'offered'`, [m9.id]);
    // Odd rounds start the update a moment before the accepts, even rounds start it last: both orders occur.
    const work = [];
    const update = () => work.push(outcome('update', owner(S[11], 'missions.update', { actor: OWNER, id: m9.id, document: { requirements: `Fixture requirements, race ${r}.` }, revision: m.revision, key: key('update') })));
    if (r % 2) { update(); await sleep(2); }
    for (const [i, seat] of offered.entries()) work.push(outcome('accept', accept(S[i % 11], seat.participant, seat, m)));
    if (!(r % 2)) update();
    tally(outcomes9, await Promise.all(work));
    const stale = await rows(`select s.id from public.eup_assignments s join public.eup_missions mm on mm.id = s.mission_id
      where s.mission_id = $1 and s.status = 'accepted' and s.accepted_requirements_revision <> mm.requirements_revision`, [m9.id]);
    assert.deepEqual(stale, [], `accept race ${r}: no accepted assignment sits on a stale requirements revision`);
  }
  count += 25;
  ok(Object.keys(outcomes9).every((o) => ['accept:ok', 'accept:40001', 'accept:EU013', 'update:ok'].includes(o)) && outcomes9['update:ok'] === 25 && outcomes9['accept:ok'] > 0
    && (outcomes9['accept:40001'] || 0) + (outcomes9['accept:EU013'] || 0) > 0, `accept raced 25 requirement changes in both orders: accepted or told to reload, every change applied (${JSON.stringify(outcomes9)})`);

  // 10. Proof submission racing review. A review names the proof revision AND the digest it was shown; a resubmission
  //     moves the revision under the proof row lock. Whatever the order, every review names exactly one existing
  //     revision with its digest, and no revision is reviewed twice.
  const m10 = await newMission(campaign, 'submit-review-race');
  const work10 = [];
  for (const t of TESTERS.slice(0, 6)) { const seat = await enroll(t, m10); work10.push({ tester: t, seat, proof: await submit(s0, t, seat, WORDS('First take')) }); }
  const outcomes10 = {};
  for (let r = 0; r < 15; r += 1) {
    const work = [];
    for (const [i, x] of work10.entries()) {
      const proof = (await rows('select * from public.eup_proofs where id = $1', [x.proof.id]))[0];
      if (!['submitted', 'needs_changes'].includes(proof.state)) continue;
      work.push(outcome('submit', submit(S[(2 * i) % 12], x.tester, x.seat, WORDS(`Take ${r}\nby ${i}`), proof.revision)));
      if (proof.state === 'submitted') work.push(outcome('review', reviewAs(S[(2 * i + 1) % 12], proof, r === 14 ? 'pass' : 'changes')));
    }
    tally(outcomes10, await Promise.all(work));
  }
  eq([await rows(`select r.id from public.eup_proof_reviews r left join public.eup_proof_revisions v on v.proof_id = r.proof_id and v.revision = r.proof_revision and v.asset_revision = r.asset_revision where v.proof_id is null`),
    await rows(`select proof_id, proof_revision from public.eup_proof_reviews group by 1, 2 having count(*) > 1`)], [[], []],
  'every review names one existing revision and its digest, and no revision was reviewed twice');
  ok(Object.keys(outcomes10).every((o) => ['submit:ok', 'submit:40001', 'review:ok', 'review:40001'].includes(o)) && outcomes10['submit:ok'] > 0 && outcomes10['review:ok'] > 0,
    `submissions raced reviews: each succeeded or was told to reload (${JSON.stringify(outcomes10)})`);

  // 11. Consent revocation racing publication. Both lock the proof first, so they serialise: a publication never
  //     stands on a revoked consent, and a publication that won the race was withdrawn by the revocation after it.
  const m11 = await newMission(campaign, 'revoke-publish-race');
  const done11 = [];
  for (const t of TESTERS.slice(0, 6)) { const seat = await enroll(t, m11); const proof = await submit(s0, t, seat); await reviewAs(s0, proof); done11.push({ tester: t, proof }); }
  const outcomes11 = {};
  for (let r = 0; r < 20; r += 1) {
    const work = [];
    for (const [i, x] of done11.entries()) {
      const consent = await consentFor(s0, x.tester, x.proof);
      work.push(outcome('publish', publish(S[(2 * i) % 12], x.proof, consent)));
      work.push(member(S[(2 * i + 1) % 12], 'consents.revoke', { actor: x.tester, id: consent.id, document: {}, key: key('revoke') })
        .then((v) => `revoke:ok:${v.publication ? 'withdrew' : 'none'}`, (e) => `revoke:${e.code}`));
    }
    tally(outcomes11, await Promise.all(work));
    const onRevoked = await rows(`select b.id from public.eup_publications b join public.eup_consents k on k.id = b.consent_id
      where b.state = 'published' and (k.revoked_at is not null or k.superseded_at is not null)`);
    assert.deepEqual(onRevoked, [], `revoke race ${r}: no live publication on a revoked consent`);
  }
  count += 20;
  ok(Object.keys(outcomes11).every((o) => ['publish:ok', 'publish:EU015', 'revoke:ok:withdrew', 'revoke:ok:none'].includes(o))
    && (outcomes11['revoke:ok:withdrew'] || 0) + (outcomes11['revoke:ok:none'] || 0) === 20 * done11.length,
  `revocation raced publication 120 times: every revocation succeeded, a publication either came first or met the revoked consent (${JSON.stringify(outcomes11)})`);
  eq(outcomes11['publish:ok'] || 0, outcomes11['revoke:ok:withdrew'] || 0, 'every publication that won the race was withdrawn by the revocation that followed it');
  eq((await rows(`select count(*)::int as n from public.eup_publications where state = 'published' and mission_id = $1`, [m11.id]))[0].n, 0, 'and none is live');

  // 12. Submissions racing for one upload: one wins and the upload is listed by one proof revision. A discard racing a
  //     submission that lists the upload: both lock the upload, so exactly one of them wins.
  const m12 = await newMission(campaign, 'upload-race');
  const tester12 = TESTERS[7];
  const seat12 = await enroll(tester12, m12);
  const begin12 = () => member(s0, 'uploads.begin', { actor: tester12, id: seat12.id, document: { kind: 'audio', mime: 'audio/webm', bytes: 4 }, key: key('upload') });
  const withMedia = (upload, lyrics) => { const { accommodation: _none, ...rest } = WORDS(lyrics); return { ...rest, media: [{ upload_id: upload.id, sha256: upload.sha256 }] }; };
  const sealed12 = await sealAs(s0, tester12, await begin12(), 'a'.repeat(64));
  const firstMedia = await settle(S.slice(0, 6).map((c, i) => submit(c, tester12, seat12, withMedia(sealed12, `Take ${i}`), 0)));
  eq(firstMedia.map((r) => r.code ?? 'ok').sort(), ['40001', '40001', '40001', '40001', '40001', 'ok'], 'six submissions attaching one upload: one wins, the others are told to reload');
  eq((await rows('select count(*)::int as n from public.eup_proof_media where upload_id = $1', [sealed12.id]))[0].n, 1, 'and the upload is listed by exactly one proof revision');
  const outcomes12 = {};
  for (let r = 0; r < 10; r += 1) {
    const current = (await rows('select * from public.eup_proofs where assignment_id = $1', [seat12.id]))[0];
    const fresh = await sealAs(s0, tester12, await begin12(), String(r).repeat(64));
    // Rounds 0-3 start both at once; 4-6 give the submission a head start, 7-9 the discard: both orders occur.
    const head = (first) => (r >= 4 && r <= 6 && first === 'discard') || (r >= 7 && first === 'submit') ? sleep(25) : Promise.resolve();
    const [submitted, discarded] = await Promise.all([
      head('submit').then(() => outcome('submit', submit(S[r % 12], tester12, seat12, withMedia(fresh, `Round ${r}`), current.revision))),
      head('discard').then(() => outcome('discard', member(S[(r + 6) % 12], 'uploads.discard', { actor: tester12, id: fresh.id, document: {}, key: key('discard') })))]);
    tally(outcomes12, [`${submitted}+${discarded}`]);
    ok([['submit:ok', 'discard:EU014'], ['submit:EU014', 'discard:ok']].some(([a, b]) => a === submitted && b === discarded), `discard race ${r}: exactly one of submission and discard wins (${submitted}, ${discarded})`);
  }
  eq(Object.keys(outcomes12).sort(), ['submit:EU014+discard:ok', 'submit:ok+discard:EU014'], `discard raced submission in both orders: ${JSON.stringify(outcomes12)}`);

  // 5. The mix. Many rounds on twelve sessions of every command class that locks more than one row; in each round the
  //    members and the owners act on one mission AT ONCE. Requirements and capacity change under the participants,
  //    the mission is paused and released, the campaign is paused for a round now and then, and every twentieth round
  //    the mission is withdrawn mid-round (the cascade over applications, assignments, consents and publications) and
  //    replaced. Completed work is consented to, published, revoked, held and released; declined applications are
  //    appealed and the appeals resolved. Only documented refusals may occur, never a deadlock (40P01) or a leaked
  //    constraint error; the invariants are checked after every round. Meanwhile a consumer pages the outbox by
  //    "after": events commit in seq order, so it must read every event, in order, skipping none.
  const mix = await newCampaign('native-mix');
  let made = 0;
  const freshMission = () => newMission(mix, `mix-${made += 1}`, { capacity: 4 });
  const pool = [await freshMission(), await freshMission(), await freshMission()];
  const seen = {};
  const byAction = {};
  const ALLOWED = new Set(['ok', '40001', 'EU001', 'EU011', 'EU013', 'EU015', 'EU016', 'EU017', '22023']);
  const run = (action, promise) => promise.then(() => ({ action, code: 'ok' }), (error) => ({ action, code: error.code || 'client', message: error.message }));
  const reader = await session();
  const firstSeq = Number((await rows('select coalesce(max(seq), 0) as s from public.eup_outbox'))[0].s);
  const consumed = [];
  let consuming = true;
  const consumer = (async () => {
    let after = firstSeq;
    for (;;) {
      const page = await owner(reader, 'outbox.list', { actor: OWNER, document: { after, limit: C.LIMITS.list.outbox } });
      for (const event of page) { consumed.push(event.seq); after = event.seq; }
      if (!page.length) { if (!consuming) return; await sleep(3); }
    }
  })();
  for (let round = 0; round < ROUNDS; round += 1) {
    const slot = round % pool.length;
    const m = await mission(pool[slot].id);
    const before = {
      applications: await rows('select * from public.eup_applications where mission_id = $1', [m.id]),
      seats: await rows('select * from public.eup_assignments where mission_id = $1', [m.id]),
      proofs: await rows('select p.* from public.eup_proofs p join public.eup_assignments s on s.id = p.assignment_id where s.mission_id = $1', [m.id]),
      consents: await rows(`select * from public.eup_consents where mission_id = $1 and purpose = 'publish_proof' and revoked_at is null and superseded_at is null`, [m.id]),
      appeals: await rows('select x.* from public.eup_appeals x join public.eup_applications a on a.id = x.application_id where a.mission_id = $1', [m.id]),
      campaign: (await rows('select * from public.eup_campaigns where id = $1', [mix.id]))[0]
    };
    const work = [];
    let i = round;
    const next = () => S[(i += 1) % S.length];
    const mine = (action, args) => work.push(run(action, member(next(), action, { key: key('mix'), ...args })));
    const theirs = (action, args, label = action) => work.push(run(label, owner(next(), action, { actor: round % 2 ? OWNER : REVIEWER, key: key('mix'), ...args })));
    // members: apply or resubmit, withdraw, accept offers, submit proofs, leave now and then
    for (const [t, tester] of TESTERS.entries()) {
      const application = before.applications.find((a) => a.applicant === tester);
      const seat = before.seats.find((s) => s.participant === tester);
      const document = { submit: true, requirements_revision: m.requirements_revision, statement: `Mix statement, round ${round}.` };
      if (!application) mine('applications.save', { actor: tester, id: m.id, document, revision: 0 });
      else if (application.status === 'submitted' && (round + t) % 7 === 1) mine('applications.withdraw', { actor: tester, id: application.id, document: {} });
      else if (['submitted', 'withdrawn', 'changes_requested'].includes(application.status) && (round + t) % 3 === 0) mine('applications.save', { actor: tester, id: m.id, document, revision: application.revision });
      if (seat?.status === 'offered') mine('assignments.accept', { actor: tester, id: seat.id, document: { requirements_revision: m.requirements_revision, notice_revision: POLICY.notices.participation.revision }, revision: seat.revision });
      if (seat?.status === 'accepted') {
        const proof = before.proofs.find((p) => p.assignment_id === seat.id);
        if (!proof || ['submitted', 'needs_changes'].includes(proof.state)) mine('proofs.submit', { actor: tester, id: seat.id, document: WORDS(`Round ${round}\nby ${t}`), revision: proof ? proof.revision : 0 });
        if ((round + t) % 11 === 5) mine('assignments.withdraw', { actor: tester, id: seat.id, document: {} });
      }
    }
    // owners: decide every submitted application, review every submitted proof, and change the mission under them
    for (const a of before.applications.filter((x) => x.status === 'submitted')) {
      const decision = round % 7 === 6 ? { decision: 'declined', reason: 'Mix.' } : round % 5 === 4 ? { decision: 'changes_requested', reason: 'Mix.' } : { decision: 'approved' };
      theirs('applications.decide', { id: a.id, document: decision, revision: a.revision });
    }
    for (const p of before.proofs.filter((x) => x.state === 'submitted')) {
      theirs('proofs.review', { id: p.id, document: { asset_revision: p.asset_revision, mission_decision: round % 3 ? 'pass' : 'changes', rights_decision: 'pass', safety_decision: 'pass', ...(round % 3 ? {} : { reason: 'Mix.' }) }, revision: p.revision });
    }
    // owner control on the same mission at the same time: consent, publication, revocation, hold and release of
    // completed work; appeals against declined applications and their resolution
    for (const p of before.proofs.filter((x) => x.state === 'accepted')) {
      const participant = before.seats.find((s) => s.id === p.assignment_id).participant;
      const open = before.consents.find((k) => k.proof_id === p.id);
      if (!open) mine('consents.grant', { actor: participant, id: p.id, document: publishConsent(p), revision: p.revision });
      else {
        if (p.publication_state !== 'published_released_audience') theirs('publications.decide', { id: p.id, document: { decision: 'published', consent_id: open.id }, revision: p.revision });
        if ((round + p.revision) % 3 === 0) mine('consents.revoke', { actor: participant, id: open.id, document: {} });
      }
      // A hold is short: placed now and then, released the next time the mission comes round.
      if (p.moderation_state === 'held') theirs('proofs.moderate', { id: p.id, document: { hold: false, reason: 'Mix.' }, revision: p.revision });
      else if ((round + p.revision) % 7 === 0) theirs('proofs.moderate', { id: p.id, document: { hold: true, reason: 'Mix.' }, revision: p.revision });
    }
    for (const a of before.applications.filter((x) => x.status === 'declined')) {
      const appeals = before.appeals.filter((x) => x.application_id === a.id);
      const open = appeals.find((x) => x.state === 'open');
      if (open) theirs('appeals.resolve', { id: open.id, document: { outcome: round % 2 ? 'overturned' : 'upheld', reason: 'Mix.' } });
      else if (appeals.length < C.LIMITS.rate.appeals_per_subject) mine('appeals.open', { actor: a.applicant, id: a.id, document: { subject: 'application', statement: 'Mix appeal.' } });
    }
    if (round % 4 === 1) theirs('missions.update', { id: m.id, document: { requirements: `Fixture requirements, round ${round}.` }, revision: m.revision });
    if (round % 4 === 2) theirs('missions.update', { id: m.id, document: { capacity: 3 + (round % 3) }, revision: m.revision });
    if (round % 20 === 19) theirs('missions.transition', { id: m.id, document: { to: 'withdrawn' }, revision: m.revision }, 'missions.transition:withdrawn');
    else if (m.state === 'paused') theirs('missions.transition', { id: m.id, document: { to: 'released' }, revision: m.revision });
    else if (round % 8 === 3) theirs('missions.transition', { id: m.id, document: { to: 'paused' }, revision: m.revision });
    if (round % 10 === 5 && before.campaign.state === 'released') theirs('campaigns.transition', { id: mix.id, document: { to: 'paused' }, revision: before.campaign.revision });
    const results = await Promise.all(work);
    for (const r of results) {
      seen[r.code] = (seen[r.code] || 0) + 1;
      byAction[r.action] = byAction[r.action] || {};
      byAction[r.action][r.code] = (byAction[r.action][r.code] || 0) + 1;
    }
    const unexpected = results.filter((r) => !ALLOWED.has(r.code));
    assert.deepEqual(unexpected.map((r) => `${r.action} ${r.code}: ${r.message}`), [], `round ${round}: only the documented refusals occur (no deadlock, no leaked error)`);
    // Invariants after every round, over the whole database.
    const stale = await rows(`select s.id from public.eup_assignments s join public.eup_missions mm on mm.id = s.mission_id where s.status = 'accepted' and s.accepted_requirements_revision is distinct from mm.requirements_revision`);
    assert.deepEqual(stale, [], `round ${round}: no accepted assignment sits on a stale requirements revision`);
    const orphanReviews = await rows(`select r.id from public.eup_proof_reviews r left join public.eup_proof_revisions v on v.proof_id = r.proof_id and v.revision = r.proof_revision and v.asset_revision = r.asset_revision where v.proof_id is null`);
    assert.deepEqual(orphanReviews, [], `round ${round}: every review names a proof revision and digest that exist together`);
    const over = await rows(`select mm.id from public.eup_missions mm where mm.capacity is not null and (select count(*) from public.eup_assignments s where s.mission_id = mm.id and s.status in ('offered','accepted','completed')) > mm.capacity`);
    assert.deepEqual(over, [], `round ${round}: seats never exceed capacity`);
    const credits = await rows(`select s.id from public.eup_assignments s left join public.eup_mission_credits c on c.assignment_id = s.id group by s.id, s.status having (s.status = 'completed') <> (count(c.id) = 1)`);
    assert.deepEqual(credits, [], `round ${round}: a completed assignment has exactly one credit, and nothing else has one`);
    const openOnWithdrawn = await rows(`select a.id from public.eup_applications a join public.eup_missions mm on mm.id = a.mission_id where mm.state = 'withdrawn' and a.status in ('draft','submitted','changes_requested')
      union all select s.id from public.eup_assignments s join public.eup_missions mm on mm.id = s.mission_id where mm.state = 'withdrawn' and s.status in ('offered','accepted')`);
    assert.deepEqual(openOnWithdrawn, [], `round ${round}: a withdrawn mission has no open application and no open assignment, whatever raced its cascade`);
    const badPublications = await rows(`select b.id from public.eup_publications b join public.eup_consents k on k.id = b.consent_id join public.eup_proofs p on p.id = b.proof_id
        join public.eup_missions mm on mm.id = b.mission_id
       where b.state = 'published' and (k.revoked_at is not null or k.superseded_at is not null or p.moderation_state = 'held' or p.state <> 'accepted'
         or mm.state = 'withdrawn' or p.publication_state <> 'published_released_audience')
      union all select p.id from public.eup_proofs p where p.publication_state = 'published_released_audience'
        and (select count(*) from public.eup_publications b where b.proof_id = p.id and b.state = 'published') <> 1`);
    assert.deepEqual(badPublications, [], `round ${round}: every live publication stands on an open consent of an accepted, clear proof of a mission that is not withdrawn, and its proof says so`);
    // Between rounds: the campaign is released again and a withdrawn mission is replaced.
    const campaignNow = (await rows('select state, revision from public.eup_campaigns where id = $1', [mix.id]))[0];
    if (campaignNow.state !== 'released') await owner(s0, 'campaigns.transition', { actor: OWNER, id: mix.id, document: { to: 'released' }, revision: campaignNow.revision, key: key('mix') });
    if ((await mission(m.id)).state === 'withdrawn') pool[slot] = await freshMission();
  }
  consuming = false;
  await consumer;
  count += ROUNDS * 6;
  ok(!seen['40P01'], `${ROUNDS} rounds of mixed commands on ${S.length} sessions: zero deadlocks (${JSON.stringify(seen)})`);
  const succeeded = (action) => byAction[action]?.ok || 0;
  for (const action of ['applications.save', 'applications.withdraw', 'applications.decide', 'assignments.accept', 'assignments.withdraw', 'proofs.submit', 'proofs.review', 'missions.update', 'missions.transition',
    'missions.transition:withdrawn', 'campaigns.transition', 'consents.grant', 'consents.revoke', 'publications.decide', 'proofs.moderate', 'appeals.open', 'appeals.resolve']) {
    ok(succeeded(action) > 0, `the mix ran ${action} successfully (${JSON.stringify(byAction[action] || {})})`);
  }
  ok((seen['40001'] || 0) > 0 && (seen.EU013 || 0) > 0, 'and the commands really collided (40001 and EU013 occurred)');
  ok((await rows('select count(*)::int as n from public.eup_mission_credits'))[0].n > 0 && (await rows(`select count(*)::int as n from public.eup_publications where withdrawn_reason = 'mission_withdrawn'`))[0].n >= 0, 'completed work with credits came out of it');
  const committed = (await rows('select seq from public.eup_outbox where seq > $1 order by seq', [firstSeq])).map((r) => Number(r.seq));
  ok(committed.length > ROUNDS * 4, `the mix wrote ${committed.length} events`);
  eq(consumed, committed, `a consumer paging the outbox by "after" during the mix read all ${committed.length} events in seq order and skipped none`);

  // 7. Module drain: waits for an in-flight League write; afterwards new work is refused and reduce-only is admitted.
  const m5 = await newMission(campaign, 'drain');
  const kept = await consentFor(s0, done11[0].tester, done11[0].proof);
  await s1.query('begin');
  await apply(s1, TESTERS[4], m5);
  const revision = (await s0.query(`select public.eup_module_policy_read('league') as r`)).rows[0].r.revision;
  const draining = s2.query(`select public.eup_module_policy_command($1, 'league', 'draining', $2, $3, 'Test fixture: drain.') as r`, [OWNER, revision, key('drain')]);
  await until(async () => (await admin.query('select pg_blocking_pids($1) as b', [s2.pid])).rows[0].b.includes(s1.pid), 'the drain waits for the League writer');
  ok(true, 'the drain is blocked by the in-flight member write');
  const lateWriter = apply(s3, TESTERS[5], m5).then(() => 'ok', (e) => e.code);
  await until(async () => (await admin.query('select pg_blocking_pids($1) as b', [s3.pid])).rows[0].b.length > 0, 'the late writer queues behind the drain');
  await s1.query('commit');
  eq([(await draining).rows[0].r.policy.state, await lateWriter], ['draining', 'EUM02'], 'the in-flight write commits, the drain completes, and the writer that arrived after it is refused EUM02');
  eq((await rows('select count(*)::int as n from public.eup_applications where mission_id = $1', [m5.id]))[0].n, 1, 'exactly the pre-drain application exists');
  const mine5 = (await rows('select id from public.eup_applications where mission_id = $1', [m5.id]))[0];
  eq((await member(s3, 'applications.withdraw', { actor: TESTERS[4], id: mine5.id, document: {}, key: key('withdraw') })).status, 'withdrawn', 'a reduce-only member action is admitted while draining');
  eq((await member(s3, 'consents.revoke', { actor: done11[0].tester, id: kept.id, document: {}, key: key('revoke') })).state, 'revoked', 'and a consent revocation');
  eq((await owner(s3, 'missions.transition', { actor: OWNER, id: m5.id, document: { to: 'paused' }, revision: m5.revision, key: key('pause') })).state, 'paused', 'and a reduce-only owner action: a pause');
  eq((await owner(s3, 'proofs.moderate', { actor: OWNER, id: done11[1].proof.id, document: { hold: true, reason: 'Test fixture: hold while draining.' }, revision: done11[1].proof.revision, key: key('hold') })).moderation_state, 'held', 'and a hold');
  eq(await owner(s3, 'missions.create', { actor: OWNER, id: campaign.id, document: { ...SONG, slug: 'while-draining' }, key: key('mission') }).then(() => 'ok', (e) => e.code), 'EUM02', 'new owner work is refused');
  eq(await publish(s3, done11[2].proof, { id: randomUUID() }).then(() => 'ok', (e) => e.code), 'EUM02', 'a publication is new work and is refused');
  ok((await member(s3, 'me.get', { actor: TESTERS[4] })).applications.length > 0 && (await owner(s3, 'campaigns.list', { actor: OWNER })).length > 0
    && (await owner(s3, 'publications.list', { actor: OWNER })).length > 0 && (await owner(s3, 'outbox.list', { actor: OWNER, document: { limit: 1 } })).length === 1, 'reads answer while draining');

  console.log(`${count} league native assertions passed on PostgreSQL ${version} (${ROUNDS} mix rounds, ${S.length} sessions; outcomes ${JSON.stringify(seen)}).`);
  console.log(`mix outcomes by action: ${JSON.stringify(byAction)}`);
  console.log(`races: accept/update ${JSON.stringify(outcomes9)}; submit/review ${JSON.stringify(outcomes10)}; publish/revoke ${JSON.stringify(outcomes11)}; submit/discard ${JSON.stringify(outcomes12)}; outbox events read by the consumer ${consumed.length}`);
} finally {
  for (const c of clients) { if (c !== admin0) await c.end().catch(() => {}); }
  if (admin0) { await admin0.query(`drop database if exists ${DB} with (force)`).catch((e) => console.error('could not drop the test database:', e.message)); await admin0.end().catch(() => {}); }
  if (embedded) { await embedded.stop().catch(() => {}); await rm(embeddedDir, { recursive: true, force: true }).catch(() => {}); }
}
