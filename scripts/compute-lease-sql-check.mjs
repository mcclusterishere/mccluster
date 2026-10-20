import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const modulePath = process.env.PGLITE_MODULE_PATH;
if (!modulePath || !path.isAbsolute(modulePath)) throw new Error('Set PGLITE_MODULE_PATH to the absolute path of pinned @electric-sql/pglite 0.5.10 dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath));
const { pgcrypto } = await import(pathToFileURL(path.join(path.dirname(modulePath), 'contrib/pgcrypto.js')));
import fs from 'node:fs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Disposable WASM PostgreSQL only; never connects to canonical Supabase.
// Use the real pgcrypto extension and unchanged migration SQL.
const db=new PGlite({ extensions: { pgcrypto } });
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema extensions;create table public.orgs(id uuid primary key);`);
 for(const f of ['supabase/replay_migrations/20260912071000_compute_node_protocol.sql','supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql','supabase/pending/20261020193442_compute_lease_authority_v2.sql']) {
  await db.exec(fs.readFileSync(`${root}/${f}`,'utf8'));console.log(`loaded ${f}`);
 }
 await db.exec(fs.readFileSync(`${root}/supabase/tests/compute_lease_authority.behaviour.sql`,'utf8'));
 console.log('compute lease SQL behavioral assertions: PASS');
} finally {await db.close();}
