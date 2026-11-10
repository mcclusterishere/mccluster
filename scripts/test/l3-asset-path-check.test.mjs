/* supabase/pending/l3_products_asset_path_check_v1.sql is a candidate, not a
   migration: one NOT VALID CHECK on public.l3_products.asset_path that the
   owner applies, or does not, after reading the count in its header.

   This holds the candidate to what it says without a database: it is pending
   and unapplied, it adds exactly one constraint and nothing else, the
   read-only count in its header is the constraint's own rule, its rollback
   undoes it, it is registered where pending SQL is registered, whatever the
   table would accept the download function accepts too, and the header's
   second count (the products the function itself refuses) is the function's
   rule and nothing else. What Postgres itself answers is
   scripts/test-l3-asset-path-check-db.sh, on a scratch Postgres 16. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { safeObjectPath } from '../../supabase/functions/_shared/storage-object-path.ts';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const NAME = 'l3_products_asset_path_check_v1';
const FILE = `supabase/pending/${NAME}.sql`;
const ROLLBACK = `supabase/pending/${NAME}.rollback.sql`;
const CONSTRAINT = 'l3_products_asset_path_plain_check';
const sql = read(FILE);
const statements = sql.replace(/--[^\n]*/g, '');
const squash = (s) => s.replace(/\s+/g, ' ').trim();

test('the candidate is pending: not a migration, not in the production ledger', () => {
  assert.ok(!readdirSync(new URL('../../supabase/migrations/', import.meta.url)).some((f) => f.includes('l3_products_asset_path')));
  assert.ok(!readdirSync(new URL('../../supabase/replay_migrations/', import.meta.url)).some((f) => f.includes('l3_products_asset_path')));
  const ledger = JSON.parse(read('supabase/production-ledger.json'));
  assert.ok(!ledger.migrations.some((m) => String(m.name).includes('l3_products_asset_path')));
  assert.match(sql, /^-- CANDIDATE, NOT APPLIED\./m, 'the file says so itself');
});

test('it adds one NOT VALID constraint and does nothing else', () => {
  assert.equal((statements.match(/\badd constraint\b/gi) || []).length, 1);
  assert.match(squash(statements), new RegExp(`alter table public\\.l3_products add constraint ${CONSTRAINT} check \\(.+\\) not valid;`));
  assert.doesNotMatch(statements, /\bvalidate\s+constraint\b/i, 'VALIDATE is the owner\'s separate statement');
  for (const word of ['create', 'drop', 'insert', 'update', 'delete', 'truncate', 'grant', 'revoke', 'policy', 'trigger', 'function']) {
    assert.doesNotMatch(statements, new RegExp(`\\b${word}\\b`, 'i'), `no ${word}`);
  }
  assert.match(statements, /^set local lock_timeout = '5s';$/m);
  assert.match(statements, /exception when duplicate_object then null;/, 'safe to run twice');
  assert.match(statements, new RegExp(`comment on constraint ${CONSTRAINT} on public\\.l3_products is`));
});

/* the rule, once in the constraint and once in the header's read-only count */
const constraintRule = squash(/check \(\s*asset_path is null\s+or \(([\s\S]+?)\)\s*\) not valid;/.exec(statements)?.[1] || '');
const headerCount = squash((/^-- >>> count \(read-only\)\n([\s\S]+?)^-- <<< count$/m.exec(sql)?.[1] || '').replace(/^--/gm, ''));

test('the read-only count in the header counts exactly the rows the constraint would refuse', () => {
  assert.ok(constraintRule.startsWith('octet_length(asset_path) <= 1024 and '), constraintRule);
  assert.equal(headerCount, `select count(*) from public.l3_products where asset_path is not null and not (${constraintRule});`);
  assert.doesNotMatch(headerCount, /\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i, 'read-only');
  assert.match(sql, new RegExp(`alter table public\\.l3_products validate constraint ${CONSTRAINT};`), 'the header gives the VALIDATE statement to run afterwards');
  assert.match(sql, /NOT VALID, on purpose\./);
  assert.match(sql, /cannot be edited at all/, 'the header states what NOT VALID means for a row that already breaks the rule');
  assert.match(sql, /Never run the\s+--\s+whole of supabase\/pending\./);
});

test('the rollback drops the constraint and changes nothing else', () => {
  const rollback = read(ROLLBACK).replace(/--[^\n]*/g, '');
  assert.deepEqual(squash(rollback).split(';').map((s) => s.trim()).filter(Boolean), [
    "set local lock_timeout = '5s'",
    `alter table public.l3_products drop constraint if exists ${CONSTRAINT}`,
  ]);
});

test('it is registered where pending SQL is registered', () => {
  const readme = read('supabase/pending/README.md');
  assert.match(readme, new RegExp(`Pending \\(2026-11-10\\): \`${NAME}\\.sql\` \\(rollback\\s+\`${NAME}\\.rollback\\.sql\`\\)`));
  assert.match(readme, /`NOT VALID`/);
  const order = read('supabase/pending/PROMOTION-ORDER.md');
  assert.match(order, new RegExp(`\\| \`${NAME}\\.sql\` \\(\\+ rollback\\) \\|`));
  /* live-callers.json lists functions, tables and buckets that shipped code calls and production lacks.
     This file defines none, so it must add no entry; rpc-names-exist.test.mjs fails on a stale one. */
  const callers = JSON.parse(read('supabase/pending/live-callers.json'));
  for (const section of Object.values(callers)) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
    for (const [name, entry] of Object.entries(section)) assert.notEqual(entry?.pending, `${NAME}.sql`, name);
  }
  assert.doesNotMatch(statements, /\bcreate\b|storage\.buckets/i);
  for (const helper of ['scripts/test-l3-asset-path-check-db.sh', 'supabase/tests/l3_products_asset_path_check.behaviour.sql']) assert.ok(existsSync(new URL('../../' + helper, import.meta.url)), helper);
  const script = read('scripts/test-l3-asset-path-check-db.sh');
  for (const used of [FILE, ROLLBACK, 'supabase/tests/l3_products_asset_path_check.behaviour.sql', 'supabase/replay_migrations/0071_level3_replay_foundation.sql']) assert.ok(script.includes(used), used);
});

/* The same rule in JavaScript, built from the file's own text: the pattern uses
   nothing that Postgres and JavaScript read differently (ASCII ranges, anchors
   that match only at the ends). */
const pattern = /asset_path ~ '([^']+)'/.exec(constraintRule)?.[1];
function tableAccepts(path) {
  if (path === null) return true;
  const bytes = Buffer.byteLength(path, 'utf8');
  return bytes <= 1024 && bytes === [...path].length && new RegExp(pattern).test(path) && !path.includes('..');
}

test('the table\'s rule: plain names of the plane\'s own upload alphabet, and nothing else', () => {
  assert.equal(constraintRule, `octet_length(asset_path) <= 1024 and octet_length(asset_path) = char_length(asset_path) and asset_path ~ '${pattern}' and position('..' in asset_path) = 0`);
  assert.equal(pattern, '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$');
  for (const ok of [null, 'a', 'packs/sound-pack-v1.zip', 'A/b/c.d-e_f', '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222-file.zip', 'a'.repeat(1024)]) {
    assert.equal(tableAccepts(ok), true, String(ok).slice(0, 60));
  }
  for (const bad of ['', '/x', 'x/', 'a//b', '.', '..', './x', '../other-bucket/x', 'a/../../other-bucket/x', 'a/./b', 'a..b', '...', '.hidden', '-x', 'a b', '.. /x',
    '%2e%2e/x', 'a%2fb', 'a?b', 'a#b', 'a\\b', 'a\n', 'packs/sound-pack-v1.zip\n', '\na', 'a\tb', 'a\u0000b', 'aé', 'a'.repeat(1025)]) {
    assert.equal(tableAccepts(bad), false, JSON.stringify(bad).slice(0, 60));
  }
});

/* The header's other count is for the function's deploy, not for the CHECK: how many
   products l3-download refuses. It is written as two patterns that Postgres and
   JavaScript read alike; here they are held to the function's rule itself, so the
   count cannot drift from what the function does. (Text in Postgres holds neither
   a NUL nor half of a surrogate pair, so those two are left out of the comparison.) */
test('the header\'s function count counts exactly the paths the download function refuses', () => {
  const block = /^-- >>> function count \(read-only\)\n([\s\S]+?)^-- <<< function count$/m.exec(sql)?.[1] || '';
  const text = squash(block.replace(/^--/gm, ''));
  assert.match(text, /^select count\(\*\) from public\.l3_products where asset_path is not null and asset_path <> '' and \(asset_path ~ '[^']+' or asset_path ~ '[^']+'\);$/);
  assert.doesNotMatch(text, /\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i, 'read-only');
  const patterns = [...text.matchAll(/asset_path ~ '([^']+)'/g)].map((m) => new RegExp(m[1]));
  assert.equal(patterns.length, 2);
  assert.ok(!/[^\x00-\x7f]/.test(block), 'every special character in the count is written as an escape');
  const counted = (path) => path !== '' && patterns.some((re) => re.test(path));
  for (const [path, refused] of [['packs/sound-pack-v1.zip', false], ['packs/My Pack (v2) + extras.zip', false], ['packs/final..mix.zip', false], ['a'.repeat(2000), false],
    ['../other-bucket/x', true], ['%2e%2e/other-bucket/x', true], ['packs/pack.zip ', true], ['packs/what?.zip', true], ['a//b', true], ['/a', true], ['a\\b', true], ['a\n', true]]) {
    assert.equal(counted(path), refused, JSON.stringify(path).slice(0, 50));
    assert.equal(safeObjectPath(path), !refused, JSON.stringify(path).slice(0, 50));
  }
  const cp = (n) => String.fromCodePoint(n);
  const pieces = ['.', '..', '...', '/', '//', '\\', '%2e', '%', ' ', '  ', '\t', '\n', '\r', cp(1), cp(0x1f), cp(0x7f), cp(0x80), cp(0x85), cp(0x9f), cp(0xa0), cp(0xe9), cp(0x2028), cp(0x2029), cp(0x202f), cp(0xff0e), cp(0x1f600),
    '?', '#', ';', ':', '@', '&', '=', '+', ',', '~', '!', '*', "'", '"', '(', ')', '$', '^', '|', '[', ']', '{', '}', 'a', 'Z', '0', '-', '_', 'packs', 'file.zip'];
  let seed = 0x0c0ffee5;
  const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let refusedCount = 0;
  const check = (path) => { if (counted(path)) refusedCount += 1; assert.equal(counted(path), !safeObjectPath(path), JSON.stringify(path)); };
  for (let c = 1; c < 0x300; c += 1) for (const path of [cp(c), 'a' + cp(c), cp(c) + 'a', 'a/' + cp(c) + 'b', 'a' + cp(c) + '/b']) check(path);
  for (let i = 0; i < 60000; i += 1) {
    let path = '';
    for (let n = 1 + Math.floor(random() * 7); n > 0; n -= 1) path += pieces[Math.floor(random() * pieces.length)];
    check(path);
  }
  assert.ok(refusedCount > 20000, `only ${refusedCount} generated paths were refused`);
});

test('whatever the table would accept, the download function accepts', () => {
  const pieces = ['.', '..', '/', '//', '\\', '%2e', '%', ' ', '\t', '\n', '\r', '?', '#', ';', ':', '@', '&', '=', '+', ',', '~', '(', ')', "'", '"',
    'a', 'B', 'x', '0', '9', '-', '_', 'packs', 'file.zip', 'v1.2', 'é', '11111111-1111-4111-8111-111111111111'];
  let seed = 0x13c0ffee;
  const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let accepted = 0, functionOnly = 0;
  for (let i = 0; i < 60000; i += 1) {
    let path = '';
    for (let n = 1 + Math.floor(random() * 7); n > 0; n -= 1) path += pieces[Math.floor(random() * pieces.length)];
    if (tableAccepts(path)) { accepted += 1; assert.equal(safeObjectPath(path), true, JSON.stringify(path)); } else if (safeObjectPath(path)) functionOnly += 1;
  }
  assert.ok(accepted > 1500, `only ${accepted} generated paths passed the table's rule`);
  assert.ok(functionOnly > 500, 'the table is the narrower of the two, as its header says');
});
