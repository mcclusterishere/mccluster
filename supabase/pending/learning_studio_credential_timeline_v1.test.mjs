// Standalone proof on a disposable PGlite database. No client/server network,
// production credentials, school/registrar records, or learner information.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PGLITE_MODULE_PATH;
if (!modulePath || !path.isAbsolute(modulePath)) throw Error('Set PGLITE_MODULE_PATH to the pinned PGlite dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath));
const db = new PGlite();
const read = suffix => readFile(new URL('./learning_studio_credential_timeline_v1' + suffix, import.meta.url), 'utf8');
const forward = await read('.sql');
const rollback = await read('.rollback.sql');
const ids = {
  ownerA: '70000000-0000-4000-8000-000000000001',
  ownerB: '70000000-0000-4000-8000-000000000002',
  member: '70000000-0000-4000-8000-000000000003',
  outsider: '70000000-0000-4000-8000-000000000004',
  house: '60000000-0000-4000-8000-000000000001',
  foreign: '60000000-0000-4000-8000-000000000002',
};
const sample = goalLabel => ({ version: 1, goals: [{ id: 'goal', label: goalLabel, school: 'Sample College' }], items: [] });
const A = sample('Fixture plan A'), B = sample('Fixture plan B');
const edit = { ...A, goals: [...A.goals, { id: 'next', label: 'Fixture updated A', school: 'Sample College' }],
  items: [{ id: 'item', label: 'Sample module', goal_ids: ['next'], kind: 'course', start: '2030-01-01', end: '2030-02-01',
    status: 'planned', next_action: 'Check the source', prerequisites: [], destinations: [
      { school: 'Sample College', equivalent: 'DEMO 000', credits: null, status: 'proposed', evidence_date: '', evidence_type: '' },
    ] }],
};
const secret = 'sensitive fixture should never appear in errors';
const empty = { version: 1, goals: [], items: [] };
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const serverRead = async owner => (await db.query('select revision, plan from public.learning_studio_timelines where owner_id=$1', [owner])).rows[0];
const save = (uid, expect, plan) => scalar(
  'select public.learning_studio_save_timeline($1::uuid, $2::integer, $3::jsonb)',
  [uid, expect, JSON.stringify(plan)],
);
const permissionDenied = { code: '42501' };
const invalidPlan = e => e.code === '22023' && e.message === 'Invalid timeline save request' && !e.detail;
async function asRole(role, fn) {
  assert.ok(['anon', 'authenticated', 'service_role', 'rls_probe'].includes(role));
  await db.exec('set role ' + role);
  try { await fn(); } finally { await db.exec('reset role'); }
}

try {
  // Exercise the same table/column/role names as the existing authority;
  // service_role gets only SELECT on authority stubs. Simulate inherited
  // defaults as well as permissive hosted default grants.
  await db.exec(String.raw`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role rls_probe;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.orgs (id uuid primary key, slug text unique not null, enabled boolean not null);
    create table public.org_members (
      org_id uuid references public.orgs,
      profile_id uuid references auth.users,
      role text not null,
      primary key (org_id, profile_id)
    );
    grant select on public.orgs, public.org_members to service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
  `);
  for (const id of [ids.ownerA, ids.ownerB, ids.member, ids.outsider]) await db.query('insert into auth.users values ($1)', [id]);
  for (const [id, slug] of [[ids.house, 'mccluster'], [ids.foreign, 'outside-fixture']]) {
    await db.query('insert into public.orgs values ($1,$2,true)', [id, slug]);
  }
  for (const [org, owner, role] of [
    [ids.house, ids.ownerA, 'owner'], [ids.house, ids.ownerB, 'owner'], [ids.house, ids.member, 'admin'],
    [ids.foreign, ids.outsider, 'owner'],
  ]) await db.query('insert into public.org_members values($1,$2,$3)', [org, owner, role]);
  await db.exec(forward);
  assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.learning_studio_timelines'::regclass"), true);
  assert.equal(await scalar("select prosecdef from pg_proc where oid='public.learning_studio_save_timeline(uuid,integer,jsonb)'::regprocedure"), false);
  for (const role of ['anon', 'authenticated']) {
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      assert.equal(await scalar("select has_table_privilege($1,'public.learning_studio_timelines',$2)", [role, priv]), false);
    }
    assert.equal(await scalar("select has_function_privilege($1,'public.learning_studio_save_timeline(uuid,integer,jsonb)','EXECUTE')", [role]), false);
  }
  for (const priv of ['DELETE', 'TRUNCATE']) {
    assert.equal(await scalar("select has_table_privilege('service_role','public.learning_studio_timelines',$1)", [priv]), false);
  }

  await asRole('service_role', async () => {
    for (const uid of [ids.member, ids.outsider, null]) await assert.rejects(save(uid, 0, A), permissionDenied);
    for (const bad of [null, secret, [], { version: 1, goals: [] }, { version: '1', goals: [], items: [] },
      { ...empty, budget: secret }, { ...empty, unknown: secret }, { ...empty, items: [secret.repeat(20000)] }]) {
      await assert.rejects(save(ids.ownerA, 0, bad), invalidPlan);
    }
    for (const invalid of [null, -1]) await assert.rejects(save(ids.ownerA, invalid, A), invalidPlan);
    assert.equal(await save(ids.ownerA, 1, A), 0, 'CAS on missing row does not create');
    assert.equal(await save(ids.ownerA, 0, A), 1);
    assert.equal(await save(ids.ownerA, 0, B), 0, 'duplicate create cannot replace');
    assert.equal(await save(ids.ownerB, 0, B), 1);
    assert.equal(await save(ids.ownerA, 1, edit), 2);
    assert.equal(await save(ids.ownerA, 1, edit), 0, 'response-loss replay does not increment or replace');
    assert.equal(await save(ids.ownerA, 1, B), 0, 'stale edit cannot replace');
    assert.deepEqual(await serverRead(ids.ownerA), { revision: 2, plan: edit });
    assert.deepEqual(await serverRead(ids.ownerB), { revision: 1, plan: B });
    assert.equal(await serverRead(ids.outsider), undefined);
  });
  for (const role of ['anon', 'authenticated']) {
    await asRole(role, async () => {
      await assert.rejects(serverRead(ids.ownerA), permissionDenied);
      await assert.rejects(save(ids.ownerA, 2, empty), permissionDenied);
    });
  }
  // RLS remains closed even if someone mistakenly grants a non-bypass role access.
  await db.exec('grant select, insert on public.learning_studio_timelines to rls_probe');
  await asRole('rls_probe', async () => {
    assert.equal(await scalar('select count(*)::int from public.learning_studio_timelines'), 0);
    await assert.rejects(db.query('insert into public.learning_studio_timelines(owner_id,revision,plan) values($1,1,$2::jsonb)',
      [ids.outsider, JSON.stringify(empty)]), permissionDenied);
  });
  await db.exec('revoke select, insert on public.learning_studio_timelines from rls_probe');

  await db.query('update public.orgs set enabled=false where id=$1', [ids.house]);
  await asRole('service_role', async () => assert.rejects(save(ids.ownerA, 2, empty), permissionDenied));
  await db.query('update public.orgs set enabled=true where id=$1', [ids.house]);
  await db.query('update public.org_members set role=$1 where org_id=$2 and profile_id=$3', ['admin', ids.house, ids.ownerA]);
  await asRole('service_role', async () => {
    await assert.rejects(save(ids.ownerA, 2, empty), permissionDenied);
    assert.deepEqual(await serverRead(ids.ownerA), { revision: 2, plan: edit });
  });

  await assert.rejects(db.exec(rollback), { code: '55000', message: 'Timeline records exist; refusing destructive rollback' });
  await db.exec('rollback');
  await asRole('service_role', async () => {
    assert.deepEqual(await serverRead(ids.ownerA), { revision: 2, plan: edit });
    assert.deepEqual(await serverRead(ids.ownerB), { revision: 1, plan: B });
  });
  // Clear fixture data (scratch only). Prove an empty rollback removes only
  // its own SQL objects and leaves shared platform records intact.
  await db.exec('delete from public.learning_studio_timelines');
  await db.exec(rollback);
  assert.equal(await scalar("select to_regclass('public.learning_studio_timelines')"), null);
  assert.equal(await scalar("select to_regprocedure('public.learning_studio_save_timeline(uuid,integer,jsonb)')"), null);
  assert.equal(await scalar('select count(*)::int from public.org_members'), 4);
  await db.exec(forward);
  await asRole('service_role', async () => assert.equal(await save(ids.ownerB, 0, empty), 1));
  await assert.rejects(db.exec(rollback), { code: '55000' }, 'even a saved empty plan is preserved');
  await db.exec('rollback');
  console.log('Credential Timeline SQL: role denial, owner scope, invalid input redaction, CAS/replay, rollback guard and re-apply passed');
} finally {
  await db.close();
}
