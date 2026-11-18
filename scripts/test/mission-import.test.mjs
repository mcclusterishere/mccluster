// The Drawdown mission import (tools/build-mission-import.mjs) and the pending SQL it writes, checked offline.
// The database side (apply the parts in order, rerun, out of order, read as a guest, join, roll back, and the
// parts' rows against the one-file import's) is scripts/test/mission-catalog.native.integration.mjs on a
// disposable PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  readCatalog, validateCatalog, buildFiles, buildImportParts, singleImportReference, driftedFiles, staleFiles,
  checkPredicate, missionRow, detailsRow, missionId, uuidV5, creatorName, NAMESPACE, ID_NAME_PREFIX, OUTPUT_FILES,
  CATALOG_PATH, IMPORT_PART_MAX_BYTES, RETIRED_IMPORT_FILE, importPartFile, importPartName,
  PRODUCTION_MISSION_CHECKS, PRODUCTION_MISSION_COLUMNS, DETAIL_LIMITS, DETAIL_PAIRS, CC_BY,
} from '../../tools/build-mission-import.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const md5 = (s) => createHash('md5').update(s).digest('hex');
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const { text: catalogText, catalog } = readCatalog();
const rows = catalog.missions;
const ids = rows.map((m) => missionId(m.slug));
const parts = buildImportParts({ text: catalogText, catalog });
const pad2 = (i) => String(i).padStart(2, '0');
/** Every part file as committed, in apply order. */
const partFiles = parts.map((p) => p.file);
const partSql = () => partFiles.map(read);

/** The one-file import the parts replace, as the tool last wrote it (2026-11-17) for this catalog: never applied. */
const RETIRED_IMPORT = { catalogSha256: 'b9150c5b3075862fc66b989a12791278924414d2c6fc463fcb3dbbf67c6e6f66', bytes: 188022, md5: '29271e66339a48f4133d1f7171d04cce' };
/** The publish and both rollbacks as reviewed with the one-file import (2026-11-17). */
const REVIEWED_MD5 = {
  publish: 'a37a83c64b9c439896770ed7b898fc30',
  importRollback: '893d7f115c14cc847d08bd23ab40b364',
  publishRollback: '16cb998e034e30208bb99c098ca504b2',
};
/** The VALUES rows of one INSERT, between "from (values" and ") as v(". */
function valuesBlock(sql, table) {
  const start = sql.indexOf(`\ninsert into public.${table}\n`);
  assert.ok(start > 0, `an insert into public.${table}`);
  const from = sql.indexOf('  from (values\n', start) + '  from (values\n'.length;
  return sql.slice(from, sql.indexOf('\n  ) as v(', from));
}

/** production's archive_missions_20261030.action_missions ids (40), read once with SELECT on 2026-11-17 */
const ARCHIVED_MISSION_IDS = [
  '015273ce-fddb-5e5f-95fe-f610d28f44ff', '053cbd0d-6bdb-49c6-bd80-8c5b8be36068', '05d92dc9-e101-46c0-8cbb-1b53fc3503ea',
  '24b16f1a-0f76-4390-a755-eba24f641f71', '302dcb4e-ca21-4289-b633-9c397985fb9d', '3467cf5e-9b43-515c-a8bd-8f96c30f7421',
  '368fd75a-77d2-4de0-9722-17020674a914', '42a2b39a-831f-496b-83da-b4ef71cc2b43', '4872dbe5-bafe-5464-986c-622941927ba7',
  '49d654e1-dfc8-42aa-a26e-22912ebf8dc6', '4c57292e-7835-5d29-b1ac-7de53e5bbb81', '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000004',
  '51000000-0000-4000-8000-000000000005', '51587300-5442-5708-8ccb-13bb4145d7b0', '5276f3b8-61fe-5363-8690-80d98a88878b',
  '58eeb75d-a5b6-4280-9cd7-3b0cabf02264', '6ec6b7a5-5290-4ba1-9f05-8f3a82e1cc04', '7cfac26a-d757-42b9-803b-970f9d5030a8',
  '8830ae39-4033-5131-98e6-d590a6481f25', '9144bd42-f94a-494e-a17a-a45f9e155f86', 'a0a81625-9ac2-4167-a133-fa5d4f63ea75',
  'a17050c1-a551-4c5c-80c1-5a1750c1a001', 'a195dc51-5593-5640-b51c-836850c3babf', 'a4333d6f-52a6-511a-b957-fb4f21916b88',
  'a4fbc309-3878-4db4-ba41-a0c4f1ddf0d7', 'b2ab3911-78ae-490c-bd95-21573c8c34e9', 'ba66d4a3-cb62-4403-9b56-7ee00af059d8',
  'ba803367-057b-4664-902d-58a0cfd62068', 'bbcffaaf-f437-4355-a1c2-7bf2a36dfa62', 'd207ca6b-a626-49c5-9fbb-fbc8204f02bb',
  'd7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c', 'dd82194b-9f1d-482d-860d-8913f0094136', 'df26314d-d4e1-47e3-b980-1b60b1a682ea',
  'e1da8234-cd83-485d-b4a9-4fb8cf14add3', 'e83aaa5e-2e44-53e4-9ffc-6eb92f457096', 'ebe8f4ee-bc56-4ed6-83f0-f501c68490cf',
  'ed2e7ae0-32d7-5a8e-b70a-c0f7b7958265',
];
/** the one mission production holds today (2026-11-17), still open */
const LIVE_MISSION_IDS = ['302dcb4e-ca21-4289-b633-9c397985fb9d'];

/** SQL with comments, string literals and dollar-quoted bodies blanked out, so keywords can be counted. */
function codeOnly(sql) {
  let out = '';
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i)) { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e; continue; }
    if (sql[i] === "'") { let j = i + 1; for (;;) { if (sql[j] === "'" && sql[j + 1] === "'") j += 2; else if (sql[j] === "'") break; else j += 1; } out += "''"; i = j + 1; continue; }
    const tag = /^\$[a-z_]*\$/i.exec(sql.slice(i));
    if (tag) { const e = sql.indexOf(tag[0], i + tag[0].length); out += '$body$'; i = e + tag[0].length; continue; }
    out += sql[i]; i += 1;
  }
  return out;
}
const uuids = (s) => [...s.matchAll(/'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/g)].map((m) => m[1]);
/** An independent UUID v5 (no code shared with the tool). */
function v5(name, ns) {
  const h = createHash('sha1').update(Buffer.from(ns.replace(/-/g, ''), 'hex')).update(name, 'utf8').digest('hex').slice(0, 32).split('');
  h[12] = '5';
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

test('the catalog: 125 missions, every row inside production\'s checks and the details constraints', () => {
  assert.equal(rows.length, 125);
  assert.deepEqual(validateCatalog(catalog), []);
  const checks = Object.entries(PRODUCTION_MISSION_CHECKS).map(([name, def]) => ({ name, ...checkPredicate(def) }));
  assert.equal(checks.length, 9, 'production has nine checks on action_missions');
  for (const m of rows) {
    const r = missionRow(m);
    for (const c of checks) assert.notEqual(c.test(r), false, `${m.slug} violates ${c.name}`);
    for (const col of PRODUCTION_MISSION_COLUMNS) {
      if (col.notNull && !['created_at', 'updated_at'].includes(col.name)) assert.ok(r[col.name] !== null && r[col.name] !== undefined, `${m.slug}: ${col.name} is null`);
    }
    assert.ok(Number.isInteger(r.difficulty) && Number.isInteger(r.base_points), `${m.slug}: integers`);
    const d = detailsRow(m);
    for (const [key, rule] of Object.entries(DETAIL_LIMITS)) {
      if (d[key] === null) { assert.ok(rule.nullable, `${m.slug}: ${key} may not be null`); continue; }
      const n = Array.from(d[key]).length;
      if (rule.min !== undefined) assert.ok(n >= rule.min && n <= rule.max, `${m.slug}: ${key} is ${n} characters`);
      if (rule.re) assert.match(d[key], rule.re, `${m.slug}: ${key}`);
    }
    for (const [a, b] of DETAIL_PAIRS) assert.equal(d[a] === null, d[b] === null, `${m.slug}: ${a} and ${b} come together`);
  }
});

test('the checks are evaluated as SQL does, and an unknown shape stops the build', () => {
  const check = (name) => checkPredicate(PRODUCTION_MISSION_CHECKS[name]).test;
  assert.equal(check('action_missions_domain_check')({ domain: 'climate' }), false);
  assert.equal(check('action_missions_discovery_category_check')({ discovery_category: null }), null, 'null passes a CHECK');
  assert.equal(check('action_missions_capacity_check')({ capacity: null }), true);
  assert.equal(check('action_missions_capacity_check')({ capacity: 0 }), false);
  assert.equal(check('action_missions_base_points_check')({ base_points: 9 }), false);
  assert.equal(check('action_missions_base_points_check')({ base_points: 1000 }), true);
  assert.equal(check('action_missions_title_check')({ title: '' }), false);
  assert.equal(check('action_missions_title_check')({ title: 'é'.repeat(160) }), true, 'char_length counts characters, not bytes');
  assert.equal(check('action_missions_title_check')({ title: '😀'.repeat(161) }), false, 'or UTF-16 units');
  assert.throws(() => checkPredicate("CHECK ((status <> 'x'::text))"), /unrecognised CHECK shape/);
});

test('the tool refuses a bad row, naming the rule', () => {
  const bad = (change) => {
    const c = structuredClone(catalog);
    change(c.missions[0], c);
    return validateCatalog(c).join('\n');
  };
  assert.match(bad((m) => { m.domain = 'climate'; }), /action_missions_domain_check/);
  assert.match(bad((m) => { m.title = 'x'.repeat(161); }), /action_missions_title_check/);
  assert.match(bad((m) => { m.base_points = 5; }), /action_missions_base_points_check/);
  assert.match(bad((m) => { m.difficulty = 1.5; }), /difficulty is not an integer/);
  assert.match(bad((m) => { m.kind = 'clip'; }), /civic missions only/);
  assert.match(bad((m) => { m.status = 'open'; }), /drafts only/);
  assert.match(bad((m) => { m.about_credit = null; }), /about and about_credit must come together/);
  assert.match(bad((m) => { m.credit_line = m.credit_line.replace(m.source.doi, 'the record'); }), /credit_line does not name the DOI/);
  assert.match(bad((m) => { m.credit_line = m.credit_line.replace('Sarah Gleeson', 'S. G.'); }), /does not name the creator Gleeson, Sarah/);
  assert.match(bad((m) => { m.source.explorer_url = m.source.explorer_url.replace('https:', 'http:'); }), /source_url does not match/);
  assert.match(bad((m) => { m.safety = 'a\u0007b'; }), /control character/);
  assert.match(bad((m) => { m.proof_hint = 'x'.repeat(501); }), /proof_hint is 501 characters/);
  assert.match(bad((m) => { m.source.license = 'CC BY-NC 4.0'; }), /is not CC BY 4\.0; review it/);
  assert.match(bad((m, c) => { c.missions[1].slug = m.slug; }), /slug repeats missions\[0\]/);
  assert.throws(() => buildFiles({ text: catalogText, catalog: { ...catalog, count: 7 } }), /not importable/);
});

test('ids: UUID v5 of mccluster:mission:drawdown:<slug> under the fixed namespace, deterministic and distinct', () => {
  assert.equal(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '2ed6657d-e927-568b-95e1-2665a8aea6a2', 'the RFC test vector');
  assert.equal(NAMESPACE, '4540f730-bb7d-4dde-b727-03881158e001');
  assert.equal(ID_NAME_PREFIX, 'mccluster:mission:drawdown:');
  for (const [i, m] of rows.entries()) {
    assert.equal(ids[i], v5(`mccluster:mission:drawdown:${m.slug}`, NAMESPACE), `${m.slug}: an independent v5 agrees`);
    assert.match(ids[i], /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
  assert.equal(new Set(ids).size, rows.length, 'distinct');
  assert.deepEqual(rows.map((m) => missionId(m.slug)), ids, 'the same on a second computation');
});

test('no id is one of production\'s archived missions or its live one', () => {
  assert.equal(ARCHIVED_MISSION_IDS.length, 40);
  const taken = new Set([...ARCHIVED_MISSION_IDS, ...LIVE_MISSION_IDS]);
  for (const [i, id] of ids.entries()) assert.ok(!taken.has(id), `${rows[i].slug} reuses ${id}`);
});

test('every CC BY 4.0 row credits its creators, record, DOI and licence, and the import writes them', () => {
  const ccBy = rows.filter((m) => m.source.license === CC_BY.name);
  assert.equal(ccBy.length, 43);
  const sql = partSql().join('\n');
  for (const m of ccBy) {
    const credit = m.credit_line.toLowerCase();
    assert.ok(m.source.creators.length > 0, m.slug);
    for (const c of m.source.creators) {
      const [family, given] = c.split(',').map((s) => s.trim());
      assert.ok(credit.includes(`${given} ${family}`.toLowerCase()), `${m.slug}: names ${c}`);
      assert.equal(creatorName(c).toLowerCase(), `${given} ${family}`.toLowerCase());
    }
    assert.ok(credit.includes(m.source.record_title.toLowerCase()), `${m.slug}: names the record`);
    assert.ok(m.credit_line.includes(m.source.doi) && m.source.doi.startsWith('https://doi.org/10.'), `${m.slug}: the DOI`);
    assert.ok(m.credit_line.includes(CC_BY.url) && m.credit_line.includes(CC_BY.name), `${m.slug}: the licence and its URL`);
    const d = detailsRow(m);
    assert.deepEqual([d.license_name, d.license_url, d.doi], [CC_BY.name, CC_BY.url, m.source.doi], `${m.slug}: details carry the licence and DOI`);
    assert.ok(sql.includes(`'${missionId(m.slug)}'::uuid, '${m.slug}',`), `${m.slug}: its details row is in the import`);
    assert.ok(sql.includes(`'${m.credit_line.replace(/'/g, "''")}'`), `${m.slug}: with its full credit line`);
  }
  for (const m of rows.filter((x) => x.source.license !== CC_BY.name)) {
    const d = detailsRow(m);
    assert.deepEqual([d.license_name, d.license_url, d.doi], [null, null, null], `${m.slug}: no licence or DOI without CC BY`);
  }
});

test('every import part inserts drafts only, with the fixed columns, and nothing else', () => {
  assert.equal(partSql().length, parts.length);
  for (const [i, sql] of partSql().entries()) {
    const f = partFiles[i];
    const code = codeOnly(sql).toLowerCase();
    assert.match(sql, /^begin;\nset local lock_timeout = '5s';\nset local standard_conforming_strings = on;\n$/m, `${f}: one transaction, bounded lock wait, standard strings`);
    assert.equal((sql.match(/^begin;$/gm) || []).length, 1, f);
    assert.equal((sql.match(/^commit;$/gm) || []).length, 1, f);
    assert.ok(sql.endsWith('\ncommit;\n'), `${f}: commit is the last statement`);
    assert.equal((code.match(/\binsert into\b/g) || []).length, 2, `${f}: two inserts`);
    assert.match(code, /insert into public\.action_missions\b/);
    assert.match(code, /insert into public\.action_mission_details\b/);
    assert.doesNotMatch(code, /\b(update|delete|truncate|drop|alter|grant|revoke|create)\b/, `${f}: no other statement`);
    assert.equal((code.match(/on conflict \(id\) do nothing;/g) || []).length, 1, f);
    assert.equal((code.match(/on conflict \(mission_id\) do nothing;/g) || []).length, 1, f);
    const m = /insert into public\.action_missions\s*\(([^)]*)\)\s*select (.*?)\s+from \(values/s.exec(sql);
    const cols = m[1].split(',').map((s) => s.trim());
    const exprs = m[2].split(/,\s*/).map((s) => s.trim());
    assert.equal(cols.length, exprs.length);
    const set = Object.fromEntries(cols.map((c, j) => [c, exprs[j]]));
    assert.deepEqual(
      [set.status, set.kind, set.proof_required, set.campaign_id, set.capacity, set.starts_at, set.ends_at],
      ["'draft'", "'civic'", 'true', 'null', 'null', 'null', 'null'],
      `${f}: every row status draft, kind civic, proof required, no campaign, capacity or dates`,
    );
    for (const c of cols) assert.ok(PRODUCTION_MISSION_COLUMNS.some((p) => p.name === c), `${c} is a production column`);
    assert.doesNotMatch(code, /'open'/, `${f}: the word 'open' is never a value in the import`);
    assert.deepEqual(uuids(valuesBlock(sql, 'action_missions')), parts[i].ids, `${f}: one row per mission of the part, in catalog order`);
    assert.deepEqual(uuids(valuesBlock(sql, 'action_mission_details')), parts[i].ids, `${f}: and one details row each`);
  }
  assert.deepEqual(parts.flatMap((p) => p.ids), ids, 'the parts, in order, hold every catalog mission once, in catalog order');
});

test(`the parts: the fewest that each fit in ${IMPORT_PART_MAX_BYTES} bytes, in catalog order, named for their order`, () => {
  assert.equal(IMPORT_PART_MAX_BYTES, 32000);
  assert.ok(parts.length >= 2 && parts.length <= 99, `${parts.length} parts`);
  let next = 1;
  for (const [i, p] of parts.entries()) {
    const sql = read(p.file);
    assert.equal(p.index, i + 1);
    assert.equal(p.file, `supabase/pending/20261117100200_action_mission_drawdown_import_${pad2(i + 1)}.sql`);
    assert.equal(p.name, `action_mission_drawdown_import_${pad2(i + 1)}`, 'the migration name is the file name without its timestamp');
    assert.equal(p.file, importPartFile(p.index));
    assert.equal(p.name, importPartName(p.index));
    assert.equal(bytes(sql), p.bytes);
    assert.ok(p.bytes <= IMPORT_PART_MAX_BYTES, `${p.file} is ${p.bytes} bytes`);
    assert.deepEqual([p.first, p.last], [next, next + p.ids.length - 1], `${p.file}: catalog missions ${next} on, no gap, no overlap`);
    next = p.last + 1;
  }
  assert.equal(next, rows.length + 1, 'and the last part ends with the last mission');
  // Fewer parts cannot fit: every part repeats a header, its guards and the two statements around the rows, so
  // one part fewer would need the rows plus that many overheads in that many times the cap.
  const rowsBytes = (sql) => bytes(valuesBlock(sql, 'action_missions')) + bytes(valuesBlock(sql, 'action_mission_details'));
  const overhead = Math.min(...partSql().map((sql) => bytes(sql) - rowsBytes(sql))) - 100;
  const allRows = partSql().reduce((sum, sql) => sum + rowsBytes(sql), 0);
  const fewer = parts.length - 1;
  assert.ok(allRows + fewer * overhead > fewer * IMPORT_PART_MAX_BYTES, `${fewer} parts cannot hold ${allRows} bytes of rows`);
  assert.deepEqual(buildImportParts({ text: catalogText, catalog }).map((p) => [p.first, p.last, md5(p.sql)]),
    parts.map((p) => [p.first, p.last, md5(p.sql)]), 'the same catalog, the same cuts');
});

test('each part is self-contained: the details guard, then from part 02 on, the part before it must be in', () => {
  const T = pad2(parts.length);
  const sha = createHash('sha256').update(catalogText).digest('hex');
  for (const [i, sql] of partSql().entries()) {
    const p = parts[i];
    const P = pad2(p.index);
    const header = sql.split(/^begin;$/m)[0];
    assert.ok(header.startsWith(`-- PROJECT DRAWDOWN MISSION CATALOG: IMPORT AS DRAFTS, PART ${P} OF ${T} (catalog missions ${p.first} to ${p.last} of ${rows.length})\n`), `${p.file}: names the part and the total`);
    assert.ok(header.includes(`(sha256 ${sha}).`), `${p.file}: names the catalog it came from`);
    assert.ok(header.includes(`under the name \`${p.name}\`, this file byte for byte in one call,`), `${p.file}: its migration name`);
    assert.ok(header.includes(`-- Order: parts 01 to ${T} one at a time, production read again between parts (supabase/pending/PROMOTION-ORDER.md,`), `${p.file}: the order`);
    assert.ok(header.includes('-- Rollback: 20261117100200_action_mission_drawdown_import.rollback.sql. One rollback serves every part.'), `${p.file}: the rollback`);
    assert.ok(header.includes('-- Proof before apply: scripts/test/mission-catalog.native.integration.mjs.'), `${p.file}: the proof`);
    const guard = /\ndo \$import_guard\$\nbegin\n([\s\S]*?)\nend\n\$import_guard\$;\n/.exec(sql);
    assert.ok(guard && guard.index < sql.indexOf('\ninsert into '), `${p.file}: one guard, before any insert`);
    assert.ok(guard[1].startsWith("  if to_regclass('public.action_mission_details') is null then\n    raise exception 'apply 20261117100100_action_mission_details.sql before the Drawdown import' using errcode = '55000';\n  end if;"),
      `${p.file}: refuses first when the details table is missing`);
    if (i === 0) {
      assert.equal((guard[1].match(/raise exception/g) || []).length, 1, 'part 01 has no part before it');
      continue;
    }
    const before = parts[i - 1];
    const B = pad2(before.index);
    const lastId = before.ids[before.ids.length - 1];
    assert.ok(guard[1].includes(`  if not exists (select 1 from public.action_missions m join public.action_mission_details d on d.mission_id = m.id\n                  where m.id = '${lastId}'::uuid) then -- ${before.slugs[before.slugs.length - 1]}\n`),
      `${p.file}: refuses unless part ${B}'s last mission is there with its details row`);
    assert.ok(guard[1].includes(`raise exception 'Drawdown import part ${P} of ${T} refused: part ${B} (${before.name}) is not applied'\n      using errcode = '55000', hint = 'Apply 20261117100200_action_mission_drawdown_import_${B}.sql first; nothing was imported.';`),
      `${p.file}: with 55000, naming part ${B}`);
    assert.equal(uuids(guard[1]).length, 1, `${p.file}: the guard names that one mission`);
  }
});

test('the one-file import, rebuilt in memory, is the file the parts replace; the parts carry its rows byte for byte', () => {
  const single = singleImportReference({ text: catalogText, catalog });
  assert.equal(createHash('sha256').update(catalogText).digest('hex'), RETIRED_IMPORT.catalogSha256,
    'the catalog is the one the one-file import was written from (a changed catalog needs new parts, a new proof and new pins)');
  assert.deepEqual([bytes(single), md5(single)], [RETIRED_IMPORT.bytes, RETIRED_IMPORT.md5], 'byte for byte the retired file');
  assert.ok(!existsSync(new URL(RETIRED_IMPORT_FILE, ROOT)), `${RETIRED_IMPORT_FILE} is gone: the parts replace it`);
  assert.equal(partSql().map((sql) => valuesBlock(sql, 'action_missions')).join(',\n'), valuesBlock(single, 'action_missions'),
    "the parts' mission rows, in order, are the one file's");
  assert.equal(partSql().map((sql) => valuesBlock(sql, 'action_mission_details')).join(',\n'), valuesBlock(single, 'action_mission_details'),
    "and so are their details rows");
  // Around the rows, each part's two statements are the one file's, word for word (only the headings count differently).
  const statements = (sql) => sql.slice(sql.indexOf('\n-- ---'), sql.lastIndexOf('\non conflict (mission_id) do nothing;\n'))
    .replace(valuesBlock(sql, 'action_missions'), '<rows>').replace(valuesBlock(sql, 'action_mission_details'), '<rows>')
    .replace(/^-- [12]\. .*$/gm, '<heading>');
  for (const [i, sql] of partSql().entries()) assert.equal(statements(sql), statements(single), `${partFiles[i]}: the one file's statements`);
});

test('the publish and the import rollback differ from their reviewed bytes only where they name the import; the publish rollback not at all', () => {
  const span = `20261117100200_action_mission_drawdown_import_01.sql to _${pad2(parts.length)}.sql`;
  const unchanged = (text, edits) => edits.reduce((t, [now, then]) => {
    assert.equal(t.split(now).length, 2, `exactly once: ${now}`);
    return t.split(now).join(then);
  }, text);
  assert.equal(md5(unchanged(read(OUTPUT_FILES.publish), [
    [`AFTER the import parts\n-- ${span}, then promote with the steps in\n-- supabase/pending/README.md.`,
      'AFTER\n-- 20261117100200_action_mission_drawdown_import.sql, then promote with the steps in supabase/pending/README.md.'],
    [`hint = 'Apply the import parts ${span} first; nothing was published.'`,
      "hint = 'Apply 20261117100200_action_mission_drawdown_import.sql first; nothing was published.'"],
  ])), REVIEWED_MD5.publish, 'the publish: its guard, its update and its ids are the reviewed ones');
  assert.equal(md5(unchanged(read(OUTPUT_FILES.importRollback), [
    [`-- Recovery artifact for the import parts ${span},\n-- however many of them ran: never a forward migration.`,
      '-- Recovery artifact for 20261117100200_action_mission_drawdown_import.sql: never a forward migration.'],
  ])), REVIEWED_MD5.importRollback, 'the import rollback: the reviewed lock, count, refusal and delete');
  assert.equal(md5(read(OUTPUT_FILES.publishRollback)), REVIEWED_MD5.publishRollback, 'the publish rollback is the reviewed file');
});

test('every SQL file a generated file names is there: in supabase/pending, or promoted under supabase/migrations', () => {
  // The publish and the import rollback used to name the one-file import; once it was gone they had to change.
  const pending = new Set(readdirSync(new URL('supabase/pending/', ROOT)));
  const promoted = new Set(readdirSync(new URL('supabase/migrations/', ROOT)).map((f) => f.slice(15)));
  const files = buildFiles({ text: catalogText, catalog });
  for (const [f, sql] of Object.entries(files)) {
    for (const [name] of sql.matchAll(/\b[0-9]{14}_[a-z0-9_]+(?:[.]rollback)?[.]sql\b/g)) {
      assert.ok(pending.has(name) || (!name.endsWith('.rollback.sql') && promoted.has(name.slice(15))), `${f} names ${name}, which is not there`);
    }
    for (const [, prefix, last] of sql.matchAll(/\b([0-9]{14}_[a-z0-9_]+_)01[.]sql to _([0-9]{2})[.]sql/g)) {
      for (let i = 1; i <= Number(last); i += 1) assert.ok(pending.has(`${prefix}${pad2(i)}.sql`), `${f} names ${prefix}${pad2(i)}.sql`);
    }
  }
  assert.ok(Object.keys(files).every((p) => pending.has(p.slice('supabase/pending/'.length))), 'and every generated file is written');
});

test('the publish touches exactly the imported ids, drafts only; its rollback undoes exactly that', () => {
  const pub = read(OUTPUT_FILES.publish);
  const pubCode = codeOnly(pub).toLowerCase();
  assert.equal((pubCode.match(/\bupdate\b/g) || []).length, 1, 'one update');
  assert.doesNotMatch(pubCode, /\b(insert|delete|truncate|drop|alter|grant|revoke|create)\b/);
  assert.match(pub, /^update public\.action_missions\n {3}set status = 'open', updated_at = now\(\)\n where status = 'draft'\n {3}and id in \(\n/m);
  const update = pub.slice(pub.indexOf('update public.action_missions'));
  assert.deepEqual(uuids(update), ids, 'the update names exactly the imported ids');
  assert.deepEqual(uuids(pub.slice(0, pub.indexOf('update public.action_missions'))), ids, 'and refuses unless each of them has its details row');
  assert.match(pub, /not exists \(select 1 from public\.action_mission_details d where d\.mission_id = i\.id\)/);

  const back = read(OUTPUT_FILES.publishRollback);
  assert.equal((codeOnly(back).toLowerCase().match(/\bupdate\b/g) || []).length, 1);
  assert.doesNotMatch(codeOnly(back).toLowerCase(), /\b(insert|delete|truncate|drop|alter|grant|revoke|create)\b/);
  assert.match(back, /^update public\.action_missions\n {3}set status = 'draft', updated_at = now\(\)\n where status = 'open'\n {3}and id in \(\n/m);
  assert.deepEqual(uuids(back), ids);

  const del = read(OUTPUT_FILES.importRollback);
  assert.deepEqual(uuids(del), ids, 'the import rollback deletes exactly the imported ids');
  assert.match(del, /for update;/, 'after locking them');
  assert.match(del, /k\.confrelid = 'public\.action_missions'::regclass/, 'refusing on any foreign key that references them');
  assert.match(del, /v_soft_tables constant text\[\] := array\['public\.action_creator_payout_intents', 'public\.action_creator_funding'\];/,
    'and on the two references production holds without a foreign key, payout intents first');
  const lockMissions = del.indexOf('\n  perform 1 from public.action_missions where id = any (v_ids) for update;\n');
  const lockSoft = del.indexOf("\n      execute format('lock table %s in share mode', to_regclass(v_soft));\n");
  const firstCount = del.indexOf('select count(*)');
  assert.ok(lockMissions > 0 && lockMissions < lockSoft && lockSoft < firstCount, 'it locks the missions, then those two tables, before it counts anything');
  assert.match(del, /execute format\('select count\(\*\) from %s where mission_id = any \(\$1\)', to_regclass\(v_soft\)\) into v_n using v_ids;/);
  assert.match(del, /raise exception 'Drawdown import rollback refused/);
});

test('the generated files are current (node tools/build-mission-import.mjs --check)', () => {
  assert.deepEqual(driftedFiles(), []);
  assert.deepEqual(staleFiles(), []);
  const r = spawnSync(process.execPath, ['tools/build-mission-import.mjs', '--check'], { cwd: fileURLToPath(ROOT), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `mission import SQL is current (${parts.length + 3} files)`);
  const sha = createHash('sha256').update(catalogText).digest('hex');
  for (const f of [...partFiles, ...Object.values(OUTPUT_FILES)]) assert.ok(read(f).includes(`(sha256 ${sha}).`), `${f} names the catalog it came from`);
});

test('--check fails while the retired one-file import or a part the catalog does not build is on disk; a build removes them', () => {
  // Two appliable copies of the import must never sit side by side: the one-file import beside its parts, or a part
  // left over from an earlier cut. Proven on a copy of the tool and the catalog in a scratch directory.
  const root = mkdtempSync(join(tmpdir(), 'mission-import-'));
  try {
    for (const dir of ['tools', 'data/missions/drawdown', 'supabase/pending']) mkdirSync(join(root, dir), { recursive: true });
    copyFileSync(fileURLToPath(new URL('tools/build-mission-import.mjs', ROOT)), join(root, 'tools/build-mission-import.mjs'));
    writeFileSync(join(root, CATALOG_PATH), catalogText);
    const tool = (...args) => spawnSync(process.execPath, [join(root, 'tools/build-mission-import.mjs'), ...args], { encoding: 'utf8' });
    assert.equal(tool().status, 0, 'a build writes every file');
    assert.deepEqual(readdirSync(join(root, 'supabase/pending')).sort(), Object.keys(buildFiles({ text: catalogText, catalog })).map((p) => p.slice('supabase/pending/'.length)).sort());
    assert.equal(tool('--check').status, 0);
    const stray = importPartFile(parts.length + 1);
    writeFileSync(join(root, RETIRED_IMPORT_FILE), singleImportReference({ text: catalogText, catalog }));
    writeFileSync(join(root, stray), '-- left over from an earlier cut\n');
    writeFileSync(join(root, 'supabase/pending/20261117100200_action_mission_drawdown_import_1.sql'), '-- a part named out of pattern\n');
    const expected = [RETIRED_IMPORT_FILE, 'supabase/pending/20261117100200_action_mission_drawdown_import_1.sql', stray].sort();
    assert.deepEqual(staleFiles(root), expected);
    assert.deepEqual(driftedFiles(root), expected, '--check reports exactly them');
    const check = tool('--check');
    assert.equal(check.status, 1, '--check fails');
    for (const p of expected) assert.ok(check.stderr.includes(p), `--check names ${p}`);
    const build = tool();
    assert.equal(build.status, 0);
    assert.ok(build.stdout.includes(`removed ${expected.join(', ')}`), build.stdout);
    for (const p of expected) assert.ok(!existsSync(join(root, p)), `a build removes ${p}`);
    assert.equal(tool('--check').status, 0, 'and --check passes again');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every pending file says owner approval is required, names its rollback and states its counts', () => {
  const files = {
    'supabase/pending/20261117100000_action_globe_join_scope_v1.sql': '20261117100000_action_globe_join_scope_v1.rollback.sql',
    'supabase/pending/20261117100100_action_mission_details.sql': '20261117100100_action_mission_details.rollback.sql',
    ...Object.fromEntries(partFiles.map((f) => [f, '20261117100200_action_mission_drawdown_import.rollback.sql'])),
    [OUTPUT_FILES.publish]: '20261117100300_action_mission_drawdown_publish.rollback.sql',
  };
  for (const [f, rollback] of Object.entries(files)) {
    const s = read(f);
    assert.match(s, /Owner approval required\./, f);
    assert.ok(s.includes(`Rollback: ${rollback}.`), `${f} names its rollback`);
    assert.ok(read(`supabase/pending/${rollback}`).includes('Owner approval required'), rollback);
    assert.match(s, /^begin;$/m, f);
    assert.match(s, /^commit;$/m, f);
  }
  for (const p of parts) {
    const k = p.ids.length;
    assert.ok(read(p.file).includes(`Row counts: public.action_missions +${k} (all draft); public.action_mission_details +${k}. On a rerun: +0 and +0.`), p.file);
  }
  assert.equal(parts.reduce((sum, p) => sum + p.ids.length, 0), 125, 'the parts together: +125 and +125');
  assert.match(read(OUTPUT_FILES.publish), /Row counts: public\.action_missions: 125 rows draft -> open on the first run; 0 on a rerun\./);
  assert.match(read(OUTPUT_FILES.importRollback), /Row counts: public\.action_missions -125, public\.action_mission_details -125/);
});

test('PROMOTION-ORDER.md and README.md list every part in order, with its migration name, missions, bytes and md5', () => {
  for (const doc of ['supabase/pending/PROMOTION-ORDER.md', 'supabase/pending/README.md']) {
    const listed = [...read(doc).matchAll(/^\| (\d{2}) \| `([^`]+)` \| `([^`]+)` \| (\d+) to (\d+) \((\d+)\) \| ([\d,]+) \| `([0-9a-f]{32})` \|$/gm)]
      .map((m) => ({ part: Number(m[1]), file: m[2], name: m[3], first: Number(m[4]), last: Number(m[5]), n: Number(m[6]), bytes: Number(m[7].replace(/,/g, '')), md5: m[8] }));
    assert.deepEqual(listed, parts.map((p) => ({
      part: p.index, file: p.file.slice('supabase/pending/'.length), name: p.name, first: p.first, last: p.last, n: p.ids.length,
      bytes: bytes(read(p.file)), md5: md5(read(p.file)),
    })), `${doc} lists the parts as committed`);
  }
});

test("the catalog's credit display rule is the README's and the details table's", () => {
  // CC BY 4.0, section 3(a)(2): the full credit in the detail view, a compact source line on a feed card that
  // opens it (brief items 5 and 6). The catalog is the file the World's feed reads, so it must say the same.
  const readme = read('data/missions/drawdown/README.md').replace(/\s+/g, ' ');
  const rule = / 3\. (Show `credit_line` [^.]+\.)/.exec(readme);
  assert.ok(rule, 'README rule 3 says how credit_line is shown');
  const wording = rule[1].replace(/`/g, '');
  assert.equal(wording, "Show credit_line in full in the mission's detail view, and on a feed card a compact source line that opens it.");
  assert.equal(catalog.display_rules.filter((r) => r.startsWith(wording)).length, 1, `missions.json carries README rule 3: ${wording}`);
  assert.deepEqual(catalog.display_rules.filter((r) => /credit_line/.test(r) && !r.startsWith(wording)), [], 'and no other credit_line rule beside it');
  assert.ok(read('supabase/pending/20261117100100_action_mission_details.sql').includes(
    "'Shown in full in the mission''s detail view; a feed card shows a compact source line that opens it.'"), 'the credit_line column comment says the same');
});

test('every mission SQL file says to run it as postgres, never as the service role', () => {
  // In production the service role owns none of these objects and has no CREATE on schema public, and the MCP
  // runs as postgres (read 2026-11-17): "apply as the service role" would fail with 42501 on 10.1 and 10.2.
  const ownerOnly = [
    'supabase/pending/20261117100000_action_globe_join_scope_v1.sql',
    'supabase/pending/20261117100000_action_globe_join_scope_v1.rollback.sql',
    'supabase/pending/20261117100100_action_mission_details.sql',
    'supabase/pending/20261117100100_action_mission_details.rollback.sql',
  ];
  for (const f of [...ownerOnly, ...partFiles, ...Object.values(OUTPUT_FILES)]) {
    const header = read(f).split(/^begin;$/m)[0].replace(/\n-- /g, ' ');
    assert.doesNotMatch(header, /as the service role/i, `${f} must not say to apply it as the service role`);
    assert.match(header, /apply_migration`? \(it runs as postgres|apply_migration` runs as postgres/, `${f} says the MCP runs as postgres`);
  }
  for (const f of ownerOnly) assert.match(read(f).split(/^begin;$/m)[0].replace(/\n-- /g, ' '), /the service role cannot/i, `${f} says why the service role cannot`);
  assert.match(read('supabase/pending/PROMOTION-ORDER.md'), /Apply each with the Supabase MCP `apply_migration`, which runs as postgres/);
});

test('the details table: constraints match the tool, https URLs, guests read only what its mission shows', () => {
  const sql = read('supabase/pending/20261117100100_action_mission_details.sql');
  for (const [key, rule] of Object.entries(DETAIL_LIMITS)) {
    if (rule.min === undefined) continue;
    assert.match(sql, new RegExp(`char_length\\(${key}\\) between ${rule.min} and ${rule.max}\\b`), `${key}: ${rule.min}..${rule.max} in SQL as in the tool`);
  }
  for (const key of ['source_url', 'license_url']) assert.match(sql, new RegExp(`${key} ~ '\\^https://\\[\\^\\[:space:\\]\\]\\+\\$'`), `${key} must be https`);
  assert.match(sql, /doi ~ '\^https:\/\/doi\[\.\]org\/10\[\.\]\[0-9\]\{4,9\}\//);
  assert.match(sql, /constraint action_mission_details_catalog_slug_key unique \(catalog, slug\)/);
  assert.match(sql, /references public\.action_missions\(id\) on delete cascade/);
  assert.match(sql, /credit_line text not null/);
  for (const [a, b] of DETAIL_PAIRS) assert.ok(sql.includes(`check ((${a} is null) = (${b} is null))`), `${a} with ${b}`);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.action_mission_details from public, anon, authenticated;\ngrant select on table public\.action_mission_details to anon, authenticated;\ngrant all on table public\.action_mission_details to service_role;/);
  assert.match(sql, /"public reads open mission details" on public\.action_mission_details\n {2}as permissive for select to anon, authenticated/);
  assert.ok(sql.includes("(m.status = any (array['open'::text, 'paused'::text, 'closed'::text])) or (select public.eu_is_admin())"), 'the same test as "public reads open missions"');
  assert.match(sql, /"admins manage mission details" on public\.action_mission_details\n {2}as permissive for all to authenticated\n {2}using \(\(select public\.eu_is_admin\(\)\)\)\n {2}with check \(\(select public\.eu_is_admin\(\)\)\);/);
  assert.doesNotMatch(codeOnly(sql).toLowerCase(), /\bcreate (or replace )?function\b|\bcreate trigger\b/, 'no function, no trigger');
});

test('the join scope file changes only the gate; its rollback is production\'s bodies byte for byte', () => {
  const body = (s, name) => new RegExp(`create or replace function public\\.${name}\\([^)]*\\)[\\s\\S]*?\\nas \\$\\$([\\s\\S]*?)\\$\\$;`).exec(s)[1];
  const md5 = (s) => createHash('md5').update(s).digest('hex');
  const fwd = read('supabase/pending/20261117100000_action_globe_join_scope_v1.sql');
  const back = read('supabase/pending/20261117100000_action_globe_join_scope_v1.rollback.sql');
  const prodJoin = body(read('supabase/migrations/20261014184518_action_globe_join_authorization.sql'), 'join_action_mission');
  const prodCan = body(read('supabase/migrations/20261014014547_action_globe_region_activation.sql'), 'action_globe_can_join_mission');
  assert.equal(md5(prodJoin), 'e0684ebe350296c5e6c06de55624ed42', "the applied migration is production's join_action_mission");
  assert.equal(md5(prodCan), 'a73db92bb2c4b4e6da84b1e311c82b84', "and production's action_globe_can_join_mission");
  assert.equal(md5(body(back, 'join_action_mission')), 'e0684ebe350296c5e6c06de55624ed42', 'the rollback restores it exactly');
  assert.equal(md5(body(back, 'action_globe_can_join_mission')), 'a73db92bb2c4b4e6da84b1e311c82b84');
  const gate = " if exists (select 1 from public.action_globe_mission_regions where mission_id = p_mission_id)\n";
  const newGate = " -- display pins never gate; only a published pin marked region_members does\n if exists (select 1 from public.action_globe_mission_regions\n             where mission_id = p_mission_id and published and join_scope = 'region_members')\n";
  assert.ok(prodJoin.includes(gate));
  assert.equal(body(fwd, 'join_action_mission'), prodJoin.replace(gate, newGate), 'the forward join differs from production by the gate alone');
  assert.equal(body(fwd, 'action_globe_can_join_mission'),
    prodCan.replace("where mr.mission_id=p_mission_id and mr.published and mission.status='open'", "where mr.mission_id=p_mission_id and mr.published and mr.join_scope='region_members'\n    and mission.status='open'"),
    'the helper also requires a region_members pin, nothing else');
  for (const s of [fwd, back]) {
    assert.equal((codeOnly(s).match(/security definer/gi) || []).length, 2, 'both functions SECURITY DEFINER');
    assert.equal((codeOnly(s).match(/search_path ?= ?''/g) || []).length, 2, "both with search_path ''");
    assert.ok(s.includes('revoke all on function public.join_action_mission(uuid) from public, anon;\ngrant execute on function public.join_action_mission(uuid) to authenticated, service_role;'));
    assert.ok(s.includes('revoke all on function public.action_globe_can_join_mission(uuid,uuid) from public,anon,authenticated;\ngrant execute on function public.action_globe_can_join_mission(uuid,uuid) to service_role;'));
  }
  // Both files refuse unless the two functions are production's or the forward file's own: over anything else,
  // such as the whole pins file's join (which also checks a mission arc's earlier step), a rerun or a rollback
  // would silently put back an older join.
  const accepted = [prodJoin, body(fwd, 'join_action_mission'), prodCan, body(fwd, 'action_globe_can_join_mission')].map(md5).sort();
  assert.equal(new Set(accepted).size, 4);
  for (const [s, tag, message] of [[fwd, 'join_scope_guard', 'join scope v1 refused'], [back, 'join_scope_rollback_guard', 'join scope v1 rollback refused']]) {
    const guard = new RegExp(`\\ndo \\$${tag}\\$\\n([\\s\\S]*?)\\n\\$${tag}\\$;\\n`).exec(s);
    assert.ok(guard, `${tag} is there`);
    assert.deepEqual([...guard[1].matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]).sort(), accepted, `${tag} accepts exactly production's bodies and the forward file's`);
    assert.match(guard[1], /v_join is null or v_join not in \('[0-9a-f]{32}', '[0-9a-f]{32}'\)\n {5}or v_can is null or v_can not in \('[0-9a-f]{32}', '[0-9a-f]{32}'\) then\n {4}raise exception/, `${tag} refuses when either function is anything else, or absent`);
    assert.ok(guard[1].includes(`'${message}: join_action_mission`) && guard[1].includes("errcode = '55000'"), `${tag} raises 55000`);
    const code = s.slice(s.search(/^begin;$/m));
    const lock = code.indexOf('\nlock table public.action_globe_mission_regions in access exclusive mode;\n');
    const firstChange = Math.min(...[/\nalter table /, /\ncreate or replace function /].map((re) => code.search(re)));
    assert.ok(lock > 0 && lock < code.indexOf(`\ndo $${tag}$`) && code.indexOf(`\ndo $${tag}$`) < firstChange, `${tag}: table lock, then the check, then the first change`);
  }
  assert.match(fwd, /add column if not exists join_scope text not null default 'anywhere'/);
  assert.match(fwd, /check \(join_scope in \('anywhere','region_members'\)\)/);
  const fwdCode = codeOnly(fwd).toLowerCase();
  for (const absent of ['pin_role', 'sort_order', 'action_globe_country_lists', 'action_mission_arcs', 'action_business_listings', 'action_mission_card_extras', 'action_globe_public_region_missions', 'primary key']) {
    assert.ok(!fwdCode.includes(absent), `the extract leaves out ${absent}`);
  }
  assert.match(back, /drop column if exists join_scope;/);
});

test("the scratch fixture's action_missions checks are the tool's, which are production's", () => {
  const fixture = read('supabase/tests/action_mission_catalog.stub.sql');
  const found = Object.fromEntries([...fixture.matchAll(/add constraint (action_missions_\w+_check) (CHECK .*);$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(found, { ...PRODUCTION_MISSION_CHECKS });
  assert.doesNotMatch(fixture, /@mccluster\.org/, 'the house owner\'s address stays out of the public repository');
});
