// Isolated local PostgreSQL-compatible database for the E=Up League; never connects to canonical Supabase.
// Applies, in the order production must: the module policy SQL, then supabase/pending/eup_league_v1.sql, then
// installs and enables the 'league' module (without that every League write is refused EUM01).
//
// The database mirrors what the League SQL may and may not rely on:
//   - Supabase API roles with the Supabase DEFAULT PRIVILEGES switched on (a new public table, sequence or
//     function is handed to anon, authenticated and service_role unless the migration takes it back);
//   - service_role can NOT read auth.users (as in production); the SQL must not depend on it;
//   - decoy copies of the public projections and of the storage tables, so a test can prove the League never
//     writes them;
//   - a second organisation (a foreign tenant) and accounts for every row of the audience matrix.
// Every call helper runs ONE statement as service_role in its own transaction: what one PostgREST RPC is.
//
// Other harnesses build on this file (the in-process plane, the journey test). The parts they need:
//   createLeagueDatabase()            -> { db, owner, member, seal, rpc, admin, as, tx, apply, rollback, close }
//   LEAGUE_RPC / leagueRpc()          -> a PostgREST stand-in for the three functions (result column `r`)
//   postgrestError(error)             -> the { code, message, details, hint } body PostgREST would answer
//   LEAGUE_POLICY, CAMPAIGN, SONG     -> synthetic documents (the notice texts say they are test fixtures)
//   seedSongMission(league, options)  -> policy + released campaign + released song mission (+ invited tester)
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as C from '../../../workers/mccluster/src/eup/league-contract.js';
import { OWNER, PEER, SECOND_OWNER, ensureHouse, applyModulePolicy, enableModule, asServiceRole } from './eup-module-policy-database.mjs';

export { OWNER, PEER };
export const REVIEWER = SECOND_OWNER; // a second house owner: the reviewer of the first owner's own work
export const TESTER = '44444444-4444-4444-8444-444444444444'; // invited to campaign A by a grant
export const TESTER_B = '55555555-5555-4555-8555-555555555555'; // invited to campaign B only
export const OUTSIDER = '66666666-6666-4666-8666-666666666666'; // signed in, invited nowhere
export const OTHER_ORG_OWNER = '77777777-7777-4777-8777-777777777777'; // owner of another organisation, not of the house
export const UNKNOWN = '99999999-9999-4999-8999-999999999999'; // not an account at all
export const FOREIGN_TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const SQL = new URL('../../../supabase/pending/eup_league_v1.sql', import.meta.url);
const ROLLBACK = new URL('../../../supabase/pending/eup_league_v1.rollback.sql', import.meta.url);
const ROLES_STUB = new URL('../../../supabase/tests/supabase_api_roles.stub.sql', import.meta.url);

export const leagueSql = () => readFile(SQL, 'utf8');
export const leagueRollbackSql = () => readFile(ROLLBACK, 'utf8');
export async function applyLeague(db) { await db.exec(await leagueSql()); }
export async function rollbackLeague(db) { await db.exec(await leagueRollbackSql()); }

// The public projections League code must never write, and the storage tables it must never touch.
export const LEAGUE_DECOYS = Object.freeze(['public.action_missions', 'public.action_proofs', 'public.action_cohorts', 'public.network_posts',
  'public.network_media_assets', 'public.network_groups', 'public.action_policy_bills', 'storage.buckets', 'storage.objects']);
// The names the League SQL text must not contain at all.
export const PUBLIC_PROJECTIONS = Object.freeze(['action_missions', 'action_proofs', 'action_cohorts', 'network_posts', 'network_media_assets',
  'network_groups', 'action_policy_bills', 'mnet-media']);

// ---- the contract values the SQL embeds (public.eup_league_contract). The integration test asserts that the
// function returns exactly leagueContractEmbedding(); leagueContractSql() prints the literal to paste between
// the quotes of that function when the contract changes:
//   node -e "import('./scripts/test/support/eup-league-database.mjs').then((m) => console.log(m.leagueContractSql()))"
export function leagueContractEmbedding(contract = C) {
  const action = (a) => {
    const o = { kind: a.kind, guard: a.guard };
    if (a.id) o.id = a.id;
    if (a.id_optional) o.id_optional = true;
    if (a.document) o.document = a.document;
    if (a.revision) o.revision = a.revision;
    if (a.revision_min === 0) o.revision_min = 0;
    if (a.kind === 'mutation' && !a.keyed) o.keyed = false;
    if (a.reduce_when) o.reduce_when = a.reduce_when;
    if (a.gates) o.gates = a.gates;
    return o;
  };
  const table = (t) => Object.fromEntries(Object.entries(t).map(([n, a]) => [n, action(a)]));
  return JSON.parse(JSON.stringify({
    contract: contract.CONTRACT,
    module: contract.MODULE,
    manifest_schema: contract.MANIFEST_SCHEMA,
    patterns: Object.fromEntries(Object.entries(contract.PATTERNS).map(([k, v]) => [k, v.source])), // uuid is matched case-insensitively
    text_rules: { text: contract.TEXT_RULES.text.refused.source, multiline: contract.TEXT_RULES.multiline.refused.source },
    limits: contract.LIMITS,
    requirements_fields: contract.REQUIREMENTS_FIELDS,
    releasable_templates: contract.ENUMS.RELEASABLE_TEMPLATES,
    template_rules: contract.TEMPLATE_RULES,
    media: { types: contract.MEDIA.types, hard_max_bytes: contract.MEDIA.hard_max_bytes, staged_ttl_seconds: contract.MEDIA.staged_ttl_seconds },
    actions: { owner: table(contract.OWNER_ACTIONS), member: table(contract.MEMBER_ACTIONS), media: table(contract.MEDIA_SEAL) },
    documents: contract.DOCUMENTS
  }));
}
// One top-level key per line and one line per action and per document, so a contract change is a small diff.
export function leagueContractSql(contract = C) {
  const e = leagueContractEmbedding(contract);
  const lines = [];
  const keys = Object.keys(e);
  const group = (indent, value) => { const names = Object.keys(value); return names.map((n, j) => `${indent}${JSON.stringify(n)}:${JSON.stringify(value[n])}${j === names.length - 1 ? '' : ','}`); };
  keys.forEach((name, i) => {
    const end = i === keys.length - 1 ? '' : ',';
    if (name === 'documents') lines.push(`"${name}":{`, ...group('  ', e[name]), `}${end}`);
    else if (name === 'actions') {
      const surfaces = Object.keys(e[name]);
      lines.push(`"${name}":{`);
      surfaces.forEach((s, si) => lines.push(` ${JSON.stringify(s)}:{`, ...group('  ', e[name][s]), ` }${si === surfaces.length - 1 ? '' : ','}`));
      lines.push(`}${end}`);
    } else lines.push(`${JSON.stringify(name)}:${JSON.stringify(e[name])}${end}`);
  });
  const text = `{\n${lines.join('\n')}\n}`;
  if (text.includes("'") || text.includes('$contract$')) throw new Error('the embedded contract must not contain a single quote or the dollar tag');
  return text;
}

// ---- PostgREST stand-in: RPC name -> (named arguments) -> [sql, params]. The result column is `r`.
// The document travels as JSON text and is cast, so a test can send any JSON value, a bare string included.
const json = (value) => (value === undefined || value === null ? null : JSON.stringify(value));
const command = (name) => (a) => [`select public.${name}($1, $2, $3, $4::jsonb, $5, $6) as r`,
  [a.p_action ?? null, a.p_actor ?? null, a.p_id ?? '', json(a.p_document), a.p_revision ?? null, a.p_key ?? null]];
export const LEAGUE_RPC = Object.freeze({
  [C.RPC.owner]: command(C.RPC.owner),
  [C.RPC.member]: command(C.RPC.member),
  [C.RPC.seal]: (a) => [`select public.${C.RPC.seal}($1, $2, $3::jsonb) as r`, [a.p_upload ?? null, a.p_actor ?? null, json(a.p_result)]]
});
export function leagueRpc(db, name, args = {}) {
  if (!Object.hasOwn(LEAGUE_RPC, name)) throw new Error(`Unknown League RPC: ${name}`);
  const [sql, params] = LEAGUE_RPC[name](args);
  return asServiceRole(db, async (tx) => (await tx.query(sql, params)).rows[0].r);
}
// What PostgREST answers for a raised exception: the SQLSTATE, the message, and the detail and hint when set.
export const postgrestError = (error) => ({ code: error?.code ?? null, message: error?.message ?? null, details: error?.detail ?? null, hint: error?.hint ?? null });

// ---- synthetic documents. Values and notice texts are test fixtures, not defaults and not policy.
const NOTICE = (id) => ({ revision: `fixture-${id}-1`, text: `TEST FIXTURE notice (${id}). Not real policy text.\nSecond line.` });
export const LEAGUE_POLICY = Object.freeze({
  entitlement: 'none_required',
  media: { enabled: true, kinds: ['audio', 'video'], audio_max_bytes: 1000, video_max_bytes: 2000, max_duration_seconds: 30 },
  retention: { completed_days: 2, withdrawn_days: 1 },
  notices: { participation: NOTICE('participation'), private_review: NOTICE('review'), publication: NOTICE('publication') }
});
export const CAMPAIGN = Object.freeze({ slug: 'fixture-campaign', title: 'Test fixture campaign', purpose: 'A synthetic campaign.\nIt describes no real programme.' });
export const SONG = Object.freeze({ slug: 'write-a-song', title: 'Test fixture: write a song', template: 'write-a-song', proof_modes: ['audio', 'video', 'lyrics'],
  requirements: 'Fixture requirements.\nWrite the words and record a take.', acceptance: 'Fixture acceptance: the words and one take.' });
export const RIGHTS = Object.freeze({ version: 'music-rights-v1', owns_master: true, controls_composition: true, samples_cleared: true,
  collaborators_cleared: true, parody_or_derivative: false, derivative_permissions: '' });
export const SHA = (c = 'a') => String(c).repeat(64);
export const key = (label) => `fixture-${label}-${randomUUID()}`;

export async function createLeagueDatabase({ enable = true } = {}) {
  const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  const stub = existsSync(ROLES_STUB);
  if (stub) {
    // gen_random_uuid() and sha256() are built in. PGlite does not load Supabase's pgcrypto extension.
    await db.exec((await readFile(ROLES_STUB, 'utf8')).replace(/create extension if not exists pgcrypto;/gi, ''));
  } else {
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      grant usage on schema auth, public to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  }
  // The stub leaves sequences out; Supabase grants them by default as well.
  await db.exec('alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;');
  await ensureHouse(db, OWNER);
  await db.exec(`insert into auth.users(id) values ('${PEER}'), ('${REVIEWER}'), ('${TESTER}'), ('${TESTER_B}'), ('${OUTSIDER}'), ('${OTHER_ORG_OWNER}');
    insert into public.org_members(org_id, profile_id, role) values ('${OWNER}', '${PEER}', 'member'), ('${OWNER}', '${REVIEWER}', 'owner');
    insert into public.orgs(id, slug) values ('${FOREIGN_TENANT}', 'another-organisation');
    insert into public.org_members(org_id, profile_id, role) values ('${FOREIGN_TENANT}', '${OTHER_ORG_OWNER}', 'owner');
    create table if not exists public.action_missions(id uuid primary key default gen_random_uuid(), title text, status text);
    create table if not exists public.action_proofs(id uuid primary key default gen_random_uuid(), mission_id uuid, body text);
    create table if not exists public.action_cohorts(id uuid primary key default gen_random_uuid(), name text);
    create table if not exists public.network_posts(id uuid primary key default gen_random_uuid(), body text);
    create table if not exists public.network_media_assets(id uuid primary key default gen_random_uuid(), owner_m_uid uuid, media_type text, status text);
    create table if not exists public.network_groups(id uuid primary key default gen_random_uuid(), name text);
    create table if not exists public.action_policy_bills(id uuid primary key default gen_random_uuid(), title text);
    create schema if not exists storage;
    create table if not exists storage.buckets(id text primary key, name text, public boolean default false);
    create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    grant usage on schema storage to service_role; grant all on storage.buckets, storage.objects to service_role;
    insert into storage.buckets(id, name) values ('${C.MEDIA.bucket}', '${C.MEDIA.bucket}');`);
  await applyModulePolicy(db);
  await applyLeague(db);
  if (enable) await enableModule(db, C.MODULE, OWNER);

  // Session-role queue for multi-statement work as one role (explicit begin ... commit), as in the policy harness.
  let chain = Promise.resolve();
  const as = (role, work) => {
    const run = chain.then(async () => { await db.exec(`set role ${role}`); try { return await work(); } finally { await db.exec('rollback; reset role'); } });
    chain = run.catch(() => {}); return run;
  };
  const admin = async (sql, params) => (await db.query(sql, params)).rows;
  const rpc = (name, args) => leagueRpc(db, name, args);
  const call = (name) => (action, { actor, id, document, revision, key: k } = {}) =>
    rpc(name, { p_action: action, p_actor: actor, p_id: id, p_document: document, p_revision: revision, p_key: k });
  return {
    db, as, admin, rpc, rolesStub: stub,
    owner: call(C.RPC.owner), // owner('campaigns.create', { actor, document, key })
    member: call(C.RPC.member),
    seal: (upload, actor, result) => rpc(C.RPC.seal, { p_upload: upload, p_actor: actor, p_result: result }),
    tx: (work) => asServiceRole(db, work), // several statements as service_role in ONE transaction
    apply: () => applyLeague(db), rollback: () => rollbackLeague(db), close: () => db.close()
  };
}

// The Worker's measurement of a stored object, as the seal takes it. Synthetic values.
export const sealed = (bytes, { sha256 = SHA('a'), family = 'ebml', object_id = randomUUID(), etag = '"fixture-etag"' } = {}) =>
  ({ outcome: 'sealed', bytes, sha256, family, storage: { object_id, etag, size: bytes } });

// A League policy, a released campaign and a released song mission; optionally the campaign is 'invited' with
// one open grant. Returns { policy, campaign, mission, grant } as the owner commands answered them.
export async function seedSongMission(league, { owner = OWNER, invite = null, slug = CAMPAIGN.slug, capacity, rubric, policy = LEAGUE_POLICY } = {}) {
  const current = await league.owner('policy.get', { actor: owner });
  const set = policy === null || current.revision !== 0 ? current
    : await league.owner('policy.set', { actor: owner, document: { policy, reason: 'Test fixture: first policy.' }, revision: 0, key: key('policy') });
  let campaign = await league.owner('campaigns.create', { actor: owner, document: { ...CAMPAIGN, slug }, key: key('campaign') });
  campaign = await league.owner('campaigns.transition', { actor: owner, id: campaign.id, document: { to: 'released' }, revision: campaign.revision, key: key('campaign-release') });
  const document = { ...SONG, ...(capacity === undefined ? {} : { capacity }), ...(rubric === undefined ? {} : { rubric }) };
  let mission = await league.owner('missions.create', { actor: owner, id: campaign.id, document, key: key('mission') });
  mission = await league.owner('missions.transition', { actor: owner, id: mission.id, document: { to: 'released' }, revision: mission.revision, key: key('mission-release') });
  let grant = null;
  if (invite) {
    campaign = await league.owner('campaigns.audience.set', { actor: owner, id: campaign.id, document: { audience: 'invited' }, revision: campaign.revision, key: key('audience') });
    grant = await league.owner('audience.grants.grant', { actor: owner, id: campaign.id, document: { account: invite, note: 'Test fixture tester.' }, key: key('grant') });
  }
  return { policy: set, campaign, mission, grant };
}
