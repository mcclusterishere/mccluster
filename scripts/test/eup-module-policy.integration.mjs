// E=Up module policy against the actual pending SQL in isolated PGlite (serial; one session).
// Proves: apply -> rollback -> re-apply and a second apply that changes nothing; no policy row is created; with
// Supabase-style default privileges switched on, anon / authenticated / service_role hold no table or sequence
// privilege and service_role executes exactly the six entry points; a missing row fails closed for the read,
// the guard, the reduce guard and the trigger; install / enable / drain / disable from every state; every EUM
// code; exact replay and changed replay; the append-only command log; the one-revision-step rule; and the
// reduce-only marker driven through fixture tables that carry the statement trigger.
// Real concurrency (the fair queue, a state command waiting for an in-flight writer) needs real sessions and is
// NOT proven here; that is the native proof's job.
import assert from 'node:assert/strict';
import { readModulePolicy as vendoredReadModulePolicy } from '../../vendor/equity-uprise/src/server/module-policy.mjs';
import {
  createModulePolicyDatabase, OWNER, PEER, SECOND_OWNER, MODULE_IDS, MODULE_POLICY_ENTRY_POINTS, MODULE_POLICY_LOCK_KEY,
  MODULE_POLICY_SCHEMA, MODULE_REDUCE_MARKER, attachModuleGuard, enableModule, disableModule, drainModule, installModule,
  readModuleControl, readModulePolicy, setModuleState, modulePolicyRpc
} from './support/eup-module-policy-database.mjs';

const { db, as, rolesStub, apply, rollback, close } = await createModulePolicyDatabase();
let count = 0;
const ok = (c, m) => { assert.ok(c, m); count++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); count++; };
async function rejects(fn, code, m) { await assert.rejects(fn, (e) => { assert.equal(e.code, code, m); return true; }, m); count++; }
const key = (s) => `k-${s}-00000000`;
const API_ROLES = ['anon', 'authenticated', 'service_role'];

// One statement as a role (its own transaction, like one PostgREST request).
const run = (role, sql, params) => as(role, async () => (await db.query(sql, params)).rows);
const svc = (sql, params) => run('service_role', sql, params);
const val = (sql, params) => svc(sql, params).then((rows) => rows[0].r);
// Several statements as service_role in ONE transaction. `work` gets q(sql, params) -> rows and code(sql, params)
// -> 'ok' | SQLSTATE; a failed statement aborts the transaction exactly as it would on a server.
const inTx = (end, work) => as('service_role', async () => {
  await db.exec('begin');
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  try { return await work(q, (sql, params) => q(sql, params).then(() => 'ok', (e) => e.code)); }
  finally { await db.exec(end); }
});
const admin = async (sql, params) => (await db.query(sql, params)).rows;
const adminCode = (sql, params) => admin(sql, params).then(() => 'ok', (e) => e.code);
const n = async (table) => (await admin(`select count(*)::int as n from public.${table}`))[0].n;
const marker = `current_setting('${MODULE_REDUCE_MARKER}', true)`;
const install = (module, k, reason = 'Test fixture: install.', actor = OWNER) =>
  modulePolicyRpc(db, 'eup_module_policy_install', { p_actor: actor, p_module: module, p_key: k, p_reason: reason });
const command = (module, state, revision, k, reason = 'Test fixture: state change.', actor = OWNER) =>
  modulePolicyRpc(db, 'eup_module_policy_command', { p_actor: actor, p_module: module, p_state: state, p_expected_revision: revision, p_key: k, p_reason: reason });
const guard = (module, revision = null) => val('select public.eup_module_guard($1, $2) as r', [module, revision]);
const reduce = (module) => val('select public.eup_module_guard_reduce($1) as r', [module]);
const fingerprint = async () => (await admin(`select jsonb_build_object(
    'functions', (select jsonb_agg(jsonb_build_object('f', p.oid::regprocedure::text, 'acl', p.proacl::text, 'definer', p.prosecdef,
        'config', p.proconfig::text, 'body', md5(p.prosrc)) order by p.oid::regprocedure::text)
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'eup_module%'),
    'relations', (select jsonb_agg(jsonb_build_object('r', c.relname, 'kind', c.relkind, 'acl', c.relacl::text, 'rls', c.relrowsecurity) order by c.relname)
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'eup_module%'),
    'columns', (select jsonb_agg(jsonb_build_object('t', a.attrelid::regclass::text, 'c', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notnull', a.attnotnull) order by a.attrelid::regclass::text, a.attnum)
      from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relname like 'eup_module%' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped),
    'constraints', (select jsonb_agg(jsonb_build_object('n', k.conname, 'def', pg_get_constraintdef(k.oid)) order by k.conname)
      from pg_constraint k join pg_class c on c.oid = k.conrelid where c.relnamespace = 'public'::regnamespace and c.relname like 'eup_module%'),
    'triggers', (select jsonb_agg(jsonb_build_object('t', t.tgname, 'on', t.tgrelid::regclass::text, 'def', pg_get_triggerdef(t.oid)) order by t.tgname, t.tgrelid::regclass::text)
      from pg_trigger t where not t.tgisinternal and (t.tgname like 'eup_module%' or t.tgname like '%_module_policy%'))) as f`))[0].f;
const objects = async () => (await admin(`select
    (select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'eup_module%') as relations,
    (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'eup_module%') as functions`))[0];

try {
  ok(rolesStub, 'the Supabase API-role stub (default privileges on tables and functions) was found and applied');

  // ------------------------------------------------------------------ apply, rollback, re-apply, apply twice
  eq([await n('eup_module_policies'), await n('eup_module_policy_commands')], [0, 0], 'the file creates NO policy row and no command row');
  const first = await fingerprint();
  eq(await objects(), { relations: 6, functions: 9 }, 'two tables, three indexes, one identity sequence; nine functions');
  await rollback();
  eq(await objects(), { relations: 0, functions: 0 }, 'rollback removes every module-policy object');
  await rollback(); ok(true, 'rollback is safe to run twice');
  await apply();
  eq(await fingerprint(), first, 'apply after rollback rebuilds the identical schema, grants and triggers');
  await apply();
  eq(await fingerprint(), first, 'a second apply on top changes nothing (idempotent)');
  eq([await n('eup_module_policies'), await n('eup_module_policy_commands')], [0, 0], 'still no row after three applies');

  // ------------------------------------------------------------------ grants, with Supabase default privileges on
  const ALL_TABLE = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
  for (const role of [...API_ROLES, 'public']) {
    const t = (await admin(`select has_table_privilege($1, 'public.eup_module_policies', $2) as a, has_table_privilege($1, 'public.eup_module_policy_commands', $2) as b,
      has_sequence_privilege($1, 'public.eup_module_policy_commands_seq_seq', 'USAGE,SELECT,UPDATE') as s`, [role, ALL_TABLE]))[0];
    eq([t.a, t.b, t.s], [false, false, false], `${role} holds no privilege on the policy table, the command log or its identity sequence`);
  }
  const rls = await admin(`select relname, relrowsecurity, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('eup_module_policies', 'eup_module_policy_commands') order by 1`);
  eq(rls.map((r) => [r.relrowsecurity, r.policies]), [[true, 0], [true, 0]], 'row level security is on for both tables and there is no policy');
  const fns = await admin(`select replace(p.oid::regprocedure::text, 'public.', '') as f, has_function_privilege('service_role', p.oid, 'EXECUTE') as s,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as a, has_function_privilege('anon', p.oid, 'EXECUTE') as n, has_function_privilege('public', p.oid, 'EXECUTE') as p,
      p.prosecdef as definer, p.proconfig as config
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'eup_module%' order by 1`);
  eq(fns.filter((f) => f.s).map((f) => f.f), [...MODULE_POLICY_ENTRY_POINTS], 'service_role executes exactly the six entry points');
  ok(fns.every((f) => !f.a && !f.n && !f.p), 'anon, authenticated and PUBLIC execute none of the nine functions');
  ok(fns.every((f) => f.config.includes('search_path=""')), 'every function pins an empty search_path');
  eq(fns.filter((f) => f.config.includes('lock_timeout=5s')).map((f) => f.f), ['eup_module_guard(text,bigint)', 'eup_module_guard_reduce(text)', 'eup_module_policy_command(uuid,text,text,bigint,text,text)', 'eup_module_policy_install(uuid,text,text,text)'],
    'every function that takes the module lock bounds its wait at 5 s');
  ok(fns.filter((f) => f.s).every((f) => f.definer), 'the six entry points are SECURITY DEFINER (service_role has no table privilege to lend them)');
  for (const role of ['anon', 'authenticated']) {
    await rejects(() => run(role, 'select * from public.eup_module_policies'), '42501', `${role} cannot read the policy table`);
    await rejects(() => run(role, 'select * from public.eup_module_policy_commands'), '42501', `${role} cannot read the command log`);
    await rejects(() => run(role, "select public.eup_module_policy_read('league')"), '42501', `${role} cannot execute the policy read`);
    await rejects(() => run(role, 'select public.eup_module_control_read($1, 5)', [OWNER]), '42501', `${role} cannot execute the owner view`);
    await rejects(() => run(role, "select public.eup_module_policy_install($1, 'league', 'k-denied-00000000', 'Test fixture.')", [OWNER]), '42501', `${role} cannot install`);
    await rejects(() => run(role, "select public.eup_module_policy_command($1, 'league', 'enabled', 0, 'k-denied-00000001', 'Test fixture.')", [OWNER]), '42501', `${role} cannot change state`);
    await rejects(() => run(role, "select public.eup_module_guard('league')"), '42501', `${role} cannot execute the guard`);
    await rejects(() => run(role, "select public.eup_module_guard_reduce('league')"), '42501', `${role} cannot execute the reduce guard`);
  }
  await rejects(() => svc('select * from public.eup_module_policies'), '42501', 'service_role cannot read the policy table directly');
  await rejects(() => svc("insert into public.eup_module_policies(org_id, module_id, state, updated_by) values ($1, 'league', 'enabled', $1)", [OWNER]), '42501', 'service_role cannot seed a policy row directly');
  await rejects(() => svc("update public.eup_module_policies set state = 'enabled'"), '42501', 'service_role cannot write the policy table directly');
  await rejects(() => svc('select * from public.eup_module_policy_commands'), '42501', 'service_role cannot read the command log directly');
  await rejects(() => svc('delete from public.eup_module_policy_commands'), '42501', 'service_role cannot delete from the command log directly');
  await rejects(() => svc("select public.eup_module_policy_json('league', 'enabled', 1)"), '42501', 'service_role cannot execute the internal JSON helper');

  // ------------------------------------------------------------------ fixture tables: what a domain SQL file does
  await db.exec(`create table public.eup_fixture_league_rows(id integer generated always as identity primary key, note text not null);
    create table public.eup_fixture_intake_rows(id integer generated always as identity primary key, note text not null);
    create table public.eup_fixture_row_level(id integer generated always as identity primary key, note text not null);
    create table public.eup_fixture_no_argument(note text);
    create table public.eup_fixture_empty_argument(note text);
    create trigger eup_fixture_league_rows_module_policy_truncate before truncate on public.eup_fixture_league_rows
      for each statement execute function public.eup_module_guard_trigger('league');
    create trigger eup_fixture_row_level_module_policy before insert or update or delete on public.eup_fixture_row_level
      for each row execute function public.eup_module_guard_trigger('league');
    create trigger eup_fixture_no_argument_module_policy before insert on public.eup_fixture_no_argument
      for each statement execute function public.eup_module_guard_trigger();
    create trigger eup_fixture_empty_argument_module_policy before insert on public.eup_fixture_empty_argument
      for each statement execute function public.eup_module_guard_trigger('');
    -- a domain RPC in miniature: authorisation would come first, then the guard, then the write
    create function public.eup_fixture_league_command(p_action text) returns bigint
    language plpgsql security definer set search_path = '' as $$
    declare policy_revision bigint;
    begin
      if p_action in ('withdraw', 'revoke') then policy_revision := public.eup_module_guard_reduce('league');
      else policy_revision := public.eup_module_guard('league'); end if;
      insert into public.eup_fixture_league_rows(note) values (p_action);
      return policy_revision;
    end $$;
    -- the placement mistake the header warns about: a guard under an EXCEPTION handler that swallows the refusal
    create function public.eup_fixture_league_swallow() returns text
    language plpgsql security definer set search_path = '' as $$
    begin
      begin perform public.eup_module_guard('league'); exception when others then null; end;
      insert into public.eup_fixture_league_rows(note) values ('swallowed');
      return 'written';
    end $$;`);
  await attachModuleGuard(db, 'eup_fixture_league_rows', 'league');
  await attachModuleGuard(db, 'eup_fixture_intake_rows', 'intake');
  const leagueInsert = (note = 'direct') => svc('insert into public.eup_fixture_league_rows(note) values ($1)', [note]);
  const intakeInsert = (note = 'direct') => svc('insert into public.eup_fixture_intake_rows(note) values ($1)', [note]);

  // ------------------------------------------------------------------ missing row fails closed
  await rejects(() => readModulePolicy(db, 'league'), 'EUM01', 'read of a missing policy row is an error, never "enabled"');
  await rejects(() => guard('league'), 'EUM01', 'guard refuses while no policy row exists');
  await rejects(() => reduce('league'), 'EUM01', 'reduce guard refuses while no policy row exists');
  await rejects(() => leagueInsert(), 'EUM01', 'trigger refuses a direct table write while no policy row exists');
  await rejects(() => val("select public.eup_fixture_league_command('create') as r"), 'EUM01', 'a guarded RPC refuses while no policy row exists');
  await rejects(() => val("select public.eup_fixture_league_command('withdraw') as r"), 'EUM01', 'a reduce-only RPC refuses while no policy row exists');
  await rejects(() => command('league', 'enabled', 0, key('missing-enable')), 'EUM01', 'a state command on a module that is not installed');
  await rejects(() => guard('arcade'), 'EUM01', 'a module id outside the registry has no row and is refused');
  await rejects(() => reduce('arcade'), 'EUM01', 'the reduce guard refuses a module id outside the registry');
  await rejects(() => guard(null), 'EUM00', 'guard without a module id');
  await rejects(() => reduce(null), 'EUM00', 'reduce guard without a module id');
  await rejects(() => svc("insert into public.eup_fixture_no_argument values ('x')"), 'EUM00', 'a trigger attached without a module argument refuses every write');
  await rejects(() => svc("insert into public.eup_fixture_empty_argument values ('x')"), 'EUM01', 'a trigger attached with an empty module argument refuses every write');
  eq(await inTx('rollback', async (q, code) => { await q(`select set_config('${MODULE_REDUCE_MARKER}', '', true)`); return code("insert into public.eup_fixture_empty_argument values ('x')"); }), 'EUM01',
    'an empty marker never matches an empty trigger argument');
  eq([await n('eup_fixture_league_rows'), await n('eup_fixture_no_argument'), await n('eup_fixture_empty_argument')], [0, 0, 0], 'no refused write left a row');
  const empty = await readModuleControl(db, OWNER);
  eq(empty.modules.map((m) => [m.moduleId, m.installed, m.state, m.revision, m.last_command]), MODULE_IDS.map((id) => [id, false, null, null, null]),
    'owner view lists every registry module as not installed');
  eq([empty.installationId, empty.commands], ['mccluster', []], 'owner view: installation id and an empty log');
  // EUM00: the house organisation row is absent
  await admin("update public.orgs set slug = 'elsewhere' where slug = 'mccluster'");
  await rejects(() => guard('league'), 'EUM00', 'guard: policy authority unavailable when the house row is absent');
  await rejects(() => reduce('league'), 'EUM00', 'reduce guard: policy authority unavailable when the house row is absent');
  await rejects(() => leagueInsert(), 'EUM00', 'trigger: policy authority unavailable when the house row is absent');
  await rejects(() => readModulePolicy(db, 'league'), 'EUM01', 'read without a house row is still an error');
  await rejects(() => install('league', key('no-house')), '42501', 'nobody owns a house that is absent');
  await admin("update public.orgs set slug = 'mccluster' where slug = 'elsewhere'");

  // ------------------------------------------------------------------ install: owner only, validated, disabled at revision 0
  await rejects(() => install('league', key('inst-peer'), 'Test fixture: install.', PEER), '42501', 'a member who is not a house owner cannot install');
  await rejects(() => install('league', key('inst-null'), 'Test fixture: install.', null), '42501', 'install without an actor');
  await rejects(() => install('league', key('inst-stranger'), 'Test fixture: install.', '99999999-9999-4999-8999-999999999999'), '42501', 'install by an unknown account');
  await rejects(() => install('arcade', key('inst-arcade')), '22023', 'install of a module outside the registry');
  await rejects(() => install(null, key('inst-nomod')), '22023', 'install without a module');
  await rejects(() => install('league', 'short'), '22023', 'idempotency key shorter than 8 characters');
  await rejects(() => install('league', 'k'.repeat(129)), '22023', 'idempotency key longer than 128 characters');
  await rejects(() => install('league', 'key with spaces'), '22023', 'idempotency key with unsafe characters');
  await rejects(() => install('league', null), '22023', 'install without an idempotency key');
  await rejects(() => install('league', key('inst-noreason'), ''), '22023', 'an empty reason is refused');
  await rejects(() => install('league', key('inst-nullreason'), null), '22023', 'a missing reason is refused');
  await rejects(() => install('league', key('inst-longreason'), 'r'.repeat(501)), '22023', 'a reason over 500 characters is refused');
  await rejects(() => install('league', key('inst-ctl'), 'line one\nline two'), '22023', 'a reason with a control character is refused');
  eq([await n('eup_module_policies'), await n('eup_module_policy_commands')], [0, 0], 'refused installs create nothing and log nothing');
  const i1 = await install('league', key('inst'));
  eq(i1.policy, { schema: MODULE_POLICY_SCHEMA, installationId: 'mccluster', moduleId: 'league', state: 'disabled', revision: 0 }, 'install creates the row disabled at revision 0');
  eq([i1.changed, i1.prior, typeof i1.recorded_at], [true, null, 'string'], 'install receipt: changed, no prior, recorded_at');
  eq(await install('league', key('inst')), i1, 'exact replay of the install returns the stored receipt');
  eq(await n('eup_module_policy_commands'), 1, 'the replay logged nothing new');
  await rejects(() => install('league', key('inst'), 'Test fixture: a different reason.'), 'EUM06', 'install replay with a changed reason');
  await rejects(() => install('intake', key('inst')), 'EUM06', 'the install key reused for another module');
  await rejects(() => install('league', key('inst'), 'Test fixture: install.', SECOND_OWNER), 'EUM06', 'the install key reused by another owner');
  await rejects(() => install('league', key('inst-again')), 'EUM07', 'a second install with a new key');
  await rejects(() => install('league', key('inst'), 'Test fixture: install.', PEER), '42501', 'authorisation comes before replay: a non-owner learns nothing from a known key');
  eq(await readModulePolicy(db, 'league'), i1.policy, 'policy read returns the persisted row');
  eq(vendoredReadModulePolicy(await readModulePolicy(db, 'league'), 'mccluster', 'league'), { installationId: 'mccluster', moduleId: 'league', revision: 0, state: 'disabled' },
    'the pinned product reader accepts the persisted policy JSON');

  // ------------------------------------------------------------------ state commands: validation and authority
  await rejects(() => command('league', 'enabled', 0, key('peer'), 'Test fixture.', PEER), '42501', 'a non-owner cannot change state');
  await rejects(() => command('league', 'enabled', 0, key('nullactor'), 'Test fixture.', null), '42501', 'a state command without an actor');
  await rejects(() => command('league', 'paused', 0, key('badstate')), '22023', 'a state outside enabled / draining / disabled');
  await rejects(() => command('league', null, 0, key('nullstate')), '22023', 'a state command without a state');
  await rejects(() => command('arcade', 'enabled', 0, key('badmodule')), '22023', 'a state command for a module outside the registry');
  await rejects(() => command('league', 'enabled', null, key('norev')), '22023', 'the expected revision is mandatory on a state command');
  await rejects(() => command('league', 'enabled', -1, key('negrev')), '22023', 'a negative expected revision');
  await rejects(() => command('league', 'enabled', 0, 'short'), '22023', 'a state command with a short key');
  await rejects(() => command('league', 'enabled', 0, key('noreason'), ''), '22023', 'a state command without a reason');
  await rejects(() => command('league', 'enabled', 0, key('ctl'), 'tab\there'), '22023', 'a state command reason with a control character');
  await rejects(() => command('league', 'enabled', 1, key('future')), '40001', 'an expected revision ahead of the row');
  eq(await n('eup_module_policy_commands'), 1, 'refused commands log nothing');

  // ------------------------------------------------------------------ the matrix: every state to every state
  // What each state admits. `direct` is a table write with no RPC; `rpc` a guarded RPC; `reduceRpc` a reduce-only RPC.
  const admits = async () => ({
    read: (await readModulePolicy(db, 'league')).state,
    guard: await guard('league').then(() => 'ok', (e) => e.code),
    reduce: await reduce('league').then(() => 'ok', (e) => e.code),
    direct: await leagueInsert('matrix').then(() => 'ok', (e) => e.code),
    rpc: await val("select public.eup_fixture_league_command('create') as r").then(() => 'ok', (e) => e.code),
    reduceRpc: await val("select public.eup_fixture_league_command('withdraw') as r").then(() => 'ok', (e) => e.code)
  });
  const DISABLED = { read: 'disabled', guard: 'EUM03', reduce: 'ok', direct: 'EUM03', rpc: 'EUM03', reduceRpc: 'ok' };
  const DRAINING = { read: 'draining', guard: 'EUM02', reduce: 'ok', direct: 'EUM02', rpc: 'EUM02', reduceRpc: 'ok' };
  const ENABLED = { read: 'enabled', guard: 'ok', reduce: 'ok', direct: 'ok', rpc: 'ok', reduceRpc: 'ok' };
  const step = async (to, revision, k) => { const r = await command('league', to, revision, key(k)); return [r.policy.state, r.policy.revision, r.changed, r.prior.state, r.prior.revision]; };
  eq(await admits(), DISABLED, 'installed and disabled: reads answer, every guarded write is EUM03, reduce-only work is admitted');
  eq(await step('disabled', 0, 'm-dis-dis'), ['disabled', 0, false, 'disabled', 0], 'disabled -> disabled is a logged no-op that keeps the revision');
  eq(await step('draining', 0, 'm-dis-drn'), ['draining', 1, true, 'disabled', 0], 'disabled -> draining');
  eq(await admits(), DRAINING, 'draining: every guarded write is EUM02, reduce-only work is admitted');
  eq(await step('draining', 1, 'm-drn-drn'), ['draining', 1, false, 'draining', 1], 'draining -> draining is a logged no-op');
  eq(await step('disabled', 1, 'm-drn-dis'), ['disabled', 2, true, 'draining', 1], 'draining -> disabled');
  eq(await step('enabled', 2, 'm-dis-en'), ['enabled', 3, true, 'disabled', 2], 'disabled -> enabled');
  eq(await admits(), ENABLED, 'enabled: guarded writes, direct writes and reduce-only work are all admitted');
  eq(await step('enabled', 3, 'm-en-en'), ['enabled', 3, false, 'enabled', 3], 'enabled -> enabled is a logged no-op');
  await rejects(() => command('league', 'disabled', 3, key('m-en-dis')), 'EUM05', 'enabled -> disabled is refused until drained');
  eq((await readModulePolicy(db, 'league')).revision, 3, 'the refused disable changed nothing');
  eq(await step('draining', 3, 'm-en-drn'), ['draining', 4, true, 'enabled', 3], 'enabled -> draining');
  eq(await step('enabled', 4, 'm-drn-en'), ['enabled', 5, true, 'draining', 4], 'draining -> enabled (a drain can be called off)');
  eq(vendoredReadModulePolicy(await readModulePolicy(db, 'league'), 'mccluster', 'league').state, 'enabled', 'the pinned product reader accepts the enabled policy');

  // ------------------------------------------------------------------ revision CAS, replay, changed replay
  await rejects(() => command('league', 'draining', 4, key('stale')), '40001', 'a stale expected revision is refused');
  const d6 = await command('league', 'draining', 5, key('drain-6'), 'Test fixture: drain for the replay cases.');
  eq([d6.policy.state, d6.policy.revision], ['draining', 6], 'drained at revision 6');
  const logged = await n('eup_module_policy_commands');
  eq(await command('league', 'draining', 5, key('drain-6'), 'Test fixture: drain for the replay cases.'), d6, 'exact replay returns the stored receipt');
  await rejects(() => command('league', 'enabled', 0, key('m-dis-en')), 'EUM06', 'a key recorded at revision 2 does not replay for a command built at revision 0');
  const old = await command('league', 'enabled', 2, key('m-dis-en'));
  eq([old.policy.state, old.policy.revision, (await readModulePolicy(db, 'league')).state], ['enabled', 3, 'draining'],
    'replaying an OLD command returns its old receipt and does not move the current state');
  await rejects(() => command('league', 'draining', 5, key('drain-6'), 'Test fixture: another reason.'), 'EUM06', 'replay with a changed reason');
  await rejects(() => command('league', 'disabled', 5, key('drain-6'), 'Test fixture: drain for the replay cases.'), 'EUM06', 'replay with a changed state');
  await rejects(() => command('league', 'draining', 6, key('drain-6'), 'Test fixture: drain for the replay cases.'), 'EUM06', 'replay with a changed expected revision');
  await rejects(() => command('intake', 'draining', 5, key('drain-6'), 'Test fixture: drain for the replay cases.'), 'EUM06', 'replay with a changed module');
  await rejects(() => command('league', 'draining', 5, key('drain-6'), 'Test fixture: drain for the replay cases.', SECOND_OWNER), 'EUM06', 'the same key from another owner');
  await rejects(() => command('league', 'draining', 5, key('drain-6'), 'Test fixture: drain for the replay cases.', PEER), '42501', 'a non-owner cannot replay an owner command');
  await rejects(() => command('league', 'draining', 5, key('inst'), 'Test fixture: install.'), 'EUM06', 'an install key reused for a state command');
  await rejects(() => install('league', key('drain-6'), 'Test fixture: drain for the replay cases.'), 'EUM06', 'a state-command key reused for an install');
  eq(await n('eup_module_policy_commands'), logged, 'replays and refusals logged nothing');
  const s7 = await command('league', 'enabled', 6, key('second-owner'), 'Test fixture: the second owner re-enables.', SECOND_OWNER);
  eq([s7.policy.state, s7.policy.revision], ['enabled', 7], 'any house owner may command; revision 7');

  // ------------------------------------------------------------------ guard: return value and the expected revision
  eq(await guard('league'), 7, 'guard returns the revision it locked');
  eq(await guard('league', 7), 7, 'guard with the matching expected revision');
  await rejects(() => guard('league', 6), 'EUM04', 'guard with a stale expected revision: module_policy_changed');
  await rejects(() => guard('league', 8), 'EUM04', 'guard with a future expected revision');
  eq(await reduce('league'), 7, 'reduce guard returns the revision it locked');
  await drainModule(db, 'league');
  await rejects(() => guard('league', 7), 'EUM02', 'while draining the state refusal comes before the revision check');
  eq(await reduce('league'), 8, 'reduce guard answers while draining');

  // ------------------------------------------------------------------ reduce-only marker through the trigger
  // league is DRAINING (revision 8); intake is not installed yet.
  const before = await n('eup_fixture_league_rows');
  eq(await val(`select ${marker} as r`), '', 'no marker outside a transaction');
  const t1 = await inTx('commit', async (q, code) => {
    await q('savepoint probe');
    const noMarker = await code("insert into public.eup_fixture_league_rows(note) values ('no marker')");
    await q('rollback to savepoint probe');
    const revision = (await q("select public.eup_module_guard_reduce('league') as r"))[0].r;
    const seen = (await q(`select ${marker} as r`))[0].r;
    const locks = await q(`select mode, granted, objsubid, objid::text as objid from pg_locks where locktype = 'advisory' and classid = ${MODULE_POLICY_LOCK_KEY}`);
    const ins = await code("insert into public.eup_fixture_league_rows(note) values ('reduce insert')");
    const upd = await code("update public.eup_fixture_league_rows set note = 'reduce update' where note = 'reduce insert'");
    const del = await code("delete from public.eup_fixture_league_rows where note = 'matrix'");
    return { noMarker, revision, seen, locks, ins, upd, del };
  });
  eq([t1.noMarker, t1.revision, t1.seen, t1.ins, t1.upd, t1.del], ['EUM02', 8, 'league', 'ok', 'ok', 'ok'],
    'draining: refused without the marker; after the reduce guard the same transaction inserts, updates and deletes');
  eq(t1.locks.map((l) => [l.mode, l.granted, l.objsubid]), [['ShareLock', true, 2]], 'the reduce guard holds the module advisory lock in SHARE mode (two-integer key) inside its transaction');
  eq([(await admin("select count(*)::int as n from public.eup_fixture_league_rows where note = 'reduce update'"))[0].n, (await admin("select count(*)::int as n from public.eup_fixture_league_rows where note = 'matrix'"))[0].n], [1, 0],
    'the reduce-only transaction committed its writes');
  eq(await val(`select ${marker} as r`), '', 'the marker does not outlive the committed transaction');
  eq((await svc(`select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = ${MODULE_POLICY_LOCK_KEY}`))[0].n, 0, 'the advisory lock is released at commit');
  await rejects(() => leagueInsert('after reduce commit'), 'EUM02', 'the next transaction is refused again: a direct table write cannot carry the marker');
  await rejects(() => svc("update public.eup_fixture_league_rows set note = 'x' where false"), 'EUM02', 'a direct update that matches no row is still refused (statement trigger)');
  await rejects(() => svc('delete from public.eup_fixture_league_rows'), 'EUM02', 'a direct delete is refused while draining');
  // the reduce guard as its own request, then a table write as the next request (two PostgREST calls)
  eq(await reduce('league'), 8, 'a reduce guard called as a request of its own');
  await rejects(() => leagueInsert('second request'), 'EUM02', 'and the following request does not inherit its marker');
  // rollback: marker and writes both gone
  const t2 = await inTx('rollback', async (q, code) => { await q("select public.eup_module_guard_reduce('league')"); return [await code("insert into public.eup_fixture_league_rows(note) values ('rolled back')"), (await q(`select ${marker} as r`))[0].r]; });
  eq(t2, ['ok', 'league'], 'a reduce-only transaction that is rolled back');
  eq([await val(`select ${marker} as r`), (await admin("select count(*)::int as n from public.eup_fixture_league_rows where note = 'rolled back'"))[0].n], ['', 0], 'leaves neither the marker nor the row');
  // savepoint: a reduce guard under a savepoint that is rolled back leaves no marker (and no lock)
  const t3 = await inTx('rollback', async (q, code) => {
    await q('savepoint s'); await q("select public.eup_module_guard_reduce('league')"); await q('rollback to savepoint s');
    const seen = (await q(`select ${marker} as r`))[0].r;
    const locks = (await q(`select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = ${MODULE_POLICY_LOCK_KEY}`))[0].n;
    return [seen, locks, await code("insert into public.eup_fixture_league_rows(note) values ('after savepoint rollback')")];
  });
  eq(t3, ['', 0, 'EUM02'], 'a marker set under a rolled-back savepoint is gone with its lock, and the write is refused');
  // the marker never weakens an explicit guard
  eq(await inTx('rollback', async (q, code) => { await q("select public.eup_module_guard_reduce('league')"); return code("select public.eup_module_guard('league')"); }), 'EUM02',
    'an explicit guard still refuses in a transaction that carries the reduce marker');
  // truncate backstop
  await rejects(() => svc('truncate public.eup_fixture_league_rows'), 'EUM02', 'a truncate trigger refuses while draining');
  // a guard swallowed by an EXCEPTION handler is caught by the trigger backstop
  await rejects(() => val('select public.eup_fixture_league_swallow() as r'), 'EUM02', 'a guard swallowed by an EXCEPTION handler is still refused by the trigger backstop');
  // guarded and reduce-only RPCs as single requests
  await rejects(() => val("select public.eup_fixture_league_command('create') as r"), 'EUM02', 'draining: the guarded RPC is refused');
  eq(await val("select public.eup_fixture_league_command('revoke') as r"), 8, 'draining: the reduce-only RPC is admitted and returns the policy revision');

  // marker for module A never admits a write guarded for module B
  eq(await inTx('rollback', async (q, code) => { await q("select public.eup_module_guard_reduce('league')"); return code("insert into public.eup_fixture_intake_rows(note) values ('cross')"); }), 'EUM01',
    'a league marker does not admit a write to an intake table (intake not installed: EUM01)');
  await installModule(db, 'intake', OWNER);
  eq(await inTx('rollback', async (q, code) => { await q("select public.eup_module_guard_reduce('league')"); return code("insert into public.eup_fixture_intake_rows(note) values ('cross')"); }), 'EUM03',
    'a league marker does not admit a write to an intake table (intake disabled: EUM03)');
  eq(await inTx('rollback', async (q, code) => { await q(`select set_config('${MODULE_REDUCE_MARKER}', 'league', true)`); return code("insert into public.eup_fixture_intake_rows(note) values ('cross')"); }), 'EUM03',
    'nor does a league marker set by hand');
  await setModuleState(db, 'intake', 'draining');
  eq(await inTx('rollback', async (q, code) => { await q("select public.eup_module_guard_reduce('league')"); return code("update public.eup_fixture_intake_rows set note = 'cross' where false"); }), 'EUM02',
    'a league marker does not admit a write to an intake table (intake draining: EUM02)');
  eq(await disableModule(db, 'league').then((p) => [p.state, p.revision]), ['disabled', 9], 'league disabled at revision 9');
  await enableModule(db, 'intake', OWNER);
  eq(await inTx('rollback', async (q, code) => { await q("select public.eup_module_guard_reduce('intake')"); return [await code("insert into public.eup_fixture_intake_rows(note) values ('own module')"), await code("insert into public.eup_fixture_league_rows(note) values ('cross')")]; }), ['ok', 'EUM03'],
    'an intake marker admits intake writes and not a write to a league table (league disabled: EUM03)');
  // two reduce guards in one transaction: the marker names the LAST module; the first falls back to the full guard
  const t4 = await inTx('rollback', async (q, code) => {
    await q("select public.eup_module_guard_reduce('league')"); await q("select public.eup_module_guard_reduce('intake')");
    const locks = await q(`select mode, objid::text as objid from pg_locks where locktype = 'advisory' and classid = ${MODULE_POLICY_LOCK_KEY} order by 2`);
    return { seen: (await q(`select ${marker} as r`))[0].r, locks, league: await code("insert into public.eup_fixture_league_rows(note) values ('two modules')") };
  });
  eq([t4.seen, t4.league, t4.locks.length, new Set(t4.locks.map((l) => l.objid)).size, t4.locks.every((l) => l.mode === 'ShareLock')], ['intake', 'EUM03', 2, 2, true],
    'two reduce guards in one transaction fail closed for the first module (one module per transaction); each module has its own lock key');

  // disabled: reduce-only work still possible, everything else refused
  eq(await admits(), DISABLED, 'disabled after a drain: the same refusals and the same reduce-only door');
  const t5 = await inTx('commit', async (q, code) => { await q("select public.eup_module_guard_reduce('league')"); return [await code("insert into public.eup_fixture_league_rows(note) values ('purge marker row')"), await code('truncate public.eup_fixture_league_rows')]; });
  eq([t5, await n('eup_fixture_league_rows')], [['ok', 'ok'], 0], 'disabled: a reduce-only transaction may even truncate (a purge) when the table carries the truncate trigger');
  await rejects(() => svc('truncate public.eup_fixture_league_rows'), 'EUM03', 'a direct truncate is refused while disabled');
  await rejects(() => val('select public.eup_fixture_league_swallow() as r'), 'EUM03', 'disabled: the swallowed guard is still caught by the backstop');
  // the guard and the state command use the same lock key, in different modes
  const share = await inTx('rollback', async (q) => { await q("select public.eup_module_guard('intake')"); return q(`select mode, objid::text as objid from pg_locks where locktype = 'advisory' and classid = ${MODULE_POLICY_LOCK_KEY}`); });
  const shareReduce = await inTx('rollback', async (q) => { await q("select public.eup_module_guard_reduce('intake')"); return q(`select mode, objid::text as objid from pg_locks where locktype = 'advisory' and classid = ${MODULE_POLICY_LOCK_KEY}`); });
  const intakeRevision = (await readModulePolicy(db, 'intake')).revision;
  const exclusive = await inTx('rollback', async (q) => {
    await q("select public.eup_module_policy_command($1, 'intake', 'draining', $2, 'k-lock-probe-00000000', 'Test fixture: rolled back.')", [OWNER, intakeRevision]);
    return q(`select mode, objid::text as objid from pg_locks where locktype = 'advisory' and classid = ${MODULE_POLICY_LOCK_KEY}`);
  });
  eq([share.map((l) => l.mode), shareReduce.map((l) => l.mode), exclusive.map((l) => l.mode)], [['ShareLock'], ['ShareLock'], ['ExclusiveLock']],
    'guard and reduce guard take the lock shared; the state command takes it exclusive');
  ok(share[0].objid === shareReduce[0].objid && share[0].objid === exclusive[0].objid, 'all three use the same per-module key, so a state command waits for either kind of writer');
  eq([(await readModulePolicy(db, 'intake')).revision, (await admin("select count(*)::int as n from public.eup_module_policy_commands where idempotency_key = 'k-lock-probe-00000000'"))[0].n], [intakeRevision, 0],
    'a state command whose transaction rolls back changes nothing and logs nothing');

  // a trigger attached FOR EACH ROW by mistake still guards and does not drop the row
  await rejects(() => svc("insert into public.eup_fixture_row_level(note) values ('row level')"), 'EUM03', 'row-level attachment: refused while disabled');
  await enableModule(db, 'league', OWNER);
  await svc("insert into public.eup_fixture_row_level(note) values ('row level'), ('row level 2')");
  await svc("update public.eup_fixture_row_level set note = 'row level updated' where note = 'row level'");
  await svc("delete from public.eup_fixture_row_level where note = 'row level 2'");
  eq((await admin('select note from public.eup_fixture_row_level order by id')).map((r) => r.note), ['row level updated'], 'row-level attachment: insert, update and delete take effect when enabled');
  eq(await val('select public.eup_fixture_league_swallow() as r'), 'written', 'enabled: the fixture RPC writes');
  await svc('truncate public.eup_fixture_league_rows'); ok(true, 'enabled: truncate is admitted');

  // ------------------------------------------------------------------ append-only log and the one-revision-step rule
  // (as the table owner: these hold even for a role that owns the tables)
  const logCount = await n('eup_module_policy_commands');
  eq(await adminCode("update public.eup_module_policy_commands set reason = 'rewritten'"), '42501', 'the command log refuses UPDATE even for the table owner');
  eq(await adminCode('delete from public.eup_module_policy_commands'), '42501', 'the command log refuses DELETE');
  eq(await adminCode('truncate public.eup_module_policy_commands'), '42501', 'the command log refuses TRUNCATE');
  eq(await adminCode('truncate public.eup_module_policies, public.eup_module_policy_commands'), '42501', 'and a TRUNCATE of both tables');
  eq(await n('eup_module_policy_commands'), logCount, 'the log is intact');
  const cur = (await admin("select state, revision::int as revision from public.eup_module_policies where module_id = 'league'"))[0];
  eq(cur, { state: 'enabled', revision: 10 }, 'league is enabled at revision 10');
  const L = "where module_id = 'league'";
  eq(await adminCode(`update public.eup_module_policies set state = 'disabled' ${L}`), '42501', 'a state change without a revision step is refused');
  eq(await adminCode(`update public.eup_module_policies set revision = revision + 1 ${L}`), '42501', 'a revision step without a state change is refused');
  eq(await adminCode(`update public.eup_module_policies set state = 'draining', revision = revision + 2 ${L}`), '42501', 'a revision jump of two is refused');
  eq(await adminCode(`update public.eup_module_policies set state = 'draining', revision = revision - 1 ${L}`), '42501', 'a revision that moves backwards is refused');
  eq(await adminCode(`update public.eup_module_policies set state = 'draining', revision = revision + 1, module_id = 'environment' ${L}`), '42501', 'a row cannot move to another module');
  eq(await adminCode(`update public.eup_module_policies set state = 'draining', revision = revision + 1, created_at = created_at + interval '1 day' ${L}`), '42501', 'created_at cannot be rewritten');
  eq(await adminCode(`update public.eup_module_policies set updated_at = clock_timestamp() ${L}`), '42501', 'not even a timestamp touch without a revision step');
  eq(await adminCode(`delete from public.eup_module_policies ${L}`), '42501', 'a policy row cannot be deleted');
  eq(await adminCode('truncate public.eup_module_policies'), '42501', 'the policy table cannot be truncated');
  eq((await admin("select state, revision::int as revision from public.eup_module_policies where module_id = 'league'"))[0], cur, 'the row is unchanged');
  eq(await adminCode("insert into public.eup_module_policies(org_id, module_id, state, updated_by) values ($1, 'arcade', 'enabled', $1)", [OWNER]), '23514', 'the registry is a CHECK: no row for an unknown module');
  eq(await adminCode("insert into public.eup_module_policies(org_id, module_id, state, updated_by) values ($1, 'environment', 'paused', $1)", [OWNER]), '23514', 'no row in an unknown state');
  eq(await adminCode("insert into public.eup_module_policies(org_id, module_id, state, revision, updated_by) values ($1, 'environment', 'disabled', 9007199254740992, $1)", [OWNER]), '23514', 'no revision above the safe-integer ceiling');
  eq(await adminCode("insert into public.eup_module_policies(org_id, module_id, state, updated_by) values ($1, 'league', 'enabled', $1)", [OWNER]), '23505', 'one row per module');
  // the log is a faithful, ordered record
  const log = await admin("select seq::int as seq, command, requested_state, expected_revision::int as expected_revision, prior_state, prior_revision::int as prior_revision, actor, (receipt->'policy'->>'revision')::int as revision, (receipt->>'changed')::boolean as changed from public.eup_module_policy_commands where module_id = 'league' order by seq");
  ok(log.every((r, i) => i === 0 || r.seq > log[i - 1].seq), 'log sequence numbers only grow');
  eq(log[0], { seq: log[0].seq, command: 'install', requested_state: 'disabled', expected_revision: null, prior_state: null, prior_revision: null, actor: OWNER, revision: 0, changed: true }, 'the first league entry is the install');
  ok(log.slice(1).every((r) => r.command === 'set_state' && r.expected_revision === r.prior_revision && r.revision === r.prior_revision + (r.changed ? 1 : 0)), 'every later entry records the prior state and moves the revision by one only when it changed something');
  eq(log.filter((r) => !r.changed).length, 3, 'the three no-ops were logged too');
  eq(log.at(-1).revision, 10, 'the last logged revision is the current one');
  ok(log.some((r) => r.actor === SECOND_OWNER), 'the log names the owner who issued each command');

  // ------------------------------------------------------------------ owner view
  const view = await readModuleControl(db, OWNER, 3);
  eq(view.modules.map((m) => [m.moduleId, m.installed, m.state, m.revision]), [['environment', false, null, null], ['league', true, 'enabled', 10], ['intake', true, 'enabled', 2]],
    'owner view: every registry module with its state and revision');
  const lastLeague = view.modules[1].last_command;
  eq([lastLeague.command, lastLeague.requested_state, lastLeague.expected_revision, lastLeague.receipt.policy.revision, lastLeague.actor], ['set_state', 'enabled', 9, 10, OWNER], 'owner view carries the last command with its receipt');
  ok(typeof lastLeague.idempotency_key === 'string' && typeof lastLeague.reason === 'string' && typeof view.modules[1].updated_at === 'string' && view.modules[1].updated_by === OWNER, 'and the key, reason, time and actor needed to read back an unknown outcome');
  eq([view.commands.length, view.commands[0].seq > view.commands[1].seq], [3, true], 'the log page is bounded by p_limit and newest first');
  eq((await readModuleControl(db, OWNER, 0)).commands.length, 1, 'p_limit below 1 is clamped to 1');
  eq((await readModuleControl(db, OWNER, 100000)).commands.length, await n('eup_module_policy_commands'), 'a large p_limit returns what exists (ceiling 200)');
  eq((await modulePolicyRpc(db, 'eup_module_control_read', { p_actor: SECOND_OWNER, p_limit: null })).commands.length, Math.min(50, await n('eup_module_policy_commands')), 'a null p_limit means 50');
  await rejects(() => readModuleControl(db, PEER), '42501', 'owner view refuses a non-owner');
  await rejects(() => readModuleControl(db, null), '42501', 'owner view refuses a missing actor');

  // ------------------------------------------------------------------ revision ceiling
  await admin("insert into public.eup_module_policies(org_id, module_id, state, revision, updated_by) values ($1, 'environment', 'disabled', 9007199254740991, $1)", [OWNER]);
  await rejects(() => command('environment', 'enabled', 9007199254740991, key('ceiling')), '22003', 'a state change at the revision ceiling is refused (revision_exhausted), never wrapped');
  eq((await command('environment', 'disabled', 9007199254740991, key('ceiling-noop'))).changed, false, 'a no-op at the ceiling is still answered');
  eq(vendoredReadModulePolicy(await readModulePolicy(db, 'environment'), 'mccluster', 'environment').revision, 9007199254740991, 'the ceiling is the largest revision the pinned reader accepts');

  // ------------------------------------------------------------------ helpers the other harnesses use
  eq(await enableModule(db, 'league', OWNER).then((p) => [p.state, p.revision]), ['enabled', 10], 'enableModule is a no-op on an enabled module');
  eq(await drainModule(db, 'league', OWNER).then((p) => [p.state, p.revision]), ['draining', 11], 'drainModule');
  eq(await disableModule(db, 'league', OWNER).then((p) => [p.state, p.revision]), ['disabled', 12], 'disableModule from draining');
  eq(await enableModule(db, 'league', OWNER).then((p) => [p.state, p.revision]), ['enabled', 13], 'enableModule from disabled');
  eq(await disableModule(db, 'league', OWNER).then((p) => [p.state, p.revision]), ['disabled', 15], 'disableModule from enabled drains first');
  eq(await setModuleState(db, 'league', 'enabled', OWNER).then((r) => [r.policy.revision, r.changed, r.prior]), [16, true, { state: 'disabled', revision: 15 }], 'setModuleState reads the current revision and returns the receipt');

  // ------------------------------------------------------------------ a second apply over live data changes nothing
  const snapshot = async () => ({ fp: await fingerprint(), policies: await admin('select module_id, state, revision::text as revision, updated_by, created_at::text as created_at, updated_at::text as updated_at from public.eup_module_policies order by 1'),
    log: await admin('select seq::int as seq, idempotency_key, payload_digest, receipt from public.eup_module_policy_commands order by 1') });
  const live = await snapshot();
  await apply();
  eq(await snapshot(), live, 're-applying over installed modules keeps every row, revision, log entry, grant and trigger');
  eq(live.fp.triggers.filter((t) => t.t.startsWith('eup_fixture_')).length, 6, 'the six fixture triggers survived the re-apply');
  eq(await val("select public.eup_fixture_league_command('create') as r"), 16, 'and guarded writes still work');

  // ------------------------------------------------------------------ dependency behaviour: rolling the policy back
  await rollback();
  eq(await objects(), { relations: 0, functions: 0 }, 'rollback with data removes the module-policy objects');
  eq((await admin("select count(*)::int as n from pg_trigger where tgname like 'eup_fixture_%'"))[0].n, 0, 'and CASCADE removed the backstop triggers from the domain tables');
  await rejects(() => val("select public.eup_fixture_league_command('create') as r"), '42883', 'an RPC that still calls the guard fails closed once the policy is rolled back');
  await rejects(() => val("select public.eup_fixture_league_command('withdraw') as r"), '42883', 'and so does a reduce-only RPC');
  await apply();
  await rejects(() => val("select public.eup_fixture_league_command('create') as r"), 'EUM01', 'after a fresh apply there is no row again: nothing is enabled by default');
  console.log(`${count} module policy assertions passed.`);
} finally { await close(); }
