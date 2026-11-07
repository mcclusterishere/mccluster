// Disposable native PostgreSQL only: fresh cluster, private Unix socket, TCP disabled.
// Dependencies: @embedded-postgres/linux-x64@17.6.0-beta.15 and postgres@3.4.7.
// ARCADE_NATIVE_MODULES=/tmp/arcade-native-qa/node_modules node scripts/test/city-arcade-native.integration.mjs
// Auth/tenancy are minimal local fixtures; this does not attest the production schema.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {TEA_MISSION} from '../../js/city-arcade/tea-action.mjs';
const modules=process.env.ARCADE_NATIVE_MODULES;
assert.ok(modules,'ARCADE_NATIVE_MODULES must point to pinned native test dependencies');
const bin=resolve(modules,'@embedded-postgres/linux-x64/native/bin');
const {default:postgres}=await import(pathToFileURL(resolve(modules,'postgres/src/index.js')));
const scratch=await mkdtemp(join(tmpdir(),'arcade-native-'));
const nativeLib=resolve(bin,'../lib');
for(const name of ['libicuuc','libicui18n','libicudata'])await symlink(join(nativeLib,name+'.so.60.2'),join(scratch,name+'.so.60'));
const processEnv={...process.env,LD_LIBRARY_PATH:scratch+':'+nativeLib};
const cluster=join(scratch,'data'),owner='11111111-1111-4111-8111-111111111111';
const id='bridgeport-main-elm';
const doc={version:1,gameId:'gauranfucking-tea-tea-rush',locationId:id,tea:structuredClone(TEA_MISSION)};
let started=false;const clients=[];
const connect=label=>{const c=postgres({host:scratch,port:5432,user:'arcade_test',database:'postgres',max:1,onnotice(){},connection:{application_name:'arcade-native-'+label,statement_timeout:15000}});clients.push(c);return c;};
try{
 execFileSync(join(bin,'initdb'),['-D',cluster,'-U','arcade_test','-A','trust','--no-locale'],{stdio:'pipe',env:processEnv});
 execFileSync(join(bin,'pg_ctl'),['-D',cluster,'-l',join(scratch,'server.log'),'-o',`-k ${scratch} -c listen_addresses=''`,'-w','start'],{stdio:'pipe',env:processEnv});started=true;
 const admin=connect('admin'),a=connect('a'),b=connect('b');
 console.log((await admin`select version() as v`)[0].v);
 await admin.unsafe(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create table public.orgs(id uuid primary key,slug text,enabled boolean not null default true);
 create table public.org_members(org_id uuid,profile_id uuid,role text);
 grant select on public.orgs,public.org_members to service_role;grant usage on schema auth to service_role;
 insert into auth.users values('${owner}');insert into orgs(id,slug) values('${owner}','mccluster');
 insert into org_members values('${owner}','${owner}','owner');`);
 const source=await readFile(new URL('../../supabase/pending/city_arcade_v1.sql',import.meta.url),'utf8');
 assert.equal(await readFile(new URL('../../supabase/migrations/20261107133314_city_arcade_v1.sql',import.meta.url),'utf8'),source,'promoted candidate must match the reviewed pending SQL');
 await admin.unsafe(source);
 for(const c of [a,b])await c.unsafe('set role service_role');
 const call=(c,action,run=id,body=null,revision=null)=>c.unsafe('select public.arcade_command($1,$2,$3,$4::jsonb,$5) as result',[action,owner,run,body===null?null:c.json(body),revision]);
 const waitBlocked=async()=>{
  const until=Date.now()+5000;
  do{const n=(await admin.unsafe("select count(*)::int as n from pg_stat_activity where application_name in ('arcade-native-a','arcade-native-b') and wait_event_type='Lock'"))[0].n;if(n===2)return;await new Promise(r=>setTimeout(r,20));}while(Date.now()<until);
  throw Error('Two independent connections never reached PostgreSQL lock waits');
 };
 // Hold the exact first-save advisory lock until both independent sessions queue.
 await admin.unsafe('begin');await admin.unsafe("select pg_advisory_xact_lock(hashtext('arcade:'||$1))",[id]);
 const saves=Promise.allSettled([call(a,'save',id,doc,0).execute(),call(b,'save',id,doc,0).execute()]);
 await waitBlocked();await admin.unsafe('commit');const outcomes=await saves;
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(outcomes.map(x=>({status:x.status,error:x.reason?.message,code:x.reason?.code}))));
 assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'40001');
 assert.equal((await admin`select count(*)::int as n from arcade_mission_versions`)[0].n,1);
 console.log('PASS concurrent first saves: one revision and one conflict');
 const run=(await call(a,'start',id,null,1))[0].result;
 const revised={...doc,tea:{...doc.tea,reward:doc.tea.reward+1}};
 await call(a,'save',id,revised,1);
 const result={status:'won',served:doc.tea.route.length};
 await admin.unsafe('begin');await admin.unsafe('select id from arcade_runs where id=$1 for update',[run.id]);
 const finishes=Promise.all([call(a,'finish',run.id,result).execute(),call(b,'finish',run.id,result).execute()]);
 await waitBlocked();await admin.unsafe('commit');const finished=await finishes;
 assert.deepEqual(finished[0][0].result,finished[1][0].result);
 assert.equal(Number(finished[0][0].result.score),doc.tea.reward*doc.tea.route.length);
 assert.equal((await admin`select count(*)::int as n from arcade_runs where status='won'`)[0].n,1);
 console.log('PASS simultaneous duplicate finish: identical single result at frozen revision');
 await admin`update orgs set enabled=false`;
 await assert.rejects(call(a,'history').execute(),e=>e.code==='42501');
 await admin`update orgs set enabled=true`;await admin`update org_members set role='staff'`;
 await assert.rejects(call(a,'history').execute(),e=>e.code==='42501');
 console.log('PASS disabled house and revoked membership denied');
 for(const role of ['anon','authenticated']){
  await admin.unsafe('set role '+role);
  await assert.rejects(admin.unsafe('select * from arcade_runs').execute(),e=>e.code==='42501');
  await admin.unsafe('reset role');
 }
 console.log('PASS direct client reads denied');
}finally{
 await Promise.all(clients.map(c=>c.end({timeout:1})));
 if(started)execFileSync(join(bin,'pg_ctl'),['-D',cluster,'-m','immediate','-w','stop'],{stdio:'pipe',env:processEnv});
 await rm(scratch,{recursive:true,force:true});
}
