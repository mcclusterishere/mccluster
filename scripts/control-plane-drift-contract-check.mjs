import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const contract = JSON.parse(await readFile(path.join(root, 'core', 'drift-contract.json'), 'utf8'));
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

const latest = timestamped.at(-1);
if (!latest) {
  failures.push('no timestamped Supabase migrations found');
} else if (expected) {
  if (latest.version !== String(expected.latest_version)) {
    failures.push(`latest migration version ${latest.version} does not match drift contract ${expected.latest_version}`);
  }
  if (latest.name !== String(expected.latest_name)) {
    failures.push(`latest migration name ${latest.name} does not match drift contract ${expected.latest_name}`);
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

const manifest = JSON.parse(await readFile(path.join(root, 'core', 'node-manifests', 'ovh-primary.json'), 'utf8'));
if (!Array.isArray(manifest.capabilities)) failures.push('ovh-primary node manifest must contain capabilities[]');
if (!manifest.capabilities.some((item) => item?.capability === 'ai.chat' && item?.implementation === 'qwen3.8b.local')) {
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
  latest_repo_migration: latest,
  node_manifest: {
    name: 'ovh-primary',
    capabilities: manifest.capabilities.map((item) => `${item.capability}:${item.implementation}`),
  },
}, null, 2));
