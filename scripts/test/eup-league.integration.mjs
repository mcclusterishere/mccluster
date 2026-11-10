// Environmental Justice League against the actual pending SQL in isolated PGlite (serial; one session).
// The wire contract is workers/mccluster/src/eup/league-contract.js; this file proves the SQL keeps it.
// Proves: apply -> rollback -> re-apply leaves nothing behind; with Supabase-style default privileges on, anon and
// authenticated hold nothing and service_role holds exactly what the SECURITY INVOKER functions use; RLS on with no
// policy; the module guard trigger on every League domain table and not on the receipts table; the contract
// values embedded in SQL equal the contract; the SQL document checker agrees with the contract's checkDocument
// over a mutation corpus; both manifest vectors through the SQL canonicalisation; and the command rules listed
// beside each section below.
// PGlite is one session: lock ORDER and real races (same-key duplicates, capacity under contention, zero
// deadlocks, revocation racing publication) are NOT proven here; scripts/test/eup-league.native.integration.mjs
// proves them on real sessions. What is proven here about locks is that they are taken, and where.
import assert from 'node:assert/strict';
import * as C from '../../workers/mccluster/src/eup/league-contract.js';
import { drainModule, disableModule, enableModule, readModulePolicy } from './support/eup-module-policy-database.mjs';
import {
  createLeagueDatabase, leagueContractEmbedding, leagueSql, leagueRollbackSql, seedSongMission, sealed, key, SHA,
  OWNER, PEER, REVIEWER, TESTER, TESTER_B, OUTSIDER, OTHER_ORG_OWNER, UNKNOWN, FOREIGN_TENANT,
  LEAGUE_POLICY, CAMPAIGN, SONG, RIGHTS, LEAGUE_DECOYS, PUBLIC_PROJECTIONS
} from './support/eup-league-database.mjs';

const league = await createLeagueDatabase();
const { db, as, admin, owner, member, seal, tx } = league;
let count = 0;
const ok = (c, m) => { assert.ok(c, m); count++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); count++; };
async function rejects(fn, code, m) {
  let error = null;
  try { await fn(); } catch (e) { error = e; }
  assert.ok(error, `${m}: expected ${code}, but the call succeeded`);
  assert.equal(error.code, code, `${m}: ${error.message}`);
  count++;
  return error;
}
const U = (n) => `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const n = async (table, where = 'true') => (await admin(`select count(*)::int as n from public.${table} where ${where}`))[0].n;
const one = async (sql, params) => (await admin(sql, params))[0];
const LEAGUE_TABLES = `c.relnamespace = 'public'::regnamespace and c.relname like 'eup\\_%' and c.relname not like 'eup\\_module%'`;
const LEAGUE_FUNCTIONS = `p.pronamespace = 'public'::regnamespace and p.proname like 'eup\\_%' and p.proname not like 'eup\\_module%'`;
const objects = async () => one(`select
    (select count(*)::int from pg_class c where ${LEAGUE_TABLES}) as relations,
    (select count(*)::int from pg_proc p where ${LEAGUE_FUNCTIONS}) as functions,
    (select count(*)::int from pg_type t where t.typnamespace = 'public'::regnamespace and t.typname like 'eup\\_%' and t.typname not like 'eup\\_module%' and t.typname not like '\\_eup\\_module%') as types,
    (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and ${LEAGUE_TABLES}) as triggers`);
const fingerprint = async () => (await one(`select jsonb_build_object(
    'functions', (select jsonb_agg(jsonb_build_object('f', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', 'acl', p.proacl::text,
        'definer', p.prosecdef, 'config', p.proconfig::text, 'body', md5(p.prosrc)) order by p.proname, pg_get_function_identity_arguments(p.oid)) from pg_proc p where ${LEAGUE_FUNCTIONS}),
    'relations', (select jsonb_agg(jsonb_build_object('r', c.relname, 'kind', c.relkind, 'acl', c.relacl::text, 'rls', c.relrowsecurity) order by c.relname) from pg_class c where ${LEAGUE_TABLES}),
    'columns', (select jsonb_agg(jsonb_build_object('t', c.relname, 'c', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notnull', a.attnotnull) order by c.relname, a.attnum)
      from pg_attribute a join pg_class c on c.oid = a.attrelid where ${LEAGUE_TABLES} and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped),
    'constraints', (select jsonb_agg(jsonb_build_object('t', c.relname, 'def', pg_get_constraintdef(k.oid)) order by c.relname, pg_get_constraintdef(k.oid))
      from pg_constraint k join pg_class c on c.oid = k.conrelid where ${LEAGUE_TABLES}),
    'triggers', (select jsonb_agg(jsonb_build_object('on', c.relname, 'def', pg_get_triggerdef(t.oid)) order by c.relname, t.tgname)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and ${LEAGUE_TABLES})) as f`)).f;
const decoysEmpty = async (label) => { for (const t of LEAGUE_DECOYS) { const rows = (await admin(`select count(*)::int as n from ${t}`))[0].n; ok(rows === (t === 'storage.buckets' ? 1 : 0), `${label}: ${t} untouched`); } };
const moduleState = async () => (await readModulePolicy(db, 'league')).state;
// Runs `work` with the module in `state`, then returns it to enabled.
async function inState(state, work) {
  if (state === 'draining') await drainModule(db, 'league'); else if (state === 'disabled') await disableModule(db, 'league');
  try { return await work(); } finally { await enableModule(db, 'league', OWNER); }
}
const GUARD_CODE = { draining: 'EUM02', disabled: 'EUM03' };
// The tables. Mutable rows (select, insert, update for service_role) and append-only history (select, insert), all
// behind the module guard trigger; and the two tables without it: the receipts (an exact replay answers in every
// module state) and the accommodation access record (written by a read; reads answer in every module state).
const MUTABLE = ['eup_league_policy', 'eup_campaigns', 'eup_campaign_audience_grants', 'eup_missions', 'eup_applications', 'eup_assignments', 'eup_proof_drafts', 'eup_media_uploads', 'eup_proofs', 'eup_consents',
  'eup_publications', 'eup_appeals'];
const APPEND_ONLY = ['eup_league_policy_revisions', 'eup_campaign_revisions', 'eup_mission_revisions', 'eup_application_decisions', 'eup_assignment_acceptances', 'eup_proof_revisions', 'eup_proof_media', 'eup_proof_reviews', 'eup_mission_credits',
  'eup_proof_moderations', 'eup_outbox', 'eup_outbox_consumptions'];
const UNGUARDED = ['eup_command_receipts', 'eup_accommodation_reads'];

try {
  /* ================================================================== A. the file: apply, rollback, privileges */

  // A1. apply -> rollback -> re-apply: nothing of the League is left behind, the module policy stays, and the
  // second apply builds the identical schema. (Plain CREATE: applying twice without a rollback is an error.)
  const first = await fingerprint();
  const built = await objects();
  ok(built.relations > 26 && built.functions > 40 && built.triggers === MUTABLE.length + APPEND_ONLY.length, `the file builds relations, functions and ${MUTABLE.length + APPEND_ONLY.length} guard triggers (${JSON.stringify(built)})`);
  await league.rollback();
  eq(await objects(), { relations: 0, functions: 0, types: 0, triggers: 0 }, 'rollback leaves no eup_ relation, function, type or trigger behind (policy objects excepted)');
  ok((await one(`select count(*)::int as n from pg_proc where proname like 'eup\\_module%'`)).n >= 9 && (await moduleState()) === 'enabled', 'the module policy objects and the policy row survive the League rollback');
  await league.rollback(); count++; // a second rollback is a no-op, not an error
  await league.apply();
  eq(await fingerprint(), first, 're-apply builds the identical functions, tables, columns, constraints, triggers and grants');
  await rejects(() => league.apply().catch(async (e) => { await db.exec('rollback'); throw e; }), '42P07', 'applying on top of an applied schema is refused, not silently merged');
  eq(await fingerprint(), first, 'and the refused apply changed nothing');

  // A2. Private at the data boundary: RLS on, no policy, nothing for anon / authenticated / PUBLIC, and for
  // service_role exactly what the invoker functions use (history tables are append-only by privilege).
  const tables = await admin(`select c.relname as t, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
      (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
      (select count(*)::int from aclexplode(c.relacl) a where a.grantee = 0) as public_grants,
      (select coalesce(array_agg(x order by x), '{}') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x where has_table_privilege('anon', c.oid, x)) as anon,
      (select coalesce(array_agg(x order by x), '{}') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x where has_table_privilege('authenticated', c.oid, x)) as authenticated,
      (select coalesce(array_agg(x order by x), '{}') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x where has_table_privilege('service_role', c.oid, x)) as service_role
    from pg_class c where ${LEAGUE_TABLES} and c.relkind = 'r' order by c.relname`);
  eq(tables.map((t) => t.t), [...MUTABLE, ...APPEND_ONLY, ...UNGUARDED].sort(), `the League tables are exactly the expected ${MUTABLE.length + APPEND_ONLY.length + UNGUARDED.length}`);
  for (const t of tables) {
    const want = MUTABLE.includes(t.t) ? ['INSERT', 'SELECT', 'UPDATE'] : ['INSERT', 'SELECT'];
    ok(t.rls && t.policies === 0 && t.public_grants === 0 && t.anon.length === 0 && t.authenticated.length === 0, `${t.t}: RLS on, no policy, nothing for anon, authenticated or PUBLIC`);
    eq(t.service_role, want, `${t.t}: service_role holds exactly ${want.join(', ')}`);
  }
  // One sequence: the outbox's identity. Supabase default privileges would hand it to every API role; the file takes it
  // back from all of them, service_role included (an identity insert needs no sequence privilege).
  const sequences = await admin(`select c.relname as s, (select count(*)::int from aclexplode(c.relacl) a where a.grantee = 0) as public_grants,
      (select coalesce(array_agg(r || ':' || x order by r, x), '{}') from unnest(array['anon','authenticated','service_role']) r, unnest(array['USAGE','SELECT','UPDATE']) x where has_sequence_privilege(r, c.oid, x)) as held
    from pg_class c where ${LEAGUE_TABLES} and c.relkind = 'S'`);
  eq(sequences, [{ s: 'eup_outbox_seq_seq', public_grants: 0, held: [] }], 'the only sequence is the outbox identity, and no API role holds anything on it');
  await rejects(() => as('service_role', () => db.query(`select nextval('public.eup_outbox_seq_seq')`)), '42501', 'service_role cannot draw outbox numbers outside an insert');
  const functions = await admin(`select p.proname as f, p.prosecdef as definer, p.proconfig as config,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
      (select count(*)::int from aclexplode(p.proacl) a where a.grantee = 0) as public_grants
    from pg_proc p where ${LEAGUE_FUNCTIONS} order by p.proname`);
  ok(functions.every((f) => f.f.startsWith('eup_league_')), 'every League function carries the eup_league_ prefix the grant block covers');
  for (const f of functions) {
    ok(!f.anon && !f.authenticated && f.public_grants === 0 && f.service_role, `${f.f}: no EXECUTE for anon, authenticated or PUBLIC; service_role executes it`);
    ok((f.config || []).includes('search_path=""'), `${f.f}: search_path is pinned empty`);
  }
  eq(functions.filter((f) => f.definer).map((f) => f.f), ['eup_league_actor_known'], 'one definer function only: the account-exists check');
  const entry = functions.filter((f) => (f.config || []).includes('lock_timeout=5s')).map((f) => f.f);
  ok(entry.includes(C.RPC.owner) && entry.every((f) => Object.values(C.RPC).includes(f)), 'the entry points bound their lock waits to 5s (under the 8s statement timeout of the API role)');
  await rejects(() => as('anon', () => db.query('select * from public.eup_campaigns')), '42501', 'anon cannot read a League table');
  await rejects(() => as('authenticated', () => db.query('select * from public.eup_command_receipts')), '42501', 'authenticated cannot read receipts');
  await rejects(() => as('anon', () => db.query(`select public.${C.RPC.owner}('campaigns.list', $1, '', null, null, null)`, [OWNER])), '42501', 'anon cannot execute the owner command');
  await rejects(() => as('authenticated', () => db.query(`select public.${C.RPC.owner}('campaigns.list', $1, '', null, null, null)`, [OWNER])), '42501', 'authenticated cannot execute the owner command');
  await rejects(() => as('authenticated', () => db.query(`select public.eup_league_contract()`)), '42501', 'authenticated cannot execute a helper either');
  await rejects(() => as('service_role', () => db.query('select count(*) from auth.users')), '42501', 'harness fidelity: service_role cannot read auth.users, so the SQL cannot depend on it');
  await rejects(() => as('service_role', () => db.query(`delete from public.eup_campaigns`)), '42501', 'service_role holds no DELETE on a League table');
  await rejects(() => as('service_role', () => db.query(`update public.eup_proof_reviews set reason = 'x'`)), '42501', 'history tables are append-only by privilege');

  // A3. The module guard backstop: a statement trigger on every League domain table, none on the receipts table.
  const triggers = await admin(`select c.relname as t, t.tgname as name, p.proname as fn, encode(t.tgargs, 'escape') as args, t.tgtype::int as type
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and ${LEAGUE_TABLES} order by c.relname`);
  eq(triggers.map((t) => t.t), [...MUTABLE, ...APPEND_ONLY].sort(), 'every League domain table has the guard trigger; the receipts and the accommodation access record have none');
  // tgtype 30 = BEFORE (2) + INSERT (4) + DELETE (8) + UPDATE (16), statement level (bit 1 clear).
  ok(triggers.every((t) => t.name === `${t.t}_module_policy` && t.fn === 'eup_module_guard_trigger' && t.args.replace(/\\000$/, '') === 'league' && t.type === 30),
    'each is BEFORE INSERT OR UPDATE OR DELETE, FOR EACH STATEMENT, eup_module_guard_trigger(league)');

  // A4. The SQL text names none of the public projections, and has no EXCEPTION handler for a guard to hide under.
  const sqlText = await leagueSql();
  const code = sqlText.replace(/--[^\n]*/g, '');
  for (const name of PUBLIC_PROJECTIONS) ok(!sqlText.includes(name) && !(await leagueRollbackSql()).includes(name), `the SQL text does not name ${name}`);
  ok(!/\bexception\s+when\b/i.test(code), 'no EXCEPTION handler anywhere in the file');
  ok(!/\bstorage\./i.test(code) && !/\bpoints?\b|\bpayout|\bcommission|\bbroadcast/i.test(code), 'no storage access and no points, payout, commission or broadcast in the code');
  ok(!/security\s+definer/i.test(code.replace(/create function public\.eup_league_actor_known[^$]*\$\$[^$]*\$\$/i, '')), 'no other SECURITY DEFINER in the text');

  /* ================================================================== B. the embedded contract */

  // B1. What the SQL embeds IS the contract (document specs, patterns, text rules, limits, media table, actions).
  eq((await one('select public.eup_league_contract() as r')).r, leagueContractEmbedding(), 'public.eup_league_contract() equals the contract projection');
  eq((await one(`select public.eup_league_contract('{documents,policy}') as r`)).r, JSON.parse(JSON.stringify(C.DOCUMENTS.policy)), 'a path selects one part');
  // The enumerations the tables enforce by CHECK are the contract's.
  const checks = await admin(`select c.relname as t, pg_get_constraintdef(k.oid) as def from pg_constraint k join pg_class c on c.oid = k.conrelid where k.contype = 'c' and ${LEAGUE_TABLES}`);
  const literals = (table, column) => {
    const defs = checks.filter((k) => k.t === table && new RegExp(`\\(\\(?${column}( IS NULL\\) OR \\(${column})? = ANY`).test(k.def));
    assert.equal(defs.length, 1, `${table}.${column} has one enumeration CHECK`);
    return [...defs[0].def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]);
  };
  const ENUM_COLUMNS = [
    ['eup_campaigns', 'state', C.ENUMS.CAMPAIGN_STATES], ['eup_campaigns', 'audience', C.ENUMS.AUDIENCES], ['eup_missions', 'state', C.ENUMS.MISSION_STATES],
    ['eup_missions', 'template', C.ENUMS.TEMPLATES], ['eup_applications', 'status', C.ENUMS.APPLICATION_STATUSES], ['eup_application_decisions', 'decision', C.ENUMS.APPLICATION_DECISIONS],
    ['eup_assignments', 'status', C.ENUMS.ASSIGNMENT_STATUSES], ['eup_campaign_audience_grants', 'state', C.ENUMS.GRANT_STATES],
    ['eup_media_uploads', 'kind', C.ENUMS.MEDIA_KINDS], ['eup_media_uploads', 'mime', Object.keys(C.MEDIA.types)], ['eup_media_uploads', 'ext', C.MEDIA.extensions],
    ['eup_media_uploads', 'state', C.ENUMS.UPLOAD_STATES], ['eup_media_uploads', 'family', C.ENUMS.MEDIA_FAMILIES], ['eup_media_uploads', 'rejected_reason', C.ENUMS.REJECT_REASONS],
    ['eup_proofs', 'state', C.ENUMS.PROOF_STATES], ['eup_proofs', 'moderation_state', C.ENUMS.MODERATION_STATES], ['eup_proofs', 'publication_state', C.ENUMS.PUBLICATION_STATES],
    ['eup_proof_reviews', 'mission_decision', C.ENUMS.DIMENSION_DECISIONS], ['eup_proof_reviews', 'rights_decision', C.ENUMS.DIMENSION_DECISIONS], ['eup_proof_reviews', 'safety_decision', C.ENUMS.DIMENSION_DECISIONS],
    ['eup_consents', 'purpose', C.ENUMS.CONSENT_PURPOSES], ['eup_consents', 'audience', C.ENUMS.CONSENT_AUDIENCES], ['eup_command_receipts', 'surface', C.ENUMS.SURFACES],
    ['eup_publications', 'state', C.ENUMS.PUBLICATION_ROW_STATES], ['eup_publications', 'withdrawn_reason', C.ENUMS.WITHDRAWN_REASONS],
    ['eup_appeals', 'subject', C.ENUMS.APPEAL_SUBJECTS], ['eup_appeals', 'state', C.ENUMS.APPEAL_STATES]
  ];
  for (const [table, column, values] of ENUM_COLUMNS) eq(literals(table, column).sort(), [...values].sort(), `${table}.${column} is the contract enumeration`);
  ok(C.ENUMS.SCAN_STATES.length === 1 && checks.some((k) => k.t === 'eup_media_uploads' && k.def.includes(`scan_state = '${C.ENUMS.SCAN_STATES[0]}'::text`)), 'scan_state can only say not_scanned');
  for (const impossible of C.ENUMS.IMPOSSIBLE_AUDIENCES) {
    await rejects(() => admin(`insert into public.eup_campaigns(tenant, slug, title, audience, document, created_by) values ($1, 'impossible-audience', 't', $2, '{}', $1)`, [OWNER, impossible]), '23514', `audience ${impossible} is impossible by CHECK, even for a direct write`);
  }
  // No column anywhere for a path, a URL, a token, points or money.
  const columns = (await admin(`select c.relname || '.' || a.attname as col from pg_attribute a join pg_class c on c.oid = a.attrelid where ${LEAGUE_TABLES} and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`)).map((r) => r.col);
  eq(columns.filter((c) => /path|url|token|point|payout|payment|commission|price|amount|broadcast/.test(c)), [], 'no column stores a path, URL, token, points or money');
  eq(columns.filter((c) => c.startsWith('eup_mission_credits.')).map((c) => c.split('.')[1]).sort(),
    Object.keys(C.SHAPES.credit).sort(), 'the credit table has exactly the contract credit fields: nothing for consent, publication, media or accommodation');

  // B2. The document checker: SQL eup_league_check and the contract's checkDocument give the same verdict for
  // every document spec over a mutation corpus (missing, null, wrong type, unknown key, bounds, control
  // characters, duplicates). Values the JSON type itself refuses (NUL, a lone surrogate) never reach SQL.
  const PROOF = { title: 'Fixture song', lyrics: 'Verse one\nChorus\twith a tab', credits: [{ name: 'Fixture Person', role: 'writer' }], rights: RIGHTS,
    media: [{ upload_id: U(4), sha256: SHA('a') }], review_notice_revision: 'fixture-review-1' };
  const { media: _proofMedia, ...WORDS } = PROOF;
  const CONSENT = { purpose: 'publish_proof', audience: 'released_audience', asset_revision: SHA('a'), notice_revision: 'fixture-publication-1', expires_at: '2027-01-01T00:00:00Z' };
  const BASES = {
    policy: [LEAGUE_POLICY, { ...LEAGUE_POLICY, media: { enabled: false } }, { ...LEAGUE_POLICY, entitlement: 'not_decided', media: { enabled: true, kinds: ['audio'], audio_max_bytes: 10, max_duration_seconds: 5 } }],
    policy_set: [{ policy: LEAGUE_POLICY, reason: 'Fixture reason' }],
    campaign_create: [{ slug: 'x-y', title: 't', purpose: 'p\nq', audience: 'admin_preview' }],
    transition: [{ to: 'released' }], audience_set: [{ audience: 'invited' }], grant: [{ account: U(2), note: 'n' }], grant_revoke: [{ reason: 'r' }, {}],
    mission_create: [{ ...SONG, capacity: 3, rubric: { application: [{ id: 'fit', label: 'Fits' }], proof: [{ id: 'complete', label: 'Complete' }, { id: 'credits', label: 'Credited' }] } },
      { slug: 'explain-a-source', title: 't', template: 'explain-a-source', proof_modes: ['text', 'link'], requirements: 'r', capacity: null }],
    mission_update: [{ title: 't', proof_modes: ['audio', 'lyrics'], capacity: null, requirements: 'r', acceptance: 'a', rubric: { proof: [] } }, { capacity: 5 }],
    application_create: [{ applicant: U(2), requirements_revision: 1, statement: 's', accommodation: { statement: 'a' } }],
    application_save: [{ submit: true, requirements_revision: 1, statement: 's\nt', accommodation: null }, { submit: false, requirements_revision: 1, statement: '', accommodation: { statement: 'x' } }],
    application_decide: [{ decision: 'changes_requested', reason: 'r', rubric: [{ id: 'fit', met: true, note: 'n' }] }, { decision: 'approved' }],
    applications_filter: [{ status: 'submitted' }], assignment_accept: [{ requirements_revision: 2, notice_revision: 'fixture-participation-1' }],
    draft_save: [{ title: '', lyrics: 'half a line', credits: [{ name: '', role: '' }], rights: { owns_master: true, version: 'music-rights-v1', derivative_permissions: '' }, media: [U(4)], accommodation: { statement: '' } }, {}],
    upload_begin: [{ kind: 'audio', mime: 'audio/webm', bytes: 4, duration_seconds: 3 }, { kind: 'video', mime: 'video/mp4', bytes: 1 }],
    upload_get: [{ sign: true }, {}],
    seal_result: [sealed(4, { object_id: U(9) }), { outcome: 'rejected', reason: 'empty' }],
    proof_submit: [PROOF, { ...WORDS, accommodation: { statement: 'I cannot record.\nHere are my words.' } }, { ...PROOF, rights: { ...RIGHTS, parody_or_derivative: true, derivative_permissions: 'Fixture permission note' } }],
    proofs_filter: [{ state: 'submitted' }], proof_get: [{ revision: 1, media: true }],
    proof_review: [{ asset_revision: SHA('a'), mission_decision: 'changes', rights_decision: 'pass', safety_decision: 'pass', reason: 'r', rubric: [{ id: 'credits', met: false }] },
      { asset_revision: SHA('a'), mission_decision: 'pass', rights_decision: 'pass', safety_decision: 'pass' }],
    proof_moderate: [{ hold: true, reason: 'r' }], consent_grant: [CONSENT], publications_filter: [{ state: 'published' }],
    publication_decide: [{ decision: 'published', consent_id: U(5) }, { decision: 'withdrawn', reason: 'r' }],
    appeal_open: [{ subject: 'proof', statement: 's' }], appeals_filter: [{ state: 'open' }], appeal_resolve: [{ outcome: 'overturned', reason: 'r' }],
    media_due: [{ uploads: [U(1)], limit: 5 }, {}], media_purged: [{ uploads: [U(1), U(2)] }],
    outbox_list: [{ after: 0, limit: 10, consumer: 'c1' }], outbox_ack: [{ consumer: 'c1' }],
    receipt_get: [{ operation: 'proofs.submit', key: 'fixture-key-0001' }], empty: [{}]
  };
  eq(Object.keys(BASES).sort(), Object.keys(C.DOCUMENTS).sort(), 'the corpus has a base document for every contract document');
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const setAt = (root, path, value, remove = false) => {
    const copy = clone(root);
    if (!path.length) return value;
    let node = copy;
    for (const k of path.slice(0, -1)) node = node[k];
    const last = path.at(-1);
    if (remove) { if (Array.isArray(node)) node.splice(last, 1); else delete node[last]; } else node[last] = value;
    return copy;
  };
  const LENGTHS = [0, 1, 2, 39, 40, 41, 63, 64, 65, 79, 80, 81, 120, 121, 128, 129, 180, 181, 200, 201, 500, 501, 2000, 2001, 4000, 4001, 8000, 8001, 10000, 10001];
  const NUMBERS = [-1, 0, 1, 2, 1.5, 3, 5, 12, 13, 24, 25, 30, 50, 51, 200, 201, 366, 3600, 3601, 3650, 3651, 100000, 100001, 104857600, 104857601, 2147483646, 2147483647, 9007199254740991, 9007199254740992, 1e21];
  const TIMES = ['2027-01-01', '2027-01-01T00:00:00+02:00', '2027-13-01T00:00:00Z', 'never', '2027-01-01T00:00:00.123456Z', '2027-01-01T00:00:00.1234567Z', '2027-06-30T23:59:59Z', '2027-00-10T00:00:00Z', '2027-01-32T00:00:00Z', '2027-01-01T00:60:00Z', ' 2027-01-01T00:00:00Z'];
  function* mutations(root) {
    const walk = function* (value, path) {
      const at = path.join('.') || '$';
      yield [`${at} removed`, setAt(root, path, null, true)];
      for (const wrong of [null, 0, 1.5, 'x', true, false, [], {}, [[]], { zz: 1 }]) yield [`${at} := ${JSON.stringify(wrong)}`, setAt(root, path, wrong)];
      if (typeof value === 'string') {
        for (const tail of ['\n', '\t', '\r', '\u0007', '\u001f', '\u007f', '\u0085', ' ']) yield [`${at} + ${JSON.stringify(tail)}`, setAt(root, path, value + tail)];
        for (const len of LENGTHS) yield [`${at} length ${len}`, setAt(root, path, 'a'.repeat(len))];
        for (const len of [1, 180, 181, 10000, 10001]) yield [`${at} astral length ${len}`, setAt(root, path, '\u{1F30D}'.repeat(len))];
        yield [`${at} upper`, setAt(root, path, value.toUpperCase())];
        yield [`${at} trailing dot`, setAt(root, path, `${value}.`)];
        if (C.PATTERNS.timestamp.test(value)) for (const t of TIMES) yield [`${at} time ${t}`, setAt(root, path, t)];
      } else if (typeof value === 'number') {
        for (const num of NUMBERS) yield [`${at} := ${num}`, setAt(root, path, num)];
        yield [`${at} as text`, setAt(root, path, String(value))];
      } else if (typeof value === 'boolean') {
        yield [`${at} flipped`, setAt(root, path, !value)];
        yield [`${at} as text`, setAt(root, path, String(value))];
      } else if (Array.isArray(value)) {
        yield [`${at} emptied`, setAt(root, path, [])];
        if (value.length) {
          yield [`${at} first repeated`, setAt(root, path, [...value, clone(value[0])])];
          if (typeof value[0] === 'string') yield [`${at} first repeated in upper case`, setAt(root, path, [...value, value[0].toUpperCase()])];
          for (const size of [2, 3, 4, 5, 6, 12, 13, 24, 25, 50, 51]) {
            const distinct = Array.from({ length: size }, (_, i) => (typeof value[0] === 'string' && C.PATTERNS.uuid.test(value[0]) ? U(1000 + i)
              : value[0] && typeof value[0] === 'object' && 'id' in value[0] ? { ...value[0], id: `c${i}` }
                : value[0] && typeof value[0] === 'object' && 'upload_id' in value[0] ? { ...value[0], upload_id: U(2000 + i) } : clone(value[0])));
            yield [`${at} with ${size} entries`, setAt(root, path, distinct)];
          }
        }
        for (let i = 0; i < value.length; i += 1) yield* walk(value[i], [...path, i]);
      } else if (value && typeof value === 'object') {
        yield [`${at} + unknown key`, setAt(root, [...path, 'zz_unknown'], 1)];
        for (const refused of ['location', 'gps', 'points', 'payout', 'actor', 'applicant', 'participant', 'user_id', 'tenant', 'object_ref', 'path', 'url']) yield [`${at} + ${refused}`, setAt(root, [...path, refused], 'x')];
        for (const k of Object.keys(value)) yield* walk(value[k], [...path, k]);
      }
    };
    yield ['unchanged', clone(root)];
    for (const top of [null, 0, 'x', true, [], [{}]]) yield [`whole := ${JSON.stringify(top)}`, top];
    yield* walk(root, []);
  }
  let corpus = 0; let accepted = 0;
  const mismatches = [];
  for (const [name, bases] of Object.entries(BASES)) {
    const cases = bases.flatMap((base, b) => [...mutations(base)].map(([label, value]) => ({ label: `${name}#${b} ${label}`, value })));
    for (let i = 0; i < cases.length; i += 100) {
      const chunk = cases.slice(i, i + 100);
      const rows = await admin(`select t.i::int as i, public.eup_league_check(public.eup_league_contract(array['documents', $1]), t.v) as problem
        from jsonb_array_elements($2::jsonb) with ordinality t(v, i) order by t.i`, [name, JSON.stringify(chunk.map((c) => c.value))]);
      assert.equal(rows.length, chunk.length, `${name}: every case came back`);
      chunk.forEach((c, j) => {
        const js = C.checkDocument(C.DOCUMENTS[name], c.value);
        if ((js === null) !== (rows[j].problem === null)) mismatches.push(`${c.label}: contract says ${js ?? 'valid'}, SQL says ${rows[j].problem ?? 'valid'}`);
        if (js === null) accepted += 1;
      });
      corpus += chunk.length;
    }
  }
  eq(mismatches.slice(0, 20), [], `the SQL checker and the contract's checkDocument agree on every one of ${corpus} documents`);
  ok(corpus > 10000 && accepted > 1500 && accepted < corpus / 2, `the corpus is not one-sided (${corpus} documents, ${accepted} valid)`);
  // Every bundled base is valid in both, and every rule name the contract uses is implemented in SQL.
  for (const [name, bases] of Object.entries(BASES)) for (const base of bases) {
    ok(C.checkDocument(C.DOCUMENTS[name], base) === null && (await one(`select public.eup_league_check(public.eup_league_contract(array['documents', $1]), $2::jsonb) as p`, [name, JSON.stringify(base)])).p === null, `${name}: the base document is valid in the contract and in SQL`);
  }
  eq((await one(`select public.eup_league_rule('no_such_rule', '{}'::jsonb) as r`)).r, false, 'an unknown rule refuses');
  const usedRules = new Set(JSON.stringify(C.DOCUMENTS).match(/"rules":\[[^\]]*\]/g).flatMap((m) => JSON.parse(`{${m}}`).rules));
  eq([...usedRules].sort(), Object.keys(C.RULES).sort(), 'every contract rule is used by a document (so the corpus above exercised each in SQL)');
  // The JSON type refuses what the text rules call malformed, before any function runs.
  await rejects(() => admin(`select public.eup_league_check(public.eup_league_contract('{documents,empty}'), $1::jsonb)`, ['{"a":"x\\u0000y"}']), '22P05', 'a NUL never reaches the checker');
  await rejects(() => admin(`select public.eup_league_check(public.eup_league_contract('{documents,empty}'), $1::jsonb)`, ['{"a":"x\\ud800y"}']), '22P02', 'a lone surrogate never reaches the checker');
  // Deliberately stricter than a permissive date parser: an impossible instant is refused in SQL.
  for (const t of ['2027-02-30T00:00:00Z', '2027-02-29T00:00:00Z', '2027-01-01T24:00:00Z', '2027-01-01T23:59:60Z', '0000-01-01T00:00:00Z', '2027-04-31T00:00:00Z']) {
    eq((await one('select public.eup_league_timestamp_ok($1) as r', [t])).r, false, `${t} is not a real UTC instant`);
  }
  for (const t of ['2028-02-29T00:00:00Z', '2027-12-31T23:59:59.999999Z', '2000-02-29T12:00:00Z']) eq((await one('select public.eup_league_timestamp_ok($1) as r', [t])).r, true, `${t} is accepted`);
  // The two text helpers the design names: multi-line text takes LF and TAB, a single line takes neither.
  const text = async (fn, value, min = 1, max = 100) => (await one(`select public.${fn}(to_jsonb($1::text), $2, $3) as r`, [value, min, max])).r;
  eq([await text('eup_league_multiline_ok', 'a\nb\tc'), await text('eup_league_multiline_ok', 'a\rb'), await text('eup_league_multiline_ok', 'a\u0007b'), await text('eup_league_multiline_ok', 'a\u007fb'), await text('eup_league_multiline_ok', '')],
    [true, false, false, false, false], 'multi-line text: line feed and tab accepted, carriage return and other control characters refused');
  eq([await text('eup_league_text_ok', 'one line'), await text('eup_league_text_ok', 'two\nlines'), await text('eup_league_text_ok', 'tab\there'), await text('eup_league_text_ok', '\u{1F30D}'.repeat(100)), await text('eup_league_text_ok', '\u{1F30D}'.repeat(101))],
    [true, false, false, true, false], 'one line of text: no line feed, no tab, and length counted in code points');
  eq((await one('select public.eup_league_policy_valid($1::jsonb) as a, public.eup_league_policy_valid($2::jsonb) as b, public.eup_league_policy_valid(null) as c',
    [JSON.stringify(LEAGUE_POLICY), JSON.stringify({ ...LEAGUE_POLICY, state: 'enabled' })])), { a: true, b: false, c: false }, 'policy validity: the fixture is valid, a state field is not configuration, null is invalid');

  // B3. asset_revision: both contract vectors through the SQL canonicalisation, byte for byte.
  for (const vector of C.MANIFEST_VECTORS) {
    const manifest = C.proofManifest(vector.input);
    const row = await one('select public.eup_league_canonical_json($1::jsonb) as canonical, public.eup_league_asset_revision($1::jsonb) as digest', [JSON.stringify(manifest)]);
    eq(row.canonical, vector.canonical, `${vector.name}: SQL canonical JSON equals the contract vector`);
    eq(row.digest, vector.asset_revision, `${vector.name}: SQL asset_revision equals the contract vector`);
    eq(row.digest, await C.assetRevision(manifest), `${vector.name}: and equals the contract's own digest function`);
  }
  eq((await one(`select public.eup_league_canonical_json('{"b":[1,{"z":null,"a":true}],"a":"\\u0001/\\u00e9"}'::jsonb) as r`)).r, '{"a":"\\u0001/é","b":[1,{"a":true,"z":null}]}', 'keys sorted in byte order, control characters escaped, slash and non-ASCII as themselves');

  /* ================================================================== C. owner command */

  // C1. Authorization first: house ownership, rechecked on every call, for reads and mutations alike.
  for (const [who, actor] of [['a house member who is not an owner', PEER], ['a signed-in outsider', OUTSIDER], ['the owner of another organisation', OTHER_ORG_OWNER], ['an unknown account', UNKNOWN], ['no actor', null]]) {
    await rejects(() => owner('campaigns.list', { actor }), '42501', `${who} cannot read`);
    await rejects(() => owner('campaigns.create', { actor, document: CAMPAIGN, key: key('denied') }), '42501', `${who} cannot write`);
  }
  await rejects(() => owner('no.such.action', { actor: OWNER }), '22023', 'an unknown action is refused');
  await rejects(() => owner(null, { actor: OWNER }), '22023', 'a missing action is refused');
  // Every owner action of the contract exists, and a non-owner is refused before anything else.
  for (const action of Object.keys(C.OWNER_ACTIONS)) {
    await rejects(() => owner(action, { actor: PEER, id: U(1), document: {}, revision: 1, key: key('owner-only') }), '42501', `${action}: a non-owner is refused before anything else`);
  }
  await rejects(() => owner('campaigns.create', { actor: OWNER, document: CAMPAIGN }), '22023', 'a mutation needs an idempotency key');
  await rejects(() => owner('campaigns.create', { actor: OWNER, document: CAMPAIGN, key: 'short' }), '22023', 'a malformed idempotency key is refused');
  await rejects(() => owner('campaigns.transition', { actor: OWNER, id: 'not-a-uuid', document: { to: 'released' }, revision: 1, key: key('bad-id') }), '22023', 'a malformed id is refused, not cast');
  await rejects(() => owner('campaigns.transition', { actor: OWNER, document: { to: 'released' }, revision: 1, key: key('no-id') }), '22023', 'an action that names a row needs its id');
  await rejects(() => owner('campaigns.create', { actor: OWNER, document: { ...CAMPAIGN, purpose: 'x'.repeat(50000) }, key: key('huge') }), '22023', 'a document over the byte cap is refused');
  eq(await n('eup_command_receipts'), 0, 'a refused command leaves no receipt');
  eq(await owner('campaigns.list', { actor: OWNER }), [], 'the owner reads an empty list');

  // C2. League policy: configuration only, owner-set, every revision kept.
  eq(await owner('policy.get', { actor: OWNER }), { revision: 0, document: null, valid: false, updated_by: null, updated_at: null }, 'no policy row: revision 0, document null, not valid');
  await rejects(() => owner('policy.set', { actor: OWNER, document: { policy: { ...LEAGUE_POLICY, state: 'enabled' }, reason: 'r' }, revision: 0, key: key('policy') }), '22023', 'a policy with a state field is refused: module state is not League configuration');
  await rejects(() => owner('policy.set', { actor: OWNER, document: { policy: { ...LEAGUE_POLICY, media: { enabled: true } }, reason: 'r' }, revision: 0, key: key('policy') }), '22023', 'media enabled without kinds and caps is refused');
  await rejects(() => owner('policy.set', { actor: OWNER, document: { policy: LEAGUE_POLICY }, revision: 0, key: key('policy') }), '22023', 'a policy change needs a reason');
  await rejects(() => owner('policy.set', { actor: OWNER, document: { policy: LEAGUE_POLICY, reason: 'r' }, revision: 1, key: key('policy') }), '40001', 'revision 1 when no row exists is a conflict');
  await rejects(() => owner('policy.set', { actor: OWNER, document: { policy: LEAGUE_POLICY, reason: 'r' }, key: key('policy') }), '22023', 'the expected revision is required');
  const policyKey = key('policy');
  const policy1 = await owner('policy.set', { actor: OWNER, document: { policy: LEAGUE_POLICY, reason: 'Test fixture: first policy.' }, revision: 0, key: policyKey });
  ok(policy1.revision === 1 && policy1.valid === true && policy1.updated_by === OWNER, 'the first policy is revision 1');
  eq(policy1.document, JSON.parse(JSON.stringify(LEAGUE_POLICY)), 'the stored document is the one sent');
  eq(await owner('policy.set', { actor: OWNER, document: { policy: LEAGUE_POLICY, reason: 'Test fixture: first policy.' }, revision: 0, key: policyKey }), policy1, 'exact replay returns the stored result');
  await rejects(() => owner('policy.set', { actor: OWNER, document: { policy: LEAGUE_POLICY, reason: 'r' }, revision: 0, key: key('policy') }), '40001', 'revision 0 when a row exists is a conflict');
  const policy2 = await owner('policy.set', { actor: REVIEWER, document: { policy: { ...LEAGUE_POLICY, entitlement: 'not_decided' }, reason: 'Test fixture: undecided entitlement.' }, revision: 1, key: key('policy') });
  ok(policy2.revision === 2 && policy2.document.entitlement === 'not_decided' && policy2.updated_by === REVIEWER, 'a second owner changes it with compare-and-swap');
  eq((await admin('select revision, reason, actor from public.eup_league_policy_revisions order by revision')).map((r) => [r.revision, r.reason, r.actor]),
    [[1, 'Test fixture: first policy.', OWNER], [2, 'Test fixture: undecided entitlement.', REVIEWER]], 'every revision is kept with its reason and actor');
  await owner('policy.set', { actor: OWNER, document: { policy: LEAGUE_POLICY, reason: 'Test fixture: back to none_required.' }, revision: 2, key: key('policy') });

  // C3. Campaigns: created draft and admin_preview; idempotency; the lifecycle; audience and tester grants.
  const campaignKey = key('campaign');
  const campaignA = await owner('campaigns.create', { actor: OWNER, document: CAMPAIGN, key: campaignKey });
  ok(campaignA.state === 'draft' && campaignA.audience === 'admin_preview' && campaignA.revision === 1 && campaignA.tenant === OWNER && campaignA.created_by === OWNER, 'created draft, admin_preview, revision 1, in the house tenant');
  eq(Object.keys(campaignA).sort(), Object.keys(C.shapeFields('campaign')).sort(), 'the result is exactly the contract campaign shape');
  const receiptsAfterCreate = await n('eup_command_receipts');
  eq(await owner('campaigns.create', { actor: OWNER, document: CAMPAIGN, key: campaignKey }), campaignA, 'exact replay returns the same campaign');
  eq([await n('eup_campaigns'), await n('eup_campaign_revisions'), await n('eup_command_receipts')], [1, 1, receiptsAfterCreate], 'a replay changes no row count');
  await rejects(() => owner('campaigns.create', { actor: OWNER, document: { ...CAMPAIGN, title: 'Other' }, key: campaignKey }), 'EU003', 'the same key with a different payload is a conflict');
  await rejects(() => owner('campaigns.create', { actor: REVIEWER, document: CAMPAIGN, key: campaignKey }), '23505', 'the same key under another actor is an independent command (and here meets the slug)');
  await rejects(() => owner('campaigns.create', { actor: OWNER, document: CAMPAIGN, key: key('campaign') }), '23505', 'a duplicate slug is refused');
  for (const audience of ['invited', 'members', 'public']) await rejects(() => owner('campaigns.create', { actor: OWNER, document: { ...CAMPAIGN, slug: 'wider', audience }, key: key('campaign') }), '22023', `a campaign cannot be created ${audience}`);
  for (const banned of ['points_policy', 'payment_policy', 'agency_commission_policy', 'live_broadcast_enabled']) await rejects(() => owner('campaigns.create', { actor: OWNER, document: { ...CAMPAIGN, slug: 'paid', [banned]: null }, key: key('campaign') }), '22023', `${banned} is not a League field`);
  eq([await n('eup_campaigns'), await n('eup_command_receipts')], [1, receiptsAfterCreate], 'failed commands left no campaign and no receipt');
  eq((await owner('campaigns.create', { actor: REVIEWER, document: { ...CAMPAIGN, slug: 'campaign-b', audience: 'admin_preview' }, key: campaignKey })).created_by, REVIEWER, 'the same key under another actor works: receipts are per actor');
  let campaignB = (await owner('campaigns.list', { actor: OWNER })).find((c) => c.slug === 'campaign-b');
  ok(campaignB.document.audience === undefined && campaignB.audience === 'admin_preview', 'the audience lives in its column, not in the stored document');

  await rejects(() => owner('campaigns.transition', { actor: OWNER, id: campaignA.id, document: { to: 'released' }, revision: 7, key: key('transition') }), '40001', 'a stale campaign revision is a conflict');
  await rejects(() => owner('campaigns.transition', { actor: OWNER, id: campaignA.id, document: { to: 'paused' }, revision: 1, key: key('transition') }), '22023', 'draft -> paused is not in the lifecycle');
  await rejects(() => owner('campaigns.transition', { actor: OWNER, id: campaignA.id, document: { to: 'draft' }, revision: 1, key: key('transition') }), '22023', 'nothing returns to draft');
  await rejects(() => owner('campaigns.transition', { actor: OWNER, id: U(404), document: { to: 'released' }, revision: 1, key: key('transition') }), 'P0002', 'an unknown campaign is not found');
  let a = await owner('campaigns.transition', { actor: OWNER, id: campaignA.id, document: { to: 'released' }, revision: 1, key: key('transition') });
  ok(a.state === 'released' && a.revision === 2, 'released with compare-and-swap');
  campaignB = await owner('campaigns.transition', { actor: OWNER, id: campaignB.id, document: { to: 'released' }, revision: campaignB.revision, key: key('transition') });

  // Audience: admin_preview by default; 'invited' only by explicit command; testers by grant.
  await rejects(() => owner('campaigns.audience.set', { actor: OWNER, id: a.id, document: { audience: 'public' }, revision: a.revision, key: key('audience') }), '22023', 'audience public cannot be set');
  await rejects(() => owner('campaigns.audience.set', { actor: OWNER, id: a.id, document: { audience: 'members' }, revision: a.revision, key: key('audience') }), '22023', 'audience members cannot be set');
  await rejects(() => owner('campaigns.audience.set', { actor: OWNER, id: a.id, document: { audience: 'invited' }, revision: 1, key: key('audience') }), '40001', 'audience change is compare-and-swap');
  // A grant may be recorded while the campaign is admin_preview; it has effect only while the audience is invited.
  const grantKey = key('grant');
  const grantA = await owner('audience.grants.grant', { actor: OWNER, id: a.id, document: { account: TESTER, note: 'Test fixture tester.' }, key: grantKey });
  eq(Object.keys(grantA).sort(), Object.keys(C.shapeFields('grant')).sort(), 'the grant result is exactly the contract grant shape');
  ok(grantA.state === 'open' && grantA.account === TESTER && grantA.granted_by === OWNER && grantA.revoked_at === null, 'an open grant for the tester');
  eq(await owner('audience.grants.grant', { actor: OWNER, id: a.id, document: { account: TESTER, note: 'Test fixture tester.' }, key: grantKey }), grantA, 'grant replay');
  await rejects(() => owner('audience.grants.grant', { actor: OWNER, id: a.id, document: { account: TESTER }, key: key('grant') }), '23505', 'one open grant per campaign and account');
  await rejects(() => owner('audience.grants.grant', { actor: OWNER, id: a.id, document: { account: UNKNOWN }, key: key('grant') }), 'P0002', 'a grant names an existing account');
  await rejects(() => owner('audience.grants.grant', { actor: OWNER, id: U(404), document: { account: TESTER }, key: key('grant') }), 'P0002', 'a grant names an existing campaign');
  await rejects(() => owner('audience.grants.list', { actor: OWNER, id: U(404) }), 'P0002', 'grants of an unknown campaign are not found');
  const grantGone = await owner('audience.grants.grant', { actor: OWNER, id: a.id, document: { account: OUTSIDER }, key: key('grant') });
  const revoked = await owner('audience.grants.revoke', { actor: REVIEWER, id: grantGone.id, document: { reason: 'Test fixture: revoked.' }, key: key('revoke') });
  ok(revoked.state === 'revoked' && revoked.revoked_by === REVIEWER && revoked.revoked_at !== null, 'a grant is revoked, by whom and when');
  await rejects(() => owner('audience.grants.revoke', { actor: OWNER, id: grantGone.id, document: {}, key: key('revoke') }), '40001', 'a revoked grant is not revoked again');
  await rejects(() => owner('audience.grants.revoke', { actor: OWNER, id: U(404), document: {}, key: key('revoke') }), 'P0002', 'an unknown grant is not found');
  eq((await owner('audience.grants.list', { actor: OWNER, id: a.id })).map((g) => [g.account, g.state]), [[TESTER, 'open'], [OUTSIDER, 'revoked']], 'the owner lists the grants of a campaign, oldest first');
  a = await owner('campaigns.audience.set', { actor: OWNER, id: a.id, document: { audience: 'invited' }, revision: a.revision, key: key('audience') });
  ok(a.audience === 'invited' && a.revision === 3, 'the audience is widened to invited by explicit command');
  await owner('audience.grants.grant', { actor: OWNER, id: campaignB.id, document: { account: TESTER_B }, key: key('grant') });
  campaignB = await owner('campaigns.audience.set', { actor: OWNER, id: campaignB.id, document: { audience: 'invited' }, revision: campaignB.revision, key: key('audience') });

  // C4. Missions: template rule, PATCH update, requirements_revision apart from the CAS revision, capacity kept.
  await rejects(() => owner('missions.create', { actor: OWNER, id: U(404), document: SONG, key: key('mission') }), 'P0002', 'a mission needs an existing campaign');
  await rejects(() => owner('missions.create', { actor: OWNER, id: a.id, document: { ...SONG, proof_modes: ['audio', 'video'] }, key: key('mission') }), '22023', 'a song without lyrics is refused');
  await rejects(() => owner('missions.create', { actor: OWNER, id: a.id, document: { ...SONG, proof_modes: ['lyrics'] }, key: key('mission') }), '22023', 'a song with neither audio nor video is refused');
  await rejects(() => owner('missions.create', { actor: OWNER, id: a.id, document: { ...SONG, proof_modes: ['audio', 'lyrics', 'link'] }, key: key('mission') }), '22023', 'a mode the song template does not allow is refused');
  for (const banned of ['points', 'reward', 'payout']) await rejects(() => owner('missions.create', { actor: OWNER, id: a.id, document: { ...SONG, [banned]: 10 }, key: key('mission') }), '22023', `${banned} is not a mission field`);
  const RUBRIC = { application: [{ id: 'fit', label: 'Fits the mission' }], proof: [{ id: 'complete', label: 'Words and one take' }, { id: 'credited', label: 'Everyone is credited' }] };
  let song = await owner('missions.create', { actor: OWNER, id: a.id, document: { ...SONG, capacity: 2, rubric: RUBRIC }, key: key('mission') });
  eq(Object.keys(song).sort(), Object.keys(C.shapeFields('mission')).sort(), 'the mission result is exactly the contract mission shape');
  ok(song.state === 'draft' && song.revision === 1 && song.requirements_revision === 1 && song.capacity === 2 && song.assigned === 0, 'created draft, revision 1, requirements_revision 1');
  eq(song.proof_modes, ['audio', 'video', 'lyrics'], 'proof modes keep the submitted order');
  await rejects(() => owner('missions.create', { actor: OWNER, id: a.id, document: SONG, key: key('mission') }), '23505', 'a duplicate mission slug in one campaign is refused');
  const explain = await owner('missions.create', { actor: OWNER, id: a.id, document: { slug: 'explain-a-source', title: 'Test fixture: explain a source', template: 'explain-a-source', proof_modes: ['text', 'link'], requirements: 'Fixture.' }, key: key('mission') });
  ok(explain.capacity === null, 'an omitted capacity means no limit');

  // PATCH semantics. The reproduced defect: an update without capacity silently removed the limit.
  song = await owner('missions.update', { actor: OWNER, id: song.id, document: { acceptance: 'Fixture acceptance, reworded.' }, revision: 1, key: key('update') });
  ok(song.capacity === 2 && song.revision === 2 && song.requirements_revision === 2 && song.document.acceptance === 'Fixture acceptance, reworded.' && song.document.requirements === SONG.requirements,
    'an update without capacity KEEPS the capacity; changing acceptance moves requirements_revision');
  song = await owner('missions.update', { actor: OWNER, id: song.id, document: { capacity: 1 }, revision: 2, key: key('update') });
  ok(song.capacity === 1 && song.revision === 3 && song.requirements_revision === 2, 'capacity alone never changes requirements_revision');
  song = await owner('missions.update', { actor: OWNER, id: song.id, document: { title: SONG.title, requirements: SONG.requirements }, revision: 3, key: key('update') });
  ok(song.revision === 4 && song.requirements_revision === 2, 'a requirements field sent with its current value is not a change');
  song = await owner('missions.update', { actor: OWNER, id: song.id, document: { capacity: null }, revision: 4, key: key('update') });
  ok(song.capacity === null && song.requirements_revision === 2, 'an explicit null removes the limit');
  song = await owner('missions.update', { actor: OWNER, id: song.id, document: { capacity: 2 }, revision: 5, key: key('update') });
  await rejects(() => owner('missions.update', { actor: OWNER, id: song.id, document: { title: 'x' }, revision: 1, key: key('update') }), '40001', 'a stale mission revision is a conflict');
  await rejects(() => owner('missions.update', { actor: OWNER, id: song.id, document: {}, revision: song.revision, key: key('update') }), '22023', 'an empty update is refused');
  await rejects(() => owner('missions.update', { actor: OWNER, id: song.id, document: { slug: 'other' }, revision: song.revision, key: key('update') }), '22023', 'the slug never changes');
  await rejects(() => owner('missions.update', { actor: OWNER, id: song.id, document: { template: 'explain-a-source' }, revision: song.revision, key: key('update') }), '22023', 'the template never changes');
  await rejects(() => owner('missions.update', { actor: OWNER, id: song.id, document: { proof_modes: ['lyrics'] }, revision: song.revision, key: key('update') }), '22023', 'the stored template still has to satisfy its proof rule');
  await rejects(() => owner('missions.update', { actor: OWNER, id: U(404), document: { capacity: 1 }, revision: 1, key: key('update') }), 'P0002', 'an unknown mission is not found');
  eq((await admin('select revision, requirements_revision, capacity from public.eup_mission_revisions where mission_id = $1 order by revision', [song.id])).map((r) => [r.revision, r.requirements_revision, r.capacity]),
    [[1, 1, 2], [2, 2, 2], [3, 2, 1], [4, 2, 1], [5, 2, null], [6, 2, 2]], 'every mission revision is kept with its requirements revision and capacity');

  await rejects(() => owner('missions.transition', { actor: OWNER, id: explain.id, document: { to: 'released' }, revision: explain.revision, key: key('transition') }), '22023', 'only a template with a proof rule can be released');
  await rejects(() => owner('missions.transition', { actor: OWNER, id: song.id, document: { to: 'paused' }, revision: song.revision, key: key('transition') }), '22023', 'draft -> paused is not in the lifecycle');
  await rejects(() => owner('missions.transition', { actor: OWNER, id: song.id, document: { to: 'released' }, revision: 1, key: key('transition') }), '40001', 'a stale mission revision is a conflict');
  // A mission cannot be released before its campaign.
  const draftCampaign = await owner('campaigns.create', { actor: OWNER, document: { ...CAMPAIGN, slug: 'still-draft' }, key: key('campaign') });
  const early = await owner('missions.create', { actor: OWNER, id: draftCampaign.id, document: SONG, key: key('mission') });
  await rejects(() => owner('missions.transition', { actor: OWNER, id: early.id, document: { to: 'released' }, revision: 1, key: key('transition') }), '22023', 'a mission is not released before its campaign');
  song = await owner('missions.transition', { actor: OWNER, id: song.id, document: { to: 'released' }, revision: song.revision, key: key('transition') });
  ok(song.state === 'released' && song.requirements_revision === 2, 'released; the release does not touch requirements_revision');
  const card = await owner('missions.preview', { actor: OWNER, id: song.id });
  eq(Object.keys(card).sort(), Object.keys(C.shapeFields('mission_card')).sort(), 'the preview is exactly the contract mission card');
  ok(card.open === true && card.requirements === SONG.requirements && card.acceptance === 'Fixture acceptance, reworded.' && card.seats_taken === 0 && card.capacity === 2 && card.requirements_revision === 2, 'the card carries the requirements the member will see');
  eq(card.rubric, RUBRIC, 'and the rubric');
  await rejects(() => owner('missions.preview', { actor: OWNER, id: U(404) }), 'P0002', 'an unknown mission has no preview');
  eq((await owner('missions.list', { actor: OWNER, id: a.id })).map((m) => m.slug), ['write-a-song', 'explain-a-source'], 'missions of one campaign, oldest first');
  ok((await owner('missions.list', { actor: OWNER })).length === 3 && (await owner('campaigns.list', { actor: OWNER })).find((c) => c.id === a.id).missions.length === 2, 'missions list with and without a campaign, and inside campaigns.list');

  // C5. Owner-recorded applications (the row keeps recorded_by) and decisions.
  const record = (applicant, extra = {}, mission = song) => owner('applications.create', { actor: OWNER, id: mission.id, document: { applicant, requirements_revision: mission.requirements_revision, statement: 'Recorded by the owner.\nSecond line.', ...extra }, key: key('record') });
  await rejects(() => record(OUTSIDER), 'EU011', 'an account outside the released audience cannot be recorded (its grant is revoked)');
  await rejects(() => record(TESTER_B), 'EU011', 'a tester of campaign B is not in the audience of campaign A');
  await rejects(() => record(UNKNOWN), 'P0002', 'an unknown account cannot be recorded');
  await rejects(() => owner('applications.create', { actor: OWNER, id: song.id, document: { applicant: TESTER, requirements_revision: 1, statement: 's' }, key: key('record') }), 'EU013', 'a stale requirements revision is refused');
  await rejects(() => owner('applications.create', { actor: OWNER, id: song.id, document: { requirements_revision: 2, statement: 's' }, key: key('record') }), '22023', 'the applicant is named explicitly');
  await rejects(() => owner('applications.create', { actor: OWNER, id: U(404), document: { applicant: TESTER, requirements_revision: 1, statement: 's' }, key: key('record') }), 'P0002', 'an unknown mission is not found');
  const recorded = await record(TESTER, { accommodation: { statement: 'Test fixture accommodation request.' } });
  eq(Object.keys(recorded).sort(), Object.keys(C.shapeFields('application_row')).sort(), 'the result is exactly the contract application row');
  ok(recorded.status === 'submitted' && recorded.recorded_by === OWNER && recorded.applicant === TESTER && recorded.requirements_revision === 2 && recorded.accommodation_requested === true, 'recorded submitted, marked recorded_by, bound to the current requirements');
  ok(!JSON.stringify(recorded).includes('accommodation request') && !JSON.stringify(recorded).includes('Recorded by the owner'), 'the result carries neither the statement nor the accommodation text');
  await rejects(() => record(TESTER), '23505', 'one application per mission and account');
  const listed = await owner('applications.list', { actor: OWNER, id: song.id, document: { status: 'submitted' } });
  ok(listed.length === 1 && listed[0].document.statement.startsWith('Recorded by the owner') && listed[0].accommodation_requested === true && !('accommodation' in listed[0]) && listed[0].decisions.length === 0,
    'the owner list shows the statement and only THAT an accommodation was requested');
  await rejects(() => owner('applications.list', { actor: OWNER, document: { status: 'paused' } }), '22023', 'an unknown status filter is refused');

  // No self-approval: the applicant never decides their own application, whoever recorded it.
  const own = await record(OWNER);
  await rejects(() => owner('applications.decide', { actor: OWNER, id: own.id, document: { decision: 'approved', rubric: [{ id: 'fit', met: true }] }, revision: 1, key: key('decide') }), 'EU002', 'an owner cannot approve their own application');
  await rejects(() => owner('applications.decide', { actor: OWNER, id: own.id, document: { decision: 'declined', reason: 'r', rubric: [{ id: 'fit', met: false }] }, revision: 1, key: key('decide') }), 'EU002', 'nor decline it');
  await rejects(() => owner('applications.decide', { actor: REVIEWER, id: own.id, document: { decision: 'approved', rubric: [{ id: 'fit', met: true }] }, revision: 9, key: key('decide') }), '40001', 'a stale application revision is a conflict');
  await rejects(() => owner('applications.decide', { actor: REVIEWER, id: own.id, document: { decision: 'approved' }, revision: 1, key: key('decide') }), '22023', 'the rubric answers every criterion');
  await rejects(() => owner('applications.decide', { actor: REVIEWER, id: own.id, document: { decision: 'approved', rubric: [{ id: 'fit', met: true }, { id: 'extra', met: true }] }, revision: 1, key: key('decide') }), '22023', 'and no criterion the mission does not have');
  await rejects(() => owner('applications.decide', { actor: REVIEWER, id: own.id, document: { decision: 'approved', rubric: [{ id: 'fit', met: false }] }, revision: 1, key: key('decide') }), '22023', 'approval needs every criterion met');
  await rejects(() => owner('applications.decide', { actor: REVIEWER, id: own.id, document: { decision: 'declined', rubric: [{ id: 'fit', met: false }] }, revision: 1, key: key('decide') }), '22023', 'a decline needs a reason');
  await rejects(() => owner('applications.decide', { actor: REVIEWER, id: U(404), document: { decision: 'approved' }, revision: 1, key: key('decide') }), 'P0002', 'an unknown application is not found');
  const decideKey = key('decide');
  const approved = await owner('applications.decide', { actor: REVIEWER, id: own.id, document: { decision: 'approved', rubric: [{ id: 'fit', met: true, note: 'Fixture note.' }] }, revision: 1, key: decideKey });
  eq(Object.keys(approved).sort(), Object.keys(C.shapeFields('application_decided')).sort(), 'the decision result is exactly the contract shape');
  eq(Object.keys(approved.assignment).sort(), Object.keys(C.shapeFields('assignment')).sort(), 'with exactly the contract assignment');
  ok(approved.status === 'approved' && approved.decided_by === REVIEWER && approved.revision === 2 && approved.assignment.status === 'offered' && approved.assignment.participant === OWNER
    && approved.assignment.offered_requirements_revision === 2 && approved.assignment.accepted_requirements_revision === null, 'approval creates one offered assignment bound to the current requirements');
  eq(await owner('applications.decide', { actor: REVIEWER, id: own.id, document: { decision: 'approved', rubric: [{ id: 'fit', met: true, note: 'Fixture note.' }] }, revision: 1, key: decideKey }), approved, 'decision replay returns the stored result');
  eq([await n('eup_assignments'), await n('eup_application_decisions')], [1, 1], 'and creates no second assignment or decision');
  await rejects(() => owner('applications.decide', { actor: REVIEWER, id: own.id, document: { decision: 'declined', reason: 'r', rubric: [{ id: 'fit', met: false }] }, revision: 2, key: key('decide') }), '40001', 'a decided application is not decided again');

  // Capacity is atomic and counted under the mission row lock: K seats, then EU001. Update below taken: EU001.
  const second = await record(TESTER_B, {}, song).catch((e) => e);
  ok(second.code === 'EU011', 'tester B still cannot be recorded on campaign A');
  await owner('audience.grants.grant', { actor: OWNER, id: a.id, document: { account: TESTER_B }, key: key('grant') });
  const peerGrant = await owner('audience.grants.grant', { actor: OWNER, id: a.id, document: { account: PEER }, key: key('grant') });
  const appB = await record(TESTER_B);
  const appPeer = await record(PEER);
  const answer = { rubric: [{ id: 'fit', met: true }] };
  const seatTwo = await owner('applications.decide', { actor: OWNER, id: recorded.id, document: { decision: 'approved', ...answer }, revision: 1, key: key('decide') });
  ok(seatTwo.assignment.status === 'offered' && (await owner('missions.preview', { actor: OWNER, id: song.id })).seats_taken === 2, 'the second seat is taken');
  await rejects(() => owner('applications.decide', { actor: OWNER, id: appB.id, document: { decision: 'approved', ...answer }, revision: 1, key: key('decide') }), 'EU001', 'capacity 2 refuses the third approval');
  eq([await n('eup_assignments'), (await owner('applications.list', { actor: OWNER, id: song.id })).find((x) => x.id === appB.id).status], [2, 'submitted'], 'the refused approval changed nothing');
  await rejects(() => owner('missions.update', { actor: OWNER, id: song.id, document: { capacity: 1 }, revision: song.revision, key: key('update') }), 'EU001', 'a capacity below the seats taken is refused');
  song = await owner('missions.update', { actor: OWNER, id: song.id, document: { capacity: 3 }, revision: song.revision, key: key('update') });
  const changes = await owner('applications.decide', { actor: OWNER, id: appB.id, document: { decision: 'changes_requested', reason: 'Test fixture: say more.', ...answer }, revision: 1, key: key('decide') });
  ok(changes.status === 'changes_requested' && changes.assignment === null && changes.decision_reason === 'Test fixture: say more.', 'changes requested, with the reason, no assignment');
  const declined = await owner('applications.decide', { actor: OWNER, id: appPeer.id, document: { decision: 'declined', reason: 'Test fixture: not this time.', rubric: [{ id: 'fit', met: false }] }, revision: 1, key: key('decide') });
  ok(declined.status === 'declined' && declined.assignment === null, 'declined');
  const history = (await owner('applications.list', { actor: OWNER, id: song.id })).find((x) => x.id === appPeer.id).decisions;
  eq(history.map((d) => [d.decision, d.reason, d.requirements_revision, d.decided_by]), [['declined', 'Test fixture: not this time.', 2, OWNER]], 'every decision is kept with its reason, requirements revision and decider');
  eq((await owner('assignments.list', { actor: OWNER, id: song.id })).map((s) => [s.participant, s.status]), [[OWNER, 'offered'], [TESTER, 'offered']], 'the owner lists assignments, oldest first');
  eq(Object.keys(await owner('overview', { actor: OWNER })).sort(), Object.keys(C.shapeFields('overview')).sort(), 'the overview is exactly the contract shape');

  // C6. Receipts: the caller reads their own, by operation and key, and nobody else's.
  const receipt = await owner('receipts.get', { actor: REVIEWER, document: { operation: 'applications.decide', key: decideKey } });
  eq(Object.keys(receipt).sort(), Object.keys(C.shapeFields('receipt')).sort(), 'the receipt is exactly the contract shape');
  eq([receipt.surface, receipt.operation, receipt.idempotency_key, receipt.result], ['owner', 'applications.decide', decideKey, approved], 'it carries the stored result');
  await rejects(() => owner('receipts.get', { actor: OWNER, document: { operation: 'applications.decide', key: decideKey } }), 'P0002', 'another owner cannot read it');
  await rejects(() => owner('receipts.get', { actor: REVIEWER, document: { operation: 'campaigns.create', key: decideKey } }), 'P0002', 'the operation is part of the key');
  await rejects(() => owner('receipts.get', { actor: REVIEWER, document: { operation: 'applications.decide' } }), '22023', 'a receipt read names operation and key');
  ok(!JSON.stringify(receipt).includes('Recorded by the owner'), 'a receipt holds no member-written text');

  // C7. The key is locked before the lookup: inside one transaction the advisory lock is held after the command,
  // for a first execution and for a replay alike. (That a concurrent duplicate then waits and replays is native proof.)
  // The two single-key advisory locks of a mutation have known keys: the receipt key and the tenant's outbox lock.
  const receiptLock = (actor, operation, k) => `hashtextextended('eup.league.receipt|' || '${OWNER}' || '|' || '${actor}' || '|' || '${operation}' || '|' || '${k}', 0)`;
  const OUTBOX_LOCK = `hashtextextended('eup.league.outbox|' || '${OWNER}', 0)`;
  const advisory = (t) => t.query(`select case when ((classid::bigint << 32) | objid::bigint) = (select ${OUTBOX_LOCK}) then 'outbox' else 'key' end as lock, mode, granted
      from pg_locks where locktype = 'advisory' and objsubid = 1 order by 1`);
  const lockEvidence = async (params) => tx(async (t) => {
    const before = (await t.query(`select count(*)::int as n from pg_locks where locktype = 'advisory' and objsubid = 1`)).rows[0].n;
    await t.query(`select public.${C.RPC.owner}($1, $2, $3, $4::jsonb, $5, $6)`, params);
    const held = (await advisory(t)).rows;
    const exact = (await t.query(`select count(*)::int as n from pg_locks where locktype = 'advisory' and objsubid = 1 and ((classid::bigint << 32) | objid::bigint) = (select ${receiptLock(params[1], params[0], params[5])})`)).rows[0].n;
    const module = (await t.query(`select mode from pg_locks where locktype = 'advisory' and objsubid = 2`)).rows.map((r) => r.mode);
    return { before, held, exact, module };
  });
  const lockKey = key('lock');
  const firstRun = await lockEvidence(['campaigns.create', OWNER, '', JSON.stringify({ ...CAMPAIGN, slug: 'lock-evidence' }), null, lockKey]);
  eq([firstRun.before, firstRun.held, firstRun.exact, firstRun.module], [0, [{ lock: 'key', mode: 'ExclusiveLock', granted: true }, { lock: 'outbox', mode: 'ExclusiveLock', granted: true }], 1, ['ShareLock']],
    'a first execution holds the receipt key lock, the module lock (shared) and the outbox lock to the end of its transaction');
  const replayRun = await lockEvidence(['campaigns.create', OWNER, '', JSON.stringify({ ...CAMPAIGN, slug: 'lock-evidence' }), null, lockKey]);
  eq([replayRun.held, replayRun.exact, replayRun.module], [[{ lock: 'key', mode: 'ExclusiveLock', granted: true }], 1, []], 'a replay takes the key lock and returns before any module or outbox lock');

  // C8. Module state: reads and exact replays answer in every state; reduce-only owner actions are admitted while
  // draining and disabled; every other mutation is refused with the guard's own code.
  const pausable = await seedSongMission(league, { slug: 'module-states', policy: null });
  let ms = { campaign: pausable.campaign, mission: pausable.mission };
  const spare = await owner('audience.grants.grant', { actor: OWNER, id: ms.campaign.id, document: { account: OUTSIDER }, key: key('grant') });
  const spare2 = await owner('audience.grants.grant', { actor: OWNER, id: ms.campaign.id, document: { account: PEER }, key: key('grant') });
  for (const state of ['draining', 'disabled']) {
    await inState(state, async () => {
      const refused = GUARD_CODE[state];
      ok((await owner('campaigns.list', { actor: OWNER })).length > 0 && (await owner('policy.get', { actor: OWNER })).valid && (await owner('overview', { actor: OWNER })).campaigns.released > 0
        && (await owner('missions.preview', { actor: OWNER, id: song.id })).open && (await owner('receipts.get', { actor: REVIEWER, document: { operation: 'applications.decide', key: decideKey } })).result.id === own.id,
      `${state}: owner reads answer`);
      eq(await owner('campaigns.create', { actor: OWNER, document: CAMPAIGN, key: campaignKey }), campaignA, `${state}: an exact replay answers with the stored result`);
      await rejects(() => owner('campaigns.create', { actor: OWNER, document: { ...CAMPAIGN, title: 'Other' }, key: campaignKey }), 'EU003', `${state}: a changed replay is still a conflict, not a guard refusal`);
      const blocked = [
        ['policy.set', { document: { policy: LEAGUE_POLICY, reason: 'r' }, revision: 3 }],
        ['campaigns.create', { document: { ...CAMPAIGN, slug: `while-${state}` } }],
        ['campaigns.transition', { id: draftCampaign.id, document: { to: 'released' }, revision: 1 }],
        ['campaigns.audience.set', { id: ms.campaign.id, document: { audience: 'invited' }, revision: ms.campaign.revision }],
        ['audience.grants.grant', { id: ms.campaign.id, document: { account: TESTER } }],
        ['missions.create', { id: ms.campaign.id, document: { ...SONG, slug: `while-${state}` } }],
        ['missions.update', { id: ms.mission.id, document: { capacity: 4 }, revision: ms.mission.revision }],
        ['missions.transition', { id: early.id, document: { to: 'released' }, revision: 1 }],
        ['applications.create', { id: song.id, document: { applicant: REVIEWER, requirements_revision: 2, statement: 's' } }],
        ['applications.decide', { id: appB.id, document: { decision: 'declined', reason: 'r', ...answer }, revision: 2 }]
      ];
      for (const [action, args] of blocked) await rejects(() => owner(action, { actor: OWNER, key: key('blocked'), ...args }), refused, `${state}: ${action} is refused ${refused}`);
      // Reduce-only: a grant revocation, and a transition to paused or withdrawn.
      const gone = await owner('audience.grants.revoke', { actor: OWNER, id: (state === 'draining' ? spare : spare2).id, document: {}, key: key('revoke') });
      ok(gone.state === 'revoked', `${state}: a grant revocation is admitted`);
      if (state === 'draining') {
        ms.mission = await owner('missions.transition', { actor: OWNER, id: ms.mission.id, document: { to: 'paused' }, revision: ms.mission.revision, key: key('transition') });
        ok(ms.mission.state === 'paused', 'draining: a mission pause is admitted');
        ms.campaign = await owner('campaigns.transition', { actor: OWNER, id: ms.campaign.id, document: { to: 'paused' }, revision: ms.campaign.revision, key: key('transition') });
        ok(ms.campaign.state === 'paused', 'draining: a campaign pause is admitted');
        await rejects(() => owner('missions.transition', { actor: OWNER, id: ms.mission.id, document: { to: 'released' }, revision: ms.mission.revision, key: key('transition') }), refused, 'draining: a re-release is not reduce-only and is refused');
      } else {
        ms.campaign = await owner('campaigns.transition', { actor: OWNER, id: ms.campaign.id, document: { to: 'withdrawn' }, revision: ms.campaign.revision, key: key('transition') });
        ok(ms.campaign.state === 'withdrawn', 'disabled: a campaign withdrawal is admitted');
        eq((await owner('missions.list', { actor: OWNER, id: ms.campaign.id })).map((m) => m.state), ['withdrawn'], 'disabled: and its cascade withdrew the mission in the same transaction');
        await rejects(() => owner('campaigns.transition', { actor: OWNER, id: draftCampaign.id, document: { to: 'bogus' }, revision: 1, key: key('transition') }), refused, 'disabled: a malformed transition is not reduce-only, so the guard answers first');
      }
      // The backstop: a direct table write obeys the module state too (it cannot carry the reduce marker).
      await rejects(() => as('service_role', () => db.query(`update public.eup_campaigns set title = 'direct write' where id = $1`, [a.id])), refused, `${state}: a direct service-role table write is refused by the trigger`);
      await rejects(() => as('service_role', () => db.query(`insert into public.eup_mission_credits(tenant, campaign_id, mission_id, assignment_id, participant, proof_id, proof_revision, asset_revision, review_id) select tenant, $1, id, id, created_by, id, 1, $2, id from public.eup_missions limit 1`, [a.id, SHA('a')])), refused, `${state}: also on an append-only table`);
    });
  }
  eq(await moduleState(), 'enabled', 'the module is enabled again');

  // C9. Tenant isolation: rows of another tenant, written directly, are invisible and their ids answer not found.
  const foreign = await one(`insert into public.eup_campaigns(tenant, slug, title, state, audience, document, created_by) values ($1, 'foreign-campaign', 'Foreign tenant fixture', 'released', 'invited', '{"slug":"foreign-campaign","title":"Foreign tenant fixture","purpose":"p"}', $2) returning id`, [FOREIGN_TENANT, OTHER_ORG_OWNER]);
  const foreignMission = await one(`insert into public.eup_missions(tenant, campaign_id, slug, title, template, state, proof_modes, document, created_by) values ($1, $2, 'write-a-song', 'Foreign mission', 'write-a-song', 'released', '{audio,lyrics}', $3::jsonb, $4) returning id`,
    [FOREIGN_TENANT, foreign.id, JSON.stringify({ ...SONG }), OTHER_ORG_OWNER]);
  ok(!(await owner('campaigns.list', { actor: OWNER })).some((c) => c.id === foreign.id) && !(await owner('missions.list', { actor: OWNER })).some((m) => m.id === foreignMission.id), 'a foreign tenant campaign and mission are in no list');
  eq((await owner('missions.list', { actor: OWNER, id: foreign.id })), [], 'nor reachable by naming the campaign');
  await rejects(() => owner('missions.preview', { actor: OWNER, id: foreignMission.id }), 'P0002', 'a foreign mission id is not found');
  await rejects(() => owner('campaigns.transition', { actor: OWNER, id: foreign.id, document: { to: 'paused' }, revision: 1, key: key('foreign') }), 'P0002', 'a foreign campaign id is not found for a mutation');
  await rejects(() => owner('missions.create', { actor: OWNER, id: foreign.id, document: { ...SONG, slug: 'intruder' }, key: key('foreign') }), 'P0002', 'no mission can be created under a foreign campaign');
  await rejects(() => owner('applications.create', { actor: OWNER, id: foreignMission.id, document: { applicant: TESTER, requirements_revision: 1, statement: 's' }, key: key('foreign') }), 'P0002', 'nor an application on a foreign mission');
  await rejects(() => owner('audience.grants.grant', { actor: OWNER, id: foreign.id, document: { account: TESTER }, key: key('foreign') }), 'P0002', 'nor a grant on a foreign campaign');
  await rejects(() => owner('campaigns.list', { actor: OTHER_ORG_OWNER }), '42501', 'the foreign tenant owner is not a house owner');
  await rejects(() => admin(`insert into public.eup_missions(tenant, campaign_id, slug, title, template, proof_modes, document, created_by) values ($1, $2, 'cross-tenant', 't', 'write-a-song', '{audio,lyrics}', '{}', $3)`, [OWNER, foreign.id, OWNER]), '23503', 'a row cannot name a parent in another tenant: the foreign key carries the tenant');

  await decoysEmpty('after the owner sections');

  /* ================================================================== D. member command */
  const NOTICES = LEAGUE_POLICY.notices;
  const STATEMENT = 'Test fixture statement: why I apply.\nSecond line.';
  const LYRICS = 'Verse one of a test fixture\nChorus\twith a tab\n\nLínea tres \u{1F30D}';
  const ACCOMMODATION = 'Test fixture: I cannot record.\nHere are my words.';
  const FIT = { rubric: [{ id: 'fit', met: true }] };
  const MET = { rubric: [{ id: 'complete', met: true }, { id: 'credited', met: true }] };
  const newMission = async (campaign, slug, extra = {}) => {
    const created = await owner('missions.create', { actor: OWNER, id: campaign.id, document: { ...SONG, slug, rubric: RUBRIC, ...extra }, key: key('mission') });
    return owner('missions.transition', { actor: OWNER, id: created.id, document: { to: 'released' }, revision: created.revision, key: key('release') });
  };
  const fresh = async (mission) => (await owner('missions.list', { actor: OWNER, id: mission.campaign_id })).find((x) => x.id === mission.id);
  const freshCampaign = async (campaign) => (await owner('campaigns.list', { actor: OWNER })).find((x) => x.id === campaign.id);
  const move = async (mission, to) => owner('missions.transition', { actor: OWNER, id: mission.id, document: { to }, revision: (await fresh(mission)).revision, key: key('move') });
  const moveCampaign = async (campaign, to) => owner('campaigns.transition', { actor: OWNER, id: campaign.id, document: { to }, revision: (await freshCampaign(campaign)).revision, key: key('move') });
  const apply = (actor, mission, extra = {}, revision = 0) => member('applications.save', { actor, id: mission.id, document: { submit: true, requirements_revision: mission.requirements_revision, statement: STATEMENT, ...extra }, revision, key: key('apply') });
  const approve = (application, reviewer = REVIEWER) => owner('applications.decide', { actor: reviewer, id: application.id, document: { decision: 'approved', ...FIT }, revision: application.revision, key: key('approve') });
  const acceptOffer = (actor, assignment, mission) => member('assignments.accept', { actor, id: assignment.id, document: { requirements_revision: mission.requirements_revision, notice_revision: NOTICES.participation.revision }, revision: assignment.revision, key: key('accept') });
  const enroll = async (actor, mission, reviewer = REVIEWER) => acceptOffer(actor, (await approve(await apply(actor, mission), reviewer)).assignment, mission);
  const words = (extra = {}) => ({ title: 'Test fixture song', lyrics: LYRICS, credits: [{ name: 'Fixture Person', role: 'writer' }, { name: 'Fixture Singer', role: 'voice' }], rights: RIGHTS,
    accommodation: { statement: ACCOMMODATION }, review_notice_revision: NOTICES.private_review.revision, ...extra });
  const submitProof = (actor, assignment, document = words(), revision = 0) => member('proofs.submit', { actor, id: assignment.id, document, revision, key: key('proof') });
  const review = (proof, decisions = {}, reviewer = REVIEWER, revision = proof.revision) => owner('proofs.review', { actor: reviewer, id: proof.id,
    document: { asset_revision: proof.asset_revision, mission_decision: 'pass', rights_decision: 'pass', safety_decision: 'pass', ...MET, ...decisions }, revision, key: key('review') });
  const me = (actor) => member('me.get', { actor });
  const expiry = (days) => new Date(Date.now() + days * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
  const publishConsent = (proof, extra = {}) => ({ purpose: 'publish_proof', audience: 'released_audience', asset_revision: proof.asset_revision, notice_revision: NOTICES.publication.revision, expires_at: expiry(30), ...extra });

  // Fixtures: campaign L (invited: TESTER), campaign B (invited: TESTER_B), a preview campaign (admin_preview, with a
  // grant that therefore has no effect), campaign A from above (invited: TESTER, TESTER_B, PEER; OUTSIDER revoked).
  const L = await seedSongMission(league, { slug: 'member-loop', invite: TESTER, policy: null, rubric: RUBRIC });
  let ML = L.mission;
  const missionB = await newMission(campaignB, 'write-a-song');
  const preview = await seedSongMission(league, { slug: 'preview-only', policy: null });
  await owner('audience.grants.grant', { actor: OWNER, id: preview.campaign.id, document: { account: TESTER }, key: key('grant') });
  await admin(`insert into public.eup_campaign_audience_grants(tenant, campaign_id, account, granted_by) values ($1, $2, $3, $4)`, [FOREIGN_TENANT, foreign.id, TESTER, OTHER_ORG_OWNER]);
  const draftDocument = { submit: false, requirements_revision: 1, statement: 'Half a thought' };

  // D1. The actor is a known account; the two functions do not share actions; every contract action is implemented.
  await rejects(() => me(null), '42501', 'no actor');
  await rejects(() => me(UNKNOWN), '42501', 'an unknown account is not a signed-in account');
  await rejects(() => member('applications.save', { actor: UNKNOWN, id: ML.id, document: draftDocument, revision: 0, key: key('unknown') }), '42501', 'an unknown account cannot write');
  await rejects(() => member('no.such.action', { actor: TESTER }), '22023', 'an unknown member action is refused');
  await rejects(() => member('campaigns.create', { actor: OWNER, document: CAMPAIGN, key: key('wrong-surface') }), '22023', 'the member function has no owner action, even for a house owner');
  await rejects(() => owner('applications.save', { actor: OWNER, id: ML.id, document: draftDocument, revision: 0, key: key('wrong-surface') }), '22023', 'and the owner function has no member action');
  await rejects(() => owner('proofs.submit', { actor: OWNER, id: U(1), document: {}, revision: 0, key: key('wrong-surface') }), '22023', 'the participant actions left the owner function');
  for (const action of Object.keys(C.MEMBER_ACTIONS)) {
    await rejects(() => member(action, { actor: UNKNOWN, id: U(1), document: {}, key: key('unknown') }), '42501', `${action}: an unknown account is refused first`);
  }
  // Every contract action is implemented: with nothing to act on, each answers something else than "unknown action"
  // or "not implemented". (The first pass deferred 11 owner and 2 member actions with 0A000; none is left.)
  eq([Object.keys(C.OWNER_ACTIONS).length, Object.keys(C.MEMBER_ACTIONS).length], [35, 15], 'the contract has 35 owner and 15 member actions');
  for (const [surface, call, actor] of [['owner', owner, OWNER], ['member', member, TESTER]]) for (const action of Object.keys(surface === 'owner' ? C.OWNER_ACTIONS : C.MEMBER_ACTIONS)) {
    const answer = await call(action, { actor, id: U(404), document: { receipt_probe: true }, revision: 1, key: key('probe') }).then(() => ({ code: 'ok', message: '' }), (e) => e);
    ok(answer.code !== '0A000' && !/Unknown action|not implemented/.test(answer.message), `${surface} ${action} is implemented (${answer.code})`);
  }
  await rejects(() => member('applications.save', { actor: TESTER, id: ML.id, document: draftDocument, revision: 0 }), '22023', 'a member mutation needs an idempotency key');
  await rejects(() => member('applications.save', { actor: TESTER, document: draftDocument, revision: 0, key: key('no-id') }), '22023', 'and the id of the row it names');
  await rejects(() => member('applications.save', { actor: TESTER, id: 'nope', document: draftDocument, revision: 0, key: key('bad-id') }), '22023', 'a malformed id is refused, not cast');

  // D2. The audience matrix, on the member read and on a mutation.
  const catalogue = async (actor) => (await me(actor)).catalogue.map((c) => c.slug).sort();
  const tryApply = (actor, mission) => member('applications.save', { actor, id: mission.id, document: draftDocument, revision: 0, key: key('matrix') });
  await rejects(() => me(OUTSIDER), 'EU011', 'a signed-in account that is invited nowhere (its only grant is revoked) has no League');
  await rejects(() => tryApply(OUTSIDER, ML), 'EU011', 'and cannot apply');
  await rejects(() => tryApply(OUTSIDER, song), 'EU011', 'a revoked grant gives nothing');
  await rejects(() => me(OTHER_ORG_OWNER), 'EU011', 'the owner of another organisation is not in any audience');
  await rejects(() => tryApply(OTHER_ORG_OWNER, ML), 'EU011', 'and cannot apply');
  eq(await catalogue(TESTER), ['fixture-campaign', 'member-loop'], 'the tester sees the campaigns that invited them: not campaign B, not the admin_preview campaign their grant sits on, not another tenant');
  await rejects(() => tryApply(TESTER, missionB), 'EU011', 'a tester of campaign A and L is not in the audience of campaign B');
  await rejects(() => tryApply(TESTER, preview.mission), 'EU011', 'a grant on an admin_preview campaign has no effect');
  await rejects(() => tryApply(TESTER, { id: foreignMission.id }), 'P0002', 'a mission of another tenant does not exist here, grant or not');
  eq(await catalogue(TESTER_B), ['campaign-b', 'fixture-campaign'], 'tester B sees campaign B and campaign A');
  await rejects(() => tryApply(TESTER_B, ML), 'EU011', 'tester B is not in the audience of campaign L');
  await rejects(() => tryApply(PEER, ML), 'EU011', 'a house member who is not an owner needs a grant like anyone else');
  eq(await catalogue(REVIEWER), ['campaign-b', 'fixture-campaign', 'member-loop', 'preview-only'], 'a house owner is in the audience of every released campaign (and sees no draft or withdrawn one)');
  const mine = await me(TESTER);
  eq(Object.keys(mine).sort(), Object.keys(C.shapeFields('me')).sort(), 'me.get is exactly the contract shape');
  eq(Object.keys(mine.catalogue[0]).sort(), Object.keys(C.shapeFields('member_campaign')).sort(), 'with contract member campaigns');
  const listedA = mine.catalogue.find((c) => c.slug === 'fixture-campaign');
  eq(listedA.missions.map((x) => x.slug), ['write-a-song'], 'only released missions are listed (the draft mission of campaign A is not)');
  eq(Object.keys(listedA.missions[0]).sort(), Object.keys(C.shapeFields('mission_card')).sort(), 'as mission cards');
  eq(listedA.missions[0], await owner('missions.preview', { actor: OWNER, id: song.id }), 'the owner preview IS the member view of the mission');
  eq([mine.actor, mine.policy.revision, mine.policy.entitlement, mine.policy.notices.participation.revision, mine.published], [TESTER, 3, 'none_required', NOTICES.participation.revision, []], 'the member reads the policy they will be held to, and nothing is published yet');
  eq(Object.keys(mine.policy).sort(), Object.keys(C.shapeFields('member_policy')).sort(), 'the member policy is the contract shape (no account id)');

  // D3. Applying: draft, read back, submit; the document is closed; the application compares its OWN revision.
  let application = await member('applications.save', { actor: TESTER, id: ML.id, document: draftDocument, revision: 0, key: key('apply') });
  eq(Object.keys(application).sort(), Object.keys(C.shapeFields('member_application')).sort(), 'the result is exactly the contract member application (no text, no account id)');
  ok(application.status === 'draft' && application.revision === 1 && application.recorded === false && application.accommodation_requested === false && application.requirements_revision === 1, 'a draft application, revision 1');
  let own1 = (await me(TESTER)).applications.find((x) => x.id === application.id);
  eq(Object.keys(own1).sort(), Object.keys(C.shapeFields('own_application')).sort(), 'the applicant reads it back as the contract own_application');
  eq([own1.document, own1.accommodation, own1.decisions, own1.appeals, own1.mission.id], [{ statement: 'Half a thought' }, null, [], [], ML.id], 'with the saved words');
  for (const refused of C.REFUSED_MEMBER_FIELDS) await rejects(() => member('applications.save', { actor: TESTER, id: ML.id, document: { ...draftDocument, [refused]: REVIEWER }, revision: 1, key: key('apply') }), '22023', `a document cannot name another account (${refused})`);
  await rejects(() => member('applications.save', { actor: TESTER, id: ML.id, document: draftDocument, revision: 0, key: key('apply') }), '40001', 'revision 0 means "I have none"; when one exists it is a conflict');
  await rejects(() => member('applications.save', { actor: TESTER, id: ML.id, document: draftDocument, revision: 7, key: key('apply') }), '40001', 'a stale application revision is a conflict');
  await rejects(() => member('applications.save', { actor: TESTER, id: ML.id, document: { ...draftDocument, requirements_revision: 2 }, revision: 1, key: key('apply') }), 'EU013', 'a requirements revision that is not the current one is refused');
  await rejects(() => member('applications.save', { actor: TESTER, id: ML.id, document: { submit: true, requirements_revision: 1 }, revision: 1, key: key('apply') }), '22023', 'submitting needs the statement in the document');
  await rejects(() => member('applications.save', { actor: TESTER, id: ML.id, document: { ...draftDocument, statement: 'bad\rreturn' }, revision: 1, key: key('apply') }), '22023', 'a carriage return is refused');
  application = await member('applications.save', { actor: TESTER, id: ML.id, document: { submit: false, requirements_revision: 1, accommodation: { statement: 'Test fixture accommodation request.' } }, revision: 1, key: key('apply') });
  own1 = (await me(TESTER)).applications.find((x) => x.id === application.id);
  ok(application.revision === 2 && application.accommodation_requested === true && own1.document.statement === 'Half a thought' && own1.accommodation.statement === 'Test fixture accommodation request.',
    'an omitted statement keeps the saved one; the applicant reads their own accommodation request');
  const ownerView = (await owner('applications.list', { actor: OWNER, id: ML.id }))[0];
  ok(ownerView.accommodation_requested === true && !JSON.stringify(ownerView).includes('accommodation request.'), 'the owner list shows only that a request exists');
  application = await member('applications.save', { actor: TESTER, id: ML.id, document: { submit: false, requirements_revision: 1, accommodation: null }, revision: 2, key: key('apply') });
  ok(application.accommodation_requested === false && application.status === 'draft', 'accommodation null clears the saved request');
  const submitKey = key('apply');
  const submitDocument = { submit: true, requirements_revision: 1, statement: STATEMENT };
  application = await member('applications.save', { actor: TESTER, id: ML.id, document: submitDocument, revision: 3, key: submitKey });
  ok(application.status === 'submitted' && application.revision === 4, 'submitted');
  const countsAfterSubmit = [await n('eup_applications'), await n('eup_command_receipts')];
  eq(await member('applications.save', { actor: TESTER, id: ML.id, document: submitDocument, revision: 3, key: submitKey }), application, 'exact replay returns the stored result');
  eq([await n('eup_applications'), await n('eup_command_receipts')], countsAfterSubmit, 'and changes no row count');
  await rejects(() => member('applications.save', { actor: TESTER, id: ML.id, document: { ...submitDocument, statement: 'Other words' }, revision: 3, key: submitKey }), 'EU003', 'the same key with another payload is a conflict');
  await rejects(() => member('applications.save', { actor: TESTER, id: ML.id, document: draftDocument, revision: 4, key: key('apply') }), '40001', 'a submitted application is not turned back into a draft by a save');
  application = await member('applications.save', { actor: TESTER, id: ML.id, document: { ...submitDocument, statement: `${STATEMENT}\nA third line.` }, revision: 4, key: key('apply') });
  ok(application.status === 'submitted' && application.revision === 5, 'a submitted application can be resubmitted with new words');

  // Withdrawal is the member's own and reversible.
  await owner('audience.grants.grant', { actor: OWNER, id: L.campaign.id, document: { account: TESTER_B }, key: key('grant') });
  await rejects(() => member('applications.withdraw', { actor: TESTER_B, id: application.id, document: {}, key: key('withdraw') }), '42501', 'another account cannot withdraw it');
  await rejects(() => member('applications.withdraw', { actor: TESTER, id: U(404), document: {}, key: key('withdraw') }), 'P0002', 'an unknown application is not found');
  await rejects(() => member('applications.withdraw', { actor: TESTER, id: application.id, document: { reason: 'x' }, key: key('withdraw') }), '22023', 'the withdrawal document is empty');
  application = await member('applications.withdraw', { actor: TESTER, id: application.id, document: {}, key: key('withdraw') });
  ok(application.status === 'withdrawn' && application.revision === 6, 'withdrawn');
  await rejects(() => member('applications.withdraw', { actor: TESTER, id: application.id, document: {}, key: key('withdraw') }), '40001', 'a withdrawn application is not withdrawn again');
  await rejects(() => owner('applications.decide', { actor: REVIEWER, id: application.id, document: { decision: 'approved', ...FIT }, revision: 6, key: key('decide') }), '40001', 'and cannot be decided');
  application = await member('applications.save', { actor: TESTER, id: ML.id, document: submitDocument, revision: 6, key: key('apply') });
  ok(application.status === 'submitted' && application.revision === 7, 'the member applies again after withdrawing');

  // The reproduced dead end: after a mission revision change an application could be neither approved nor re-applied.
  // Now a pause and re-release changes nothing for it, and a real requirements change asks for a resubmission.
  await move(ML, 'paused');
  await rejects(() => member('applications.save', { actor: TESTER, id: ML.id, document: submitDocument, revision: 7, key: key('apply') }), 'EU011', 'no application work on a paused mission');
  ML = await move(ML, 'released');
  ok(ML.requirements_revision === 1 && ML.revision === 4, 'pause and re-release moved the mission revision, not the requirements revision');
  ML = await owner('missions.update', { actor: OWNER, id: ML.id, document: { requirements: 'Fixture requirements, changed.\nWrite the words and record a take.' }, revision: ML.revision, key: key('update') });
  ok(ML.requirements_revision === 2, 'the owner changes the requirements');
  await rejects(() => owner('applications.decide', { actor: REVIEWER, id: application.id, document: { decision: 'approved', ...FIT }, revision: 7, key: key('decide') }), 'EU013', 'an application bound to older requirements is not approved');
  await rejects(() => apply(TESTER, { ...ML, requirements_revision: 1 }, {}, 7), 'EU013', 'and the applicant cannot resubmit against the old ones');
  application = await apply(TESTER, ML, {}, 7);
  ok(application.requirements_revision === 2 && application.revision === 8, 'the applicant resubmits against the current requirements');
  let decision = await owner('applications.decide', { actor: REVIEWER, id: application.id, document: { decision: 'changes_requested', reason: 'Test fixture: say a little more.', ...FIT }, revision: 8, key: key('decide') });
  application = await member('applications.save', { actor: TESTER, id: ML.id, document: { submit: false, requirements_revision: 2, statement: 'More, as asked.' }, revision: 9, key: key('apply') });
  ok(application.status === 'changes_requested', 'a draft save keeps changes_requested');
  application = await apply(TESTER, ML, { statement: 'More, as asked.\nAnd a second line.' }, 10);
  own1 = (await me(TESTER)).applications.find((x) => x.id === application.id);
  eq([application.status, own1.decisions.map((d) => [d.decision, d.reason])], ['submitted', [['changes_requested', 'Test fixture: say a little more.']]], 'resubmitted; the member reads the decision and its reason');
  eq(Object.keys(own1.decisions[0]).sort(), Object.keys(C.shapeFields('member_decision')).sort(), 'as a member decision: no decider id');
  ok((await owner('applications.list', { actor: OWNER, id: ML.id }))[0].decided_by === null, 'the row carries no stale decision while it waits again');
  decision = await approve(application);
  ok(decision.status === 'approved' && decision.assignment.status === 'offered' && decision.assignment.offered_requirements_revision === 2, 'and now it is approved: the dead end is gone');
  await rejects(() => apply(TESTER, ML, {}, decision.revision), '40001', 'an approved application is not changed');
  await rejects(() => member('applications.withdraw', { actor: TESTER, id: application.id, document: {}, key: key('withdraw') }), '40001', 'nor withdrawn');

  // D4. Accepting: the participant only, the exact requirements revision and participation notice revision.
  let assignment = decision.assignment;
  const acceptDocument = { requirements_revision: 2, notice_revision: NOTICES.participation.revision };
  await rejects(() => member('assignments.accept', { actor: REVIEWER, id: assignment.id, document: acceptDocument, revision: 1, key: key('accept') }), '42501', 'a house owner who is not the participant cannot accept');
  await rejects(() => member('assignments.accept', { actor: TESTER_B, id: assignment.id, document: acceptDocument, revision: 1, key: key('accept') }), '42501', 'another tester of the same campaign cannot accept');
  await rejects(() => member('assignments.accept', { actor: OUTSIDER, id: assignment.id, document: acceptDocument, revision: 1, key: key('accept') }), 'EU011', 'an account outside the audience gets the audience answer, not "not yours"');
  await rejects(() => member('assignments.accept', { actor: TESTER, id: U(404), document: acceptDocument, revision: 1, key: key('accept') }), 'P0002', 'an unknown assignment is not found');
  await rejects(() => member('assignments.accept', { actor: TESTER, id: assignment.id, document: acceptDocument, revision: 5, key: key('accept') }), '40001', 'a stale assignment revision is a conflict');
  await rejects(() => member('assignments.accept', { actor: TESTER, id: assignment.id, document: { ...acceptDocument, requirements_revision: 1 }, revision: 1, key: key('accept') }), 'EU013', 'an older requirements revision is not what is on offer');
  await rejects(() => member('assignments.accept', { actor: TESTER, id: assignment.id, document: { ...acceptDocument, notice_revision: 'fixture-participation-0' }, revision: 1, key: key('accept') }), 'EU013', 'nor an older participation notice');
  await rejects(() => member('assignments.accept', { actor: TESTER, id: assignment.id, document: { requirements_revision: 2 }, revision: 1, key: key('accept') }), '22023', 'acceptance names the notice revision');
  await rejects(() => member('drafts.save', { actor: TESTER, id: assignment.id, document: {}, revision: 0, key: key('draft') }), 'EU013', 'no work before the offer is accepted');
  // The reproduced dead end: an offered assignment was stranded by a pause. Pause, re-release, accept.
  await move(ML, 'paused');
  await rejects(() => member('assignments.accept', { actor: TESTER, id: assignment.id, document: acceptDocument, revision: 1, key: key('accept') }), 'EU011', 'no acceptance while the mission is paused');
  ML = await move(ML, 'released');
  assignment = await member('assignments.accept', { actor: TESTER, id: assignment.id, document: acceptDocument, revision: 1, key: key('accept') });
  eq(Object.keys(assignment).sort(), Object.keys(C.shapeFields('assignment')).sort(), 'the result is exactly the contract assignment');
  ok(assignment.status === 'accepted' && assignment.revision === 2 && assignment.accepted_requirements_revision === 2 && assignment.accepted_notice_revision === NOTICES.participation.revision && assignment.accepted_at !== null,
    'accepted after a pause and re-release: what was accepted is recorded exactly');
  await rejects(() => member('assignments.accept', { actor: TESTER, id: assignment.id, document: acceptDocument, revision: 2, key: key('accept') }), '40001', 'an accepted assignment is not accepted again');

  // D5. The working copy: compare-and-swap, full replace, lenient, never evidence.
  const draftKey = key('draft');
  const draft1 = await member('drafts.save', { actor: TESTER, id: assignment.id, document: { title: '', lyrics: 'Half a line\nand another', credits: [{ name: '', role: '' }], media: [U(77)] }, revision: 0, key: draftKey });
  eq(Object.keys(draft1).sort(), Object.keys(C.shapeFields('draft_saved')).sort(), 'the result is exactly the contract draft_saved (no text)');
  eq(await member('drafts.save', { actor: TESTER, id: assignment.id, document: { title: '', lyrics: 'Half a line\nand another', credits: [{ name: '', role: '' }], media: [U(77)] }, revision: 0, key: draftKey }), draft1, 'draft replay');
  await rejects(() => member('drafts.save', { actor: TESTER, id: assignment.id, document: {}, revision: 0, key: key('draft') }), '40001', 'revision 0 when a draft exists is a conflict');
  await rejects(() => member('drafts.save', { actor: TESTER, id: assignment.id, document: {}, revision: 9, key: key('draft') }), '40001', 'a stale draft revision is a conflict');
  await rejects(() => member('drafts.save', { actor: TESTER, id: assignment.id, document: { lyrics: 'a\rb' }, revision: 1, key: key('draft') }), '22023', 'a carriage return is refused in a draft too');
  await rejects(() => member('drafts.save', { actor: TESTER, id: assignment.id, document: { location: 'x' }, revision: 1, key: key('draft') }), '22023', 'a draft is a closed document as well');
  await rejects(() => member('drafts.save', { actor: TESTER_B, id: assignment.id, document: {}, revision: 1, key: key('draft') }), '42501', 'another participant cannot write this draft');
  const draft2 = await member('drafts.save', { actor: TESTER, id: assignment.id, document: { lyrics: 'Replaced' }, revision: 1, key: key('draft') });
  const ownAssignment = (await me(TESTER)).assignments.find((x) => x.id === assignment.id);
  eq(Object.keys(ownAssignment).sort(), Object.keys(C.shapeFields('own_assignment')).sort(), 'the participant reads the assignment as the contract own_assignment');
  eq([draft2.revision, ownAssignment.draft.document, ownAssignment.draft.revision, ownAssignment.uploads, ownAssignment.proof, ownAssignment.credit], [2, { lyrics: 'Replaced' }, 2, [], null, null], 'a save replaces the whole working copy, and it is read back');
  eq(Object.keys(ownAssignment.draft).sort(), Object.keys(C.shapeFields('draft')).sort(), 'as the contract draft');

  // D6. A requirements change returns open assignments to offered and blocks work until the participant accepts again.
  ML = await owner('missions.update', { actor: OWNER, id: ML.id, document: { capacity: 5 }, revision: ML.revision, key: key('update') });
  eq((await owner('assignments.list', { actor: OWNER, id: ML.id })).map((x) => [x.status, x.revision]), [['accepted', 2]], 'a capacity change asks nobody to accept again');
  ML = await owner('missions.update', { actor: OWNER, id: ML.id, document: { title: 'Test fixture: write a song, retitled' }, revision: ML.revision, key: key('update') });
  const reoffered = (await owner('assignments.list', { actor: OWNER, id: ML.id }))[0];
  eq([ML.requirements_revision, reoffered.status, reoffered.revision, reoffered.offered_requirements_revision, reoffered.accepted_requirements_revision], [3, 'offered', 3, 3, 2], 'a requirements change returns the accepted assignment to offered at the new revision');
  await rejects(() => member('drafts.save', { actor: TESTER, id: assignment.id, document: {}, revision: 2, key: key('draft') }), 'EU013', 'the draft is blocked until the new requirements are accepted');
  await rejects(() => submitProof(TESTER, assignment), 'EU013', 'and so is proof submission');
  await rejects(() => member('assignments.accept', { actor: TESTER, id: assignment.id, document: acceptDocument, revision: 3, key: key('accept') }), 'EU013', 'accepting the old requirements revision is refused');
  assignment = await acceptOffer(TESTER, reoffered, ML);
  ok(assignment.status === 'accepted' && assignment.accepted_requirements_revision === 3 && assignment.revision === 4, 'accepted again, against the current requirements');
  eq((await admin('select requirements_revision, notice_revision, actor from public.eup_assignment_acceptances where assignment_id = $1 order by accepted_at', [assignment.id])).map((r) => [r.requirements_revision, r.notice_revision, r.actor]),
    [[2, NOTICES.participation.revision, TESTER], [3, NOTICES.participation.revision, TESTER]], 'the acceptance history has both acceptances');

  // D7. Submitting a proof privately. The accommodation path has equal standing; media proofs follow in section E.
  await rejects(() => submitProof(TESTER, assignment, words(), 1), '40001', 'the first submission replaces revision 0');
  await rejects(() => submitProof(TESTER_B, assignment), '42501', 'another participant cannot submit for this assignment');
  await rejects(() => submitProof(TESTER, { id: U(404) }), 'P0002', 'an unknown assignment is not found');
  for (const [why, document] of [
    ['a title is one line', words({ title: 'two\nlines' })], ['a carriage return in the lyrics', words({ lyrics: 'a\r\nb' })], ['a bell character in the lyrics', words({ lyrics: 'a\u0007b' })],
    ['a DEL character in the lyrics', words({ lyrics: 'a\u007fb' })], ['empty lyrics', words({ lyrics: '' })], ['no credits', words({ credits: [] })], ['no rights attestation', words({ rights: undefined })],
    ['rights without samples_cleared', words({ rights: { ...RIGHTS, samples_cleared: undefined } })], ['a derivative without permissions', words({ rights: { ...RIGHTS, parody_or_derivative: true } })],
    ['an unknown attestation version', words({ rights: { ...RIGHTS, version: 'music-rights-v2' } })], ['neither media nor accommodation', words({ accommodation: undefined })],
    ['both media and accommodation', words({ media: [{ upload_id: U(4), sha256: SHA('a') }] })], ['a precise location', words({ location: 'x' })], ['gps', words({ gps: [1, 2] })],
    ['a caller-supplied object reference', words({ object_ref: 'anything/at/all.mp3' })], ['the old single mode field', words({ mode: 'lyrics' })], ['a url', words({ url: 'https://example.invalid/x' })],
    ['another account as participant', words({ participant: REVIEWER })], ['no review notice revision', words({ review_notice_revision: undefined })]
  ]) await rejects(() => submitProof(TESTER, assignment, JSON.parse(JSON.stringify(document))), '22023', `a proof with ${why} is refused`);
  await rejects(() => submitProof(TESTER, assignment, words({ review_notice_revision: 'fixture-review-0' })), 'EU015', 'the private review notice named must be the current one');
  // The reproduced defect: an audio proof was accepted with any object reference. Now media is a sealed upload row or nothing.
  await rejects(() => submitProof(TESTER, assignment, { ...words({ accommodation: undefined }), media: [{ upload_id: U(4), sha256: SHA('a') }] }), 'EU014', 'media that names no upload of this assignment is refused');
  eq([await n('eup_proofs'), await n('eup_consents'), await n('eup_proof_revisions')], [0, 0, 0], 'refused submissions wrote nothing');
  const proofKey = key('proof');
  let proof = await member('proofs.submit', { actor: TESTER, id: assignment.id, document: words(), revision: 0, key: proofKey });
  eq(Object.keys(proof).sort(), Object.keys(C.shapeFields('proof_submitted')).sort(), 'the result is exactly the contract proof_submitted (no words)');
  eq(Object.keys(proof.consent).sort(), Object.keys(C.shapeFields('member_consent')).sort(), 'with the member consent shape');
  eq([proof.state, proof.revision, proof.publication_state, proof.moderation_state, proof.media], ['submitted', 1, 'private', 'clear', []], 'submitted privately, revision 1, multi-line lyrics accepted');
  eq([proof.consent.purpose, proof.consent.audience, proof.consent.state, proof.consent.notice_revision, proof.consent.proof_revision, proof.consent.asset_revision, proof.consent.expires_at],
    ['private_review', 'reviewers', 'open', NOTICES.private_review.revision, 1, proof.asset_revision, null], 'the private-review consent for exactly this revision and digest was written with it');
  eq([await n('eup_proofs'), await n('eup_proof_revisions'), await n('eup_consents'), await n('eup_proof_media')], [1, 1, 1, 0], 'one proof, one revision, one consent, in one transaction');
  const manifestOf = (document, uploads = [], requirements = 3) => C.proofManifest({ tenant: OWNER, mission_id: ML.id, assignment_id: assignment.id, requirements_revision: requirements, proof: document, media: uploads });
  eq(proof.asset_revision, await C.assetRevision(manifestOf(words())), 'asset_revision is the SHA-256 of the contract manifest of what was submitted');
  eq(await member('proofs.submit', { actor: TESTER, id: assignment.id, document: words(), revision: 0, key: proofKey }), proof, 'exact replay returns the stored result');
  await rejects(() => submitProof(TESTER, assignment), '40001', 'a second "first" submission under another key is a conflict');
  const ownProof = (await me(TESTER)).assignments.find((x) => x.id === assignment.id).proof;
  eq(Object.keys(ownProof).sort(), Object.keys(C.shapeFields('own_proof')).sort(), 'the participant reads the proof as the contract own_proof');
  eq([ownProof.document.lyrics, ownProof.reviews, ownProof.consents.length, ownProof.publication, ownProof.appeals], [LYRICS, [], 1, null, []], 'with the words exactly as sent');
  // Resubmitting the same work gives the same digest; any change gives another; the older consent is superseded.
  proof = await submitProof(TESTER, assignment, words(), 1);
  const superseded = (await owner('consents.list', { actor: OWNER, id: proof.id })).map((k) => [k.proof_revision, k.state, k.superseded_at !== null]);
  eq([proof.revision, proof.asset_revision === ownProof.asset_revision, superseded], [2, true, [[1, 'superseded', true], [2, 'open', false]]], 'revision 2 of unchanged work has the same asset_revision; the consent of revision 1 is superseded');
  proof = await submitProof(TESTER, assignment, words({ lyrics: `${LYRICS}\nOne more line.` }), 2);
  ok(proof.revision === 3 && proof.asset_revision !== ownProof.asset_revision && proof.asset_revision === await C.assetRevision(manifestOf(words({ lyrics: `${LYRICS}\nOne more line.` }))), 'changed words give a new asset_revision');
  const ownerProof = (await owner('proofs.list', { actor: OWNER, id: assignment.id }))[0];
  eq(Object.keys(ownerProof).sort(), Object.keys(C.shapeFields('proof')).sort(), 'the owner reads the proof as the contract proof');
  eq([ownerProof.revision, ownerProof.state, ownerProof.document.lyrics.endsWith('One more line.'), ownerProof.media, ownerProof.reviews], [3, 'submitted', true, [], []], 'with the current revision document');
  eq((await owner('proofs.list', { actor: OWNER, document: { state: 'accepted' } })), [], 'the state filter works');

  // D8. Review: bound to the exact proof revision AND asset revision; three decisions; no self-review.
  await rejects(() => review(proof, {}, REVIEWER, 2), '40001', 'a review of an older proof revision is a conflict');
  await rejects(() => review(proof, { asset_revision: ownProof.asset_revision }), 'EU014', 'a review that names another asset revision is refused');
  await rejects(() => review(proof, { rubric: [{ id: 'complete', met: true }] }), '22023', 'the rubric answers every proof criterion');
  await rejects(() => review(proof, { rubric: [{ id: 'complete', met: true }, { id: 'credited', met: false }] }), '22023', 'a mission pass needs every criterion met');
  await rejects(() => review(proof, { mission_decision: 'changes' }), '22023', 'anything but three passes needs a reason');
  await rejects(() => review(proof, { decision: 'accepted' }), '22023', 'there is no separate overall decision to send');
  await rejects(() => review({ ...proof, id: U(404) }), 'P0002', 'an unknown proof is not found');
  await rejects(() => owner('proofs.review', { actor: PEER, id: proof.id, document: {}, revision: 3, key: key('review') }), '42501', 'review is an owner action');
  const reviewKey = key('review');
  const reviewDocument = { asset_revision: proof.asset_revision, mission_decision: 'changes', rights_decision: 'pass', safety_decision: 'pass', reason: 'Test fixture: add the missing credit.', rubric: [{ id: 'complete', met: true }, { id: 'credited', met: false, note: 'missing' }] };
  let reviewed = await owner('proofs.review', { actor: REVIEWER, id: proof.id, document: reviewDocument, revision: 3, key: reviewKey });
  eq(Object.keys(reviewed).sort(), Object.keys(C.shapeFields('proof_reviewed')).sort(), 'the result is exactly the contract proof_reviewed');
  eq(Object.keys(reviewed.review).sort(), Object.keys(C.shapeFields('review')).sort(), 'with the contract review');
  eq([reviewed.state, reviewed.reviewed_revision, reviewed.review.decision, reviewed.review.proof_revision, reviewed.review.asset_revision, reviewed.review.reviewer, reviewed.credit],
    ['needs_changes', 3, 'needs_changes', 3, proof.asset_revision, REVIEWER, null], 'needs_changes: bound to revision 3 and its digest, no credit');
  await rejects(() => review(proof), '40001', 'a reviewed proof is not awaiting review');
  const memberReview = (await me(TESTER)).assignments.find((x) => x.id === assignment.id).proof.reviews[0];
  eq(Object.keys(memberReview).sort(), Object.keys(C.shapeFields('member_review')).sort(), 'the participant reads the review without the reviewer id');
  ok(memberReview.reason === 'Test fixture: add the missing credit.' && memberReview.decision === 'needs_changes', 'and its reason');
  proof = await submitProof(TESTER, assignment, words({ credits: [{ name: 'Fixture Person', role: 'writer' }, { name: 'Fixture Singer', role: 'voice' }, { name: 'Fixture Producer', role: 'producer' }] }), 3);
  ok(proof.revision === 4 && proof.state === 'submitted', 'the participant revises: revision 4');
  await rejects(() => review({ ...proof, asset_revision: reviewDocument.asset_revision }, {}, REVIEWER, 3), '40001', 'the review of revision 3 cannot be repeated on revision 4');
  // Self-review: the house owner takes part, a second owner approves; the participant can never review their own proof.
  const ownerSeat = await enroll(OWNER, ML, REVIEWER);
  const ownerProofRow = await submitProof(OWNER, ownerSeat);
  await rejects(() => review(ownerProofRow, {}, OWNER), 'EU002', 'a participant cannot review their own proof');
  await rejects(() => review(ownerProofRow, { safety_decision: 'fail', reason: 'r' }, OWNER), 'EU002', 'whatever the decision');
  // A hold stops review (the hold itself is placed by the second pass; the state is planted here).
  await admin(`update public.eup_proofs set moderation_state = 'held' where id = $1`, [proof.id]);
  await rejects(() => review(proof), 'EU016', 'a held proof is not reviewed');
  await rejects(() => owner('proofs.get', { actor: OWNER, id: proof.id, document: { revision: 4, media: true } }), 'EU016', 'and its media is not opened for signing');
  ok((await owner('proofs.get', { actor: OWNER, id: proof.id, document: { revision: 4 } })).moderation_state === 'held', 'the owner still reads the held proof itself');
  await admin(`update public.eup_proofs set moderation_state = 'clear' where id = $1`, [proof.id]);
  await rejects(() => owner('proofs.get', { actor: OWNER, id: proof.id, document: { revision: 3 } }), '40001', 'proofs.get names the current revision');
  await rejects(() => owner('proofs.get', { actor: OWNER, id: proof.id, document: {} }), '22023', 'and must name one');
  // Requirements changed after submission: nothing is reviewed until the participant has accepted them. After that
  // the pending proof stands (the owner's, below, is reviewed without a resubmission) or is submitted again.
  ML = await owner('missions.update', { actor: OWNER, id: ML.id, document: { acceptance: 'Fixture acceptance, changed after submission.' }, revision: ML.revision, key: key('update') });
  await rejects(() => review(proof), '40001', 'a proof on an assignment returned to offered is not reviewed');
  await rejects(() => review(ownerProofRow), '40001', 'for every participant of the mission');
  assignment = await acceptOffer(TESTER, (await owner('assignments.list', { actor: OWNER, id: ML.id })).find((x) => x.id === assignment.id), ML);
  await acceptOffer(OWNER, (await owner('assignments.list', { actor: OWNER, id: ML.id })).find((x) => x.id === ownerSeat.id), ML);
  proof = await submitProof(TESTER, assignment, words(), 4);
  eq(proof.asset_revision, await C.assetRevision(manifestOf(words(), [], 4)), 'the manifest carries the requirements revision: the same words under new requirements are a new digest');
  const creditsBefore = await n('eup_mission_credits');
  const acceptKey = key('review');
  const acceptDocumentReview = { asset_revision: proof.asset_revision, mission_decision: 'pass', rights_decision: 'pass', safety_decision: 'pass', ...MET };
  reviewed = await owner('proofs.review', { actor: REVIEWER, id: proof.id, document: acceptDocumentReview, revision: 5, key: acceptKey });
  eq(Object.keys(reviewed.credit).sort(), Object.keys(C.shapeFields('credit')).sort(), 'acceptance returns the contract credit');
  eq([reviewed.state, reviewed.review.decision, reviewed.credit.kind, reviewed.credit.participant, reviewed.credit.proof_revision, reviewed.credit.asset_revision, reviewed.credit.review_id, reviewed.credit.mission_id],
    ['accepted', 'accepted', 'mission_completion', TESTER, 5, proof.asset_revision, reviewed.review.id, ML.id], 'accepted only when mission, rights and safety all pass: one completion credit, bound to the reviewed revision and digest');
  eq(await owner('proofs.review', { actor: REVIEWER, id: proof.id, document: acceptDocumentReview, revision: 5, key: acceptKey }), reviewed, 'review replay returns the stored result');
  eq([await n('eup_mission_credits') - creditsBefore, await n('eup_mission_credits', `assignment_id = '${assignment.id}'`)], [1, 1], 'exactly one credit row; the replay did not duplicate it');
  const completed = (await me(TESTER)).assignments.find((x) => x.id === assignment.id);
  eq([completed.status, completed.completed_at !== null, completed.credit.id, completed.proof.state], ['completed', true, reviewed.credit.id, 'accepted'], 'the assignment is completed and the participant sees the credit');
  await rejects(() => review(proof), '40001', 'an accepted proof is not reviewed again');
  await rejects(() => submitProof(TESTER, assignment, words(), 5), '40001', 'nor replaced');
  await rejects(() => member('drafts.save', { actor: TESTER, id: assignment.id, document: {}, revision: 2, key: key('draft') }), '40001', 'a completed assignment takes no more work');
  await rejects(() => member('assignments.withdraw', { actor: TESTER, id: assignment.id, document: {}, key: key('withdraw') }), '40001', 'and is not withdrawn');
  // Any fail rejects; a rejected proof is final (the appeal path is second pass). This proof was submitted before the
  // requirements changed and is reviewed after its participant accepted the new ones, without a resubmission.
  const rejected = await review(ownerProofRow, { safety_decision: 'fail', reason: 'Test fixture: unsafe.' });
  eq([rejected.state, rejected.credit], ['rejected', null], 'any fail rejects, without a credit');
  await rejects(() => submitProof(OWNER, ownerSeat, words(), 1), '40001', 'a rejected proof is not resubmitted');
  // The stored outcome cannot contradict the three decisions: the CHECK is the contract's reviewOutcome.
  let derived = 0;
  for (const m of C.ENUMS.DIMENSION_DECISIONS) for (const r of C.ENUMS.DIMENSION_DECISIONS) for (const s of C.ENUMS.DIMENSION_DECISIONS) for (const d of ['accepted', 'needs_changes', 'rejected']) {
    const outcome = await admin(`insert into public.eup_proof_reviews(tenant, proof_id, proof_revision, asset_revision, reviewer, mission_decision, rights_decision, safety_decision, decision)
      values ($1, $2, 5, $3, $4, $5, $6, $7, $8) returning id`, [OWNER, proof.id, proof.asset_revision, REVIEWER, m, r, s, d]).then((rows) => rows[0].id, (e) => e.code);
    const expected = C.reviewOutcome({ mission_decision: m, rights_decision: r, safety_decision: s }) === d;
    assert.equal(outcome === '23514', !expected, `${m}/${r}/${s} stored as ${d}`);
    if (expected) { await admin('delete from public.eup_proof_reviews where id = $1', [outcome]); derived += 1; }
  }
  eq(derived, 27, 'for all 27 combinations the table admits exactly the derived outcome'); count += 80;

  // D9. Publication consent: exact scope, finite expiry, revocable by id; it publishes nothing and the credit never depends on it.
  const creditRow = async () => (await admin('select to_jsonb(c) as j from public.eup_mission_credits c where c.assignment_id = $1', [assignment.id]))[0].j;
  const creditAtAcceptance = await creditRow();
  ok(creditAtAcceptance.id === reviewed.credit.id && (await owner('consents.list', { actor: OWNER, id: proof.id })).every((k) => k.purpose === 'private_review'), 'the credit exists while no publication consent has ever been given');
  const grant = (actor, document, revision = 5, id = proof.id) => member('consents.grant', { actor, id, document, revision, key: key('consent') });
  await rejects(() => grant(REVIEWER, publishConsent(proof)), '42501', 'only the participant grants consent (a house owner cannot)');
  await rejects(() => grant(OUTSIDER, publishConsent(proof)), 'EU011', 'an account outside the audience gets the audience answer');
  await rejects(() => grant(TESTER, publishConsent(proof), 5, U(404)), 'P0002', 'an unknown proof is not found');
  await rejects(() => grant(TESTER, publishConsent(proof), 4), '40001', 'the consent names the current proof revision');
  for (const [why, document, code] of [
    ['another asset revision', publishConsent(proof, { asset_revision: SHA('b') }), 'EU015'], ['an older publication notice', publishConsent(proof, { notice_revision: 'fixture-publication-0' }), 'EU015'],
    ['an expiry in the past', publishConsent(proof, { expires_at: expiry(-1) }), 'EU015'], ['an expiry beyond the bound', publishConsent(proof, { expires_at: expiry(C.LIMITS.consent_max_days + 2) }), 'EU015'],
    ['no expiry', publishConsent(proof, { expires_at: undefined }), '22023'], ['a malformed expiry', publishConsent(proof, { expires_at: '2027-01-01' }), '22023'],
    ['an expiry with an offset', publishConsent(proof, { expires_at: '2027-01-01T00:00:00+02:00' }), '22023'], ['audience public', publishConsent(proof, { audience: 'public' }), '22023'],
    ['audience members', publishConsent(proof, { audience: 'members' }), '22023'], ['audience reviewers', publishConsent(proof, { audience: 'reviewers' }), '22023'],
    ['purpose private_review', publishConsent(proof, { purpose: 'private_review' }), '22023'], ['a granted flag', publishConsent(proof, { granted: true }), '22023']
  ]) await rejects(() => grant(TESTER, JSON.parse(JSON.stringify(document))), code, `a consent with ${why} is refused`);
  // The reproduced defect: consent could be granted before any review. Now only an accepted proof can be consented to.
  const waiting = await submitProof(TESTER_B, await enroll(TESTER_B, ML, OWNER));
  await rejects(() => member('consents.grant', { actor: TESTER_B, id: waiting.id, document: publishConsent(waiting), revision: 1, key: key('consent') }), 'EU015', 'no publication consent before the proof is accepted');
  await rejects(() => member('consents.grant', { actor: OWNER, id: ownerProofRow.id, document: publishConsent(ownerProofRow), revision: 1, key: key('consent') }), 'EU015', 'nor for a rejected proof');
  await admin(`update public.eup_proofs set moderation_state = 'held' where id = $1`, [proof.id]);
  await rejects(() => grant(TESTER, publishConsent(proof)), 'EU016', 'no consent while the proof is held');
  await admin(`update public.eup_proofs set moderation_state = 'clear' where id = $1`, [proof.id]);
  const consentKey = key('consent');
  const consentDocument = publishConsent(proof);
  let consent = await member('consents.grant', { actor: TESTER, id: proof.id, document: consentDocument, revision: 5, key: consentKey });
  eq(Object.keys(consent).sort(), Object.keys(C.shapeFields('member_consent')).sort(), 'the result is exactly the contract member consent');
  eq([consent.purpose, consent.audience, consent.state, consent.proof_revision, consent.asset_revision, consent.notice_revision, new Date(consent.expires_at).toISOString().replace('.000Z', 'Z')],
    ['publish_proof', 'released_audience', 'open', 5, proof.asset_revision, NOTICES.publication.revision, consentDocument.expires_at], 'an open publication consent for exactly this proof revision, digest, notice and expiry');
  eq(await member('consents.grant', { actor: TESTER, id: proof.id, document: consentDocument, revision: 5, key: consentKey }), consent, 'consent replay');
  const scope = (await owner('consents.list', { actor: OWNER, id: proof.id })).find((k) => k.id === consent.id);
  eq(Object.keys(scope).sort(), Object.keys(C.shapeFields('consent')).sort(), 'the owner reads the contract consent');
  eq([scope.tenant, scope.mission_id, scope.assignment_id, scope.proof_id, scope.actor], [OWNER, ML.id, assignment.id, proof.id, TESTER], 'whose scope names tenant, mission, assignment, proof and actor');
  await rejects(() => grant(TESTER, publishConsent(proof, { expires_at: expiry(31) })), '23505', 'one open publication consent per proof');
  eq([(await me(TESTER)).assignments.find((x) => x.id === assignment.id).proof.publication_state, (await owner('proofs.list', { actor: OWNER, id: assignment.id }))[0].publication_state], ['private', 'private'], 'a consent publishes nothing');
  await rejects(() => member('consents.revoke', { actor: REVIEWER, id: consent.id, document: {}, key: key('revoke') }), '42501', 'only the participant revokes');
  await rejects(() => member('consents.revoke', { actor: TESTER, id: U(404), document: {}, key: key('revoke') }), 'P0002', 'an unknown consent is not found');
  await rejects(() => member('consents.revoke', { actor: TESTER, id: proof.consent.id, document: {}, key: key('revoke') }), '22023', 'the private-review consent is not revoked by command');
  await rejects(() => member('consents.revoke', { actor: TESTER, id: consent.id, document: { reason: 'x' }, key: key('revoke') }), '22023', 'the revocation document is empty');
  const revokeKey = key('revoke');
  let gone = await member('consents.revoke', { actor: TESTER, id: consent.id, document: {}, key: revokeKey });
  eq(Object.keys(gone).sort(), Object.keys(C.shapeFields('consent_revoked')).sort(), 'the result is exactly the contract consent_revoked');
  eq([gone.state, gone.revoked_at !== null, gone.publication], ['revoked', true, null], 'revoked by id; no publication existed to withdraw');
  eq(await member('consents.revoke', { actor: TESTER, id: consent.id, document: {}, key: revokeKey }), gone, 'revocation replay');
  await rejects(() => member('consents.revoke', { actor: TESTER, id: consent.id, document: {}, key: key('revoke') }), '40001', 'a revoked consent is not revoked again');
  consent = await grant(TESTER, publishConsent(proof));
  ok(consent.state === 'open', 'after revoking, the participant can consent again');
  // An expired consent stops counting as open without anyone writing it, and can still be revoked.
  await admin(`update public.eup_consents set expires_at = now() - interval '1 minute' where id = $1`, [consent.id]);
  eq((await me(TESTER)).assignments.find((x) => x.id === assignment.id).proof.consents.map((k) => [k.purpose, k.proof_revision, k.state]),
    [['private_review', 1, 'superseded'], ['private_review', 2, 'superseded'], ['private_review', 3, 'superseded'], ['private_review', 4, 'superseded'], ['private_review', 5, 'open'], ['publish_proof', 5, 'revoked'], ['publish_proof', 5, 'expired']],
    'the participant reads every consent with its state: each new revision superseded the one before, and expiry is computed at read');
  await rejects(() => grant(TESTER, publishConsent(proof)), '23505', 'an expired consent is revoked before another is granted');
  // The reproduced defect: a grant could not be revoked once the proof had a newer revision. Revocation is by consent id.
  eq(await as('service_role', async () => {
    await db.exec('begin');
    await db.query('update public.eup_proofs set revision = revision + 1 where id = $1', [proof.id]);
    return (await db.query(`select public.${C.RPC.member}('consents.revoke', $1, $2, '{}'::jsonb, null, $3) as r`, [TESTER, consent.id, key('revoke')])).rows[0].r.state;
  }), 'revoked', 'a consent is revoked by its id even when the proof has moved to a newer revision');
  gone = await member('consents.revoke', { actor: TESTER, id: consent.id, document: {}, key: key('revoke') });
  ok(gone.state === 'revoked', 'the expired consent is revoked');
  eq(await creditRow(), creditAtAcceptance, 'granting, expiring and revoking consent never touched the credit');

  // D10. Reduce-only: a participant can always leave. Own records stay readable whatever happens around them.
  consent = await grant(TESTER, publishConsent(proof));
  await owner('audience.grants.revoke', { actor: OWNER, id: L.grant.id, document: { reason: 'Test fixture: tester grant revoked.' }, key: key('revoke') });
  await rejects(() => grant(TESTER, publishConsent(proof)), 'EU011', 'after the grant is revoked the tester starts nothing new');
  await rejects(() => tryApply(TESTER, missionB), 'EU011', 'anywhere');
  const afterRevocation = await me(TESTER);
  ok(afterRevocation.catalogue.every((c) => c.slug !== 'member-loop') && afterRevocation.assignments.some((x) => x.id === assignment.id && x.credit && x.proof.document.lyrics === LYRICS)
    && afterRevocation.applications.some((x) => x.id === application.id), 'but still reads every record of their own: application, assignment, proof, credit');
  gone = await member('consents.revoke', { actor: TESTER, id: consent.id, document: {}, key: key('revoke') });
  ok(gone.state === 'revoked', 'and can still revoke a consent');
  const regrant = await owner('audience.grants.grant', { actor: OWNER, id: L.campaign.id, document: { account: TESTER }, key: key('grant') });
  ok(regrant.state === 'open' && regrant.id !== L.grant.id, 'a new grant can follow a revoked one');

  // Withdrawing an assignment frees the seat, revokes its open consents and keeps the records.
  const tight = await newMission(L.campaign, 'one-seat', { capacity: 1 });
  const seatA = await enroll(TESTER, tight, OWNER);
  const queued = await apply(TESTER_B, tight);
  await rejects(() => approve(queued, OWNER), 'EU001', 'the one seat is taken');
  const privateProof = await submitProof(TESTER, seatA);
  await rejects(() => member('assignments.withdraw', { actor: TESTER_B, id: seatA.id, document: {}, key: key('withdraw') }), '42501', 'another account cannot withdraw this assignment');
  await rejects(() => member('assignments.withdraw', { actor: TESTER, id: U(404), document: {}, key: key('withdraw') }), 'P0002', 'an unknown assignment is not found');
  const left = await member('assignments.withdraw', { actor: TESTER, id: seatA.id, document: {}, key: key('withdraw') });
  eq([left.status, left.withdrawn_at !== null, left.revision], ['withdrawn', true, seatA.revision + 1], 'withdrawn');
  eq((await owner('consents.list', { actor: OWNER, id: privateProof.id })).map((k) => [k.purpose, k.state, k.revoked_by]), [['private_review', 'revoked', TESTER]], 'its open consent is revoked with it');
  await rejects(() => member('assignments.withdraw', { actor: TESTER, id: seatA.id, document: {}, key: key('withdraw') }), '40001', 'a withdrawn assignment is not withdrawn again');
  await rejects(() => review(privateProof, {}, OWNER), '40001', 'its proof is no longer reviewed');
  await rejects(() => submitProof(TESTER, seatA, words(), 1), '40001', 'and takes no more work');
  ok((await approve(queued, OWNER)).assignment.status === 'offered' && (await owner('missions.preview', { actor: OWNER, id: tight.id })).seats_taken === 1, 'the freed seat goes to the next approval');
  ok((await me(TESTER)).assignments.some((x) => x.id === seatA.id && x.status === 'withdrawn' && x.proof.id === privateProof.id), 'the participant still reads the withdrawn assignment and its proof');

  // Mission and campaign withdrawal: the cascade declines open applications, withdraws open assignments, revokes
  // their consents, and keeps completed assignments and credits.
  const doomed = await newMission(L.campaign, 'to-be-withdrawn');
  const openSeat = await enroll(TESTER, doomed, OWNER);
  const openProof = await submitProof(TESTER, openSeat);
  const waitingApplication = await apply(TESTER_B, doomed);
  const draftApplication = await member('applications.save', { actor: OWNER, id: doomed.id, document: { submit: false, requirements_revision: 1 }, revision: 0, key: key('apply') });
  await move(doomed, 'withdrawn');
  const afterWithdrawal = await owner('applications.list', { actor: OWNER, id: doomed.id });
  eq(afterWithdrawal.map((x) => [x.applicant, x.status, x.decision_reason, x.decisions.at(-1).decision, x.decisions.at(-1).reason]).sort(),
    [[OWNER, 'declined', 'mission_withdrawn', 'declined', 'mission_withdrawn'], [TESTER, 'approved', null, 'approved', null], [TESTER_B, 'declined', 'mission_withdrawn', 'declined', 'mission_withdrawn']].sort(),
    'a mission withdrawal declines draft and submitted applications, each with a decision row, and leaves the approved one');
  eq((await owner('assignments.list', { actor: OWNER, id: doomed.id })).map((x) => x.status), ['withdrawn'], 'and withdraws the open assignment');
  eq((await owner('consents.list', { actor: OWNER, id: openProof.id })).map((k) => [k.state, k.revoked_by]), [['revoked', OWNER]], 'whose consent is revoked by the cascade');
  await rejects(() => tryApply(TESTER, doomed), 'EU011', 'a withdrawn mission takes no application');
  await rejects(() => move(doomed, 'released'), '22023', 'and nothing leaves withdrawn');
  ok([waitingApplication, draftApplication].every((x) => x.id) && (await me(TESTER_B)).applications.some((x) => x.id === waitingApplication.id && x.status === 'declined' && x.decisions[0].reason === 'mission_withdrawn'), 'the applicant reads why');
  // A campaign pause is effective for its missions without rewriting them; a campaign withdrawal cascades.
  await moveCampaign(L.campaign, 'paused');
  ok((await fresh(ML)).state === 'released' && (await owner('missions.preview', { actor: OWNER, id: ML.id })).open === false, 'a campaign pause rewrites no mission, and closes every one of them');
  await rejects(() => tryApply(REVIEWER, ML), 'EU011', 'no application on a paused campaign, even for a house owner');
  await rejects(() => grant(TESTER, publishConsent(proof)), 'EU011', 'no new consent on a paused campaign');
  await rejects(() => owner('applications.create', { actor: OWNER, id: ML.id, document: { applicant: REVIEWER, requirements_revision: ML.requirements_revision, statement: 's' }, key: key('record') }), 'EU011', 'no owner-recorded application either');
  const waitingB = (await owner('applications.list', { actor: OWNER, id: tight.id })).find((x) => x.applicant === TESTER_B);
  ok(waitingB.status === 'approved' && (await me(TESTER)).assignments.length > 0, 'own records are readable while the campaign is paused');
  const pausedSeat = (await owner('assignments.list', { actor: OWNER, id: tight.id })).find((x) => x.participant === TESTER_B);
  await rejects(() => acceptOffer(TESTER_B, pausedSeat, tight), 'EU011', 'an offer is not accepted while the campaign is paused');
  await moveCampaign(L.campaign, 'released');
  ok((await acceptOffer(TESTER_B, pausedSeat, tight)).status === 'accepted', 'and is accepted after the re-release: nothing had to be restored');
  await moveCampaign(L.campaign, 'withdrawn');
  eq((await owner('missions.list', { actor: OWNER, id: L.campaign.id })).map((x) => x.state), ['withdrawn', 'withdrawn', 'withdrawn'], 'a campaign withdrawal withdraws every mission');
  const final = await owner('assignments.list', { actor: OWNER, id: ML.id });
  eq(final.map((x) => [x.participant, x.status]).sort(), [[OWNER, 'accepted'], [TESTER, 'completed'], [TESTER_B, 'accepted']].map(([who, status]) => [who, status === 'accepted' ? 'withdrawn' : status]).sort(), 'open assignments are withdrawn, the completed one stays');
  eq(await creditRow(), creditAtAcceptance, 'and its credit is untouched by pause, withdrawal and cascade');
  const afterCampaign = await me(TESTER);
  ok(afterCampaign.assignments.find((x) => x.id === assignment.id).credit.id === reviewed.credit.id && afterCampaign.catalogue.every((c) => c.slug !== 'member-loop'), 'the participant still reads the completed work of a withdrawn campaign');
  await rejects(() => owner('missions.create', { actor: OWNER, id: L.campaign.id, document: { ...SONG, slug: 'too-late' }, key: key('mission') }), '40001', 'a withdrawn campaign takes no new mission');

  // D11. Member receipts: per actor and per surface; a result (and so a receipt) never carries member-written text.
  const memberReceipt = await member('receipts.get', { actor: TESTER, document: { operation: 'proofs.submit', key: proofKey } });
  eq([memberReceipt.surface, memberReceipt.operation, memberReceipt.result.id, memberReceipt.result.revision], ['member', 'proofs.submit', ownProof.id, 1], 'the participant reads the receipt of their own submission');
  await rejects(() => member('receipts.get', { actor: TESTER_B, document: { operation: 'proofs.submit', key: proofKey } }), 'P0002', 'the same key under another account returns nothing');
  await rejects(() => owner('receipts.get', { actor: OWNER, document: { operation: 'proofs.submit', key: proofKey } }), 'P0002', 'the owner route does not read member receipts');
  await rejects(() => member('receipts.get', { actor: REVIEWER, document: { operation: 'applications.decide', key: decideKey } }), 'P0002', 'and the member route does not read owner receipts, which carry other accounts');
  await rejects(() => member('receipts.get', { actor: TESTER, document: { operation: 'proofs.submit' } }), '22023', 'a receipt read names operation and key');
  eq(await n('eup_command_receipts', `result::text ~ 'Verse one|Half a|why I apply|cannot record|accommodation request|say a little more.*statement|Replaced'`), 0, 'no stored result holds lyrics, a statement, a draft or an accommodation note');
  const memberResults = (await admin(`select result from public.eup_command_receipts where surface = 'member'`)).map((r) => JSON.stringify(r.result));
  ok(memberResults.length > 30 && memberResults.every((r) => !C.FOREIGN_ID_FIELDS.some((f) => r.includes(`"${f}"`))), 'no member result names another account in any of the contract foreign id fields');
  const failures = await n('eup_command_receipts');
  await rejects(() => member('applications.save', { actor: TESTER, id: missionB.id, document: draftDocument, revision: 0, key: key('apply') }), 'EU011', 'a refused member command');
  eq(await n('eup_command_receipts'), failures, 'leaves no receipt');
  // The key lock, for the member function.
  const memberLock = await tx(async (t) => {
    await t.query(`select public.${C.RPC.member}('applications.save', $1, $2, $3::jsonb, 0, $4)`, [TESTER_B, missionB.id, JSON.stringify(draftDocument), key('lock')]);
    return { single: (await advisory(t)).rows, module: (await t.query(`select mode from pg_locks where locktype = 'advisory' and objsubid = 2`)).rows.map((r) => r.mode),
      account: (await t.query(`select count(*)::int as n from pg_locks where locktype = 'advisory' and objsubid = 1 and ((classid::bigint << 32) | objid::bigint) = (select hashtextextended('eup.league.rate.applications|' || $1 || '|' || $2, 0))`, [OWNER, TESTER_B])).rows[0].n };
  });
  eq(memberLock, { single: [{ lock: 'key', mode: 'ExclusiveLock', granted: true }, { lock: 'key', mode: 'ExclusiveLock', granted: true }, { lock: 'outbox', mode: 'ExclusiveLock', granted: true }], module: ['ShareLock'], account: 1 },
    'a member mutation that opens an application holds the receipt key lock, the per-account count lock, the module lock and the outbox lock to the end of its transaction');

  // D12. The five gates of a member mutation, each alone, each with its own code, and their order.
  // The probe passes every gate and is then refused for its stale revision (40001): a gate that answers shows its own code.
  await owner('audience.grants.grant', { actor: OWNER, id: campaignB.id, document: { account: TESTER }, key: key('grant') });
  const draftB = (await me(TESTER_B)).applications.find((x) => x.mission_id === missionB.id);
  const seatB = (await approve(await apply(TESTER_B, missionB, {}, draftB.revision), OWNER)).assignment;
  const acceptB = { requirements_revision: 1, notice_revision: NOTICES.participation.revision };
  const probe = (actor = TESTER_B, id = seatB.id, document = acceptB) => member('assignments.accept', { actor, id, document, revision: 999, key: key('probe') });
  const open = () => rejects(() => probe(), '40001', 'every gate is open again: the stale revision answers');
  await rejects(() => probe(), '40001', 'baseline: every gate passes and the stale revision answers');
  // 1. module state (from the module guard)
  for (const state of ['draining', 'disabled']) await inState(state, () => rejects(() => probe(), GUARD_CODE[state], `module ${state}, alone: ${GUARD_CODE[state]}`));
  await open();
  // 2. readiness: a missing or invalid League policy fails closed (the missing row is proven in section F)
  const storedPolicy = (await admin('select document from public.eup_league_policy'))[0].document;
  await admin(`update public.eup_league_policy set document = '{"entitlement":"none_required"}'::jsonb`);
  const invalid = await owner('policy.get', { actor: OWNER });
  ok(invalid.valid === false && invalid.revision === 3 && (await me(TESTER_B)).policy === null && (await owner('overview', { actor: OWNER })).policy.valid === false, 'a malformed stored policy is reported invalid to owner and member');
  await rejects(() => probe(), 'EU010', 'readiness, alone: EU010');
  await rejects(() => probe(TESTER), '42501', 'order: the row is the actor\'s (42501) before readiness');
  await admin(`update public.eup_league_policy set document = '{"entitlement":"not_decided"}'::jsonb`);
  await rejects(() => probe(), 'EU010', 'order: readiness before entitlement (an invalid policy is EU010 whatever it says about entitlement)');
  await admin('update public.eup_league_policy set document = $1::jsonb', [JSON.stringify(storedPolicy)]);
  await open();
  // 3. entitlement: the policy must say none_required explicitly
  let leaguePolicy = await owner('policy.set', { actor: OWNER, document: { policy: { ...LEAGUE_POLICY, entitlement: 'not_decided' }, reason: 'Test fixture: entitlement undecided.' }, revision: 3, key: key('policy') });
  await rejects(() => probe(), 'EU012', 'entitlement, alone: EU012 from a VALID policy');
  eq((await me(TESTER_B)).policy.entitlement, 'not_decided', 'the member reads the rule that stops them');
  leaguePolicy = await owner('policy.set', { actor: OWNER, document: { policy: LEAGUE_POLICY, reason: 'Test fixture: none_required again.' }, revision: leaguePolicy.revision, key: key('policy') });
  await open();
  // 4. released audience: campaign released AND mission released AND (house owner OR open grant on an invited campaign)
  await moveCampaign(campaignB, 'paused');
  await rejects(() => probe(), 'EU011', 'audience, alone: the campaign is paused');
  await moveCampaign(campaignB, 'released');
  await move(missionB, 'paused');
  await rejects(() => probe(), 'EU011', 'audience, alone: the mission is paused');
  await move(missionB, 'released');
  const grantB = (await owner('audience.grants.list', { actor: OWNER, id: campaignB.id })).find((g) => g.account === TESTER_B && g.state === 'open');
  await owner('audience.grants.revoke', { actor: OWNER, id: grantB.id, document: {}, key: key('revoke') });
  await rejects(() => probe(), 'EU011', 'audience, alone: the grant is revoked');
  await owner('audience.grants.grant', { actor: OWNER, id: campaignB.id, document: { account: TESTER_B }, key: key('grant') });
  await owner('campaigns.audience.set', { actor: OWNER, id: campaignB.id, document: { audience: 'admin_preview' }, revision: (await freshCampaign(campaignB)).revision, key: key('audience') });
  await rejects(() => probe(), 'EU011', 'audience, alone: the campaign is narrowed back to admin_preview, so the grant has no effect');
  await owner('campaigns.audience.set', { actor: OWNER, id: campaignB.id, document: { audience: 'invited' }, revision: (await freshCampaign(campaignB)).revision, key: key('audience') });
  await open();
  // 5. authorization: the row is the actor's
  await rejects(() => probe(TESTER), '42501', 'authorization, alone: another account in the same audience');
  await rejects(() => probe(REVIEWER), '42501', 'authorization, alone: a house owner is not the participant');
  // Order: first failure wins.
  await rejects(() => probe(OUTSIDER, U(404)), 'P0002', 'order: the row is looked up before the audience');
  await rejects(() => probe(OUTSIDER), 'EU011', 'order: audience before "not yours"');
  await rejects(() => probe(OUTSIDER, seatB.id, { nonsense: true }), 'EU011', 'order: the audience answers before the document is read');
  await rejects(() => probe(TESTER, seatB.id, { nonsense: true }), '42501', 'order: and so does "not yours"');
  await rejects(() => probe(TESTER_B, seatB.id, { nonsense: true }), '22023', 'order: the document before the revision');
  await rejects(() => probe(TESTER_B, seatB.id, { ...acceptB, requirements_revision: 9 }), '40001', 'order: revision and state before the action\'s own rules');
  await inState('disabled', () => rejects(() => probe(OUTSIDER, U(404)), 'EUM03', 'order: the module state answers before anything about the row'));
  await inState('disabled', () => rejects(() => member('assignments.accept', { actor: UNKNOWN, id: seatB.id, document: acceptB, revision: 1, key: key('probe') }), '42501', 'order: the actor before the module state'));

  // D13. Module state for members: own records and exact replays answer in every state; reduce-only actions are
  // admitted while draining and disabled; every other member mutation is refused with the guard's code.
  const b2 = await newMission(campaignB, 'second-song');
  const b3 = await newMission(campaignB, 'third-song');
  const seatsB = [await acceptOffer(TESTER_B, seatB, missionB), await enroll(TESTER, missionB, OWNER)];
  const fixtures = {};
  for (const [i, [state, actor]] of [['draining', TESTER_B], ['disabled', TESTER]].entries()) {
    const accepted = await submitProof(actor, seatsB[i]);
    await review(accepted, {}, OWNER);
    fixtures[state] = { actor, accepted, consent: await member('consents.grant', { actor, id: accepted.id, document: publishConsent(accepted), revision: 1, key: key('consent') }),
      application: await apply(actor, b3), seat: await enroll(actor, b2, OWNER) };
  }
  const firstSubmission = memberReceipt.result;
  for (const state of ['draining', 'disabled']) {
    await inState(state, async () => {
      const refused = GUARD_CODE[state];
      const f = fixtures[state];
      const view = await me(f.actor);
      ok(view.assignments.length >= 2 && view.applications.length >= 2 && view.catalogue.length >= 1 && view.assignments.some((x) => x.credit), `${state}: the participant reads catalogue, applications, assignments, proofs and credits`);
      ok((await member('receipts.get', { actor: TESTER, document: { operation: 'proofs.submit', key: proofKey } })).result.id === ownProof.id, `${state}: and their receipts`);
      eq(await member('proofs.submit', { actor: TESTER, id: assignment.id, document: words(), revision: 0, key: proofKey }), firstSubmission, `${state}: an exact replay answers with the stored result`);
      await rejects(() => member('proofs.submit', { actor: TESTER, id: assignment.id, document: words({ title: 'Other' }), revision: 0, key: proofKey }), 'EU003', `${state}: a changed replay is a conflict, not a guard refusal`);
      for (const [action, args] of [
        ['applications.save', { id: b3.id, document: { submit: true, requirements_revision: 1, statement: 's' }, revision: f.application.revision }],
        ['assignments.accept', { id: f.seat.id, document: acceptB, revision: f.seat.revision }],
        ['drafts.save', { id: f.seat.id, document: { lyrics: 'x' }, revision: 0 }],
        ['proofs.submit', { id: f.seat.id, document: words(), revision: 0 }],
        ['consents.grant', { id: f.accepted.id, document: publishConsent(f.accepted), revision: 1 }]
      ]) await rejects(() => member(action, { actor: f.actor, key: key('blocked'), ...args }), refused, `${state}: ${action} is refused ${refused}`);
      eq((await member('applications.withdraw', { actor: f.actor, id: f.application.id, document: {}, key: key('withdraw') })).status, 'withdrawn', `${state}: an application withdrawal is admitted`);
      eq((await member('assignments.withdraw', { actor: f.actor, id: f.seat.id, document: {}, key: key('withdraw') })).status, 'withdrawn', `${state}: an assignment withdrawal is admitted`);
      eq((await member('consents.revoke', { actor: f.actor, id: f.consent.id, document: {}, key: key('revoke') })).state, 'revoked', `${state}: a consent revocation is admitted`);
      await rejects(() => member('consents.revoke', { actor: f.actor === TESTER ? TESTER_B : TESTER, id: f.consent.id, document: {}, key: key('revoke') }), '42501', `${state}: reduce-only still means the actor's own row only`);
      await rejects(() => as('service_role', () => db.query(`update public.eup_consents set revoked_at = null, revoked_by = null where id = $1`, [f.consent.id])), refused, `${state}: a direct table write cannot undo it`);
    });
  }
  eq(await moduleState(), 'enabled', 'the module is enabled again');

  // An account with records but no audience left still reads them; only "no audience AND no record" is not available.
  await owner('audience.grants.revoke', { actor: OWNER, id: peerGrant.id, document: {}, key: key('revoke') });
  const peerView = await me(PEER);
  eq([peerView.catalogue, peerView.applications.map((x) => [x.status, x.decisions[0].reason]), peerView.assignments], [[], [['declined', 'Test fixture: not this time.']], []], 'an account whose only grant is revoked reads its own declined application and the reason');
  await rejects(() => me(OUTSIDER), 'EU011', 'an account with no audience and no record still has no League');

  /* ================================================================== E. media: staged uploads, the seal, media proofs */
  const hinted = async (fn, hint, status, m) => {
    const e = await rejects(fn, '22023', m);
    eq([e.hint ?? null, C.errorFor(e.code, 'member', e.hint).status], [hint, status], `${m}: the refusal carries the hint ${hint}`);
  };
  const setPolicy = async (document) => owner('policy.set', { actor: OWNER, document: { policy: document, reason: 'Test fixture: policy change.' }, revision: (await owner('policy.get', { actor: OWNER })).revision, key: key('policy') });
  const AUDIO = { kind: 'audio', mime: 'audio/webm', bytes: 4, duration_seconds: 3 };
  const VIDEO = { kind: 'video', mime: 'video/mp4', bytes: 8 };
  const begin = (actor, seat, document = AUDIO) => member('uploads.begin', { actor, id: seat.id, document, key: key('upload') });
  const sealUpload = async (actor, seat, document, family, digest) => seal((await begin(actor, seat, document)).id, actor, sealed(document.bytes, { sha256: SHA(digest), family }));
  const mediaProof = (uploads, extra = {}) => { const { accommodation: _unused, ...rest } = words(extra); return { ...rest, media: uploads.map((x) => ({ upload_id: x.id, sha256: x.sha256 })) }; };
  const discard = (actor, upload) => member('uploads.discard', { actor, id: upload.id, document: {}, key: key('discard') });
  const songSeats = await owner('assignments.list', { actor: OWNER, id: song.id });
  const offeredOwner = songSeats.find((x) => x.participant === OWNER);
  await rejects(() => begin(OWNER, offeredOwner), 'EU013', 'no upload before the offer is accepted');
  const seatT = await acceptOffer(TESTER, songSeats.find((x) => x.participant === TESTER), song);
  const seatO = await acceptOffer(OWNER, offeredOwner, song);

  // E1. uploads.begin: the gates plus the media gate; kind, MIME and size against the policy and the mission; a
  // staged row and nothing else (no URL, no path: the Worker signs for the path it derives from the row ids).
  await rejects(() => begin(OUTSIDER, seatT), 'EU011', 'an account outside the audience cannot begin an upload');
  await rejects(() => begin(TESTER_B, seatT), '42501', 'nor another tester for this assignment');
  await rejects(() => begin(TESTER, { id: U(404) }), 'P0002', 'an unknown assignment is not found');
  await setPolicy({ ...LEAGUE_POLICY, media: { enabled: false } });
  await rejects(() => begin(TESTER, seatT), 'EU010', 'the media gate, alone: with media.enabled false an upload fails closed');
  ok((await member('drafts.save', { actor: TESTER, id: seatT.id, document: { lyrics: 'words still work' }, revision: 0, key: key('draft') })).revision === 1, 'while every action that is not an upload still works');
  await setPolicy({ ...LEAGUE_POLICY, entitlement: 'not_decided', media: { enabled: false } });
  await rejects(() => begin(TESTER, seatT), 'EU012', 'order: entitlement before the media gate');
  await setPolicy({ ...LEAGUE_POLICY, media: { enabled: true, kinds: ['audio'], audio_max_bytes: 1000, max_duration_seconds: 30 } });
  await hinted(() => begin(TESTER, seatT, VIDEO), 'media_type_not_allowed', 415, 'a kind the policy does not list');
  await setPolicy(LEAGUE_POLICY);
  await hinted(() => begin(TESTER, seatT, { ...AUDIO, bytes: 1001 }), 'media_too_large', 413, 'more bytes than the policy cap of the kind');
  await hinted(() => begin(TESTER, seatT, { ...VIDEO, bytes: 2001 }), 'media_too_large', 413, 'each kind has its own cap');
  await hinted(() => begin(TESTER, seatT, { ...AUDIO, mime: 'audio/flac' }), 'media_type_not_allowed', 415, 'a MIME type outside the table');
  await hinted(() => begin(TESTER, seatT, { kind: 'audio', mime: 'video/mp4', bytes: 4 }), 'media_type_not_allowed', 415, 'a MIME type of the other kind');
  await hinted(() => begin(TESTER, seatT, { ...AUDIO, bytes: C.MEDIA.hard_max_bytes + 1 }), 'media_too_large', 413, 'more bytes than the hard ceiling');
  const unhinted = await rejects(() => begin(TESTER, seatT, { mime: 'audio/webm', bytes: 4 }), '22023', 'an upload document without its kind');
  eq([unhinted.hint ?? null, C.errorFor(unhinted.code, 'member', unhinted.hint).status], [null, 422], 'is plainly invalid: no hint');
  await rejects(() => begin(TESTER, seatT, { ...AUDIO, bytes: 0 }), '22023', 'an empty upload is refused');
  for (const client of ['path', 'url', 'object_ref', 'bucket', 'name']) await rejects(() => begin(TESTER, seatT, { ...AUDIO, [client]: 'league/v1/x' }), '22023', `the client cannot send a ${client}`);
  eq(await n('eup_media_uploads'), 0, 'refused begins wrote no row');
  const beginKey = key('upload');
  const staged = await member('uploads.begin', { actor: TESTER, id: seatT.id, document: { ...AUDIO, bytes: 1000 }, key: beginKey });
  eq(Object.keys(staged).sort(), Object.keys(C.shapeFields('upload')).sort(), 'the result is exactly the contract upload');
  eq([staged.state, staged.scan_state, staged.kind, staged.mime, staged.ext, staged.declared_bytes, staged.max_bytes, staged.duration_seconds, staged.bytes, staged.sha256, staged.family, staged.storage, staged.participant, staged.assignment_id, staged.tenant],
    ['staged', 'not_scanned', 'audio', 'audio/webm', 'webm', 1000, 1000, 3, null, null, null, null, TESTER, seatT.id, OWNER], 'a staged row at exactly the cap, max_bytes the policy cap in force, nothing measured yet, not scanned');
  ok(Math.abs(new Date(staged.expires_at).getTime() - Date.now() - C.MEDIA.staged_ttl_seconds * 1000) < 120000, 'it expires after the contract staged lifetime');
  ok(!/league\/v1|https?:|token|equity-uprise-private/.test(JSON.stringify(staged)), 'the result carries no path, URL, token or bucket');
  eq(C.mediaObjectPath({ tenant: staged.tenant, assignment: staged.assignment_id, upload: staged.id, ext: staged.ext }), `league/v1/t/${OWNER}/a/${seatT.id}/u/${staged.id}.webm`, 'the row ids are all the Worker needs to derive the path');
  eq(await member('uploads.begin', { actor: TESTER, id: seatT.id, document: { ...AUDIO, bytes: 1000 }, key: beginKey }), staged, 'begin replay returns the same row');
  eq(Object.keys((await me(TESTER)).assignments.find((x) => x.id === seatT.id).uploads[0]).sort(), Object.keys(C.shapeFields('member_upload')).sort(), 'the participant lists it as a member upload: no tenant, participant, family or storage identity');

  // E2. The seal: what the Worker measured, written once. Only the participant's request seals; idempotent by state.
  const measured = sealed(1000, { sha256: SHA('b'), family: 'ebml' });
  await rejects(() => seal(staged.id, null, measured), '42501', 'the seal needs an actor');
  await rejects(() => seal(staged.id, UNKNOWN, measured), '42501', 'a known one');
  await rejects(() => seal(staged.id, OUTSIDER, measured), 'EU011', 'in the released audience');
  await rejects(() => seal(staged.id, TESTER_B, measured), '42501', 'who is the upload participant');
  await rejects(() => seal(staged.id, REVIEWER, measured), '42501', 'a house owner is not');
  await rejects(() => seal(U(404), TESTER, measured), 'P0002', 'an unknown upload is not found');
  for (const [why, result] of [['no measurement', null], ['an unknown outcome', { outcome: 'ok' }], ['no storage identity', { ...measured, storage: undefined }],
    ['bytes that differ from the listed size', { ...measured, storage: { ...measured.storage, size: 999 } }], ['an upper-case digest', { ...measured, sha256: SHA('B') }],
    ['an unknown family', { ...measured, family: 'png' }], ['a path', { ...measured, path: 'league/v1/x' }], ['an unknown rejection reason', { outcome: 'rejected', reason: 'virus' }],
    ['a rejection that also claims a digest', { outcome: 'rejected', reason: 'empty', sha256: SHA('b') }]]) {
    await rejects(() => seal(staged.id, TESTER, result === null ? null : JSON.parse(JSON.stringify(result))), '22023', `a seal with ${why} is refused`);
  }
  await rejects(() => seal(staged.id, TESTER, sealed(999, { sha256: SHA('b') })), 'EU014', 'bytes that differ from the declared bytes are a different file');
  await rejects(() => seal(staged.id, TESTER, { ...measured, family: 'riff_wave' }), 'EU014', 'a family the declared MIME type does not allow');
  for (const state of ['draining', 'disabled']) await inState(state, () => rejects(() => seal(staged.id, TESTER, measured), GUARD_CODE[state], `${state}: the seal takes the normal guard (${GUARD_CODE[state]})`));
  await setPolicy({ ...LEAGUE_POLICY, media: { enabled: false } });
  await rejects(() => seal(staged.id, TESTER, measured), 'EU010', 'no seal while media is not enabled');
  await setPolicy(LEAGUE_POLICY);
  await moveCampaign(a, 'paused');
  await rejects(() => seal(staged.id, TESTER, measured), 'EU011', 'no seal while the campaign is paused');
  await moveCampaign(a, 'released');
  eq((await member('uploads.get', { actor: TESTER, id: staged.id })).state, 'staged', 'every refused seal left the row staged');
  const receiptsBeforeSeal = await n('eup_command_receipts');
  const sealedRow = await seal(staged.id, TESTER, measured);
  eq(Object.keys(sealedRow).sort(), Object.keys(C.shapeFields('upload')).sort(), 'the seal answers the contract upload');
  eq([sealedRow.state, sealedRow.bytes, sealedRow.sha256, sealedRow.family, sealedRow.storage, sealedRow.sealed_at !== null, sealedRow.scan_state], ['sealed', 1000, SHA('b'), 'ebml', measured.storage, true, 'not_scanned'],
    'sealed with the measured bytes, digest, family and storage identity; still not scanned');
  eq(Object.keys(sealedRow.storage).sort(), Object.keys(C.shapeFields('storage_identity')).sort(), 'the storage identity is the contract shape: an object id, an eTag and a size, never a path');
  eq(await seal(staged.id, TESTER, measured), sealedRow, 'the same measurement again returns the row unchanged');
  await rejects(() => seal(staged.id, TESTER, { ...measured, sha256: SHA('c') }), 'EU014', 'a different digest on a sealed upload is refused: written once');
  await rejects(() => seal(staged.id, TESTER, { ...measured, storage: { ...measured.storage, object_id: U(5) } }), 'EU014', 'so is a different object');
  await rejects(() => seal(staged.id, TESTER, { ...measured, storage: { ...measured.storage, etag: '"other"' } }), 'EU014', 'and a different eTag');
  await rejects(() => seal(staged.id, TESTER, { outcome: 'rejected', reason: 'empty' }), '40001', 'a sealed upload is not rejected afterwards');
  eq(await n('eup_command_receipts'), receiptsBeforeSeal, 'the seal has no key and writes no receipt');
  const bad = await begin(TESTER, seatT);
  const rejectedRow = await seal(bad.id, TESTER, { outcome: 'rejected', reason: 'unrecognised' });
  eq([rejectedRow.state, rejectedRow.rejected_reason, rejectedRow.sha256, rejectedRow.bytes, rejectedRow.storage], ['rejected', 'unrecognised', null, null, null], 'a rejection is a committed fact with its reason');
  eq(await seal(bad.id, TESTER, { outcome: 'rejected', reason: 'unrecognised' }), rejectedRow, 'the same rejection again returns the row unchanged');
  await rejects(() => seal(bad.id, TESTER, { outcome: 'rejected', reason: 'empty' }), '40001', 'a different reason is not "the same thing"');
  await rejects(() => seal(bad.id, TESTER, sealed(4)), '40001', 'a rejected upload is not sealed afterwards');
  const late = await begin(TESTER, seatT);
  await admin(`update public.eup_media_uploads set expires_at = now() - interval '1 second' where id = $1`, [late.id]);
  const expiredRow = await seal(late.id, TESTER, sealed(4));
  eq([expiredRow.state, expiredRow.sha256, expiredRow.storage], ['expired', null, null], 'a seal after the staged lifetime answers the row as expired, without an error');
  eq((await member('uploads.get', { actor: TESTER, id: late.id })).state, 'expired', 'so that the state is committed');
  await rejects(() => seal(late.id, TESTER, sealed(4)), '40001', 'an expired upload is not sealed');
  const spareUpload = await begin(TESTER, seatT);
  eq(await tx(async (t) => {
    await t.query(`select public.${C.RPC.seal}($1, $2, $3::jsonb)`, [spareUpload.id, TESTER, JSON.stringify(sealed(4, { sha256: SHA('e') }))]);
    return { single: (await advisory(t)).rows, module: (await t.query(`select mode from pg_locks where locktype = 'advisory' and objsubid = 2`)).rows.map((r) => r.mode) };
  }), { single: [{ lock: 'outbox', mode: 'ExclusiveLock', granted: true }], module: ['ShareLock'] }, 'the seal holds the module lock and the outbox lock (it changed the row), and no receipt key lock');

  // E3. uploads.get: the participant's own row in every state; the storage identity only when a read is to be signed.
  eq((await member('uploads.get', { actor: TESTER, id: staged.id })).storage, null, 'without sign the storage identity is not answered');
  eq((await member('uploads.get', { actor: TESTER, id: staged.id, document: { sign: true } })).storage, measured.storage, 'with sign it is, for a sealed upload');
  await rejects(() => member('uploads.get', { actor: TESTER, id: bad.id, document: { sign: true } }), 'EU014', 'an upload that is not sealed cannot be signed');
  await rejects(() => member('uploads.get', { actor: TESTER_B, id: staged.id }), '42501', 'another account cannot read the row');
  await rejects(() => member('uploads.get', { actor: REVIEWER, id: staged.id, document: { sign: true } }), '42501', 'a house owner reads media through the review read, not this one');
  await rejects(() => member('uploads.get', { actor: TESTER, id: U(404) }), 'P0002', 'an unknown upload is not found');
  await rejects(() => member('uploads.get', { actor: TESTER, id: staged.id, document: { sign: 'yes' } }), '22023', 'sign is a boolean');
  await rejects(() => member('uploads.get', { actor: TESTER }), '22023', 'the read names its upload');

  // E4. uploads.discard: reduce-only, the actor's own row, never a file the current proof lists.
  await rejects(() => discard(TESTER_B, bad), '42501', 'another account cannot discard it');
  await rejects(() => discard(TESTER, { id: U(404) }), 'P0002', 'an unknown upload is not found');
  const discarded = await discard(TESTER, bad);
  eq([discarded.state, discarded.discarded_at !== null, discarded.storage, discarded.rejected_reason], ['discarded', true, null, 'unrecognised'], 'a rejected upload is discarded; what was recorded stays');
  await rejects(() => discard(TESTER, bad), '40001', 'a discarded upload is not discarded again');
  await rejects(() => discard(TESTER, late), '40001', 'an expired upload is left to the purge');
  await rejects(() => seal(bad.id, TESTER, { outcome: 'rejected', reason: 'unrecognised' }), '40001', 'a discarded upload is not sealed');
  eq((await discard(TESTER, spareUpload)).state, 'discarded', 'a sealed upload that no proof lists is discarded');

  // E5. A proof with media: sealed upload rows of THIS assignment and participant, with the digest the participant was shown.
  const videoUpload = await sealUpload(TESTER, seatT, VIDEO, 'iso_bmff', 'c');
  const ownerUpload = await sealUpload(OWNER, seatO, AUDIO, 'ebml', 'd');
  const stillStaged = await begin(TESTER, seatT);
  const wide = await newMission(a, 'audio-or-video');
  let seatN = await enroll(TESTER, wide, OWNER);
  const elsewhere = await sealUpload(TESTER, seatN, VIDEO, 'iso_bmff', 'f');
  for (const [why, uploads] of [
    ['a digest that is not the sealed one', [{ id: sealedRow.id, sha256: SHA('f') }]], ['an upload that is still staged', [{ id: stillStaged.id, sha256: SHA('a') }]],
    ['an expired upload', [sealedRow, { id: late.id, sha256: SHA('a') }]], ['a discarded upload', [{ id: spareUpload.id, sha256: SHA('e') }]],
    ['another participant\'s sealed upload', [ownerUpload]], ['a sealed upload of another assignment of the same participant', [elsewhere]]
  ]) await rejects(() => submitProof(TESTER, seatT, mediaProof(uploads)), 'EU014', `a proof naming ${why} is refused`);
  await rejects(() => submitProof(OWNER, seatO, mediaProof([sealedRow])), 'EU014', 'and the tester\'s upload is no proof for the owner');
  await admin(`update public.eup_media_uploads set state = 'purged', purged_at = now() where id = $1`, [videoUpload.id]);
  await rejects(() => submitProof(TESTER, seatT, mediaProof([videoUpload])), 'EU014', 'a purged upload is refused');
  await admin(`update public.eup_media_uploads set state = 'sealed', purged_at = null where id = $1`, [videoUpload.id]);
  await rejects(() => submitProof(TESTER, seatT, mediaProof([sealedRow, sealedRow])), '22023', 'an upload listed twice is refused');
  await rejects(() => submitProof(TESTER, seatT, mediaProof([sealedRow, { id: sealedRow.id.toUpperCase(), sha256: sealedRow.sha256 }])), '22023', 'also when the second mention is in upper case');
  await rejects(() => submitProof(TESTER, seatT, { ...mediaProof([sealedRow]), accommodation: { statement: 'both' } }), '22023', 'media and the accommodation statement exclude each other');
  await rejects(() => submitProof(TESTER, seatT, { ...mediaProof([sealedRow]), media: [{ upload_id: sealedRow.id, sha256: sealedRow.sha256, object_ref: 'anything/at/all.mp3' }] }), '22023', 'a media entry cannot carry an object reference');
  let songProof = await submitProof(TESTER, seatT, mediaProof([videoUpload, sealedRow]));
  eq(songProof.media, [{ upload_id: videoUpload.id, kind: 'video', mime: 'video/mp4', bytes: 8, sha256: SHA('c') }, { upload_id: sealedRow.id, kind: 'audio', mime: 'audio/webm', bytes: 1000, sha256: SHA('b') }],
    'the proof lists its media in submitted order, with the values of the sealed rows');
  eq(Object.keys(songProof.media[0]).sort(), Object.keys(C.shapeFields('proof_media')).sort(), 'as contract proof media');
  eq(songProof.asset_revision, await C.assetRevision(C.proofManifest({ tenant: OWNER, mission_id: song.id, assignment_id: seatT.id, requirements_revision: 2, proof: mediaProof([videoUpload, sealedRow]), media: [videoUpload, sealedRow] })),
    'asset_revision is the SHA-256 of the contract manifest, sealed media included');
  ok(songProof.asset_revision !== await C.assetRevision(C.proofManifest({ tenant: OWNER, mission_id: song.id, assignment_id: seatT.id, requirements_revision: 2, proof: mediaProof([sealedRow, videoUpload]), media: [sealedRow, videoUpload] })), 'the order of the files is part of the digest');
  await rejects(() => discard(TESTER, sealedRow), 'EU014', 'a file the current proof revision lists is not discarded');
  const opened = await owner('proofs.get', { actor: REVIEWER, id: songProof.id, document: { revision: 1, media: true } });
  eq(Object.keys(opened).sort(), Object.keys(C.shapeFields('proof_with_media')).sort(), 'the review read is the contract proof_with_media');
  eq(opened.uploads.map((x) => [x.id, x.ext, x.storage]), [[videoUpload.id, 'mp4', videoUpload.storage], [sealedRow.id, 'webm', measured.storage]], 'with each listed upload and its storage identity, in order');
  eq((await owner('proofs.get', { actor: REVIEWER, id: songProof.id, document: { revision: 1 } })).uploads.map((x) => x.storage), [null, null], 'and without the identity when media was not asked for');
  await admin(`update public.eup_proofs set moderation_state = 'held' where id = $1`, [songProof.id]);
  await rejects(() => member('uploads.get', { actor: TESTER, id: sealedRow.id, document: { sign: true } }), 'EU016', 'while the proof is held even the participant gets no signed read');
  await rejects(() => owner('proofs.get', { actor: REVIEWER, id: songProof.id, document: { revision: 1, media: true } }), 'EU016', 'nor the reviewer');
  eq((await member('uploads.get', { actor: TESTER, id: sealedRow.id })).state, 'sealed', 'the row itself stays readable');
  await admin(`update public.eup_proofs set moderation_state = 'clear' where id = $1`, [songProof.id]);
  // A mission that stops taking video: the sealed video is no proof for it any more.
  const narrowed = await owner('missions.update', { actor: OWNER, id: wide.id, document: { proof_modes: ['audio', 'lyrics'] }, revision: wide.revision, key: key('update') });
  seatN = await acceptOffer(TESTER, (await owner('assignments.list', { actor: OWNER, id: wide.id }))[0], narrowed);
  await hinted(() => begin(TESTER, seatN, VIDEO), 'media_type_not_allowed', 415, 'a kind the mission does not take');
  await rejects(() => submitProof(TESTER, seatN, mediaProof([elsewhere])), '22023', 'a sealed file of a kind the mission no longer takes is refused');
  // Module state for uploads: reads answer, discard is reduce-only, begin is new work.
  const extra = await sealUpload(TESTER, seatT, AUDIO, 'ebml', 'e');
  for (const [state, target] of [['draining', stillStaged], ['disabled', extra]]) {
    await inState(state, async () => {
      eq((await member('uploads.get', { actor: TESTER, id: videoUpload.id, document: { sign: true } })).storage, videoUpload.storage, `${state}: the participant reads their upload, signable`);
      await rejects(() => begin(TESTER, seatT), GUARD_CODE[state], `${state}: a new upload is refused`);
      eq((await discard(TESTER, target)).state, 'discarded', `${state}: a discard is admitted`);
    });
  }
  // A new revision that lists only the video: the audio is no longer evidence under review and can go.
  songProof = await submitProof(TESTER, seatT, mediaProof([videoUpload]), 1);
  eq((await discard(TESTER, sealedRow)).state, 'discarded', 'an upload the current revision no longer lists can be discarded');
  await rejects(() => submitProof(TESTER, seatT, mediaProof([videoUpload, sealedRow]), 2), 'EU014', 'and then is no proof any more');
  // Review of the media proof, and credit parity with the accommodation proof of section D.
  const songReviewed = await review(songProof, {}, REVIEWER);
  const comparable = async (assignmentId) => { const { id, assignment_id, mission_id, campaign_id, proof_id, proof_revision, asset_revision, review_id, created_at, ...rest } = (await admin('select to_jsonb(c) as j from public.eup_mission_credits c where c.assignment_id = $1', [assignmentId]))[0].j; return rest; };
  eq(songReviewed.credit.kind, 'mission_completion', 'the media proof is accepted and credited');
  eq(await comparable(seatT.id), await comparable(assignment.id), 'a private media proof and an accommodation proof earn the identical credit (same participant, same kind, nothing else on the row)');
  eq((await me(TESTER)).assignments.find((x) => x.id === seatT.id).uploads.map((x) => x.state).sort(), ['discarded', 'discarded', 'discarded', 'discarded', 'discarded', 'expired', 'sealed'], 'the participant keeps reading every upload row after completion');
  // No storage path is stored anywhere, in any column or receipt.
  for (const t of [...MUTABLE, ...APPEND_ONLY, ...UNGUARDED]) eq(await n(t, `${t}::text ~ 'league/v1|equity-uprise-private|https?://|token='`), 0, `${t} holds no path, bucket, URL or token`);

  /* ================================================================== F. not installed, and no League policy */
  const bare = await createLeagueDatabase({ enable: false });
  try {
    await rejects(() => readModulePolicy(bare.db, 'league'), 'EUM01', 'a fresh database has no League module row');
    eq(await bare.owner('campaigns.list', { actor: OWNER }), [], 'not installed: owner reads answer');
    ok((await bare.owner('policy.get', { actor: OWNER })).revision === 0 && (await bare.owner('overview', { actor: OWNER })).policy.present === false, 'not installed: the policy read says there is none');
    await rejects(() => bare.owner('campaigns.create', { actor: OWNER, document: CAMPAIGN, key: key('campaign') }), 'EUM01', 'not installed: an owner mutation is refused EUM01');
    await rejects(() => bare.owner('campaigns.transition', { actor: OWNER, id: U(1), document: { to: 'paused' }, revision: 1, key: key('transition') }), 'EUM01', 'not installed: even a reduce-only one');
    await rejects(() => bare.member('applications.save', { actor: TESTER, id: U(1), document: draftDocument, revision: 0, key: key('apply') }), 'EUM01', 'not installed: a member mutation is refused EUM01');
    await rejects(() => bare.member('applications.withdraw', { actor: TESTER, id: U(1), document: {}, key: key('withdraw') }), 'EUM01', 'not installed: and a member reduce-only one');
    await rejects(() => bare.seal(U(1), TESTER, sealed(4)), 'EUM01', 'not installed: the seal is refused EUM01');
    await rejects(() => bare.member('me.get', { actor: TESTER }), 'EU011', 'not installed: the member read answers (nothing is released to anyone)');
    await rejects(() => bare.admin(`insert into public.eup_campaigns(tenant, slug, title, document, created_by) values ($1, 'direct', 't', '{}', $1)`, [OWNER]), 'EUM01', 'not installed: a direct table write is refused by the trigger');
    eq((await bare.admin('select count(*)::int as n from public.eup_command_receipts'))[0].n, 0, 'not installed: nothing was written');
    await enableModule(bare.db, 'league', OWNER);
    const seeded = await seedSongMission(bare, { invite: TESTER, policy: null });
    ok(seeded.policy.revision === 0 && seeded.mission.state === 'released', 'enabled, with a released mission and NO League policy row');
    await rejects(() => bare.member('applications.save', { actor: TESTER, id: seeded.mission.id, document: draftDocument, revision: 0, key: key('apply') }), 'EU010', 'no policy row: a member mutation fails closed EU010');
    await rejects(() => bare.member('applications.save', { actor: OWNER, id: seeded.mission.id, document: draftDocument, revision: 0, key: key('apply') }), 'EU010', 'for a house owner as well');
    const noPolicy = await bare.member('me.get', { actor: TESTER });
    eq([noPolicy.policy, noPolicy.catalogue.length], [null, 1], 'the member read answers with policy null: every gated mutation would answer EU010');
    // Owner work does not need the League policy: an owner-recorded application and its decision.
    const recordedBare = await bare.owner('applications.create', { actor: OWNER, id: seeded.mission.id, document: { applicant: TESTER, requirements_revision: 1, statement: 's' }, key: key('record') });
    const offeredBare = (await bare.owner('applications.decide', { actor: OWNER, id: recordedBare.id, document: { decision: 'approved' }, revision: 1, key: key('decide') })).assignment;
    await rejects(() => bare.member('assignments.accept', { actor: TESTER, id: offeredBare.id, document: { requirements_revision: 1, notice_revision: 'x' }, revision: 1, key: key('accept') }), 'EU010', 'no policy row: the offer cannot be accepted');
    eq((await bare.member('applications.withdraw', { actor: TESTER, id: recordedBare.id, document: {}, key: key('withdraw') }).catch((e) => e.code)), '40001', 'no policy row: a reduce-only action is not stopped by readiness (it reaches its own state check)');
    eq((await bare.member('assignments.withdraw', { actor: TESTER, id: offeredBare.id, document: {}, key: key('withdraw') })).status, 'withdrawn', 'no policy row: the participant can still withdraw');
    await bare.owner('policy.set', { actor: OWNER, document: { policy: LEAGUE_POLICY, reason: 'Test fixture: first policy.' }, revision: 0, key: key('policy') });
    ok((await bare.member('applications.save', { actor: OWNER, id: seeded.mission.id, document: draftDocument, revision: 0, key: key('apply') })).status === 'draft', 'with a valid policy the same member mutation succeeds');
  } finally { await bare.close(); }

  await decoysEmpty('at the end');


  console.log(`${count} league assertions passed.`);
} finally { await league.close(); }
