#!/usr/bin/env node
// Read-only portability inventory. No production calls, export, or mutations.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
if (argv.some(x => !['--check', '--help'].includes(x))) {
  console.error('Usage: node scripts/productization-audit.mjs [--check]');
  process.exit(2);
}
if (argv.includes('--help')) {
  console.log('Inventory known production bindings and data-seeding SQL; --check exits 1 while findings remain. Not a complete release/security audit.');
  process.exit(0);
}
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const rules = [
  ['production_project', /zmnhbrjyhxzhkxmhkexs/],
  ['production_origin', /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*mccluster\.org\b/i],
  ['owner_email', /matthew@mccluster\.org/i],
  ['house_org_lookup', /\.eq\(\s*['"]slug['"]\s*,\s*['"]mccluster['"]\s*\)/],
];
const findings = [];
const sqlWithDataWrites = [];
for (const file of files) {
  const runtime = /^(js\/|supabase\/functions\/|core\/src\/|workers\/mccluster\/src\/)/.test(file)
    && /\.(?:js|mjs|ts|tsx|jsx)$/.test(file)
    && !/(?:^|\/)(?:test|tests|node_modules)\//.test(file)
    && !/\.(?:test|spec)\./.test(file);
  const config = ['supabase/config.toml', 'workers/mccluster/wrangler.toml', 'core/core.env.example'].includes(file);
  const sql = /^supabase\/(?:migrations|replay_migrations)\/.*\.sql$/.test(file);
  if (!runtime && !config && !sql) continue;
  const source = await readFile(path.join(root, file), 'utf8');
  if (runtime || config) {
    const categories = rules.filter(([, re]) => re.test(source)).map(([name]) => name);
    if (categories.length) findings.push({ path: file, categories });
  }
  // Intentionally conservative inventory, not a SQL parser: DML can be a legitimate
  // system default or a function body. Every flagged file needs classification.
  if (sql && /\b(?:insert\s+into|update\s+(?:public\.|private\.)|delete\s+from)\b/i.test(source)) sqlWithDataWrites.push(file);
}
const report = {
  schema_version: 'mccluster-productization-inventory/v1',
  purpose: 'Known production bindings and SQL requiring data classification',
  complete_release_audit: false,
  independent_install_verified: false,
  runtime_and_config_files_with_known_bindings: findings.length,
  bindings: findings,
  sql_files_requiring_classification: sqlWithDataWrites,
  release_contract: 'docs/products/DISTRIBUTABLE-PRODUCT.md',
};
console.log(JSON.stringify(report, null, 2));
if (argv.includes('--check') && (findings.length || sqlWithDataWrites.length)) process.exitCode = 1;
