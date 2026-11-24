/* supabase/pending/eup_module_policy_halo_v1.sql and its rollback, read as text. No database is started here and
   nothing is applied anywhere: this holds the staged file to the reviewed, applied policy migration.

     - the three functions it replaces are the applied ones byte for byte except for the module list;
     - the rollback restores exactly the applied bodies and refuses once the unit has history;
     - it creates no policy row, grants nothing new and never touches the guard functions;
     - it is still pending: not in supabase/migrations and not in the production ledger.
   Execution proof on a real PostgreSQL (or PGlite) is NOT part of this file and has not been run for it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = async (p) => (await readFile(new URL('../../' + p, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const [applied, forward, rollback] = await Promise.all([
  read('supabase/migrations/20261117144103_eup_module_policy_v1.sql'),
  read('supabase/pending/eup_module_policy_halo_v1.sql'),
  read('supabase/pending/eup_module_policy_halo_v1.rollback.sql')
]);
const FUNCTIONS = ['eup_module_control_read', 'eup_module_policy_install', 'eup_module_policy_command'];
function body(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  assert.equal(sql.indexOf(`create or replace function public.${name}(`, start + 1), -1, `${name} is defined once`);
  const end = sql.indexOf('end $$;', start);
  return sql.slice(start, end + 'end $$;'.length);
}
const THREE = "('environment','league','intake')", FOUR = "('environment','league','intake','halo')";
const withHalo = (text) => text.split(THREE).join(FOUR).split("(3, 'intake'))").join("(3, 'intake'), (4, 'halo'))");

test('the staged functions are the applied ones with halo added to the module list, and nothing else', () => {
  for (const name of FUNCTIONS) {
    assert.equal(body(forward, name), withHalo(body(applied, name)), name);
    assert.notEqual(body(forward, name), body(applied, name), `${name} does change`);
    assert.equal(body(rollback, name), body(applied, name), `${name}: the rollback restores the applied body`);
  }
  const defined = (sql) => [...sql.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1]);
  assert.deepEqual(defined(forward), FUNCTIONS); assert.deepEqual(defined(rollback), FUNCTIONS);
});

test('the module_id checks admit halo forward and the three applied units after a rollback', () => {
  for (const [sql, list, label] of [[forward, FOUR, 'forward'], [rollback, THREE, 'rollback']]) {
    for (const table of ['eup_module_policies', 'eup_module_policy_commands']) {
      assert.ok(sql.includes(`alter table public.${table} drop constraint if exists ${table}_module_id_check;\nalter table public.${table} add constraint ${table}_module_id_check\n  check (module_id in ${list});`), `${label} ${table}`);
    }
  }
});

test('it creates no row, no table, no new grant, and leaves the guards and the read function alone', () => {
  for (const [sql, label] of [[forward, 'forward'], [rollback, 'rollback']]) {
    const code = sql.split('\n').filter((l) => !l.startsWith('--')).join('\n');
    assert.doesNotMatch(code, /\binsert\s+into\s+public\.eup_module_policies\s*\([^)]*\)\s*values\s*\([^)]*'halo'/i, label);
    assert.doesNotMatch(code, /create table|drop table|drop function|truncate|delete from|alter .* owner|security invoker/i, label);
    assert.doesNotMatch(code, /eup_module_guard|eup_module_policy_read\(|eup_module_policy_json\s*\(p_module text/, label + ': guards and the gate read are untouched');
    assert.doesNotMatch(code, /grant [^;]* to (anon|authenticated|public)\b/i, label);
    assert.match(code, /revoke all on function public\.eup_module_control_read\(uuid, integer\), public\.eup_module_policy_install\(uuid, text, text, text\),\n  public\.eup_module_policy_command\(uuid, text, text, bigint, text, text\) from public, anon, authenticated;/, label);
    assert.match(code, /to service_role;\ncommit;\n$/, label);
    assert.equal(code.split('begin;').length - 1 >= 1 && code.trimEnd().endsWith('commit;'), true, label + ': one transaction');
  }
  assert.match(forward, /^-- PENDING\. Not applied to production\./);
  assert.match(forward, /eup_module_policy_v1 is not applied; nothing changed' using errcode = '55000'/, 'it refuses, changing nothing, without the applied policy schema');
  assert.match(rollback, /if exists \(select 1 from public\.eup_module_policies where module_id = 'halo'\)\n\s+or exists \(select 1 from public\.eup_module_policy_commands where module_id = 'halo'\) then\n\s+raise exception '[^']*' using errcode = '55000';/, 'the rollback refuses once the unit has a row or a command');
});

test('it is pending: not a migration, not in the production ledger, and the Worker names this exact file', async () => {
  const migrations = await readdir(new URL('../../supabase/migrations/', import.meta.url));
  assert.equal(migrations.filter((f) => /halo/.test(f) && /module_policy/.test(f)).length, 0);
  assert.doesNotMatch(await read('supabase/production-ledger.json'), /eup_module_policy_halo/);
  const { MODULE_PENDING_SQL, MODULE_IDS } = await import('../../workers/mccluster/src/eup/modules.js');
  assert.equal(MODULE_PENDING_SQL.halo, 'supabase/pending/eup_module_policy_halo_v1.sql');
  assert.deepEqual([...MODULE_IDS], ['environment', 'league', 'intake', 'halo'], 'registry order is the order the staged read answers in');
  assert.match(await read('supabase/pending/PROMOTION-ORDER.md'), /eup_module_policy_halo_v1\.sql/);
});
