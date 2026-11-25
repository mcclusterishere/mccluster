import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readCatalog, detailsRow, buildImportParts, CC_BY, creatorName } from '../../tools/build-mission-import.mjs';
import { readPolicy, publicationDetails, buildFiles, prepare, POLICY_PATH } from '../../tools/build-drawdown-credit-fallback.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const input = readCatalog(), policy = readPolicy(), missions = input.catalog.missions;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

test('the seven applied imports and historical input remain byte-for-byte reproducible', () => {
  assert.equal(sha256(input.text), 'b9150c5b3075862fc66b989a12791278924414d2c6fc463fcb3dbbf67c6e6f66');
  const parts = buildImportParts(input);
  assert.equal(parts.length, 7);
  for (const p of parts) assert.equal(read(p.file), p.sql, p.file);
  assert.equal(policy.historical_catalog_sha256, sha256(input.text));
  assert.throws(() => prepare({ ...input, text: input.text + '\n' }, policy), /catalog is frozen/);
});

test('the release removes all 87 website excerpts and claims, preserving every other details field', () => {
  const quoted = missions.filter((m) => m.about != null);
  assert.equal(quoted.length, 87);
  assert.equal(quoted.filter((m) => m.source.license === CC_BY.name).length, 40, 'spreadsheet licences do not licence website excerpts');
  for (const m of missions) {
    const before = detailsRow(m), after = publicationDetails(m);
    const unchanged = ({ about, about_credit, credit_line, ...rest }) => rest;
    assert.deepEqual(unchanged(after), unchanged(before), m.slug);
    assert.equal(after.about, null);
    assert.equal(after.about_credit, null);
    assert.doesNotMatch(after.credit_line, /used with permission|Solution summary from Project Drawdown/i);
    if (before.about == null) assert.deepEqual(after, before, `${m.slug}: an unquoted row never changes`);
    else {
      assert.ok(after.credit_line.startsWith(`Solution listed in Project Drawdown's Explorer (${before.source_url})`));
      assert.equal(after.credit_line.slice(`Solution listed in Project Drawdown's Explorer (${before.source_url})`.length),
        before.credit_line.slice(`Solution summary from Project Drawdown (${before.source_url}), used with permission`.length),
        `${m.slug}: complete assessment and adaptation suffix remains`);
    }
  }
});

test('all 43 CC BY citations retain creators, assessment titles, DOI, licence and adaptation notice', () => {
  const licensed = missions.filter((m) => m.source.license === CC_BY.name);
  assert.equal(licensed.length, 43);
  for (const m of licensed) {
    const d = publicationDetails(m);
    for (const s of [...m.source.creators.map(creatorName), m.source.record_title, m.source.doi, m.source.license, m.source.license_url, 'Adapted: the mission wording is original.']) {
      assert.ok(d.credit_line.toLowerCase().includes(s.toLowerCase()), `${m.slug}: ${s}`);
    }
    assert.equal(d.license_name, CC_BY.name);
    assert.equal(d.license_url, CC_BY.url);
    assert.equal(d.doi, m.source.doi);
  }
});

test('three bounded SQL artifacts are generated exactly; no source-page attestation or schema writes', () => {
  const files = buildFiles();
  assert.equal(Object.keys(files).length, 3);
  for (const [file, sql] of Object.entries(files)) {
    assert.equal(read(file), sql, file);
    assert.ok(Buffer.byteLength(sql) <= 32000, `${file}: fits one exact migration call`);
    assert.match(sql, /set local lock_timeout = '5s'/);
    assert.match(sql, /using errcode = '55000'/);
    assert.doesNotMatch(sql, /\b(create|alter|drop)\s+(table|function|policy|trigger)|\b(grant|revoke)\s|permission_confirmed\s*[:=]/i);
  }
  assert.equal(policy.permission_evidence, 'not_verified');
  assert.equal(policy.source_page_state, 'draft');
  const cli = spawnSync(process.execPath, ['tools/build-drawdown-credit-fallback.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(read(POLICY_PATH), /"public_website_excerpts": false/);
});

test('the catalog record documents the fallback without treating historical claims as permission evidence', () => {
  const doc = read('data/missions/drawdown/README.md').replace(/\s+/g, ' ');
  assert.match(doc, /Permission evidence was not verified on 2026-11-20/);
  assert.match(doc, /all 87 website excerpts/);
  assert.match(doc, /all 43 assessment citations/);
  assert.match(doc, /source page stays draft/);
});
