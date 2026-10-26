import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE||'/tmp/selfservice-tools/node_modules/@electric-sql/pglite/dist/index.js');
// PGlite executes the complete pending SQL and functions. Only external schema and
// PGMQ extension transport are fixtures; no provider, process runner or network.
export async function researchFixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema pgmq;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function current_m_uid() returns uuid language sql stable as $$select auth.uid()$$;
 grant usage on schema auth,storage to authenticated,service_role;
 create table m_people(id uuid primary key);
 create table creator_tracks(id uuid primary key,uid uuid,m_uid uuid,status text,rights_status text,master_bucket text,master_path text,rights_declaration jsonb);
 create table music_rights_attestations(track_id uuid,creator_m_uid uuid,owns_master boolean,collaborators_cleared boolean);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;
 create table pgmq.messages(msg_id bigint generated always as identity primary key,read_ct integer default 0,enqueued_at timestamptz default now(),vt timestamptz default now(),message jsonb,archived boolean default false);
 create type pgmq.message_record as (msg_id bigint,read_ct integer,enqueued_at timestamptz,vt timestamptz,message jsonb);
 create function pgmq.list_queues() returns table(queue_name text) language sql as $$select 'mcc_music_research_v1'::text$$;
 create function pgmq.create(text) returns void language sql as $$select$$;
 create function pgmq.send(text,jsonb) returns bigint language sql as $$insert into pgmq.messages(message) values($2) returning msg_id$$;
 create function pgmq.archive(text,bigint) returns boolean language sql as $$update pgmq.messages set archived=true where msg_id=$2 returning true$$;
 create function pgmq.set_vt(text,bigint,integer) returns setof pgmq.message_record language sql as $$update pgmq.messages set vt=now()+make_interval(secs=>$3) where msg_id=$2 returning msg_id,read_ct,enqueued_at,vt,message$$;
 create function pgmq.read(text,integer,integer,jsonb default '{}') returns setof pgmq.message_record language sql as $$update pgmq.messages set vt=now()+make_interval(secs=>$2),read_ct=read_ct+1 where msg_id in (select msg_id from pgmq.messages where not archived and vt<=now() and message @> $4 order by msg_id limit $3) returning msg_id,read_ct,enqueued_at,vt,message$$;`);
 const sql=await readFile(new URL('../../supabase/pending/music_research_pipeline_reconciled.sql',import.meta.url),'utf8');
 assert.equal((sql.match(/create extension if not exists pgmq;/g)||[]).length,1);
 await db.exec(sql.replace('create extension if not exists pgmq;','-- PGlite PGMQ transport fixture defined above.'));
 return db;
}
const a='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',track='cccccccc-cccc-cccc-cccc-cccccccccccc';
test('reconciled SQL executes; two creators, private review, stage ordering, idempotency, leases and gates',async()=>{
 const db=await researchFixture();try{
 const as=async(owner,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role '+role)};
 const root=()=>db.exec('reset role');
 await db.query('insert into m_people values($1),($2)',[a,b]);
 await db.query("insert into creator_tracks values($1,$2,$2,'draft','incomplete','creator-masters',$3,'{}')",[track,a,a+'/workspace/master.wav']);
 const enqueue=(stage='analyze',model='mcc_spectral_v1',key='fixture-request-1',parent=null)=>db.query('select mcc_music_research_enqueue($1,$2,$3,$4,$5,true) id',[track,stage,model,key,parent]).then(x=>x.rows[0].id);
 await as(a);await assert.rejects(enqueue(),/enqueue disabled/);
 await assert.rejects(db.exec('update music_research_capabilities set enqueue_enabled=true'),/permission denied/);
 await root();await db.exec('update music_research_capabilities set enqueue_enabled=true');
 await as(a);await assert.rejects(enqueue(),/rights-attested/);
 await root();await db.query("update creator_tracks set rights_status='attested'");await db.query('insert into music_rights_attestations values($1,$2,true,false)',[track,a]);
 await as(a);await assert.rejects(enqueue(),/rights-attested/);
 await root();await db.exec('update music_rights_attestations set collaborators_cleared=true');
 await as(b);await assert.rejects(enqueue(),/creator-owned/);
 await as(a);await assert.rejects(enqueue('analyze','mcc_spectral_v1','bad!'),/idempotency/);
 const job=await enqueue();assert.equal(await enqueue(),job);
 await assert.rejects(db.query("select * from mcc_music_research_claim('mcc-cpu-fixture',600)"),/permission denied/);
 await as(b);assert.equal((await db.query('select * from music_research_jobs')).rows.length,0);await assert.rejects(db.query("select mcc_music_research_review($1,'approved')",[job]),/owner review/);
 await as('', 'service_role');assert.equal((await db.query("select * from mcc_music_research_claim('mcc-cpu-fixture',600)")).rows.length,0);
 await root();await db.exec('update music_research_capabilities set execution_enabled=true');
 await as('', 'service_role');await assert.rejects(db.query("select * from mcc_music_research_claim('unknown-worker',600)"),/capability/);
 const claimed=(await db.query("select * from mcc_music_research_claim('mcc-cpu-fixture',600)")).rows[0];assert.equal(claimed.job_id,job);
 await assert.rejects(db.query("select mcc_music_research_finish($1,$2,'{}','[]')",[job,b]),/stale worker/);
 const path='research/'+a+'/'+job+'/features.json';await root();await db.query("insert into storage.objects values('creator-research-outputs',$1)",[path]);
 const artifact={kind:'features',object_path:path,checksum_sha256:'a'.repeat(64),byte_size:12};
 await as('', 'service_role');await db.query("select mcc_music_research_finish($1,$2,'{}',$3)",[job,claimed.lease_token,JSON.stringify([artifact])]);
 await as(a);assert.equal((await db.query('select * from storage.objects')).rows.length,1);
 await as(b);assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await root();await db.exec("insert into music_research_models(model_id,stage,provider,version,license_class,enabled,approval_reference,reviewed_at,checkpoint_sha256) values('fixture_separator','separate','fixture','1','approved_commercial',true,'fixture-only',now(),repeat('a',64))");
 await as(a);await assert.rejects(enqueue('separate','fixture_separator','fixture-stage-2',job),/prior stage/);
 await db.query("select mcc_music_research_review($1,'approved')",[job]);const child=await enqueue('separate','fixture_separator','fixture-stage-2',job);
 await as('', 'service_role');assert.equal((await db.query("select * from mcc_music_research_claim('mcc-cpu-fixture',600)")).rows.length,0);
 const gpu=(await db.query("select * from mcc_music_research_claim('mcc-gpu-fixture',600)")).rows[0];assert.equal(gpu.job_id,child);
 // Expire an in-progress job and revoke its model; cleanup must clear its token.
 await root();await db.query("update music_research_jobs set leased_until=now()-interval '1 second' where id=$1",[child]);await db.exec("update pgmq.messages set vt=now()-interval '1 second';update music_research_models set enabled=false where stage='separate'");
 await as('', 'service_role');assert.equal((await db.query("select * from mcc_music_research_claim('mcc-gpu-fixture',600)")).rows.length,0);
 await root();assert.equal((await db.query('select status from music_research_jobs where id=$1',[child])).rows[0].status,'failed');
 await as(a);const cancel=await enqueue('analyze','mcc_spectral_v1','fixture-cancelled');await db.query('select mcc_music_research_cancel($1)',[cancel]);
 await as(b);assert.equal((await db.query('select mcc_music_research_cancel($1) ok',[job])).rows[0].ok,false);
 await as(a);const revoked=await enqueue('analyze','mcc_spectral_v1','fixture-rights-revoked');
 await root();await db.exec("update creator_tracks set status='rejected'");
 await as('', 'service_role');assert.equal((await db.query("select * from mcc_music_research_claim('mcc-cpu-fixture',600)")).rows.length,0);
 await root();assert.equal((await db.query('select error_code from music_research_jobs where id=$1',[revoked])).rows[0].error_code,'rights_revoked');await db.exec("update creator_tracks set status='draft'");
 // Cap is preserved without making an acknowledged retry fail at the cap.
 await root();await db.query("insert into music_research_jobs(track_id,creator_m_uid,stage,model_id,idempotency_key) select $1,$2,'analyze','mcc_spectral_v1','fixture-extra-'||n from generate_series(1,16) n",[track,a]);
 await as(a);assert.equal(await enqueue(),job);await assert.rejects(enqueue('analyze','mcc_spectral_v1','fixture-over-limit'),/daily creator/);
 }finally{await db.close()}
});
test('workspace bridge requires completed authoritative handoff, explicit consent, ownership and rights',async()=>{
 const db=await researchFixture();try{
 await db.exec('create table music_workspace_release_handoffs(id uuid,track_id uuid,owner_id uuid,creator_m_uid uuid,completed_at timestamptz,master_path text)');
 await db.exec(await readFile(new URL('../../supabase/pending/music_workspace_research_bridge.sql',import.meta.url),'utf8'));
 const hid='dddddddd-dddd-dddd-dddd-dddddddddddd',path=a+'/workspace/'+hid+'.wav';
 await db.query('insert into m_people values($1),($2)',[a,b]);
 await db.query("insert into creator_tracks values($1,$2,$2,'draft','attested','creator-masters',$3,$4)",[track,a,path,JSON.stringify({workspace_handoff:{id:hid}})]);
 await db.query('insert into music_rights_attestations values($1,$2,true,true)',[track,a]);
 const as=async(id)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated')};
 const enqueue=(consent=true)=>db.query("select music_workspace_research_enqueue($1,'analyze','mcc_spectral_v1','fixture-bridge-request',null,$2) id",[track,consent]);
 await as(a);await assert.rejects(enqueue(false),/explicit analysis consent/);await assert.rejects(enqueue(),/completed creator-owned/);
 await db.exec('reset role');await db.query('insert into music_workspace_release_handoffs values($1,$2,$3,$3,null,$4)',[hid,track,a,path]);
 await as(a);await assert.rejects(enqueue(),/completed creator-owned/);
 await db.exec('reset role');await db.exec('update music_workspace_release_handoffs set completed_at=now()');
 await as(a);await assert.rejects(enqueue(),/enqueue disabled/);
 await db.exec('reset role');await db.exec('update music_research_capabilities set enqueue_enabled=true');
 await as(b);await assert.rejects(enqueue(),/completed creator-owned/);
 await as(a);const first=(await enqueue()).rows[0].id;assert.equal((await enqueue()).rows[0].id,first);
 assert.equal((await db.query('select * from music_research_jobs')).rows.length,1);
 await assert.rejects(db.query("select mcc_music_research_enqueue($1,'analyze','mcc_spectral_v1','fixture-direct-without-consent')",[track]),/explicit analysis consent/);
 await db.exec('reset role');await db.exec("update creator_tracks set rights_status='incomplete'");
 await as(a);await assert.rejects(enqueue(),/rights-attested/);
 }finally{await db.close()}
});
