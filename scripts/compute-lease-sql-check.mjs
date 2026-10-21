import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { nativeTestDb, migrationPath, waitForBlocked } from './native-admin-test-db.mjs';
import fs from 'node:fs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Disposable WASM or local native PostgreSQL; never connects to canonical Supabase.
// Use the real pgcrypto extension and unchanged migration SQL.
let db;
if(process.env.NATIVE_TEST_DATABASE_URL) db=await nativeTestDb('compute');
else {
 const modulePath=process.env.PGLITE_MODULE_PATH;
 if(!modulePath||!path.isAbsolute(modulePath)) throw Error('Set PGLITE_MODULE_PATH to pinned PGlite');
 const {PGlite}=await import(pathToFileURL(modulePath));
 const {pgcrypto}=await import(pathToFileURL(path.join(path.dirname(modulePath),'contrib/pgcrypto.js')));
 db=new PGlite({extensions:{pgcrypto}});
}
try {
 await db.exec(`do $$ begin create role anon;create role authenticated;create role service_role;exception when duplicate_object then null;end $$;create schema extensions;create table public.orgs(id uuid primary key);`);
 for(const f of ['supabase/replay_migrations/20260912071000_compute_node_protocol.sql','supabase/migrations/20260919021007_compute_capability_concurrency_live_reconcile.sql',await migrationPath('compute_lease_authority_v2')]) {
  await db.exec(fs.readFileSync(`${root}/${f}`,'utf8'));console.log(`loaded ${f}`);
 }
 await db.exec(fs.readFileSync(`${root}/supabase/tests/compute_lease_authority.behaviour.sql`,'utf8'));
 console.log('compute lease SQL behavioral assertions: PASS');
 if(db.native) {
  const org='f0000000-0000-4000-8000-000000000001',task='f0000000-0000-4000-8000-000000000002';
  const node='node_dddddddddddddddddddddddddddddddd', replacement='node_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  await db.query('insert into public.orgs(id) values($1)',[org]);
  for(const id of [node,replacement]) await db.query(`insert into public.ops_compute_nodes(id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version,capabilities) values($1,$2,$1,'fixture',$1,'mccluster-compute/1','test','[{"capability":"ai.chat","implementation":"fixture.local","max_concurrency":1}]')`,[id,org]);
  await db.query("insert into public.ops_compute_tasks(id,org_id,capability) values($1,$2,'ai.chat')",[task,org]);
  const claim=(await db.query("select public.compute_claim_task($1,array['ai.chat'],array['fixture.local']) as r",[node])).rows[0].r;
  await db.query('select public.compute_start_lease($1,$2,$3)',[node,claim.lease_id,claim.lease_token]);
  const peer=db.fork(),observer=db.fork();
  let release;const hold=new Promise(resolve=>{release=resolve;});
  let held;const ready=new Promise(resolve=>{held=resolve;});
  const blocking=db.transaction(async tx=>{
   await tx.query('select id from public.ops_compute_nodes where id=$1 for update',[node]);
   held();await hold;
   await tx.query("update public.ops_compute_leases set expires_at=now()-interval '1 second' where id=$1",[claim.lease_id]);
   await tx.query("select public.compute_claim_task($1,array['ai.chat'],array['fixture.local'])",[replacement]);
   await tx.query("update public.ops_compute_tasks set run_after=now()-interval '1 second' where id=$1",[task]);
   const next=(await tx.query("select public.compute_claim_task($1,array['ai.chat'],array['fixture.local']) as r",[replacement])).rows[0].r;
   assert.equal(next.attempt,2);
  });
  try {
   await ready;
   const stale=peer.query("select public.compute_complete_lease($1,$2,$3,'{\"stale\":true}') as accepted",[node,claim.lease_id,claim.lease_token]);
   try {await waitForBlocked(observer);}finally{release();}
   await blocking;
   assert.equal((await stale).rows[0].accepted,false);
   const state=(await db.query('select status,attempts,locked_by_node_id,output from public.ops_compute_tasks where id=$1',[task])).rows[0];
   assert.equal(state.status,'leased');assert.equal(state.attempts,2);assert.equal(state.locked_by_node_id,replacement);assert.equal(state.output,null);
   console.log('native compute: completion blocked on real row lock, expiry/reassignment committed, stale result rejected');
  } finally {release();await peer.close();await observer.close();}
 }
} finally {await db.close();}
