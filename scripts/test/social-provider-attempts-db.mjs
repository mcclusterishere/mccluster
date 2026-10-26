// Real baseline/replay/pending SQL in disposable PostgreSQL WASM. No provider I/O.
import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import assert from 'node:assert/strict';
const {PGlite}=createRequire(resolve(process.env.PGLITE_DIR||'/tmp/first-offer-tools/node_modules','fixture.cjs'))('@electric-sql/pglite');const db=new PGlite();
const ORG='11111111-1111-4111-8111-111111111111',ACC='22222222-2222-4222-8222-222222222222',USER='33333333-3333-4333-8333-333333333333';
const sql=async file=>db.exec(await readFile(file,'utf8'));
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 create table orgs(id uuid primary key);create table org_members(org_id uuid,profile_id uuid,role text);
 create table media_assets(id uuid primary key);create table media_jobs(id uuid primary key);create table inbox_contacts(id uuid primary key);create table inbox_conversations(id uuid primary key);create table leads(id uuid primary key);
 create function private.is_org_member(uuid) returns boolean language sql as $$select true$$;
 create function private.is_org_owner(uuid) returns boolean language sql as $$select true$$;
 create table org_channels(org_id uuid,channel text,enabled boolean,secret_id uuid,token_env text,account_id text,primary key(org_id,channel));`);
 await sql('supabase/migrations/20260906174445_social_growth_engine.sql');
 await sql('supabase/replay_migrations/20260907040300_social_hardening.sql');
 await sql('supabase/replay_migrations/20260908220000_reconcile_social_credential_and_lease.sql');
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create table m_people(id uuid primary key);create table action_campaigns(id text primary key);create table action_missions(id uuid primary key,campaign_id text);create table network_posts(id uuid primary key);create table action_mission_assignments(id uuid primary key,status text);`);
 // Exact content tables/columns/guards from the real migration; its unrelated
 // action-attribution RPCs require the broader Action Network fixture.
 await db.exec((await readFile('supabase/migrations/20261003230844_creator_action_distribution_v1.sql','utf8')).split('create or replace function public.join_action_mission_attributed(')[0]);
 await db.query('insert into orgs values($1)',[ORG]);await db.query("insert into org_members values($1,$2,'owner')",[ORG,USER]);
 await db.query("insert into social_accounts(id,org_id,platform,external_account_id,status) values($1,$2,'instagram','123','connected')",[ACC,ORG]);
 await db.query("insert into org_channels values($1,'instagram',true,null,'SOCIAL_IG_TEST_ACCESS_TOKEN','123')",[ORG]);
 const job=async(overrides={})=>(await db.query("insert into social_publish_jobs(org_id,account_id,payload,state,external_creation_id,attempts) values($1,$2,$3,$4,$5,$6) returning *",[ORG,ACC,JSON.stringify({caption:'Fixture',...overrides.payload}),overrides.state||'queued',overrides.container||null,overrides.attempts||0])).rows[0];
 const legacy=await job(),known=await job({state:'processing',container:'456'});
 await sql('supabase/pending/social_provider_attempts_v1.sql');
 assert.equal((await db.query('select state from social_publish_jobs where id=$1',[legacy.id])).rows[0].state,'failed');
 assert.equal((await db.query('select count(*)::int n from private.social_provider_attempts where job_id=$1',[known.id])).rows[0].n,0);
 const rpc=async(action,j,extra={})=>(await db.query('select social_provider_attempt_v1($1,$2,$3,$4,$5,$6,$7,$8) r',[action,j.id,extra.lease===undefined?'worker-a':extra.lease,extra.stage||null,JSON.stringify(extra.expected||{}),extra.attempt||null,extra.external||null,extra.actor||null])).rows[0].r;
 const expected=j=>({account_id:ACC,platform:'instagram',external_account_id:'123',credential_binding:'env:SOCIAL_IG_TEST_ACCESS_TOKEN',payload:j.payload});
 const claim=async owner=>(await db.query('select * from claim_social_publish_jobs($1,25,120)',[owner])).rows;
 const j=await job();const claimed=await claim('worker-a');assert.ok(claimed.some(x=>x.id===j.id));assert.ok(claimed.some(x=>x.id===known.id));assert.equal((await claim('worker-b')).length,0);
 for(const bad of [{external_account_id:'999'},{payload:{caption:'Changed'}},{credential_binding:'env:STRIPE_SECRET_KEY'},{account_id:USER}])await assert.rejects(()=>rpc('begin',j,{stage:'container',expected:{...expected(j),...bad}}),/changed|unavailable/);
 const started=await rpc('begin',j,{stage:'container',expected:expected(j)});assert.equal(started.action,'send');
 assert.equal((await rpc('begin',j,{stage:'container',expected:expected(j)})).action,'hold');
 await assert.rejects(()=>db.query("update social_publish_jobs set payload='{}' where id=$1",[j.id]),/immutable/);
 await assert.rejects(()=>db.query("update social_accounts set external_account_id='999' where id=$1",[ACC]),/immutable/);
 await assert.rejects(()=>db.query('delete from social_publish_jobs where id=$1',[j.id]),/foreign key/);
 const receipt=await rpc('receipt',j,{attempt:started.id,external:'4567'});assert.equal(receipt.state,'accepted');assert.deepEqual(await rpc('receipt',j,{attempt:started.id,external:'4567'}),receipt);
 // Lost confirmation response: read durable receipt; no second provider send.
 assert.equal((await rpc('status',j)).external_id,'4567');
 await db.query("update social_publish_jobs set lease_owner='worker-a',lease_expires_at=now()+interval '2 minutes' where id=$1",[j.id]);
 assert.equal((await rpc('begin',j,{stage:'container',expected:expected(j)})).action,'recover');
 const publish=await rpc('begin',j,{stage:'publish',expected:expected(j)});assert.equal(publish.action,'send');
 await rpc('unknown',j,{attempt:publish.id});await assert.rejects(()=>rpc('retry',j,{actor:USER}),/reconciliation/);
 // Even privileged state reset cannot erase the private uncertainty.
 await db.query("update social_publish_jobs set state='queued',lease_owner=null,lease_expires_at=null where id=$1",[j.id]);assert.ok(!(await claim('worker-b')).some(x=>x.id===j.id));
 // A late known receipt records the original attempt, not permission to resend.
 await rpc('receipt',j,{attempt:publish.id,external:'890'});assert.equal((await db.query('select state,external_media_id from social_publish_jobs where id=$1',[j.id])).rows[0].external_media_id,'890');
 await assert.rejects(()=>rpc('retry',j,{actor:USER}),/reconciliation/);
 // Receipt remains durable through failing local bookkeeping and disconnect.
 await db.exec(`create function public.fixture_reject_post() returns trigger language plpgsql as $$begin raise exception 'fixture bookkeeping failure';end$$;create trigger fixture_reject before insert on social_posts for each row execute function public.fixture_reject_post();`);
 await db.query("update social_accounts set status='disconnected' where id=$1",[ACC]);
 assert.ok((await claim('worker-b')).some(x=>x.id===j.id));
 await assert.rejects(()=>rpc('finalize',j,{lease:'worker-b'}),/bookkeeping failure/);
 assert.equal((await rpc('status',j)).external_id,'890');assert.equal((await db.query('select state from social_publish_jobs where id=$1',[j.id])).rows[0].state,'processing');
 await db.exec('drop trigger fixture_reject on social_posts');
 const finalized=await rpc('finalize',j,{lease:'worker-b'});assert.equal(finalized.state,'published');assert.deepEqual(await rpc('finalize',j,{lease:'worker-b'}),finalized);
 assert.equal((await db.query('select count(*)::int n from social_posts where publish_job_id=$1',[j.id])).rows[0].n,1);
 await db.query("update social_accounts set status='connected' where id=$1",[ACC]);
 await assert.rejects(()=>rpc('retry',j,{actor:ACC}),/Owner required/);
 const expired=await job();await claim('worker-a');const exp=await rpc('begin',expired,{stage:'container',expected:expected(expired)});
 await db.query("update social_publish_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[expired.id]);assert.ok(!(await claim('worker-b')).some(x=>x.id===expired.id));assert.equal((await rpc('status',expired)).state,'unknown');
 await assert.rejects(()=>rpc('begin',expired,{stage:'container',expected:expected(expired),lease:'worker-b'}),/lease changed/);
 // Known legacy container can receive definitive status; PUBLISHED is not a media ID.
 await assert.rejects(()=>rpc('terminal',known,{lease:null,external:'PUBLISHED'}),/unavailable/);
 await db.query('update social_publish_jobs set lease_expires_at=null where id=$1',[known.id]);await assert.rejects(()=>rpc('terminal',known,{external:'PUBLISHED'}),/unavailable/);
 await db.query("update social_publish_jobs set lease_expires_at=now()+interval '2 minutes' where id=$1",[known.id]);
 await rpc('terminal',known,{external:'PUBLISHED'});assert.equal((await rpc('status',known)).state,'unknown');assert.equal((await db.query('select external_media_id from social_publish_jobs where id=$1',[known.id])).rows[0].external_media_id,null);
 const terminal=await job({state:'processing',container:'expired-container'});await claim('worker-a');await rpc('terminal',terminal,{external:'EXPIRED'});assert.equal((await rpc('retry',terminal,{actor:USER})).allowed,true);
 // A publish attempt's observed ERROR must remain ERROR, not fabricated PUBLISHED.
 const uncertain=await job({state:'processing',container:'known-uncertain'});await claim('worker-a');const attempted=await rpc('begin',uncertain,{stage:'publish',expected:expected(uncertain)});
 await rpc('terminal',uncertain,{external:'ERROR'});const observed=await rpc('status',uncertain);assert.equal(observed.state,'unknown');assert.equal(observed.observed_status,'ERROR');await assert.rejects(()=>rpc('retry',uncertain,{actor:USER}),/reconciliation/);
 // Disconnected and unsupported accounts do not consume the due-work window.
 const fb=(await db.query("insert into social_accounts(org_id,platform,external_account_id,status) values($1,'facebook','page-1','connected') returning id",[ORG])).rows[0].id;
 await db.query("insert into social_publish_jobs(org_id,account_id,payload) values($1,$2,'{}')",[ORG,fb]);assert.ok(!(await claim('worker-b')).some(x=>x.account_id===fb));
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('update social_publish_jobs set attempts=0'),/permission denied/);await assert.rejects(()=>db.query('select * from private.social_provider_attempts'),/permission denied/);await assert.rejects(()=>rpc('status',j),/permission denied/);await db.exec('reset role');
 console.log('PASS: real social baseline/replay+attempt SQL; no-ID legacy quarantine; known container recovery; lease exclusion/expiry; account/payload/credential binding; private uncertainty survives privileged reset/delete; receipt response-loss replay; disconnected local finalization/bookkeeping rollback; actual observed ERROR; unsupported platform exclusion; PUBLISHED without receipt; role denial. No provider calls.');
}finally{await db.close();}
