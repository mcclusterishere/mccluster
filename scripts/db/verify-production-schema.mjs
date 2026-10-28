#!/usr/bin/env node
// Read-only production schema verifier.
//
// It proves what a source scan or an allowlist cannot: what the database actually holds.
// It compares a live snapshot (or a saved one) against:
//   - the repo's migration files (supabase/migrations/, supabase/pending/) and
//     supabase/production-ledger.json, for the applied ledger;
//   - supabase/schema-manifest.json, the schema CI's disposable reset builds from
//     supabase/migrations/ + supabase/replay_migrations/, for tables, columns, functions
//     (SECURITY DEFINER, EXECUTE grants), RLS, policies, triggers, buckets, views'
//     security_invoker and table grants.
//
// The SQL is scripts/db/schema-queries.mjs, the same text every way it runs.
//
// Usage:
//   node scripts/db/verify-production-schema.mjs --print-sql [section]
//       Print the SQL to paste into the Supabase MCP execute_sql tool.
//   PROD_DB_URL=postgresql://... node scripts/db/verify-production-schema.mjs \
//       --database-url-env PROD_DB_URL [--snapshot-out snap.json]
//       Snapshot a live database with psql (the URL is read from the environment, never
//       from the command line or a file), then verify it.
//   node scripts/db/verify-production-schema.mjs --snapshot docs/control-plane/evidence/<file>.json
//       Verify a saved snapshot (for example the MCP evidence). Each section's md5 is
//       rechecked against its rows and its SQL hash against the current queries.
//   --mode production (default)  ledger vs repo + schema vs manifest
//   --mode reset                 the disposable CI database: schema must equal the manifest
//   --write-manifest             (reset mode) write supabase/schema-manifest.json from the snapshot
//   --report-json <file>         write the full comparison
//   --no-fail                    exit 0 even when drift is found
//
// Exit: 0 clean, 1 drift, 2 usage or integrity error.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SECTIONS, SECTION_NAMES, canonicalJsonbText, normalizeSqlCode } from './schema-queries.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const MANIFEST = path.join(ROOT, 'supabase', 'schema-manifest.json');
export const SNAPSHOT_SCHEMA = 'mccluster-schema-snapshot/v1';
export const MANIFEST_SCHEMA = 'mccluster-schema-manifest/v1';

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
export const sqlSha256 = (name) => sha256(SECTIONS[name].sql);

// ---------- snapshot ----------

// The md5 proves the saved rows are the rows the database returned. A different SQL
// hash is not an integrity failure (the evidence is dated), but such a section is not
// compared with a manifest built from other SQL.
export function checkSectionIntegrity(name, section) {
  if (!section || !Array.isArray(section.rows)) return [`${name}: no rows[]`];
  const text = canonicalJsonbText(section.rows);
  return md5(text) === section.md5 ? [] : [`${name}: rows do not hash to the recorded md5 (${section.md5})`];
}

function runPsql(url, sql) {
  const out = execFileSync('psql', ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-d', url, '-c', sql], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, PGCONNECT_TIMEOUT: '20' },
  });
  return out.trim();
}

export function snapshotDatabase(url, { source = 'database' } = {}) {
  const sections = {};
  for (const name of SECTION_NAMES) {
    const def = SECTIONS[name];
    if (def.requires) {
      const present = runPsql(url, `select to_regclass('${def.requires}') is not null`);
      if (present !== 't') { sections[name] = { absent: def.requires }; continue; }
    }
    const raw = runPsql(url, `select json_build_object('md5', md5, 'j', j) from (${def.sql}) x`);
    const parsed = JSON.parse(raw);
    sections[name] = { sql_sha256: sqlSha256(name), md5: parsed.md5, rows: parsed.j };
  }
  return { schema_version: SNAPSHOT_SCHEMA, source, sections };
}

// One row per line: diffable, and small enough to commit.
export function formatSnapshot(obj) {
  const lines = ['{'];
  const top = Object.entries(obj).filter(([k]) => k !== 'sections');
  for (const [k, v] of top) lines.push(` ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  lines.push(' "sections": {');
  const names = Object.keys(obj.sections || {});
  names.forEach((name, i) => {
    const sec = obj.sections[name];
    const head = Object.entries(sec).filter(([k]) => k !== 'rows').map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    if (!Array.isArray(sec.rows)) {
      lines.push(`  ${JSON.stringify(name)}: {${head.join(', ')}}${i < names.length - 1 ? ',' : ''}`);
      return;
    }
    lines.push(`  ${JSON.stringify(name)}: {${head.join(', ')}${head.length ? ', ' : ''}"rows": [`);
    sec.rows.forEach((r, j) => lines.push(`   ${JSON.stringify(r)}${j < sec.rows.length - 1 ? ',' : ''}`));
    lines.push(`  ]}${i < names.length - 1 ? ',' : ''}`);
  });
  lines.push(' }', '}');
  return `${lines.join('\n')}\n`;
}

// Build a snapshot from saved MCP execute_sql results: <dir>/<section>.json, each the
// tool's row list [{"md5": ..., "j": [...]}] for the SQL --print-sql <section> prints.
export async function snapshotFromMcpDir(dir, { source = 'production via Supabase MCP execute_sql', capturedAt = null } = {}) {
  const sections = {};
  for (const name of SECTION_NAMES) {
    let raw;
    try { raw = JSON.parse(await readFile(path.join(dir, `${name}.json`), 'utf8')); } catch { continue; }
    const row = Array.isArray(raw) ? raw[0] : raw;
    sections[name] = { sql_sha256: sqlSha256(name), md5: row.md5, rows: row.j };
  }
  return { schema_version: SNAPSHOT_SCHEMA, source, captured_at: capturedAt, sections };
}

// ---------- ledger ----------

const fileMd5 = async (file) => md5(await readFile(file, 'utf8'));

export async function compareLedger(ledgerRows, root = ROOT) {
  const migDir = path.join(root, 'supabase', 'migrations');
  const pendDir = path.join(root, 'supabase', 'pending');
  const migFiles = (await readdir(migDir)).filter((f) => f.endsWith('.sql')).sort();
  const pendFiles = (await readdir(pendDir)).filter((f) => f.endsWith('.sql') && !f.includes('.rollback.')).sort();
  const committed = JSON.parse(await readFile(path.join(root, 'supabase', 'production-ledger.json'), 'utf8'));
  const cutover = String(committed.production_sql_cutover_version || '');

  const live = ledgerRows.map(([version, name, n, m, c]) => ({ version, name, n, md5: m, code: c }));
  const liveFile = new Map(live.map((r) => [`${r.version}_${r.name}.sql`, r]));
  const maxLive = live.reduce((a, r) => (r.version > a ? r.version : a), '');

  const missingInRepo = live.filter((r) => !migFiles.includes(`${r.version}_${r.name}.sql`)).map((r) => `${r.version}_${r.name}`);
  const extraInRepo = migFiles.filter((f) => !liveFile.has(f));
  const outOfOrder = extraInRepo.filter((f) => f.slice(0, 14) < maxLive);

  // Byte-exact, or the same executable SQL with rewritten `--` comments, or different SQL.
  const byteMismatch = [];
  const commentOnly = [];
  let byteExact = 0;
  for (const r of live) {
    const f = `${r.version}_${r.name}.sql`;
    if (!migFiles.includes(f) || r.n !== 1) continue;
    const text = await readFile(path.join(migDir, f), 'utf8');
    if (md5(text) === r.md5) { byteExact += 1; continue; }
    if (r.code && md5(normalizeSqlCode(text)) === r.code) { commentOnly.push(`${r.version}_${r.name}`); continue; }
    byteMismatch.push({ migration: `${r.version}_${r.name}`, post_cutover: r.version >= cutover, anchor_only: text.includes('REPLAY_ANCHOR_ONLY') });
  }
  const multiStatement = live.filter((r) => r.n !== 1).map((r) => `${r.version}_${r.name}`);

  // Same name, different version: a twin left behind by a rename or a re-apply.
  const liveByName = new Map();
  for (const r of live) liveByName.set(r.name, [...(liveByName.get(r.name) || []), r.version]);
  const repoTwins = [];
  for (const f of migFiles) {
    const m = /^(\d+)_(.+)\.sql$/.exec(f);
    if (!m) continue;
    const versions = liveByName.get(m[2]) || [];
    if (versions.length && !versions.includes(m[1])) repoTwins.push({ file: f, production_versions: versions });
  }
  const duplicateLiveNames = [...liveByName].filter(([, v]) => v.length > 1).map(([name, versions]) => ({ name, versions }));

  // Pending files already recorded in production (by name or by exact content).
  const liveByMd5 = new Map(live.filter((r) => r.n === 1).map((r) => [r.md5, r]));
  const pending = [];
  for (const f of pendFiles) {
    const base = f.replace(/\.sql$/, '').replace(/^\d{14}_/, '');
    const content = await fileMd5(path.join(pendDir, f));
    const byName = live.filter((r) => r.name === base).map((r) => r.version);
    const byContent = liveByMd5.get(content);
    pending.push({
      file: f,
      recorded_by_name: byName,
      recorded_by_content: byContent ? `${byContent.version}_${byContent.name}` : null,
    });
  }

  const committedRows = (committed.migrations || []).map((r) => `${r.version}:${r.name}`);
  const liveRows = [...live].sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0)).map((r) => `${r.version}:${r.name}`);
  const committedLedgerMatches = JSON.stringify(committedRows) === JSON.stringify(liveRows);

  return {
    live_count: live.length,
    live_latest: live.at(-1) ? `${live.at(-1).version}_${live.at(-1).name}` : null,
    live_sha256: sha256(liveRows.join('\n')),
    committed_ledger: { count: committedRows.length, sha256: committed.ledger_sha256, matches_live: committedLedgerMatches },
    repo_migration_files: migFiles.length,
    missing_in_repo: missingInRepo,
    extra_in_repo: extraInRepo,
    out_of_order: outOfOrder,
    renamed_twins: repoTwins,
    duplicate_live_names: duplicateLiveNames,
    byte_exact_single_statement: byteExact,
    comment_only_difference: commentOnly,
    byte_mismatch: byteMismatch,
    multi_statement_not_compared: multiStatement,
    pending,
  };
}

// ---------- schema ----------

const KEYS = {
  schemas: (r) => r[0],
  extensions: (r) => r[0],
  relations: (r) => `${r[0]}.${r[1]}`,
  functions: (r) => `${r[0]}.${r[1]}(${r[2]})`,
  policies: (r) => `${r[0]}.${r[1]} :: ${r[2]}`,
  triggers: (r) => `${r[0]}.${r[1]} :: ${r[2]}`,
  buckets: (r) => r[0],
  cron_jobs: (r) => `${r[0] ?? ''}@${r[1]}`,
};
export const FIELDS = {
  schemas: ['schema', 'owner', 'acl'],
  extensions: ['name', 'version', 'schema'],
  relations: ['schema', 'name', 'relkind', 'rls_enabled', 'rls_forced', 'security_invoker', 'ncols', 'colsig', 'consig', 'idxsig', 'defsig', 'acl'],
  functions: ['schema', 'name', 'args', 'result', 'security_definer', 'volatility', 'config', 'body', 'exec_acl'],
  policies: ['schema', 'table', 'policy', 'permissive', 'cmd', 'roles', 'using', 'check'],
  triggers: ['schema', 'table', 'trigger', 'enabled', 'def'],
  buckets: ['id', 'name', 'public', 'file_size_limit', 'allowed_mime_types'],
  cron_jobs: ['jobname', 'schedule', 'active', 'command'],
};

export function compareSection(name, actualRows, expectedRows) {
  const key = KEYS[name];
  const a = new Map(actualRows.map((r) => [key(r), r]));
  const e = new Map(expectedRows.map((r) => [key(r), r]));
  const onlyActual = [...a.keys()].filter((k) => !e.has(k)).sort();
  const onlyExpected = [...e.keys()].filter((k) => !a.has(k)).sort();
  const changed = [];
  for (const [k, row] of a) {
    const want = e.get(k);
    if (!want) continue;
    const fields = FIELDS[name];
    const diffs = [];
    for (let i = 0; i < fields.length; i += 1) {
      if (JSON.stringify(row[i]) !== JSON.stringify(want[i])) diffs.push({ field: fields[i], actual: row[i], expected: want[i] });
    }
    if (diffs.length) changed.push({ key: k, diffs });
  }
  return { only_in_database: onlyActual, only_in_manifest: onlyExpected, changed };
}

// Posture checks that need no manifest.
export function postureFindings(sections) {
  const rel = sections.relations?.rows || [];
  const fun = sections.functions?.rows || [];
  const pol = sections.policies?.rows || [];
  const exposed = (acl) => /(^|;)(anon|authenticated|PUBLIC)=/.test(acl);
  const tablesWithPolicies = new Set(pol.map((p) => `${p[0]}.${p[1]}`));
  return {
    tables_without_rls_exposed: rel.filter((r) => ['r', 'p'].includes(r[2]) && !r[3] && exposed(r[11])).map((r) => `${r[0]}.${r[1]}`),
    rls_enabled_no_policy: rel.filter((r) => ['r', 'p'].includes(r[2]) && r[3] && !tablesWithPolicies.has(`${r[0]}.${r[1]}`)).map((r) => `${r[0]}.${r[1]}`),
    definer_views_exposed: rel.filter((r) => ['v', 'm'].includes(r[2]) && r[5] !== 'true' && r[5] !== 'on' && exposed(r[11])).map((r) => `${r[0]}.${r[1]}`),
    security_definer_functions: fun.filter((f) => f[4]).length,
    security_definer_executable_by_anon_or_public: fun.filter((f) => f[4] && /(^|;)(anon|PUBLIC)=X/.test(f[8])).map((f) => `${f[0]}.${f[1]}(${f[2]})`),
    security_definer_without_search_path: fun.filter((f) => f[4] && !/search_path=/.test(f[6])).map((f) => `${f[0]}.${f[1]}(${f[2]})`),
    public_policies_for_anon: pol.filter((p) => /(^|,)(anon|public)(,|$)/.test(p[5]) && p[4] !== 'SELECT').map((p) => `${p[0]}.${p[1]} :: ${p[2]} (${p[4]})`),
  };
}

// ---------- pending file object scan ----------

const ident = String.raw`(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*)`;
const qname = String.raw`(${ident}(?:\s*\.\s*${ident})?)`;
const unq = (s) => {
  const parts = s.split('.').map((p) => p.trim().replace(/^"|"$/g, ''));
  return parts.length === 1 ? `public.${parts[0]}` : parts.join('.');
};
export function scanSqlObjects(sql) {
  const text = sql.replace(/--[^\n]*/g, '');
  const grab = (re, f = (m) => unq(m[1])) => [...new Set([...text.matchAll(re)].map(f))].sort();
  return {
    tables: grab(new RegExp(String.raw`create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${qname}`, 'gi')),
    views: grab(new RegExp(String.raw`create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${qname}`, 'gi')),
    functions: grab(new RegExp(String.raw`create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+${qname}\s*\(`, 'gi')),
    policies: grab(new RegExp(String.raw`create\s+policy\s+("[^"]+"|${ident})\s+on\s+${qname}`, 'gi'), (m) => `${unq(m[2])} :: ${m[1].replace(/^"|"$/g, '')}`),
    buckets: grab(/insert\s+into\s+storage\.buckets\s*\([^)]*\)\s*values\s*\(\s*'([^']+)'/gi, (m) => m[1]),
    columns: grab(new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${qname}\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(${ident})`, 'gi'), (m) => `${unq(m[1])}.${m[2].replace(/^"|"$/g, '')}`),
  };
}

export async function pendingPresence(sections, root = ROOT) {
  const pendDir = path.join(root, 'supabase', 'pending');
  const files = (await readdir(pendDir)).filter((f) => f.endsWith('.sql') && !f.includes('.rollback.')).sort();
  const rel = new Set((sections.relations?.rows || []).map((r) => `${r[0]}.${r[1]}`));
  const fun = new Set((sections.functions?.rows || []).map((r) => `${r[0]}.${r[1]}`));
  const pol = new Set((sections.policies?.rows || []).map((r) => `${r[0]}.${r[1]} :: ${r[2]}`));
  const bkt = new Set((sections.buckets?.rows || []).map((r) => r[0]));
  const out = [];
  for (const f of files) {
    const objs = scanSqlObjects(await readFile(path.join(pendDir, f), 'utf8'));
    const check = (list, set) => ({ present: list.filter((x) => set.has(x)), absent: list.filter((x) => !set.has(x)) });
    const r = {
      file: f,
      tables: check(objs.tables, rel),
      views: check(objs.views, rel),
      functions: check(objs.functions, fun),
      policies: check(objs.policies, pol),
      buckets: check(objs.buckets, bkt),
      added_columns: objs.columns,
    };
    const created = [...objs.tables, ...objs.views, ...objs.buckets];
    const createdPresent = [...r.tables.present, ...r.views.present, ...r.buckets.present];
    r.status = !created.length
      ? (r.functions.absent.length ? 'functions_absent' : (objs.functions.length ? 'functions_exist_replace_only' : 'no_created_objects'))
      : createdPresent.length === created.length ? 'objects_present'
      : createdPresent.length ? 'partially_present' : 'absent';
    out.push(r);
  }
  return out;
}

// ---------- main ----------

function parseArgs(argv) {
  const o = { mode: 'production', fail: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--print-sql') { o.printSql = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'all'; }
    else if (a === '--database-url-env') o.urlEnv = argv[++i];
    else if (a === '--snapshot') o.snapshot = argv[++i];
    else if (a === '--snapshot-out') o.snapshotOut = argv[++i];
    else if (a === '--from-mcp-dir') o.mcpDir = argv[++i];
    else if (a === '--captured-at') o.capturedAt = argv[++i];
    else if (a === '--manifest') o.manifest = argv[++i];
    else if (a === '--mode') o.mode = argv[++i];
    else if (a === '--write-manifest') o.writeManifest = true;
    else if (a === '--report-json') o.reportJson = argv[++i];
    else if (a === '--no-fail') o.fail = false;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

export function manifestFromSnapshot(snap) {
  const sections = {};
  for (const name of SECTION_NAMES) {
    if (name === 'ledger' || name === 'cron_jobs' || name === 'extensions') continue;
    const s = snap.sections[name];
    if (s?.rows) sections[name] = { md5: s.md5, rows: s.rows };
  }
  return {
    schema_version: MANIFEST_SCHEMA,
    note: 'What supabase/migrations/ + supabase/replay_migrations/ build on the CI disposable reset (scripts/supabase-local-reset-with-replay.sh). Regenerate with --mode reset --write-manifest; never edit by hand.',
    sql_sha256: Object.fromEntries(Object.keys(sections).map((n) => [n, snap.sections[n].sql_sha256 || sqlSha256(n)])),
    sections,
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.printSql) {
    const names = o.printSql === 'all' ? SECTION_NAMES : [o.printSql];
    for (const n of names) {
      if (!SECTIONS[n]) throw new Error(`unknown section ${n}; one of ${SECTION_NAMES.join(', ')}`);
      if (names.length > 1) console.log(`-- section: ${n} (sql_sha256 ${sqlSha256(n)})`);
      console.log(`${SECTIONS[n].sql};`);
    }
    return 0;
  }

  let snap;
  if (o.urlEnv) {
    const url = process.env[o.urlEnv];
    if (!url) { console.error(`environment variable ${o.urlEnv} is empty`); return 2; }
    snap = snapshotDatabase(url, { source: o.mode });
    if (o.snapshotOut) await writeFile(o.snapshotOut, formatSnapshot(snap));
  } else if (o.mcpDir) {
    snap = await snapshotFromMcpDir(o.mcpDir, { capturedAt: o.capturedAt || null });
    if (o.snapshotOut) await writeFile(o.snapshotOut, formatSnapshot(snap));
  } else if (o.snapshot) {
    snap = JSON.parse(await readFile(o.snapshot, 'utf8'));
  } else {
    console.error('give --database-url-env NAME, --snapshot FILE, --from-mcp-dir DIR or --print-sql');
    return 2;
  }
  if (snap.schema_version !== SNAPSHOT_SCHEMA) { console.error(`unsupported snapshot ${snap.schema_version}`); return 2; }

  const integrity = [];
  for (const [n, s] of Object.entries(snap.sections)) if (!s.absent) integrity.push(...checkSectionIntegrity(n, s));
  if (integrity.length) { integrity.forEach((p) => console.error(`integrity: ${p}`)); return 2; }

  if (o.writeManifest) {
    await writeFile(o.manifest || MANIFEST, formatSnapshot(manifestFromSnapshot(snap)));
    console.log(`wrote ${path.relative(ROOT, o.manifest || MANIFEST)}`);
  }

  const report = { mode: o.mode, source: snap.source, captured_at: snap.captured_at || null };
  let drift = 0;

  if (o.mode === 'production' && snap.sections.ledger?.rows) {
    report.ledger = await compareLedger(snap.sections.ledger.rows);
    const l = report.ledger;
    drift += l.missing_in_repo.length + l.extra_in_repo.length + l.renamed_twins.length + (l.committed_ledger.matches_live ? 0 : 1);
    drift += l.byte_mismatch.filter((m) => m.post_cutover && !m.anchor_only).length;
  }

  let manifest = null;
  try { manifest = JSON.parse(await readFile(o.manifest || MANIFEST, 'utf8')); } catch { manifest = null; }
  report.schema = {};
  if (!manifest) {
    report.schema.error = `no manifest at ${path.relative(ROOT, o.manifest || MANIFEST)}`;
    drift += 1;
  } else {
    for (const [n, want] of Object.entries(manifest.sections)) {
      const have = snap.sections[n];
      if (!have?.rows) { report.schema[n] = { error: 'section missing from snapshot' }; drift += 1; continue; }
      if (manifest.sql_sha256?.[n] && have.sql_sha256 && manifest.sql_sha256[n] !== have.sql_sha256) {
        report.schema[n] = { error: 'snapshot and manifest were taken with different SQL; regenerate the older one' }; drift += 1; continue;
      }
      const c = compareSection(n, have.rows, want.rows);
      report.schema[n] = { equal: have.md5 === want.md5, ...c };
      drift += c.only_in_database.length + c.only_in_manifest.length + c.changed.length;
    }
  }

  report.posture = postureFindings(snap.sections);
  if (o.mode === 'production') report.pending_objects = await pendingPresence(snap.sections);

  if (o.reportJson) await writeFile(o.reportJson, `${JSON.stringify(report, null, 1)}\n`);
  printSummary(report);
  if (drift && o.fail) { console.error(`DRIFT: ${drift} difference(s)`); return 1; }
  console.log(drift ? `drift: ${drift} difference(s) (not failing: --no-fail)` : 'no drift');
  return 0;
}

function printSummary(r) {
  const lines = [`mode ${r.mode}, source ${r.source}`];
  if (r.ledger) {
    const l = r.ledger;
    lines.push(`ledger: live ${l.live_count} (latest ${l.live_latest}); committed ledger matches live: ${l.committed_ledger.matches_live}`);
    lines.push(`  missing in repo ${l.missing_in_repo.length}, extra in repo ${l.extra_in_repo.length}, out of order ${l.out_of_order.length}, renamed twins ${l.renamed_twins.length}`);
    lines.push(`  single-statement byte-exact ${l.byte_exact_single_statement}, comments-only difference ${l.comment_only_difference.length}, SQL differs ${l.byte_mismatch.length} (post-cutover ${l.byte_mismatch.filter((m) => m.post_cutover).length}, comment-only anchors ${l.byte_mismatch.filter((m) => m.anchor_only).length}), multi-statement not compared ${l.multi_statement_not_compared.length}`);
    for (const p of l.pending) if (p.recorded_by_name.length || p.recorded_by_content) lines.push(`  pending already recorded: ${p.file} -> ${p.recorded_by_content || p.recorded_by_name.join(',')}`);
  }
  for (const [n, s] of Object.entries(r.schema || {})) {
    if (n === 'error') continue;
    if (s.error) { lines.push(`${n}: ${s.error}`); continue; }
    lines.push(`${n}: ${s.equal ? 'equal' : `only in database ${s.only_in_database.length}, only in manifest ${s.only_in_manifest.length}, changed ${s.changed.length}`}`);
  }
  if (r.schema?.error) lines.push(`schema: ${r.schema.error}`);
  for (const [k, v] of Object.entries(r.posture)) lines.push(`posture ${k}: ${Array.isArray(v) ? v.length : v}`);
  if (r.pending_objects) for (const p of r.pending_objects) lines.push(`pending ${p.file}: ${p.status}`);
  console.log(lines.join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(err.stack || String(err)); process.exitCode = 2; });
}
