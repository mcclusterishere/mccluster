// Offline PostgreSQL behavior tests. Install @electric-sql/pglite@0.5.10 in a
// scratch tools directory and point PGLITE_MODULE_PATH to its dist/index.js.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(resolve(process.env.PGLITE_MODULE_PATH)).href : '@electric-sql/pglite');
const root = fileURLToPath(new URL('../', import.meta.url));
const db = new PGlite();
try {
  for (const path of [
    'supabase/tests/analytics_measurement.deps.sql',
    'supabase/migrations/20261020205942_analytics_measurement_semantics_v1.sql',
    'supabase/tests/analytics_measurement.behaviour.sql'
  ]) await db.exec(await readFile(resolve(root, path), 'utf8'));
  console.log('analytics measurement SQL: passed (DST boundary, repeat devices, tenant/bot isolation, taxonomy, account authority and role denial)');
} finally { await db.close(); }
