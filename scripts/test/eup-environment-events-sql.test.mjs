// Static checks of the pending E=UP environmental event store (supabase/pending/20261119100000_eup_environment_events_v1_01.sql
// to _05.sql and its rollback), in the root suite so every pull request runs them without a database. The behaviour is proven
// by scripts/test/eup-environment-events.integration.mjs (PGlite) and .native.integration.mjs (PostgreSQL 16 and 17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STORE_PART_FILES, STORE_PART_NAMES, STORE_ROLLBACK_FILE, STORE_PART_MAX_BYTES, STORE_ENTRY_POINTS } from './support/eup-environment-database.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const parts = STORE_PART_FILES.map((f) => ({ file: f, sql: read(`supabase/pending/${f}`) }));
const rollback = read(`supabase/pending/${STORE_ROLLBACK_FILE}`);
const stripComments = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const created = (sql, kind) => [...stripComments(sql).matchAll(kind === 'function'
  ? /create or replace function public\.(\w+)\(/g : /create table if not exists public\.(\w+) \(/g)].map((m) => m[1]);
const entryNames = STORE_ENTRY_POINTS.map((e) => e.split('(')[0]);

test('five parts and one rollback are staged, and nothing else of the store', () => {
  const staged = readdirSync(new URL('supabase/pending/', ROOT)).filter((f) => f.startsWith('20261119100000_eup_environment_events_v1'));
  assert.deepEqual(staged.sort(), [...STORE_PART_FILES, STORE_ROLLBACK_FILE].sort());
  assert.deepEqual(readdirSync(new URL('supabase/migrations/', ROOT)).filter((f) => f.includes('eup_environment_events')), [],
    'nothing of the store is under supabase/migrations/: it is not applied');
});

test('every part is one transaction of at most 32,000 bytes that names itself and says it is pending', () => {
  for (const [i, { file, sql }] of parts.entries()) {
    const bytes = Buffer.byteLength(sql, 'utf8');
    assert.ok(bytes <= STORE_PART_MAX_BYTES, `${file}: ${bytes} bytes`);
    assert.ok(sql.startsWith(`-- E=UP ENVIRONMENTAL EVENT STORE, version 1, part 0${i + 1} of 05 (migration name ${STORE_PART_NAMES[i]})`), `${file}: its first line`);
    assert.ok(sql.includes('-- PENDING. Not applied to production. Owner approval required.'), `${file}: the pending header`);
    assert.ok(sql.includes('independent of and after the mission publish (step 9 of docs/control-plane/WORLD-RELEASE-20261118.md)'), `${file}: after step 9`);
    const body = stripComments(sql);
    assert.equal((body.match(/^begin;$/gm) || []).length, 1, `${file}: one begin`);
    assert.ok(sql.endsWith('commit;\n'), `${file}: ends with its commit`);
    assert.match(body, /^set local lock_timeout = '5s';$/m, `${file}: bounded lock wait`);
  }
});

test('parts 02 to 05 refuse until the part before them is in; part 01 refuses without the module policy', () => {
  assert.match(parts[0].sql, /to_regprocedure\('public\.eup_module_policy_read\(text\)'\) is null[\s\S]*errcode = '55000'/);
  for (let i = 1; i < parts.length; i += 1) {
    assert.ok(parts[i].sql.includes(`raise exception 'eup_environment_events_v1_0${i + 1}: apply eup_environment_events_v1_0${i} first' using errcode = '55000';`),
      `${parts[i].file}: its order guard names part 0${i}`);
  }
});

test('each part takes back from every API role what it creates, before granting only the entry points to service_role', () => {
  const all = [];
  for (const { file, sql } of parts) {
    const body = stripComments(sql);
    const fns = created(sql, 'function');
    all.push(...fns);
    const revokeAt = body.indexOf('revoke all on function');
    assert.ok(revokeAt > 0, `${file}: revokes its functions`);
    const revoke = body.slice(revokeAt, body.indexOf(';', revokeAt));
    for (const fn of fns) assert.ok(revoke.includes(`public.${fn}(`), `${file}: ${fn} is revoked in the part that creates it`);
    assert.match(revoke, /from public, anon, authenticated, service_role$/, `${file}: from PUBLIC and all three API roles`);
    const grants = [...body.matchAll(/grant execute on function ([\s\S]*?) to (\w+);/g)];
    for (const g of grants) {
      assert.equal(g[2], 'service_role', `${file}: execute is granted to service_role only`);
      assert.ok(body.indexOf(g[0]) > revokeAt, `${file}: the grant comes after the revoke`);
      for (const m of g[1].matchAll(/public\.(\w+)\(/g)) assert.ok(entryNames.includes(m[1]), `${file}: ${m[1]} is an entry point`);
    }
    assert.doesNotMatch(body, /grant [^;]* to (anon|authenticated|public)\b/i, `${file}: nothing is granted to anon, authenticated or PUBLIC`);
    assert.doesNotMatch(body, /grant (select|insert|update|delete|all)[^;]* on (table )?public\.eup_environment/i, `${file}: no table privilege is granted`);
    for (const m of body.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\bas \$\$/g)) {
      assert.match(m[0], /set search_path = ''/, `${file}: ${m[1]} pins an empty search_path`);
    }
  }
  assert.deepEqual([...new Set(all)].length, all.length, 'no function is created by two parts');
  assert.deepEqual(entryNames.filter((e) => !all.includes(e)), [], 'every entry point is created by some part');
  const tables = created(parts[0].sql, 'table');
  assert.equal(tables.length, 7, 'part 01 creates the seven tables');
  for (const t of tables) {
    assert.ok(parts[0].sql.includes(`alter table public.${t} enable row level security;`), `${t}: row level security on`);
  }
  assert.doesNotMatch(parts.map((p) => stripComments(p.sql)).join('\n'), /create policy/i, 'no policy: the functions are the only door');
});

test('only government providers: gdelt is in no provider list of the store', () => {
  for (const { file, sql } of parts) {
    for (const m of stripComments(sql).matchAll(/provider in \(([^)]*)\)/g)) {
      assert.equal(m[1], "'usgs', 'nws', 'nhc', 'eonet', 'firms', 'wfigs', 'coops'", `${file}: the fixed list of government providers`);
    }
    assert.doesNotMatch(stripComments(sql), /'gdelt'/, `${file}: gdelt is never accepted`);
  }
});

test('the rollback is a recovery artifact that drops exactly what the parts create', () => {
  assert.ok(rollback.startsWith('-- Recovery artifact for 20261119100000_eup_environment_events_v1_01.sql to _05.sql: never a forward migration.'));
  assert.ok(rollback.includes('Owner approval required, like the forward parts.'));
  const body = stripComments(rollback);
  const droppedFns = [...body.matchAll(/drop function if exists public\.(\w+)\(/g)].map((m) => m[1]).sort();
  const droppedTables = [...body.matchAll(/drop table if exists public\.(\w+);/g)].map((m) => m[1]).sort();
  assert.deepEqual(droppedFns, parts.flatMap((p) => created(p.sql, 'function')).sort(), 'every function, once');
  assert.deepEqual(droppedTables, created(parts[0].sql, 'table').sort(), 'every table, once');
  assert.doesNotMatch(body, /cascade|eup_module_polic/i, 'no cascade, and the module policy is never touched');
  assert.ok(body.indexOf('drop table') < body.indexOf('drop function if exists public.eup_environment_state_of('),
    'the tables go before the helper their CHECK calls');
});

test('the promotion order records the parts, the order and what waits for the owner', () => {
  const order = read('supabase/pending/PROMOTION-ORDER.md');
  const at = order.indexOf('## 12. E=UP environmental event store');
  assert.ok(at > 0, 'section 12 exists');
  const section = order.slice(at, order.indexOf('\n## ', at + 5));
  for (const f of [...STORE_PART_FILES, STORE_ROLLBACK_FILE]) assert.ok(section.includes(f), `section 12 names ${f}`);
  assert.match(section, /separate approval of the exact text/);
  assert.match(section, /after the mission publish/);
  assert.match(section, /changes nothing public until the ingest flag and the environment module/);
  assert.ok(read('supabase/pending/README.md').includes('20261119100000_eup_environment_events_v1_01.sql'), 'the README names the store');
});
