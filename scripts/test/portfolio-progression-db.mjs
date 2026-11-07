// Optional local SQL behavior check: PORTFOLIO_TOOLS=/path/to/node_modules node scripts/test/portfolio-progression-db.mjs
const {PGlite}=await import((process.env.PORTFOLIO_TOOLS||'/tmp/portfolio-tools/node_modules')+'/@electric-sql/pglite/dist/index.js');
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.orgs(id uuid primary key,slug text);create table public.org_members(org_id uuid,profile_id uuid,role text);grant select on orgs,org_members to service_role;insert into auth.users values('00000000-0000-4000-8000-000000000001');insert into orgs values('00000000-0000-4000-8000-000000000002','mccluster');insert into org_members values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','owner');`);
const sql=await readFile(new URL('../../supabase/pending/learning_portfolio_v1.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
await db.exec('set role service_role');
const call=async(rev,action,snapshot=null)=> (await db.query('select public.learning_portfolio_write($1,$2,$3,$4,$5) as result',[rev,'00000000-0000-4000-8000-000000000001',action,{courses:[]},snapshot])).rows[0].result;
// Invalid RPC inputs must fail before the initial INSERT and never bypass CAS.
await assert.rejects(call(null,'save'),e=>e.code==='22023');
assert.equal((await db.query('select count(*)::integer as n from learning_portfolio')).rows[0].n,0);
assert.equal((await call(0,'save')).revision,1);
const beforeInvalid=(await db.query('select * from learning_portfolio')).rows;
for(const [revision,action] of [[null,'save'],[-1,'save'],[1,null]]) {
  await assert.rejects(call(revision,action),e=>e.code==='22023');
  assert.deepEqual((await db.query('select * from learning_portfolio')).rows,beforeInvalid);
}
assert.equal(await call(0,'publish',{safe:true}),null);
assert.equal((await call(1,'publish',{safe:true})).revision,2);
assert.deepEqual((await db.query('select published from learning_portfolio')).rows[0].published,{safe:true});
await call(2,'unpublish');assert.equal((await db.query('select published from learning_portfolio')).rows[0].published,null);
for(const role of ['anon','authenticated']) {await db.exec('reset role;set role '+role);await assert.rejects(db.query('select * from learning_portfolio'),/permission denied/);await assert.rejects(call(3,'save'),/permission denied/);}
await db.exec('reset role;set role service_role');await assert.rejects(db.query("select learning_portfolio_write(3,'00000000-0000-4000-8000-000000000003','save','{}',null)"),/owner required/);
console.log('PASS: SQL applies twice; save/publish/revoke; stale/null/negative revision and null action leave rows unchanged; anon/authenticated table and RPC denial; non-owner denial.');await db.close();
