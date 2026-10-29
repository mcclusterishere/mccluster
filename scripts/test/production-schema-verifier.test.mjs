// Offline checks for scripts/db/verify-production-schema.mjs and its evidence.
// No database: the live comparison runs in the "Supabase migration reset" CI job and,
// against production, by hand (docs/control-plane/PRODUCTION-SCHEMA-RECONCILIATION-2026-10-28.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { SECTIONS, SECTION_NAMES, canonicalJsonbText, normalizeSqlCode, MANAGED_SCHEMAS } from '../db/schema-queries.mjs';
import {
  checkSectionIntegrity, compareLedger, compareSection, formatSnapshot, manifestFromSnapshot,
  postureFindings, scanSqlObjects, SNAPSHOT_SCHEMA, MANIFEST_SCHEMA,
} from '../db/verify-production-schema.mjs';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const evidenceDir = path.join(root, 'docs', 'control-plane', 'evidence');

test('every query is a single read-only SELECT', () => {
  for (const name of SECTION_NAMES) {
    // String literals ('INSERT', ';') are data, not statements.
    const sql = SECTIONS[name].sql.replace(/'(?:[^']|'')*'/g, "''");
    assert.match(sql, /^select /, name);
    assert.doesNotMatch(sql, /;/, `${name} must be one statement`);
    assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|copy|vacuum|pg_read_file|lo_import|dblink)\b/i, name);
    // created_by holds an email address; statements and expressions are only ever hashed.
    assert.doesNotMatch(SECTIONS[name].sql, /created_by/, name);
  }
  assert.ok(MANAGED_SCHEMAS.includes('auth') && MANAGED_SCHEMAS.includes('storage'));
});

test('canonicalJsonbText reproduces the way Postgres prints jsonb', () => {
  assert.equal(canonicalJsonbText([['a', 1, true, null, ['x', 'y\n"z']]]), '[["a", 1, true, null, ["x", "y\\n\\"z"]]]');
  assert.equal(canonicalJsonbText([]), '[]');
});

test('normalizeSqlCode drops line comments and collapses whitespace', () => {
  assert.equal(normalizeSqlCode('-- head\n create  table x(a int); -- tail\n\tselect 1;\n'), 'create table x(a int); select 1;');
});

test('the dated production evidence is the database result byte for byte', async () => {
  const files = (await readdir(evidenceDir)).filter((f) => /^production-schema-snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  assert.ok(files.length, 'no production schema snapshot evidence');
  for (const f of files) {
    const snap = JSON.parse(await readFile(path.join(evidenceDir, f), 'utf8'));
    assert.equal(snap.schema_version, SNAPSHOT_SCHEMA);
    for (const [name, section] of Object.entries(snap.sections)) {
      assert.deepEqual(checkSectionIntegrity(name, section), [], `${f} ${name}`);
    }
    const text = await readFile(path.join(evidenceDir, f), 'utf8');
    assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, `${f} must not carry an email address`);
    assert.equal(formatSnapshot(snap), text, `${f} is not in the canonical one-row-per-line format`);
  }
});

test('the evidence ledger reconciles with the repo and the committed production ledger', async () => {
  const snap = JSON.parse(await readFile(path.join(evidenceDir, 'production-schema-snapshot-2026-10-28.json'), 'utf8'));
  const l = await compareLedger(snap.sections.ledger.rows, root);
  assert.equal(l.committed_ledger.matches_live, true);
  assert.deepEqual(l.missing_in_repo, []);
  // Files added to supabase/migrations/ after the capture would show here; promotion
  // records a new capture, so a non-empty list means the evidence is stale, not wrong.
  for (const f of l.extra_in_repo) assert.ok(f.slice(0, 14) > l.live_latest.slice(0, 14), `${f} is older than the captured ledger`);
  assert.deepEqual(l.renamed_twins, []);
});

test('compareSection reports additions, removals and field changes', () => {
  const have = [['public', 't', 'r', true, false, '', 1, 'a', 'b', 'c', '', 'anon=r'], ['public', 'x', 'r', false, false, '', 1, 'a', 'b', 'c', '', '']];
  const want = [['public', 't', 'r', false, false, '', 1, 'a', 'b', 'c', '', 'anon=r'], ['public', 'y', 'r', true, false, '', 1, 'a', 'b', 'c', '', '']];
  const c = compareSection('relations', have, want);
  assert.deepEqual(c.only_in_database, ['public.x']);
  assert.deepEqual(c.only_in_manifest, ['public.y']);
  assert.deepEqual(c.changed, [{ key: 'public.t', diffs: [{ field: 'rls_enabled', actual: true, expected: false }] }]);
});

test('posture flags definer views and anon-executable SECURITY DEFINER functions', () => {
  const p = postureFindings({
    relations: { rows: [['public', 'v', 'v', false, false, '', 1, 'a', 'b', 'c', 'd', 'anon=r'], ['public', 'w', 'v', false, false, 'true', 1, 'a', 'b', 'c', 'd', 'anon=r']] },
    functions: { rows: [['public', 'f', '', 'void', true, 'v', 'search_path=""', 'h', 'PUBLIC=X;anon=X'], ['public', 'g', '', 'void', true, 'v', '', 'h', '']] },
    policies: { rows: [] },
  });
  assert.deepEqual(p.definer_views_exposed, ['public.v']);
  assert.deepEqual(p.security_definer_executable_by_anon_or_public, ['public.f()']);
  assert.deepEqual(p.security_definer_without_search_path, ['public.g()']);
});

test('scanSqlObjects finds what a pending file creates', () => {
  const o = scanSqlObjects(`
    create table if not exists public.member_fronts (id uuid);
    create or replace function public.front_media_has_room(p uuid) returns boolean language sql as $$ select true $$;
    create policy "front media insert own" on storage.objects for insert to authenticated with check (true);
    insert into storage.buckets (id, name, public) values ('front-media', 'front-media', true);
    alter table public.media_news_sources add column if not exists publisher_name text;
  `);
  assert.deepEqual(o.tables, ['public.member_fronts']);
  assert.deepEqual(o.functions, ['public.front_media_has_room']);
  assert.deepEqual(o.policies, ['storage.objects :: front media insert own']);
  assert.deepEqual(o.buckets, ['front-media']);
  assert.deepEqual(o.columns, ['public.media_news_sources.publisher_name']);
});

test('the committed manifest, when present, was built by the current SQL', async () => {
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(root, 'supabase', 'schema-manifest.json'), 'utf8')); } catch { return; }
  assert.equal(manifest.schema_version, MANIFEST_SCHEMA);
  for (const [name, section] of Object.entries(manifest.sections)) {
    assert.deepEqual(checkSectionIntegrity(name, section), [], name);
  }
  const rebuilt = manifestFromSnapshot({ sections: Object.fromEntries(Object.entries(manifest.sections).map(([n, s]) => [n, { ...s, sql_sha256: manifest.sql_sha256[n] }])) });
  assert.deepEqual(Object.keys(rebuilt.sections), Object.keys(manifest.sections));
});

test('production mode refuses a snapshot without a readable ledger instead of reporting no drift', async () => {
  const { execFile } = await import('node:child_process');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const evidence = JSON.parse(await readFile(path.join(evidenceDir, 'production-schema-snapshot-2026-10-28.json'), 'utf8'));
  delete evidence.sections.ledger;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'schema-noledger-'));
  const file = path.join(dir, 'snap.json');
  await writeFile(file, JSON.stringify(evidence));
  const run = (args) => new Promise((resolve) => execFile(process.execPath, [path.join(root, 'scripts/db/verify-production-schema.mjs'), ...args], (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stderr })));
  try {
    const r = await run(['--snapshot', file, '--mode', 'production']);
    assert.equal(r.code, 2, 'a ledger-less production snapshot is an integrity error');
    assert.match(r.stderr, /no readable ledger section/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
