import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const contract = JSON.parse(await readFile(path.join(root, 'core', 'drift-contract.json'), 'utf8'));
const ledger = JSON.parse(await readFile(path.join(root, 'supabase', 'production-ledger.json'), 'utf8'));
const files = await readdir(path.join(root, 'supabase', 'migrations'));

const timestamped = files
  .map((file) => {
    const match = file.match(/^(\d{14})_(.+)\.sql$/);
    return match ? { file, version: match[1], name: match[2] } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.version.localeCompare(b.version) || a.name.localeCompare(b.name));

const failures = [];
const versions = new Map();
for (const item of timestamped) {
  const prior = versions.get(item.version);
  if (prior) failures.push(`duplicate migration version ${item.version}: ${prior} and ${item.file}`);
  else versions.set(item.version, item.file);
}

const expected = contract?.supabase;
if (!expected) failures.push('core/drift-contract.json has no supabase contract');

if (ledger?.schema_version !== 'mccluster-supabase-production-ledger/v1') {
  failures.push('supabase/production-ledger.json has an unsupported schema_version');
}
if (!Array.isArray(ledger?.migrations) || !ledger.migrations.length) {
  failures.push('supabase/production-ledger.json has no migrations[]');
}

const ledgerRows = Array.isArray(ledger?.migrations) ? ledger.migrations.map((row) => ({
  version: String(row?.version || ''),
  name: String(row?.name || ''),
})) : [];

const sortedLedger = [...ledgerRows].sort((a, b) => a.version.localeCompare(b.version) || a.name.localeCompare(b.name));
if (JSON.stringify(ledgerRows) !== JSON.stringify(sortedLedger)) {
  failures.push('production ledger migrations are not in canonical version/name order');
}

const ledgerVersions = new Map();
for (const row of ledgerRows) {
  if (!/^\d{14}$/.test(row.version) || !row.name) {
    failures.push(`invalid production ledger entry: ${JSON.stringify(row)}`);
    continue;
  }
  if (ledgerVersions.has(row.version)) {
    failures.push(`duplicate production ledger version ${row.version}`);
  } else {
    ledgerVersions.set(row.version, row.name);
  }
}

const ledgerText = ledgerRows.map((row) => `${row.version}:${row.name}`).join('\n');
const ledgerSha256 = createHash('sha256').update(ledgerText, 'utf8').digest('hex');
const latestLedger = ledgerRows.at(-1) || null;

if (Number(ledger?.migration_count) !== ledgerRows.length) {
  failures.push(`production ledger migration_count ${ledger?.migration_count} does not match entries ${ledgerRows.length}`);
}
if (String(ledger?.ledger_sha256 || '') !== ledgerSha256) {
  failures.push(`production ledger SHA-256 ${ledger?.ledger_sha256} does not match computed ${ledgerSha256}`);
}
if (latestLedger) {
  if (String(ledger?.latest_version || '') !== latestLedger.version) {
    failures.push(`production ledger latest_version ${ledger?.latest_version} does not match ${latestLedger.version}`);
  }
  if (String(ledger?.latest_name || '') !== latestLedger.name) {
    failures.push(`production ledger latest_name ${ledger?.latest_name} does not match ${latestLedger.name}`);
  }
}

if (expected && latestLedger) {
  const checks = [
    ['project_ref', String(ledger?.project_ref || ''), String(expected.project_ref || '')],
    ['migration_count', String(ledgerRows.length), String(expected.migration_count)],
    ['latest_version', latestLedger.version, String(expected.latest_version)],
    ['latest_name', latestLedger.name, String(expected.latest_name)],
    ['ledger_sha256', ledgerSha256, String(expected.ledger_sha256)],
  ];
  for (const [field, actual, wanted] of checks) {
    if (actual !== wanted) failures.push(`production ledger ${field} ${actual} does not match drift contract ${wanted}`);
  }
}

const cutover = String(ledger?.production_sql_cutover_version || '');
if (!/^\d{14}$/.test(cutover)) {
  failures.push('production_sql_cutover_version must be a 14-digit migration version');
} else {
  for (const row of ledgerRows.filter((item) => item.version >= cutover)) {
    const exact = `${row.version}_${row.name}.sql`;
    if (!files.includes(exact)) failures.push(`missing exact post-cutover production migration: ${exact}`);
  }

  for (const item of timestamped.filter((row) => row.version >= cutover)) {
    const liveName = ledgerVersions.get(item.version);
    if (!liveName) {
      failures.push(`post-cutover repository migration is not in production ledger: ${item.file}`);
    } else if (liveName !== item.name) {
      failures.push(`post-cutover migration name mismatch for ${item.version}: repo=${item.name} ledger=${liveName}`);
    }
  }
}

const requiredLiveReconciliations = [
  '20260919020830_compute_gateway_hardening_live_reconcile.sql',
  '20260919021007_compute_capability_concurrency_live_reconcile.sql',
  '20260919021013_compute_crypto_search_path_reconcile.sql',
  '20260919021348_control_plane_drift_attestation.sql',
];
for (const file of requiredLiveReconciliations) {
  if (!files.includes(file)) failures.push(`missing production reconciliation migration: ${file}`);
}

const nodeManifest = JSON.parse(await readFile(path.join(root, 'core', 'node-manifests', 'ovh-primary.json'), 'utf8'));
if (!Array.isArray(nodeManifest.capabilities)) failures.push('ovh-primary node manifest must contain capabilities[]');
if (!nodeManifest.capabilities.some((item) => item?.capability === 'ai.chat' && item?.implementation === 'qwen3.8b.local')) {
  failures.push('ovh-primary node manifest lost ai.chat/qwen3.8b.local');
}

if (failures.length) {
  console.error('CONTROL-PLANE DRIFT CONTRACT FAILED');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  schema_version: contract.schema_version,
  supabase: expected,
  production_ledger: {
    entries: ledgerRows.length,
    cutover,
    latest: latestLedger,
    ledger_sha256: ledgerSha256,
  },
  node_manifest: {
    name: 'ovh-primary',
    capabilities: nodeManifest.capabilities.map((item) => `${item.capability}:${item.implementation}`),
  },
}, null, 2));
