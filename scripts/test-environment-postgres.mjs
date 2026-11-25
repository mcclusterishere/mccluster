// Isolated local PostgreSQL behavior tests. Never connect to production.
// ENVIRONMENT_PG_SOCKET must be an absolute /tmp Unix socket directory;
// POSTGRES_MODULE_PATH points at an already installed official postgres package.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ENVIRONMENT_ACTIONS } from '../workers/mccluster/src/world-environment.js';
const socket = process.env.ENVIRONMENT_PG_SOCKET;
assert.match(socket || '', /^\/tmp\/[a-zA-Z0-9_/-]+$/);
const { default: postgres } = await import(pathToFileURL(process.env.POSTGRES_MODULE_PATH));
const config = { host:socket, port:54329, username:'postgres', database:'postgres',max:1,onnotice:()=>{} };
const admin=postgres(config), name=`environment_test_${process.pid}`;
await admin.unsafe(`create database ${name}`);
const db=postgres({...config,database:name});const connections=[];
const owner='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',other='10000000-0000-4000-8000-000000000003',house='10000000-0000-4000-8000-000000000004';
let passed=0;
const check=async(name,fn)=>{await fn();console.log(`PASS ${++passed} ${name}`);};
const session=async(role,user=member)=>{const c=postgres({...config,database:name});connections.push(c);await c.unsafe(`set role ${role}`);await c`select set_config('request.jwt.claim.sub',${user},false)`;return c;};
const event=(id='usgs:fixture')=>({id,title:'Public quake report',observed_at:new Date().toISOString(),fetched_at:new Date().toISOString(),stale:false,source:{id:'usgs',url:'https://earthquake.usgs.gov/'},expires_at:null});
const propose=async(c,actor=member,e=event())=>(await c`select public.world_environment_propose(${actor}::uuid,${c.json(e)}::jsonb,${c.json(ENVIRONMENT_ACTIONS[0])}::jsonb) as value`)[0].value;
const team=async(c,join=null)=>(await c`select public.world_environment_team(${join}::boolean) as value`)[0].value;
const join=async(c,id)=>(await c`select public.world_environment_join(${id}::uuid) as value`)[0].value;
const review=async(c,id,status='open',actor=owner)=>(await c`select public.world_environment_review(${actor}::uuid,${id}::uuid,${status}) as value`)[0].value;
try {
 await db.unsafe(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function public.current_m_uid() returns uuid language sql as $$ select auth.uid() $$;
 create table public.m_people(id uuid primary key);create table public.action_campaigns(id text primary key);
 create table public.m_auth_user_links(auth_user_id uuid,m_uid uuid,is_primary boolean);
 create table public.orgs(id uuid primary key,slug text);create table public.org_members(org_id uuid,profile_id uuid,role text);
 grant usage on schema public,auth to anon,authenticated,service_role;`);
 const canonical=await readFile(new URL('../supabase/migrations/20261002061056_action_network_gamification_v1.sql',import.meta.url),'utf8');
 await db.unsafe(canonical.slice(canonical.indexOf('create table public.action_missions'),canonical.indexOf('alter table public.action_missions enable')));
 const groups=await readFile(new URL('../supabase/migrations/20260925040000_mnet_handles_groups_and_welcome.sql',import.meta.url),'utf8');
 await db.unsafe(groups.slice(groups.indexOf('create table if not exists public.network_groups'),groups.indexOf('-- A post can belong to a group.')));
 await db.unsafe(`create table public.action_globe_mission_regions(mission_id uuid);create function public.action_globe_can_join_mission(uuid,uuid) returns boolean language sql as $$ select false $$;
 grant select,insert,update,delete on all tables in schema public to service_role;`);
 await db.unsafe(await readFile(new URL('../supabase/migrations/20261014184518_action_globe_join_authorization.sql',import.meta.url),'utf8'));
 for(const user of [owner,member,other]) {await db`insert into auth.users values(${user})`;await db`insert into public.m_people values(${user})`;await db`insert into public.m_auth_user_links values(${user},${user},true)`;}
 await db`insert into public.orgs values(${house},'mccluster')`;await db`insert into public.org_members values(${house},${owner},'owner'),(${house},${member},'staff')`;
 await db.unsafe(await readFile(new URL('../supabase/pending/20261107120000_world_environment_v1.sql',import.meta.url),'utf8'));
 const service=await session('service_role'),a=await session('authenticated'),b=await session('authenticated',other),second=await session('service_role'),anon=await session('anon');
 await check('anon and authenticated cannot forge provenance or owner reviews',async()=>{for(const c of [anon,a]) {await assert.rejects(propose(c));await assert.rejects(c`select * from public.action_environment_missions`);}await assert.rejects(team(anon));});
 await check('team membership survives fresh connection, repeats safely, and is self-only',async()=>{assert.equal((await team(a,true)).joined,true);assert.equal((await team(a,true)).joined,true);assert.equal((await team(b)).joined,false);const fresh=await session('authenticated');assert.equal((await team(fresh)).joined,true);assert.equal((await db`select count(*)::int as n from network_group_members`)[0].n,1);});
 await check('banned member cannot rejoin or leave to evade ban; invite group not self-joinable',async()=>{await db`update network_group_members set state='banned' where m_uid=${member}`;await assert.rejects(team(a,true),/membership_blocked/);await assert.rejects(team(a,false),/membership_blocked/);await db`update network_group_members set state='joined' where m_uid=${member}`;await db`update network_groups set visibility='invite'`;await assert.rejects(team(b,true),/team_unavailable/);await db`update network_groups set visibility='open'`;});
 let mission;
 await check('proposal is a canonical draft, duplicate retry and race create one mission',async()=>{const results=await Promise.all([propose(service),propose(second)]);assert.equal(results[0].mission_id,results[1].mission_id);mission=results[0].mission_id;assert.equal((await db`select status from action_missions where id=${mission}`)[0].status,'draft');assert.equal((await db`select count(*)::int as n from action_environment_missions`)[0].n,1);await assert.rejects(join(a,mission),/approved_environment_mission_required/);});
 await check('member and unprivileged account cannot approve; owner role rechecked in SQL',async()=>{await assert.rejects(review(service,mission,'open',member),/owner_only/);await assert.rejects(review(a,mission));await review(service,mission);assert.equal((await db`select count(*)::int as n from action_environment_reviews`)[0].n,1);});
 await check('concurrent capacity-one joins produce one assignment; reload reveals own only',async()=>{await team(b,true);await db`update action_missions set capacity=1 where id=${mission}`;const results=await Promise.allSettled([join(a,mission),join(b,mission)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/full/);const ownA=await team(a),ownB=await team(b);assert.equal(ownA.assignments.length+ownB.assignments.length,1);const winner=ownA.assignments.length?a:b;const repeated=await join(winner,mission);assert.equal(repeated.assignment_id,results.find(r=>r.status==='fulfilled').value.assignment_id);});
 await check('immutable source survives pause; source links cannot be rewritten',async()=>{await assert.rejects(db`update action_environment_missions set event_id='changed' where mission_id=${mission}`,/immutable_environment_provenance/);await review(service,mission,'paused');await assert.rejects(join(a,mission),/not open/);});
 await check('old source cannot be approved even via service-role direct RPC',async()=>{const e=event('usgs:old');e.observed_at=new Date(Date.now()-2*86400000).toISOString();const m=await propose(service,member,e);await assert.rejects(review(service,m.mission_id),/source_expired/);});
 await check('expired mission cannot be approved and stale proposal is rejected',async()=>{const e=event('usgs:expired');e.expires_at=new Date(Date.now()-1000).toISOString();const m=await propose(service,member,e);await assert.rejects(review(service,m.mission_id),/source_expired|mission_expired/);await assert.rejects(propose(service,member,{...event('usgs:stale'),stale:true}),/current_event_required/);});
 await check('generic canonical join cannot bypass environmental team membership',async()=>{
   await review(service,mission,'open');
   await team(a,false);await team(b,false);
   await db`update action_mission_assignments set status='withdrawn' where mission_id=${mission}`;
   for(const c of [a,b]) await assert.rejects(c`select public.join_action_mission(${mission}::uuid)`,/join_team_first/);
   await team(a,true);await join(a,mission);await team(a,false);
   await db`update action_mission_assignments set status='submitted' where mission_id=${mission}`;
 });
 await check('leave removes membership but preserves assignment history; nonmember cannot join',async()=>{assert.equal((await team(a,false)).joined,false);await assert.rejects(join(a,mission),/join_team_first/);assert.equal((await db`select count(*)::int as n from action_mission_assignments`)[0].n,1);});
 console.log(`PASS ${passed} PostgreSQL behavior checks. Isolated fixture uses canonical group/mission table DDL and current join RPC; not a full production migration replay.`);
} finally {for(const c of connections)await c.end();await db.end();await admin.unsafe(`drop database ${name}`);await admin.end();}
