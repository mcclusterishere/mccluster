import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nativeTestDb, migrationPath } from './native-admin-test-db.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Proof for the PENDING supabase/pending/compute_claim_task_yield_v3.sql on a
// disposable WASM or local native PostgreSQL; never connects to canonical
// Supabase and never applies anything there. Same base chain as
// compute-lease-sql-check.mjs, then: apply the pending file, run its behaviour
// assertions and the existing lease assertions on the new function, roll back,
// prove the 5-argument call is gone, re-apply (idempotence), assert again.
const FOUR='p_node_id text, p_capabilities text[], p_implementations text[], p_lease_seconds integer';
const FIVE=`${FOUR}, p_yield_seconds integer`;
let db;
if(process.env.NATIVE_TEST_DATABASE_URL) db=await nativeTestDb('compute_yield');
else {
 const modulePath=process.env.PGLITE_MODULE_PATH;
 if(!modulePath||!path.isAbsolute(modulePath)) throw Error('Set PGLITE_MODULE_PATH to pinned PGlite');
 const {PGlite}=await import(pathToFileURL(modulePath));
 const {pgcrypto}=await import(pathToFileURL(path.join(path.dirname(modulePath),'contrib/pgcrypto.js')));
 db=new PGlite({extensions:{pgcrypto}});
}
const read=(file)=>fs.readFileSync(`${root}/${file}`,'utf8');
const identity=async()=>(await db.query("select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='compute_claim_task' order by 1")).rows.map(r=>r.args);
try {
 await db.exec(`do $$ begin create role anon;create role authenticated;create role service_role;exception when duplicate_object then null;end $$;create schema extensions;create table public.orgs(id uuid primary key);`);
 for(const f of ['supabase/replay_migrations/20260912071000_compute_node_protocol.sql','supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql',await migrationPath('compute_lease_authority_v2')]) {
  await db.exec(read(f));console.log(`loaded ${f}`);
 }
 assert.deepEqual(await identity(),[FOUR],'base chain ends on the v2 4-argument function');
 const pending='supabase/pending/compute_claim_task_yield_v3.sql';
 const rollback='supabase/pending/compute_claim_task_yield_v3.rollback.sql';
 await db.exec(read(pending));console.log(`applied ${pending}`);
 assert.deepEqual(await identity(),[FIVE],'exactly one compute_claim_task, 5 identity arguments');
 await db.exec(read('supabase/tests/compute_claim_task_yield.behaviour.sql'));
 console.log('compute claim yield SQL behavioral assertions: PASS');
 await db.exec(read('supabase/tests/compute_lease_authority.behaviour.sql'));
 console.log('compute lease v2 behavioral assertions on the v3 function: PASS');
 await db.exec(read(rollback));console.log(`applied ${rollback}`);
 assert.deepEqual(await identity(),[FOUR],'rollback restores the 4-argument identity');
 await assert.rejects(db.query("select public.compute_claim_task('node_x',array['ai.chat'],array['x'],120,30)"),/does not exist/,'the 5-argument call is gone after rollback');
 await db.exec(read('supabase/tests/compute_lease_authority.behaviour.sql'));
 console.log('compute lease v2 behavioral assertions after rollback: PASS');
 await db.exec(read(pending));
 assert.deepEqual(await identity(),[FIVE],'re-apply after rollback');
 await db.exec(read('supabase/tests/compute_claim_task_yield.behaviour.sql'));
 console.log('rollback, re-apply and second behaviour run: PASS');
} finally {await db.close();}
