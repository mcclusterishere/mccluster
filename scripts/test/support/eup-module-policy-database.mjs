// Isolated local PostgreSQL-compatible support for the E=Up module policy; never connects to canonical Supabase.
// Applies supabase/pending/eup_module_policy_v1.sql and drives its owner commands the way the Worker will: as
// service_role, through the functions, never through the tables. The League and intake harnesses import the
// helpers; scripts/test/eup-module-policy.integration.mjs uses createModulePolicyDatabase().
//
//   await ensureHouse(db, OWNER);            // only when the harness has no auth.users / orgs / org_members yet
//   await applyModulePolicy(db);             // BEFORE the domain SQL (it references the guard functions)
//   await db.exec(domainSql);
//   await enableModule(db, 'league', OWNER); // install (if needed) then enable; without it every write is EUM01
//
// Every helper that calls a function runs in ONE PGlite transaction with `set local role service_role`, so it
// neither depends on nor disturbs the session role a harness switches with its own `as(role, work)` queue.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const OWNER = '11111111-1111-4111-8111-111111111111';
export const PEER = '22222222-2222-4222-8222-222222222222';
export const SECOND_OWNER = '33333333-3333-4333-8333-333333333333';
export const MODULE_IDS = Object.freeze(['environment', 'league', 'intake']);
export const MODULE_POLICY_SCHEMA = 'equity-uprise.module-policy/v1';
export const MODULE_POLICY_INSTALLATION = 'mccluster';
// First key of the two-integer advisory lock; the second is hashtext(<house org id> || ':' || <module id>).
export const MODULE_POLICY_LOCK_KEY = 1163219023;
// Transaction-local setting written by eup_module_guard_reduce. In the trigger backstop it selects a MODE (the
// trigger then runs the reduce guard itself, taking both locks and the EUM00 / EUM01 check); it is never a bypass.
export const MODULE_REDUCE_MARKER = 'eup.module_reduce';
// The functions service_role may execute, by identity signature. Nothing else in the file is executable.
export const MODULE_POLICY_ENTRY_POINTS = Object.freeze([
  'eup_module_control_read(uuid,integer)', 'eup_module_guard(text,bigint)', 'eup_module_guard_reduce(text)',
  'eup_module_policy_command(uuid,text,text,bigint,text,text)', 'eup_module_policy_install(uuid,text,text,text)',
  'eup_module_policy_read(text)'
]);

const SQL = new URL('../../../supabase/pending/eup_module_policy_v1.sql', import.meta.url);
const ROLLBACK = new URL('../../../supabase/pending/eup_module_policy_v1.rollback.sql', import.meta.url);
const ROLES_STUB = new URL('../../../supabase/tests/supabase_api_roles.stub.sql', import.meta.url);

export const modulePolicySql = () => readFile(SQL, 'utf8');
export const modulePolicyRollbackSql = () => readFile(ROLLBACK, 'utf8');
export async function applyModulePolicy(db) { await db.exec(await modulePolicySql()); }
export async function rollbackModulePolicy(db) { await db.exec(await modulePolicyRollbackSql()); }

// Stand-ins for the canonical objects the policy SQL reads: auth.users, public.orgs (the house is slug
// 'mccluster'), public.org_members. Creates only what is missing, so it is safe beside a harness that already
// made them, and makes `owner` a house owner.
export async function ensureHouse(db, owner = OWNER, { org = owner } = {}) {
  await db.exec(`do $r$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $r$;
    create schema if not exists auth;
    create table if not exists auth.users(id uuid primary key);
    create table if not exists public.orgs(id uuid primary key, slug text);
    create table if not exists public.org_members(org_id uuid, profile_id uuid, role text);
    grant usage on schema public, auth to anon, authenticated, service_role;`);
  await db.query('insert into auth.users(id) select $1::uuid where not exists (select 1 from auth.users where id = $1::uuid)', [owner]);
  await db.query(`insert into public.orgs(id, slug) select $1::uuid, 'mccluster' where not exists (select 1 from public.orgs where slug = 'mccluster')`, [org]);
  await db.query(`insert into public.org_members(org_id, profile_id, role)
    select o.id, $1::uuid, 'owner' from public.orgs o where o.slug = 'mccluster'
      and not exists (select 1 from public.org_members m where m.org_id = o.id and m.profile_id = $1::uuid and m.role = 'owner')`, [owner]);
}

// One statement as service_role in its own transaction: what one PostgREST RPC call is.
export function asServiceRole(db, work) {
  return db.transaction(async (tx) => { await tx.exec('set local role service_role'); return work(tx); });
}
const one = (db, sql, params) => asServiceRole(db, async (tx) => (await tx.query(sql, params)).rows[0].r);
const key = (label) => `fixture-${label}-${randomUUID()}`;

// PostgREST stand-in table for a harness fetchImpl: RPC name -> (named arguments) -> [sql, params]. The result
// column is `r`. These are the four functions the Worker calls; the guards are called from SQL only.
export const MODULE_POLICY_RPC = Object.freeze({
  eup_module_policy_read: (a) => ['select public.eup_module_policy_read($1) as r', [a.p_module]],
  eup_module_control_read: (a) => ['select public.eup_module_control_read($1,$2) as r', [a.p_actor, a.p_limit ?? 50]],
  eup_module_policy_install: (a) => ['select public.eup_module_policy_install($1,$2,$3,$4) as r', [a.p_actor, a.p_module, a.p_key, a.p_reason]],
  eup_module_policy_command: (a) => ['select public.eup_module_policy_command($1,$2,$3,$4,$5,$6) as r',
    [a.p_actor, a.p_module, a.p_state, a.p_expected_revision, a.p_key, a.p_reason]]
});
export function modulePolicyRpc(db, name, args = {}) {
  if (!Object.hasOwn(MODULE_POLICY_RPC, name)) throw new Error(`Unknown module policy RPC: ${name}`);
  const [sql, params] = MODULE_POLICY_RPC[name](args);
  return one(db, sql, params);
}

// { schema, installationId, moduleId, state, revision }; rejects with code EUM01 when the module has no row.
export const readModulePolicy = (db, module) => modulePolicyRpc(db, 'eup_module_policy_read', { p_module: module });
// { installationId, modules: [{ moduleId, installed, state, revision, updated_at, updated_by, last_command }], commands: [...] }
export const readModuleControl = (db, owner = OWNER, limit = 50) => modulePolicyRpc(db, 'eup_module_control_read', { p_actor: owner, p_limit: limit });
// Receipt { policy, changed: true, prior: null, recorded_at }; the row starts 'disabled' at revision 0.
export const installModule = (db, module, owner = OWNER, { key: k = key(`install-${module}`), reason = 'Test fixture: install the module.' } = {}) =>
  modulePolicyRpc(db, 'eup_module_policy_install', { p_actor: owner, p_module: module, p_key: k, p_reason: reason });
// One state command at the CURRENT revision (read first unless expectedRevision is given). Returns the receipt
// { policy, changed, prior: { state, revision }, recorded_at }. enabled -> disabled rejects with EUM05: use disableModule.
export async function setModuleState(db, module, state, owner = OWNER, { key: k = key(`${state}-${module}`), reason = `Test fixture: set ${module} ${state}.`, expectedRevision } = {}) {
  const revision = expectedRevision ?? (await readModulePolicy(db, module)).revision;
  return modulePolicyRpc(db, 'eup_module_policy_command', { p_actor: owner, p_module: module, p_state: state, p_expected_revision: revision, p_key: k, p_reason: reason });
}
// Install when there is no row, then enable unless already enabled. Returns the policy.
export async function enableModule(db, module, owner = OWNER) {
  let policy;
  try { policy = await readModulePolicy(db, module); }
  catch (error) { if (error.code !== 'EUM01') throw error; policy = (await installModule(db, module, owner)).policy; }
  if (policy.state === 'enabled') return policy;
  return (await setModuleState(db, module, 'enabled', owner, { expectedRevision: policy.revision })).policy;
}
// enabled -> draining (a no-op when already draining). Returns the policy.
export async function drainModule(db, module, owner = OWNER) {
  return (await setModuleState(db, module, 'draining', owner)).policy;
}
// Drain first when enabled (a direct disable is EUM05), then disable. Returns the policy.
export async function disableModule(db, module, owner = OWNER) {
  let policy = await readModulePolicy(db, module);
  if (policy.state === 'enabled') policy = (await setModuleState(db, module, 'draining', owner, { expectedRevision: policy.revision })).policy;
  if (policy.state === 'disabled') return policy;
  return (await setModuleState(db, module, 'disabled', owner, { expectedRevision: policy.revision })).policy;
}
// The backstop exactly as a domain SQL file attaches it (statement level, the module id as the argument).
export async function attachModuleGuard(db, table, module) {
  if (!/^[a-z][a-z0-9_]*$/.test(table) || !MODULE_IDS.includes(module)) throw new Error('attachModuleGuard: table or module is not valid');
  await db.exec(`create or replace trigger ${table}_module_policy before insert or update or delete on public.${table}
    for each statement execute function public.eup_module_guard_trigger('${module}')`);
}

// A fresh database for the policy's own test: Supabase API roles with the Supabase DEFAULT PRIVILEGES switched on
// (every new public table, sequence and function is handed to anon, authenticated and service_role unless the
// migration takes it back), a house with two owners and one plain member, and the policy SQL applied once.
export async function createModulePolicyDatabase() {
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
  await db.exec(`insert into auth.users(id) values ('${PEER}'), ('${SECOND_OWNER}');
    insert into public.org_members(org_id, profile_id, role) values ('${OWNER}', '${PEER}', 'member'), ('${OWNER}', '${SECOND_OWNER}', 'owner');`);
  await applyModulePolicy(db);
  // Session-role queue for multi-statement work (an explicit begin ... commit as one role), as in the League harness.
  let chain = Promise.resolve();
  const as = (role, work) => {
    const run = chain.then(async () => { await db.exec(`set role ${role}`); try { return await work(); } finally { await db.exec('rollback; reset role'); } });
    chain = run.catch(() => {}); return run;
  };
  return { db, as, rolesStub: stub, apply: () => applyModulePolicy(db), rollback: () => rollbackModulePolicy(db), close: () => db.close() };
}
