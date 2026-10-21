// Optional isolated PostgreSQL runtime for the SAME SQL regression file used by
// scripts/test-action-archive-db.sh. No production dependency or remote DB access.
// Supply a separately installed PGlite node_modules directory, for example:
// PGLITE_DIR=/tmp/archive-tests/node_modules node scripts/test/action-archive-db.mjs
import { createRequire } from 'node:module';
import { access, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

if (!process.env.PGLITE_DIR) {
  throw new Error('Set PGLITE_DIR to a test-only node_modules directory containing @electric-sql/pglite, or run scripts/test-action-archive-db.sh with local PostgreSQL.');
}
const require = createRequire(join(resolve(process.env.PGLITE_DIR), 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
// Pending files are promoted with a timestamp. Resolve the same named migration
// after promotion without copying its SQL into the test or pinning a stale path.
async function migration(suffix) {
  const pending = new URL('../../supabase/pending/' + suffix, import.meta.url);
  try { await access(pending); return 'supabase/pending/' + suffix; } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const files = await readdir(new URL('../../supabase/migrations/', import.meta.url));
  const matches = files.filter(name => name === suffix || name.endsWith('_' + suffix));
  if (matches.length !== 1) throw new Error('Expected one migration for ' + suffix + ', found ' + matches.length);
  return 'supabase/migrations/' + matches[0];
}
const archiveMigration = await migration('action_archive_cohort_v1.sql');
const resetMigration = await migration('action_mission_reset_v1.sql');
async function run(paths, label) {
  const db = new PGlite();
  try {
    await db.exec("select set_config('request.jwt.claims','{}',false)");
    for (const path of paths) {
      const sql = await readFile(new URL('../../' + path, import.meta.url), 'utf8');
      // gen_random_uuid() is built into PostgreSQL. These tests need no pgcrypto
      // functions, so the shared role fixture's optional extension is unnecessary.
      await db.exec(sql.replace(/create extension if not exists pgcrypto;/gi, ''));
    }
    console.log('PASS: ' + label);
  } finally {
    await db.close();
  }
}
await run([
    'supabase/tests/supabase_api_roles.stub.sql',
    'supabase/tests/action_archive.stub.sql',
    archiveMigration,
    archiveMigration,
    'supabase/tests/action_archive.behaviour.sql'
], 'archive publication, claim/replay, owner edits, reseeding and API-role boundaries');
await run([
  'supabase/tests/supabase_api_roles.stub.sql',
  'supabase/tests/mnet_network_tables.stub.sql',
  'supabase/migrations/20261002061056_action_network_gamification_v1.sql',
  'supabase/migrations/20261016020407_action_partner_opportunity_drafts_v1.sql',
  'supabase/tests/action_mission_reset.stub.sql',
  resetMigration,
  resetMigration,
  'supabase/tests/action_mission_reset.behaviour.sql'
], 'three open missions, preserved proof access, idempotent acceptance, private arsenal and held CfAL draft');
