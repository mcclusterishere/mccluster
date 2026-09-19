import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const contract = JSON.parse(await readFile(path.join(root, 'core', 'drift-contract.json'), 'utf8'));
const ledger = JSON.parse(await readFile(path.join(root, 'supabase', 'production-ledger.json'), 'utf8'));
const migrationDir = path.join(root, 'supabase', 'migrations');
const replayDir = path.join(root, 'supabase', 'replay_migrations');
const files = await readdir(migrationDir);
const replayFiles = await readdir(replayDir);
const sqlFiles = files.filter((file) => file.endsWith('.sql')).sort();
const failures = [];

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
for (const file of sqlFiles) if (!ledgerFiles.has(file)) failures.push(`active migration is not in production ledger: ${file}`);

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
},null,2));
