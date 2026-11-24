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
 // Canonical Supabase hands every new public table, function and sequence to
 // anon, authenticated and service_role through default privileges (the repo's
 // hardening migrations only strip truncate/references/trigger from the two
 // API roles). Install the same defaults here so the privilege assertions in
 // the behaviour file prove the pending SQL against the database it targets,
 // not against an empty fixture where nothing is granted to begin with.
 await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;`);
 // migrationPath matches `_<suffix>.sql`; the pending file carries no timestamp prefix
 // yet, so its suffix after `compute_` resolves it now and after promotion alike.
 const pending=await migrationPath('scheduler_lease_v1');
 const rollback='supabase/pending/compute_scheduler_lease_v1.rollback.sql';
 await db.exec(read(pending));console.log(`loaded ${pending}`);
 const leak=(await db.query("select has_table_privilege('service_role','public.ops_compute_scheduler_leases','insert') as i, has_table_privilege('service_role','public.ops_compute_scheduler_leases','update') as u, has_table_privilege('service_role','public.ops_compute_scheduler_leases','delete') as d, has_table_privilege('service_role','public.ops_compute_scheduler_leases','select') as s")).rows[0];
 if(leak.i||leak.u||leak.d||!leak.s) throw Error(`service_role table privileges under Supabase defaults: ${JSON.stringify(leak)}`);
 console.log('service_role holds select only on ops_compute_scheduler_leases under Supabase default privileges: PASS');
 await db.exec(read('supabase/tests/compute_scheduler_lease.behaviour.sql'));
 console.log('compute scheduler lease SQL behavioral assertions: PASS');
 if(db.native) {
  // Two real connections: a status read left open in a transaction must not
  // block the holder's renew (status is a plain select, no FOR UPDATE).
  const org='00000000-0000-0000-0000-000000000055';
  await db.exec(`insert into public.orgs(id) values ('${org}') on conflict do nothing`);
  const fresh=(await db.query(`select public.compute_scheduler_acquire('${org}','core-native','primary',30) as r`)).rows[0].r;
  if(fresh.reason!=='fresh') throw Error(`native fresh acquire: ${JSON.stringify(fresh)}`);
  const reader=db.fork();
  try {
   await db.transaction(async(tx)=>{
    const st=(await tx.query(`select public.compute_scheduler_status('${org}') as r`)).rows[0].r;
    if(st.live!==true) throw Error(`native status: ${JSON.stringify(st)}`);
    const started=Date.now();
    const renew=(await reader.query(`select public.compute_scheduler_renew('${org}','core-native',1,30) as r`)).rows[0].r;
    const waited=Date.now()-started;
    if(renew.ok!==true||renew.reason!=='renewed'||waited>5000) throw Error(`renew behind an open status read: ${JSON.stringify(renew)} after ${waited} ms`);
   });
   console.log('native two-connection proof: renew not blocked by an open status read: PASS');
  } finally {
   await reader.close();
   await db.exec(`delete from public.orgs where id='${org}'`);
  }
 } else console.log('native two-connection lock proof: skipped (PGlite is single-connection; set NATIVE_TEST_DATABASE_URL to run it)');
 await db.exec(read(rollback));console.log(`applied ${rollback}`);
 const left=(await db.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'compute_scheduler_%'")).rows[0].n;
 if(left!==0) throw Error(`rollback left ${left} compute_scheduler_* functions`);
 if((await db.query("select to_regclass('public.ops_compute_scheduler_leases') as t")).rows[0].t!==null) throw Error('rollback left the table');
 await db.exec(read(pending));
 await db.exec(read('supabase/tests/compute_scheduler_lease.behaviour.sql'));
 console.log('rollback, re-apply and second behaviour run: PASS');
} finally {await db.close();}
