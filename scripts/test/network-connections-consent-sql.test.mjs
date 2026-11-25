// Static checks on the consent guard for public.network_connections and its retained rollback,
// at the paths named by scripts/test/support/network-connections-database.mjs, in the root suite.
// The database proofs are scripts/test/network-connections-consent.integration.mjs (PGlite) and
// scripts/test/network-connections-consent.native.integration.mjs (PostgreSQL 16 and 17). Here: the file's shape (one
// transaction, its lock bound, exactly the statements the fix needs), the rollback's policies equal to the repository's
// record of production, and the assumption the fix rests on: no shipped code writes the table with a member's token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FIX_FILE, ROLLBACK_FILE, REPLAY_FILE, consentForwardLocation, fixSql, rollbackSql, repoFile, splitStatements, normalizeStatement } from './support/network-connections-database.mjs';

const statements = (sql) => splitStatements(sql).map((s) => normalizeStatement(s.text));
const NOT_APPLIED = "Not applied. Apply only with Matthew's approval.";
const TRANSACTION_CONTROL = /^(begin|commit|rollback|end|abort|savepoint|release|start transaction)\b/i;

test('the forward SQL and rollback retain their original review headers', async () => {
  // A later promotion preserves the SQL, including its pre-approval header.
  // Current status belongs to the production ledger and promotion records.
  assert.ok((await fixSql()).includes(NOT_APPLIED));
  assert.ok((await rollbackSql()).includes(NOT_APPLIED));
});

test('the forward SQL stays pending until the ledger records its actual migration version', () => {
  assert.deepEqual(consentForwardLocation({ migrations: [] }), {
    directory: 'pending', file: '20261119062110_network_connections_consent_guard_v1.sql'
  });
  const fixture = { version: '20990101000000', name: 'network_connections_consent_guard_v1' };
  assert.deepEqual(consentForwardLocation({ migrations: [fixture] }), {
    directory: 'migrations', file: '20990101000000_network_connections_consent_guard_v1.sql'
  });
  assert.throws(() => consentForwardLocation({ migrations: [fixture, fixture] }), /recorded more than once/);
  assert.throws(() => consentForwardLocation({ migrations: [{ ...fixture, version: 'unrecorded' }] }), /actual migration version/);
});

test('the fix is one transaction with a 5 s lock bound, and does exactly three things before its check', async () => {
  const s = statements(await fixSql());
  assert.equal(s[0], 'begin;');
  assert.equal(s[1], "set local lock_timeout = '5s';");
  assert.equal(s.at(-1), 'commit;');
  assert.deepEqual(s.slice(1, -1).filter((x) => TRANSACTION_CONTROL.test(x)), [], 'no other transaction control');
  assert.deepEqual(s.slice(2, -2), [
    'drop policy if exists network_connections_self_write on public.network_connections;',
    'drop policy if exists network_connections_self_update on public.network_connections;',
    'revoke insert, update, delete on table public.network_connections from authenticated;'
  ]);
  const check = s.at(-2);
  assert.match(check, /^do \$consent\$/);
  for (const part of ["has_any_column_privilege(r.role, 'public.network_connections', p.priv)", "('anon'), ('authenticated')",
    "('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')", "p.roles && array['public', 'anon', 'authenticated']::name[]",
    "('public.request_connection(uuid)'), ('public.answer_connection(uuid,boolean)')", "('public.withdraw_connection(uuid)')",
    'f.prosecdef and f.proowner = v_owner']) assert.ok(check.includes(part), `the check covers ${part}`);
  assert.equal((check.match(/errcode = '55000'/g) || []).length, 3, 'each refusal is 55000');
});

test('the fix keeps the member read policy, SELECT and everything else', async () => {
  const text = statements(await fixSql()).join('\n');
  assert.doesNotMatch(text, /network_connections_member_read/);
  assert.doesNotMatch(text, /\bgrant\b/i);
  assert.doesNotMatch(text, /revoke[^;]*\bselect\b/i);
  const named = new Set([...text.matchAll(/\bpublic\.([a-z_]+)\b/g)].map((m) => m[1]));
  assert.deepEqual([...named].sort(), ['answer_connection', 'network_connections', 'request_connection', 'withdraw_connection'],
    'it names no other object');
});

test('the rollback puts back exactly the production-only policies, as the repository records them, and the three grants', async () => {
  const s = statements(await rollbackSql());
  const replay = await repoFile(REPLAY_FILE);
  const recorded = (name) => normalizeStatement(new RegExp(`create policy ${name} on public\\.network_connections[^;]*;`).exec(replay)[0]);
  assert.deepEqual(s, [
    'begin;',
    "set local lock_timeout = '5s';",
    'grant insert, update, delete on table public.network_connections to authenticated;',
    'drop policy if exists network_connections_self_update on public.network_connections;',
    recorded('network_connections_self_update'),
    'drop policy if exists network_connections_self_write on public.network_connections;',
    recorded('network_connections_self_write'),
    'commit;'
  ]);
});

test('the header records the production evidence the proofs check', async () => {
  const text = await fixSql();
  for (const fact of ['{postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=arwdm/postgres,service_role=arwdDxtm/postgres}',
    "'{postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=rm/postgres,service_role=arwdDxtm/postgres}'",
    '376 rows (latest version 20261118035654)', 'PostgreSQL 17.6', 'section 13']) assert.ok(text.includes(fact), fact);
});

const SHIPPED = ['js', 'workers/mccluster/src', 'workers/mccluster-mcp/src', 'supabase/functions', 'core/src', 'native/src'];
async function* files(dir) {
  let entries = [];
  try { entries = await readdir(new URL(`../../${dir}/`, import.meta.url), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* files(path);
    else if (/\.(m?js|ts|tsx|html)$/.test(e.name)) yield path;
  }
}

test('no shipped code writes public.network_connections with a member\'s token (the fix takes that away)', async () => {
  const mentions = [];
  const roots = await readdir(new URL('../../', import.meta.url));
  const all = [...roots.filter((f) => f.endsWith('.html'))];
  for (const dir of SHIPPED) for await (const f of files(dir)) all.push(f);
  for (const f of all) {
    const text = await readFile(new URL(`../../${f}`, import.meta.url), 'utf8');
    text.split('\n').forEach((line, i) => { if (line.includes('network_connections')) mentions.push([f, i + 1, line]); });
  }
  for (const [f, line, text] of mentions) {
    if (f === 'workers/mccluster/src/platform-api.js' && /service\(env,`network_connections\?[^`]*`\)/.test(text)) continue; // the service role's GET
    assert.doesNotMatch(text, /["'`/]network_connections|from\(\s*["'`]network_connections/, `${f}:${line} reaches the table directly: review it before applying the fix`);
  }
  assert.ok(mentions.some(([f]) => f === 'workers/mccluster/src/platform-api.js'), 'the Worker\'s read is still where the fix\'s header says');
});

test('the promotion records locate the forward file and retained rollback', async () => {
  const order = await repoFile('supabase/pending/PROMOTION-ORDER.md');
  const readme = await repoFile('supabase/pending/README.md');
  for (const file of [FIX_FILE, ROLLBACK_FILE]) assert.ok(order.includes(file), `PROMOTION-ORDER.md names ${file}`);
  assert.ok(readme.includes(FIX_FILE), `README.md names ${FIX_FILE}`);
  assert.match(order, /## 13\. Network connections: consent/);
});
