// Environmental Justice League against the actual pending SQL in isolated PGlite (serial; one session).
// The wire contract is workers/mccluster/src/eup/league-contract.js; this file proves the SQL keeps it.
// Proves: apply -> rollback -> re-apply leaves nothing behind; with Supabase-style default privileges on, anon and
// authenticated hold nothing and service_role holds exactly what the SECURITY INVOKER functions use; RLS on with no
// policy; the module guard trigger on every League domain table and not on the receipts table; the contract
// values embedded in SQL equal the contract; the SQL document checker agrees with the contract's checkDocument
// over a mutation corpus; both manifest vectors through the SQL canonicalisation; and the command rules listed
// beside each section below.
// PGlite is one session: lock ORDER and real races (same-key duplicates, capacity under contention, zero
// deadlocks) are NOT proven here. What is proven here about locks is that they are taken, and where.
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
// The second-pass sets, exactly as the SQL defers them.
const DEFERRED = {
  owner: ['publications.list', 'publications.decide', 'appeals.list', 'appeals.resolve', 'proofs.moderate', 'media.due', 'media.purged', 'outbox.list', 'outbox.ack', 'credits.list', 'applications.accommodation.get'],
  member: ['appeals.open', 'appeals.withdraw']
};

try {
  /* ================================================================== A. the file: apply, rollback, privileges */

  // A1. apply -> rollback -> re-apply: nothing of the League is left behind, the module policy stays, and the
  // second apply builds the identical schema. (Plain CREATE: applying twice without a rollback is an error.)
  const first = await fingerprint();
  const built = await objects();
  ok(built.relations > 20 && built.functions > 30 && built.triggers === 19, `the file builds relations, functions and 19 guard triggers (${JSON.stringify(built)})`);
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
  const MUTABLE = ['eup_league_policy', 'eup_campaigns', 'eup_campaign_audience_grants', 'eup_missions', 'eup_applications', 'eup_assignments', 'eup_proof_drafts', 'eup_media_uploads', 'eup_proofs', 'eup_consents'];
  const APPEND_ONLY = ['eup_league_policy_revisions', 'eup_campaign_revisions', 'eup_mission_revisions', 'eup_application_decisions', 'eup_assignment_acceptances', 'eup_proof_revisions', 'eup_proof_media', 'eup_proof_reviews', 'eup_mission_credits'];
  const tables = await admin(`select c.relname as t, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
      (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
      (select count(*)::int from aclexplode(c.relacl) a where a.grantee = 0) as public_grants,
      (select coalesce(array_agg(x order by x), '{}') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x where has_table_privilege('anon', c.oid, x)) as anon,
      (select coalesce(array_agg(x order by x), '{}') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x where has_table_privilege('authenticated', c.oid, x)) as authenticated,
      (select coalesce(array_agg(x order by x), '{}') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x where has_table_privilege('service_role', c.oid, x)) as service_role
    from pg_class c where ${LEAGUE_TABLES} and c.relkind = 'r' order by c.relname`);
  eq(tables.map((t) => t.t), [...MUTABLE, ...APPEND_ONLY, 'eup_command_receipts'].sort(), 'the League tables are exactly the expected twenty');
  for (const t of tables) {
    const want = MUTABLE.includes(t.t) ? ['INSERT', 'SELECT', 'UPDATE'] : ['INSERT', 'SELECT'];
    ok(t.rls && t.policies === 0 && t.public_grants === 0 && t.anon.length === 0 && t.authenticated.length === 0, `${t.t}: RLS on, no policy, nothing for anon, authenticated or PUBLIC`);
    eq(t.service_role, want, `${t.t}: service_role holds exactly ${want.join(', ')}`);
  }
  eq((await one(`select count(*)::int as n from pg_class c where ${LEAGUE_TABLES} and c.relkind = 'S'`)).n, 0, 'the file creates no sequence (nothing for default privileges to hand out)');
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
  eq(triggers.map((t) => t.t), [...MUTABLE, ...APPEND_ONLY].sort(), 'every League domain table has the guard trigger; eup_command_receipts has none');
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
    ['eup_consents', 'purpose', C.ENUMS.CONSENT_PURPOSES], ['eup_consents', 'audience', C.ENUMS.CONSENT_AUDIENCES], ['eup_command_receipts', 'surface', C.ENUMS.SURFACES]
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
  for (const action of DEFERRED.owner) {
    ok(Object.hasOwn(C.OWNER_ACTIONS, action), `${action} is a contract action`);
    const e = await rejects(() => owner(action, { actor: OWNER, id: U(1), document: {}, revision: 1, key: key('deferred') }), '0A000', `${action} is left to the second pass`);
    ok(/not implemented in this pass/.test(e.message), `${action}: the refusal says why`);
    await rejects(() => owner(action, { actor: PEER, id: U(1), document: {}, revision: 1, key: key('deferred') }), '42501', `${action}: a non-owner is refused before anything else`);
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
  const lockEvidence = async (params) => tx(async (t) => {
    const before = (await t.query(`select count(*)::int as n from pg_locks where locktype = 'advisory' and objsubid = 1`)).rows[0].n;
    await t.query(`select public.${C.RPC.owner}($1, $2, $3, $4::jsonb, $5, $6)`, params);
    const held = (await t.query(`select mode, granted from pg_locks where locktype = 'advisory' and objsubid = 1`)).rows;
    const module = (await t.query(`select mode from pg_locks where locktype = 'advisory' and objsubid = 2`)).rows.map((r) => r.mode);
    return { before, held, module };
  });
  const lockKey = key('lock');
  const firstRun = await lockEvidence(['campaigns.create', OWNER, '', JSON.stringify({ ...CAMPAIGN, slug: 'lock-evidence' }), null, lockKey]);
  eq([firstRun.before, firstRun.held, firstRun.module], [0, [{ mode: 'ExclusiveLock', granted: true }], ['ShareLock']], 'a first execution holds the receipt key lock (exclusive) and the module lock (shared) to the end of its transaction');
  const replayRun = await lockEvidence(['campaigns.create', OWNER, '', JSON.stringify({ ...CAMPAIGN, slug: 'lock-evidence' }), null, lockKey]);
  eq([replayRun.held, replayRun.module], [[{ mode: 'ExclusiveLock', granted: true }], []], 'a replay takes the key lock and returns before any module lock');

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

  console.log(`${count} league assertions passed.`);
} finally { await league.close(); }
