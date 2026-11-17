import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const root = new URL('..', import.meta.url).pathname;
const contract = JSON.parse(await readFile(path.join(root, 'core', 'drift-contract.json'), 'utf8'));
const ledger = JSON.parse(await readFile(path.join(root, 'supabase', 'production-ledger.json'), 'utf8'));
const migrationDir = path.join(root, 'supabase', 'migrations');
const replayDir = path.join(root, 'supabase', 'replay_migrations');
const migrationEntries = await readdir(migrationDir, { withFileTypes: true });
const files = migrationEntries.map((entry) => entry.name);
const replayFiles = await readdir(replayDir);
const sqlFiles = files.filter((file) => file.endsWith('.sql')).sort();
const failures = [];

// supabase/migrations/ is production-only and flat. A subdirectory (a second "pending"
// folder) or a non-.sql file is invisible to the ledger checks below, so either fails here.
for (const entry of migrationEntries) {
  if (entry.isDirectory()) failures.push(`supabase/migrations/ must not contain a subdirectory: ${entry.name}/ (staged SQL lives in supabase/pending/)`);
  else if (!entry.isFile() || !entry.name.endsWith('.sql')) failures.push(`supabase/migrations/ must contain only .sql files: ${entry.name}`);
}

const expected = contract?.supabase;
if (!expected) failures.push('core/drift-contract.json has no supabase contract');
if (ledger?.schema_version !== 'mccluster-supabase-production-ledger/v1') failures.push('unsupported production ledger schema');
if (!Array.isArray(ledger?.migrations) || !ledger.migrations.length) failures.push('production ledger has no migrations[]');

const ledgerRows = Array.isArray(ledger?.migrations) ? ledger.migrations.map((row) => ({
  version: String(row?.version || ''), name: String(row?.name || ''),
})) : [];
const sortedLedger = [...ledgerRows].sort((a,b)=>a.version.localeCompare(b.version)||a.name.localeCompare(b.name));
if (JSON.stringify(ledgerRows) !== JSON.stringify(sortedLedger)) failures.push('production ledger is not canonically ordered');

const versions = new Set();
const ledgerFiles = new Set();
for (const row of ledgerRows) {
  if (!/^(?:\d{4}|\d{14})$/.test(row.version) || !row.name) failures.push(`invalid production ledger entry: ${JSON.stringify(row)}`);
  if (versions.has(row.version)) failures.push(`duplicate production ledger version ${row.version}`);
  versions.add(row.version);
  ledgerFiles.add(`${row.version}_${row.name}.sql`);
}

const ledgerText = ledgerRows.map((row)=>`${row.version}:${row.name}`).join('\n');
const ledgerSha256 = createHash('sha256').update(ledgerText,'utf8').digest('hex');
const latest = ledgerRows.at(-1) || null;
if (Number(ledger?.migration_count) !== ledgerRows.length) failures.push('production ledger count mismatch');
if (String(ledger?.ledger_sha256||'') !== ledgerSha256) failures.push('production ledger hash mismatch');
if (latest && (String(ledger.latest_version)!==latest.version || String(ledger.latest_name)!==latest.name)) failures.push('production ledger latest migration mismatch');

if (expected && latest) {
  for (const [field,actual,wanted] of [
    ['project_ref',String(ledger.project_ref||''),String(expected.project_ref||'')],
    ['migration_count',String(ledgerRows.length),String(expected.migration_count)],
    ['latest_version',latest.version,String(expected.latest_version)],
    ['latest_name',latest.name,String(expected.latest_name)],
    ['ledger_sha256',ledgerSha256,String(expected.ledger_sha256)],
  ]) if (actual!==wanted) failures.push(`production ledger ${field} ${actual} does not match drift contract ${wanted}`);
}

for (const exact of ledgerFiles) if (!sqlFiles.includes(exact)) failures.push(`missing exact production migration: ${exact}`);
// New migrations are valid PR changes but must not be represented as already applied.
// They must be strictly newer than the production ledger's latest local version.
const pendingFiles = sqlFiles.filter((file) => !ledgerFiles.has(file));
for (const file of pendingFiles) {
  const match = /^(\d{14})_([a-z0-9_]+)\.sql$/.exec(file);
  if (!match || !latest || match[1] <= latest.version) {
    failures.push(`unregistered historical or invalid migration: ${file}`);
  }
}
if (pendingFiles.length) console.log(`Pending unapplied migrations (not in production ledger): ${pendingFiles.join(', ')}`);

for (const row of ledgerRows.filter((item)=>/^\d{4}$/.test(item.version))) {
  const exact=`${row.version}_${row.name}.sql`;
  const source=await readFile(path.join(migrationDir,exact),'utf8');
  if (!source.includes('REPLAY_ANCHOR_ONLY')) failures.push(`registered numbered migration is not a no-op anchor: ${exact}`);
  if (!replayFiles.includes(exact)) failures.push(`registered numbered migration missing replay source: ${exact}`);
}

const cutover=String(ledger?.production_sql_cutover_version||'');
if (!/^\d{14}$/.test(cutover)) failures.push('production_sql_cutover_version must be 14 digits');

for (const file of [
  '20260919020830_compute_gateway_hardening_live_reconcile.sql',
  '20260919021007_compute_capability_concurrency_live_reconcile.sql',
  '20260919021013_compute_crypto_search_path_reconcile.sql',
  '20260919021348_control_plane_drift_attestation.sql',
]) if (!files.includes(file)) failures.push(`missing production reconciliation migration: ${file}`);

const nodeManifest=JSON.parse(await readFile(path.join(root,'core','node-manifests','ovh-primary.json'),'utf8'));
if (!Array.isArray(nodeManifest.capabilities)) failures.push('ovh-primary node manifest must contain capabilities[]');
if (!nodeManifest.capabilities.some((item)=>item?.capability==='ai.chat'&&item?.implementation==='qwen3.8b.local')) failures.push('ovh-primary lost ai.chat/qwen3.8b.local');

// The Windows GPU laptop template (core/windows/mccluster-node.ps1 -Install writes it, pruned per
// model tier, to that node's capabilities.json; docs/control-plane/WINDOWS-NODE.md). It must stay
// claimable beside the OVH node and private: the same implementation id with the OVH schema (one
// binding, one task, either node), loopback executors with per-implementation readiness, no VRAM
// threshold (an APU reports its UMA carve-out, not the memory inference uses), one lease, owned
// gpu-laptop labels, nothing pilot-only, and no user path, UNC host, e-mail or non-loopback address.
const laptopPath=path.join(root,'core','node-manifests','owner-windows-gpu.json');
let laptopRaw='';
let laptop=null;
try { laptopRaw=await readFile(laptopPath,'utf8'); laptop=JSON.parse(laptopRaw); }
catch (error) { failures.push(`owner-windows-gpu node manifest is missing or unparsable: ${error.message}`); }
const laptopEntries=Array.isArray(laptop?.capabilities)?laptop.capabilities:null;
if (laptop&&!laptopEntries) failures.push('owner-windows-gpu node manifest must contain capabilities[]');
if (laptopEntries) {
  const ovhChat=nodeManifest.capabilities.find((item)=>item?.capability==='ai.chat'&&item?.implementation==='qwen3.8b.local');
  const laptopEntry=(implementation)=>laptopEntries.find((item)=>item?.capability==='ai.chat'&&item?.implementation===implementation);
  // The four entries the doctor's tiers choose from (owner decision 2026-11-17, headroom first): the resident
  // vision model, the OVH twin on demand, qwen3:14b for a discrete card with 12 GiB or more, qwen3-vl:4b for a
  // box with little free memory. Every entry carries the OVH ai.chat schema byte for byte.
  for (const implementation of ['qwen3-vl.8b.local','qwen3.8b.local','qwen3.14b.local','qwen3-vl.4b.local']) if (!laptopEntry(implementation)) failures.push(`owner-windows-gpu lost ai.chat/${implementation}`);
  if (laptopEntries.some((item)=>item?.capability==='ai.text.draft')) failures.push('owner-windows-gpu must not advertise ai.text.draft (pilot-only, nothing submits it)');
  if (ovhChat) for (const item of laptopEntries) for (const field of ['input_schema','output_schema']) {
    if (!isDeepStrictEqual(item?.[field],ovhChat[field])) failures.push(`owner-windows-gpu ${item?.implementation||'?'} ${field} drifted from ovh-primary`);
  }
  for (const item of laptopEntries) {
    for (const field of ['url','health_url']) {
      let hostname=null;
      try { hostname=new URL(item?.executor?.[field]).hostname; } catch { hostname=null; }
      if (hostname!=='127.0.0.1') failures.push(`owner-windows-gpu ${item?.implementation||'?'} executor ${field} must be a 127.0.0.1 loopback service`);
    }
    if (item?.min_vram_bytes!==0) failures.push(`owner-windows-gpu ${item?.implementation||'?'} min_vram_bytes must be 0`);
  }
  if (laptop.max_leases!==1) failures.push('owner-windows-gpu max_leases must be 1');
  if (laptop?.labels?.trust!=='owned'||laptop?.labels?.role!=='gpu-laptop') failures.push('owner-windows-gpu labels must say trust owned and role gpu-laptop');
}
// A Windows user-profile path (raw or JSON-escaped), a UNC host (two backslashes at a path start),
// an e-mail address, or an IPv4 address other than the loopback the executors must use.
const PRIVATE_STRINGS=/[A-Za-z]:\\{1,2}Users\\{1,2}|(?<![\\\w])\\\\[A-Za-z0-9]|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?!127\.0\.0\.1\b)\d{1,3}(?:\.\d{1,3}){3}\b/;
const privateHit=PRIVATE_STRINGS.exec(laptopRaw);
if (privateHit) failures.push(`owner-windows-gpu node manifest carries a private string: ${privateHit[0]}`);

if (failures.length) {
  console.error('CONTROL-PLANE DRIFT CONTRACT FAILED');
  failures.forEach((failure)=>console.error(`- ${failure}`));
  process.exit(1);
}
console.log(JSON.stringify({
  ok:true,
  schema_version:contract.schema_version,
  supabase:expected,
  production_ledger:{entries:ledgerRows.length,cutover,latest,ledger_sha256:ledgerSha256},
  migration_files:{active:sqlFiles.length,replay:replayFiles.filter((f)=>f.endsWith('.sql')).length},
  node_manifests:{
    'ovh-primary':{implementations:nodeManifest.capabilities.map((item)=>`${item.capability}/${item.implementation}`)},
    'owner-windows-gpu':{implementations:(laptopEntries||[]).map((item)=>`${item.capability}/${item.implementation}`)},
  },
},null,2));
