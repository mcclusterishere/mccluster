\set ON_ERROR_STOP on
-- Disposable CI database only. Synthetic identities, no live production access.
do $$ begin if current_database()<>'mccluster_learning_test' then raise exception 'Wrong test database';end if; end $$;
create schema ai_context;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create table public.orgs(id uuid primary key,slug text,kind text,enabled boolean);
create table public.org_members(org_id uuid,profile_id uuid,role text,primary key(org_id,profile_id));
create table public.ops_ai_threads(id uuid primary key,org_id uuid,created_by uuid,status text);
create table public.ops_ai_messages(id uuid primary key,thread_id uuid,org_id uuid,role text,content text,created_at timestamptz default now(),metadata jsonb default '{}');
create table public.ops_agent_jobs(id uuid primary key,org_id uuid,job_type text,target_type text,target_id text,status text,input jsonb default '{}',output jsonb default '{}');
create table ai_context.memory_items(id uuid primary key default gen_random_uuid(),org_id uuid,memory_type text,subject text,content text not null,canonical_key text,confidence numeric default .7,status text default 'active',sensitivity text default 'internal',source_message_ids uuid[] default '{}',valid_from timestamptz,valid_until timestamptz,last_confirmed_at timestamptz,metadata jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
create unique index ai_context_memory_key_unique on ai_context.memory_items(org_id,canonical_key) where canonical_key is not null;
create table public.control_audit(id bigint generated always as identity primary key,at timestamptz default now(),org_id uuid,actor_user_id uuid,actor_kind text,event text,capability text,resource_type text,resource_id text,detail jsonb);
\ir ../../../supabase/pending/20261016_resident_learning_v1.sql
create function pg_temp.ok(name text,pass boolean) returns void language plpgsql as $$begin
 if pass is distinct from true then raise exception 'FAIL: %',name;end if;raise notice 'PASS: %',name;end $$;
create function pg_temp.source(o uuid,t uuid,m uuid,c text) returns void language plpgsql as $$begin
 insert into ops_ai_messages(id,thread_id,org_id,role,content) values(m,t,o,'user',c);
 insert into ops_agent_jobs(id,org_id,job_type,target_type,target_id,status,input) values(m,o,'resident_ai_turn','ai_thread',t::text,'running',jsonb_build_object('thread_id',t,'user_message_id',m));
end $$;
select pg_temp.ok('anon cannot call learning',not has_function_privilege('anon','public.ops_ai_learning_turn(uuid,uuid,uuid)','EXECUTE'));
select pg_temp.ok('authenticated cannot call learning',not has_function_privilege('authenticated','public.ops_ai_learning_turn(uuid,uuid,uuid)','EXECUTE'));
select pg_temp.ok('service role may call learning',has_function_privilege('service_role','public.ops_ai_learning_turn(uuid,uuid,uuid)','EXECUTE'));
select pg_temp.ok('authenticated cannot save model reflection',not has_function_privilege('authenticated','public.ops_ai_learning_reflection(uuid,uuid,uuid,text,text)','EXECUTE'));
select pg_temp.ok('private helper not callable by authenticated',not has_function_privilege('authenticated','ai_context.learning_owner_v1(uuid,uuid,uuid)','EXECUTE'));
do $$
declare owner uuid=gen_random_uuid();owner2 uuid=gen_random_uuid();o uuid=gen_random_uuid();otherorg uuid=gen_random_uuid();
 t uuid=gen_random_uuid();t2 uuid=gen_random_uuid();t3 uuid=gen_random_uuid();p uuid=gen_random_uuid();a uuid=gen_random_uuid();r uuid=gen_random_uuid();q uuid=gen_random_uuid();qold uuid=gen_random_uuid();z uuid=gen_random_uuid();j uuid=gen_random_uuid();proposal uuid; result jsonb; repeated jsonb; n int;
begin
 insert into orgs values(o,'mccluster','studio',true),(otherorg,'other','business',true);
 insert into org_members values(o,owner,'owner'),(o,owner2,'owner'),(otherorg,owner,'owner');
 insert into ops_ai_threads values(t,o,owner,'active'),(t2,o,owner2,'active'),(t3,o,owner,'active');
 perform pg_temp.source(o,t,p,E'/learn propose preference\nKeep the analytical globe black.');
 result=ops_ai_learning_turn(o,t,p);proposal=(result->>'id')::uuid;
 perform pg_temp.ok('proposal is not active',result->>'status'='proposed');
 repeated=ops_ai_learning_turn(o,t,p);
 perform pg_temp.ok('replay creates no duplicate memory',repeated->>'id'=result->>'id' and (select count(*)=1 from ai_context.memory_items));
 perform pg_temp.ok('audit is atomic and idempotent',(select count(*)=1 from control_audit));
 perform pg_temp.source(o,t3,q,'How should the globe look?');
 perform pg_temp.ok('unapproved is not retrieved',jsonb_array_length(ops_ai_learning_turn(o,t3,q)->'items')=0);
 perform pg_temp.source(o,t2,z,'/learn approve '||proposal);
 perform pg_temp.ok('another owner does not inherit personal lesson',ops_ai_learning_turn(o,t2,z)->>'status'='rejected');
 perform pg_temp.source(o,t,a,'/learn approve '||proposal);
 result=ops_ai_learning_turn(o,t,a);
 perform pg_temp.ok('explicit approval admits memory',result->>'status'='approved');
 perform pg_temp.ok('legacy active-memory search cannot expose owner lessons',(select count(*)=0 from ai_context.memory_items where status='active'));
 perform pg_temp.ok('approval remains replay safe',ops_ai_learning_turn(o,t,a)->>'status'='approved' and (select count(*)=2 from control_audit));
 result=ops_ai_learning_turn(o,t3,q);
 perform pg_temp.ok('approved memory crosses own threads',jsonb_array_length(result->'items')=1);
 perform pg_temp.ok('training permission remains false',result#>'{items,0,metadata,learning,training_allowed}'='false'::jsonb);
 perform pg_temp.ok('canonical source namespace not misrepresented',(select source_message_ids='{}'::uuid[] from ai_context.memory_items where id=proposal));
 perform pg_temp.source(o,t,qold,'Earlier question');update ops_ai_messages set created_at=now()-interval '1 day' where id=qold;
 perform pg_temp.ok('no future memory in historical turn',jsonb_array_length(ops_ai_learning_turn(o,t,qold)->'items')=0);
 update ops_ai_messages set content='Changed approval text' where id=a;
 perform pg_temp.ok('edited approval invalidates retrieval',jsonb_array_length(ops_ai_learning_turn(o,t3,q)->'items')=0);
 update ops_ai_messages set content='/learn approve '||proposal where id=a;
 update ops_ai_messages set content=E'/learn propose preference\nDifferent content.' where id=p;
 perform pg_temp.ok('edited source invalidates retrieval',jsonb_array_length(ops_ai_learning_turn(o,t3,q)->'items')=0);
 perform pg_temp.ok('same source id cannot overwrite memory',ops_ai_learning_turn(o,t,p)->>'status'='conflict');
 update ops_ai_messages set content=E'/learn propose preference\nKeep the analytical globe black.' where id=p;
 update ai_context.memory_items set valid_until=now()-interval '1 second' where id=proposal;
 perform pg_temp.ok('expired source is not retrieved',jsonb_array_length(ops_ai_learning_turn(o,t3,q)->'items')=0);
 update ai_context.memory_items set valid_until=now()+interval '1 day' where id=proposal;
 perform pg_temp.source(o,t,r,'/learn revoke '||proposal);perform ops_ai_learning_turn(o,t,r);
 perform pg_temp.ok('revocation stops future retrieval',jsonb_array_length(ops_ai_learning_turn(o,t3,q)->'items')=0);
 perform pg_temp.ok('revoked memory cannot be approved by replay',ops_ai_learning_turn(o,t,a)->>'status'='conflict');
 n=(select count(*) from control_audit);perform ops_ai_learning_turn(o,t,r);
 perform pg_temp.ok('revocation replay has no new audit event',(select count(*)=n from control_audit));
 update org_members set role='admin' where org_id=o and profile_id=owner;
 begin perform ops_ai_learning_turn(o,t3,q);raise exception 'owner gate failed';exception when insufficient_privilege then perform pg_temp.ok('generic admin not owner',true);end;
 update org_members set role='owner' where org_id=o and profile_id=owner;
 begin perform ops_ai_learning_turn(otherorg,t3,q);raise exception 'org gate failed';exception when insufficient_privilege then perform pg_temp.ok('cross org rejected',true);end;
 update ops_ai_messages set role='assistant' where id=q;
 begin perform ops_ai_learning_turn(o,t3,q);raise exception 'role gate failed';exception when insufficient_privilege then perform pg_temp.ok('assistant cannot teach via message role',true);end;
 update ops_ai_messages set role='user' where id=q;
 -- Credential-pattern rejection is defense in depth, not complete DLP.
 z=gen_random_uuid();perform pg_temp.source(o,t,z,E'/learn propose correction\nBearer abcdefghijklmnop');
 perform pg_temp.ok('obvious credential not retained',ops_ai_learning_turn(o,t,z)->>'status'='rejected');
 -- Test database-side source binding; cryptographic output-envelope validation
 -- is separately enforced by Node assertCompletionEvidence before the model.
 insert into ops_agent_jobs(id,org_id,job_type,status,output) values(j,o,'repo_health','done',jsonb_build_object('tests',jsonb_build_object('ran',true,'ok',true),'completion_evidence',jsonb_build_object('result_sha256',repeat('a',64))));
 z=gen_random_uuid();perform pg_temp.source(o,t,z,'/learn reflect '||j);
 result=ops_ai_learning_turn(o,t,z);perform pg_temp.ok('reflection only returns matching completed job',result->>'status'='reflect' and result#>>'{job,id}'=j::text);
 result=ops_ai_learning_reflection(o,t,z,'Check test evidence before declaring success.',repeat('a',64));
 proposal=(result->>'id')::uuid;perform pg_temp.ok('model reflection stays proposed',result->>'status'='proposed');
 perform pg_temp.ok('reflection cannot reuse another source',ops_ai_learning_reflection(o,t,q,'invented lesson',repeat('a',64))->>'status'='rejected');
 repeated=ops_ai_learning_reflection(o,t,z,'Different model output on retry.',repeat('a',64));
 perform pg_temp.ok('reflection replay retains the first proposal',repeated->>'id'=proposal::text and repeated->>'content'='Check test evidence before declaring success.');
 a=gen_random_uuid();perform pg_temp.source(o,t,a,'/learn approve '||proposal);perform ops_ai_learning_turn(o,t,a);
 perform pg_temp.ok('reviewed reflection is retrievable',jsonb_array_length(ops_ai_learning_turn(o,t3,q)->'items')=1);
 update ops_agent_jobs set output=jsonb_set(output,'{completion_evidence,result_sha256}',to_jsonb(repeat('b',64))) where id=j;
 perform pg_temp.ok('revised job evidence invalidates its lesson',jsonb_array_length(ops_ai_learning_turn(o,t3,q)->'items')=0);
 perform pg_temp.ok('mismatched evidence rejected during save',ops_ai_learning_reflection(o,t,z,'lesson',repeat('a',64))->>'status'='rejected');
 update orgs set enabled=false where id=o;
 begin perform ops_ai_learning_turn(o,t3,q);raise exception 'enabled gate failed';exception when insufficient_privilege then perform pg_temp.ok('disabled workspace loses learning access',true);end;
end $$;
