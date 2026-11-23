import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { nativeTestDb, migrationPath } from './native-admin-test-db.mjs';
import fs from 'node:fs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Disposable WASM or local native PostgreSQL; never connects to canonical Supabase.
// Use the real pgcrypto extension and unchanged pending SQL.
let db;
if(process.env.NATIVE_TEST_DATABASE_URL) db=await nativeTestDb('scheduler');
else {
 const modulePath=process.env.PGLITE_MODULE_PATH;
 if(!modulePath||!path.isAbsolute(modulePath)) throw Error('Set PGLITE_MODULE_PATH to pinned PGlite');
 const {PGlite}=await import(pathToFileURL(modulePath));
 const {pgcrypto}=await import(pathToFileURL(path.join(path.dirname(modulePath),'contrib/pgcrypto.js')));
 db=new PGlite({extensions:{pgcrypto}});
}
const read=(file)=>fs.readFileSync(`${root}/${file}`,'utf8');
try {
 await db.exec(`do $$ begin create role anon;create role authenticated;create role service_role;exception when duplicate_object then null;end $$;create schema extensions;create table public.orgs(id uuid primary key);`);
 // migrationPath matches `_<suffix>.sql`; the pending file carries no timestamp prefix
 // yet, so its suffix after `compute_` resolves it now and after promotion alike.
 const pending=await migrationPath('scheduler_lease_v1');
 const rollback='supabase/pending/compute_scheduler_lease_v1.rollback.sql';
 await db.exec(read(pending));console.log(`loaded ${pending}`);
 await db.exec(read('supabase/tests/compute_scheduler_lease.behaviour.sql'));
 console.log('compute scheduler lease SQL behavioral assertions: PASS');
 await db.exec(read(rollback));console.log(`applied ${rollback}`);
 const left=(await db.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'compute_scheduler_%'")).rows[0].n;
 if(left!==0) throw Error(`rollback left ${left} compute_scheduler_* functions`);
 if((await db.query("select to_regclass('public.ops_compute_scheduler_leases') as t")).rows[0].t!==null) throw Error('rollback left the table');
 await db.exec(read(pending));
 await db.exec(read('supabase/tests/compute_scheduler_lease.behaviour.sql'));
 console.log('rollback, re-apply and second behaviour run: PASS');
} finally {await db.close();}
