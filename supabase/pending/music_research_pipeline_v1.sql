-- PENDING APPROVAL ONLY. DO NOT APPLY AUTOMATICALLY ON PR MERGE.
-- Durable PGMQ music derivation queue; never publishes stems/MIDI/scores without creator review.
create extension if not exists pgmq;
do $queue$
begin
  if not exists(select 1 from pgmq.list_queues() q where q.queue_name='mcc_music_research_v1') then
    perform pgmq.create('mcc_music_research_v1');
  end if;
end $queue$;

create table if not exists public.music_research_models(
  model_id text primary key check(model_id~'^[a-z][a-z0-9_:-]{2,79}$'),
  stage text not null check(stage in ('analyze','separate','transcribe','engrave')),
  provider text not null, version text not null,
  license_class text not null check(license_class in ('first_party','approved_commercial','noncommercial_research','unknown')),
  checkpoint_sha256 text check(checkpoint_sha256 is null or checkpoint_sha256~'^[a-f0-9]{64}$'),
  enabled boolean not null default false, approval_reference text, reviewed_at timestamptz,
  constraint approved_research_model check(not enabled or
    (license_class in ('first_party','approved_commercial') and approval_reference is not null
     and reviewed_at is not null
     and (stage not in ('separate','transcribe') or checkpoint_sha256 is not null)))
);
insert into public.music_research_models(model_id,stage,provider,version,license_class,enabled,approval_reference,reviewed_at)
values('mcc_spectral_v1','analyze','mccluster','1','first_party',true,
       'docs/research/MCCLUSTER-RESONANCE-ATLAS-V1.md',now())
on conflict(model_id) do nothing;
-- No separation/transcription checkpoints enabled by default. MuScriptor weights are CC BY-NC.

create table if not exists public.music_research_jobs(
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.creator_tracks(id) on delete restrict,
  creator_m_uid uuid not null references public.m_people(id) on delete restrict,
  parent_job_id uuid references public.music_research_jobs(id) on delete restrict,
  stage text not null check(stage in ('analyze','separate','transcribe','engrave')),
  model_id text not null references public.music_research_models(model_id),
  idempotency_key text not null check(length(idempotency_key) between 12 and 128 and
                                     idempotency_key~'^[A-Za-z0-9._:-]+$'),
  status text not null default 'queued'
    check(status in ('queued','processing','awaiting_review','approved','rejected','failed','cancelled')),
  attempts int not null default 0 check(attempts between 0 and 10),
  max_attempts int not null default 3 check(max_attempts between 1 and 5),
  msg_id bigint, lease_token uuid, leased_until timestamptz,
  result jsonb not null default '{}'::jsonb check(jsonb_typeof(result)='object'),
  error_code text,
  review_note text, reviewed_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(creator_m_uid,track_id,stage,idempotency_key),
  constraint processing_requires_lease check((status='processing')=(lease_token is not null))
);
create index if not exists research_job_owner_idx on public.music_research_jobs(creator_m_uid,created_at desc);
create index if not exists research_job_status_idx on public.music_research_jobs(status,leased_until);

create table if not exists public.music_research_artifacts(
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.music_research_jobs(id) on delete restrict,
  creator_m_uid uuid not null references public.m_people(id) on delete restrict,
  kind text not null check(kind in ('stem','midi','musicxml','pdf','features')),
  bucket text not null default 'creator-research-outputs' check(bucket='creator-research-outputs'),
  object_path text not null unique,
  checksum_sha256 text not null check(checksum_sha256~'^[a-f0-9]{64}$'),
  byte_size bigint not null check(byte_size between 1 and 104857600),
  status text not null default 'quarantined' check(status in ('quarantined','creator_approved','rejected')),
  created_at timestamptz not null default now()
);
create index if not exists research_artifact_owner_idx on public.music_research_artifacts(creator_m_uid,job_id);

create table if not exists public.music_research_reviews(
  job_id uuid primary key references public.music_research_jobs(id) on delete restrict,
  creator_m_uid uuid not null references public.m_people(id) on delete restrict,
  decision text not null check(decision in ('approved','rejected')),
  note text, reviewed_at timestamptz not null default now()
);

insert into storage.buckets(id,name,public,file_size_limit)
values('creator-research-outputs','creator-research-outputs',false,104857600)
on conflict(id) do update set public=false;
-- Creator may obtain a short-lived signed preview to review their own output.
-- The bucket stays private; no client inserts/upserts, deletes or public reads.
-- Joining to the creator-owned artifact row ensures that a guessed path cannot
-- expose unrelated content in this bucket.
create policy music_research_creator_artifact_read on storage.objects
  for select to authenticated using (
    bucket_id='creator-research-outputs'
    and exists (
      select 1 from public.music_research_artifacts a
      where a.object_path=storage.objects.name
        and a.creator_m_uid=public.current_m_uid()
        and a.status in ('quarantined','creator_approved')
    )
  );

alter table public.music_research_models enable row level security;
alter table public.music_research_jobs enable row level security;
alter table public.music_research_artifacts enable row level security;
alter table public.music_research_reviews enable row level security;
revoke all on public.music_research_models,public.music_research_jobs,
  public.music_research_artifacts,public.music_research_reviews from public,anon,authenticated;
grant select on public.music_research_models,public.music_research_jobs,public.music_research_artifacts,public.music_research_reviews to authenticated;
create policy music_research_approved_model_read on public.music_research_models
  for select to authenticated using(enabled and license_class in ('first_party','approved_commercial'));
grant select,insert,update,delete on public.music_research_models,public.music_research_jobs,
  public.music_research_artifacts,public.music_research_reviews to service_role;
create policy music_research_job_owner_read on public.music_research_jobs
  for select to authenticated using(creator_m_uid=public.current_m_uid());
create policy music_research_artifact_owner_read on public.music_research_artifacts
  for select to authenticated using(creator_m_uid=public.current_m_uid());
create policy music_research_review_owner_read on public.music_research_reviews
  for select to authenticated using(creator_m_uid=public.current_m_uid());

create or replace function public.mcc_music_research_enqueue(
 p_track_id uuid,p_stage text,p_model_id text,p_idempotency_key text,p_parent_job_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $fn$
declare v_owner uuid;v_parent public.music_research_jobs%rowtype;
 v_id uuid;v_msg bigint;v_master text;v_rights text;v_parent_stage text;
begin
 if auth.uid() is null then raise exception 'signed in creator required';end if;
 v_owner:=public.current_m_uid();
 if v_owner is null then raise exception 'creator identity required';end if;
 select t.master_path,t.rights_status into v_master,v_rights
   from public.creator_tracks t where t.id=p_track_id and t.m_uid=v_owner
      and t.master_bucket='creator-masters' and t.status not in ('rejected','archived');
 if not found or coalesce(v_master,'')='' or v_rights not in ('attested','cleared')
    or not exists(select 1 from public.music_rights_attestations a
      where a.track_id=p_track_id and a.creator_m_uid=v_owner) then
   raise exception 'rights-attested, creator-owned master required';
 end if;
 if not exists(select 1 from public.music_research_models m where m.model_id=p_model_id
   and m.stage=p_stage and m.enabled and m.license_class in ('first_party','approved_commercial')
   and m.reviewed_at is not null) then raise exception 'model not commercially approved';end if;
 if length(coalesce(p_idempotency_key,'')) not between 12 and 128 or
    p_idempotency_key!~'^[A-Za-z0-9._:-]+
 v_parent_stage:=case p_stage when 'analyze' then null when 'separate' then 'analyze'
                   when 'transcribe' then 'separate' when 'engrave' then 'transcribe' end;
 if v_parent_stage is null then
   if p_parent_job_id is not null then raise exception 'analysis has no parent';end if;
 else
   select * into v_parent from public.music_research_jobs j where j.id=p_parent_job_id
      and j.track_id=p_track_id and j.creator_m_uid=v_owner
      and j.stage=v_parent_stage and j.status='approved';
   if not found then raise exception 'prior stage must be approved by creator';end if;
 end if;
 insert into public.music_research_jobs(track_id,creator_m_uid,parent_job_id,stage,model_id,idempotency_key)
 values(p_track_id,v_owner,p_parent_job_id,p_stage,p_model_id,p_idempotency_key)
 on conflict(creator_m_uid,track_id,stage,idempotency_key) do nothing returning id into v_id;
 if v_id is null then
   select id into v_id from public.music_research_jobs
   where creator_m_uid=v_owner and track_id=p_track_id and stage=p_stage and idempotency_key=p_idempotency_key;
   return v_id;
 end if;
 select pgmq.send('mcc_music_research_v1',jsonb_build_object('job_id',v_id)) into v_msg;
 update public.music_research_jobs set msg_id=v_msg where id=v_id;
 return v_id;
end $fn$;

create or replace function public.mcc_music_research_review(
 p_job_id uuid,p_decision text,p_note text default null
) returns uuid language plpgsql security definer set search_path='' as $fn$
declare v_owner uuid;v_job public.music_research_jobs%rowtype;
begin
 if auth.uid() is null then raise exception 'authenticated review required';end if;
 v_owner:=public.current_m_uid();
 if p_decision not in ('approved','rejected') or v_owner is null then raise exception 'invalid reviewer/decision';end if;
 select * into v_job from public.music_research_jobs j where j.id=p_job_id and j.creator_m_uid=v_owner for update;
 if not found or v_job.status<>'awaiting_review' then raise exception 'job not awaiting owner review';end if;
 if p_decision='approved' and not exists (
   select 1 from public.creator_tracks t where t.id=v_job.track_id
   and t.m_uid=v_owner and t.rights_status in ('attested','cleared')
   and t.status not in ('rejected','archived')
 ) then raise exception 'rights approval must still be valid';end if;
 update public.music_research_jobs set status=p_decision,review_note=left(p_note,2000),
    reviewed_at=now(),updated_at=now() where id=p_job_id;
 update public.music_research_artifacts set status=case when p_decision='approved'
   then 'creator_approved' else 'rejected' end where job_id=p_job_id and creator_m_uid=v_owner;
 insert into public.music_research_reviews(job_id,creator_m_uid,decision,note)
 values(p_job_id,v_owner,p_decision,left(p_note,2000));
 return p_job_id;
end $fn$;

create or replace function public.mcc_music_research_cancel(p_job_id uuid)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare v_owner uuid;v_job public.music_research_jobs%rowtype;
begin
 if auth.uid() is null then raise exception 'authentication required';end if;
 v_owner:=public.current_m_uid();
 select * into v_job from public.music_research_jobs where id=p_job_id and creator_m_uid=v_owner for update;
 if not found or v_job.status not in ('queued','processing','awaiting_review') then return false;end if;
 update public.music_research_jobs set status='cancelled',lease_token=null,leased_until=null,
   updated_at=now() where id=p_job_id;
 if v_job.msg_id is not null then perform pgmq.archive('mcc_music_research_v1',v_job.msg_id);end if;
 return true;
end $fn$;

-- Service-role RPC consumes the durable queue. A UUID fencing token prevents
-- expired/duplicate workers from committing late results.
create or replace function public.mcc_music_research_claim(
 p_worker text,p_lease_seconds integer default 600
) returns table(job_id uuid,stage text,model_id text,lease_token uuid,
                creator_m_uid uuid,source_objects jsonb)
language plpgsql security definer set search_path='' as $fn$
declare v_msg pgmq.message_record;v_job public.music_research_jobs%rowtype;
 v_track public.creator_tracks%rowtype;v_inputs jsonb;v_token uuid;v_count int;
begin
 if length(coalesce(p_worker,'')) not between 3 and 100 or p_lease_seconds not between 60 and 1800
   then raise exception 'invalid worker or lease';end if;
 for v_count in 1..5 loop
   select * into v_msg from pgmq.read('mcc_music_research_v1',p_lease_seconds,1);
   if v_msg.msg_id is null then return;end if;
   select * into v_job from public.music_research_jobs j
      where j.id=(v_msg.message->>'job_id')::uuid for update;
   if not found or v_job.status in ('approved','awaiting_review','rejected','failed','cancelled') then
     perform pgmq.archive('mcc_music_research_v1',v_msg.msg_id);continue;
   end if;
   if v_job.status='processing' and v_job.leased_until>now() then
     perform pgmq.set_vt('mcc_music_research_v1',v_msg.msg_id,p_lease_seconds);continue;
   end if;
   if v_job.attempts>=v_job.max_attempts then
     update public.music_research_jobs set status='failed',lease_token=null,leased_until=null,
       error_code='attempts_exhausted' where id=v_job.id;
     perform pgmq.archive('mcc_music_research_v1',v_msg.msg_id);continue;
   end if;
   if not exists(select 1 from public.music_research_models m where m.model_id=v_job.model_id
      and m.enabled and m.license_class in ('first_party','approved_commercial')) then
     update public.music_research_jobs set status='failed',error_code='license_revoked' where id=v_job.id;
     perform pgmq.archive('mcc_music_research_v1',v_msg.msg_id);continue;
   end if;
   select * into v_track from public.creator_tracks t where t.id=v_job.track_id;
   if not found or v_track.m_uid is distinct from v_job.creator_m_uid or
      v_track.rights_status not in ('attested','cleared') then
     update public.music_research_jobs set status='failed',error_code='rights_revoked' where id=v_job.id;
     perform pgmq.archive('mcc_music_research_v1',v_msg.msg_id);continue;
   end if;
   if v_job.stage in ('analyze','separate') then
     v_inputs:=jsonb_build_array(jsonb_build_object('bucket',v_track.master_bucket,
       'path',v_track.master_path,'kind','master'));
   else
     select coalesce(jsonb_agg(jsonb_build_object('bucket',a.bucket,'path',a.object_path,'kind',a.kind)),
       '[]'::jsonb) into v_inputs from public.music_research_artifacts a
       where a.job_id=v_job.parent_job_id and a.status='creator_approved'
         and a.kind=case when v_job.stage='transcribe' then 'stem' else 'midi' end;
     if jsonb_array_length(v_inputs)=0 then
       update public.music_research_jobs set status='failed',error_code='no_approved_input' where id=v_job.id;
       perform pgmq.archive('mcc_music_research_v1',v_msg.msg_id);continue;
     end if;
   end if;
   v_token:=gen_random_uuid();
   update public.music_research_jobs set status='processing',attempts=attempts+1,msg_id=v_msg.msg_id,
     lease_token=v_token,leased_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
     where id=v_job.id;
   return query select v_job.id,v_job.stage,v_job.model_id,v_token,v_job.creator_m_uid,v_inputs;
   return;
 end loop;
end $fn$;

create or replace function public.mcc_music_research_heartbeat(p_job_id uuid,p_token uuid,p_seconds int default 600)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare v_msg bigint;
begin
 if p_seconds not between 60 and 1800 then raise exception 'bad lease';end if;
 update public.music_research_jobs set leased_until=now()+make_interval(secs=>p_seconds),updated_at=now()
   where id=p_job_id and status='processing' and lease_token=p_token and leased_until>now()
   returning msg_id into v_msg;
 if not found then return false;end if;
 perform pgmq.set_vt('mcc_music_research_v1',v_msg,p_seconds);return true;
end $fn$;

create or replace function public.mcc_music_research_finish(
 p_job_id uuid,p_token uuid,p_result jsonb,p_artifacts jsonb default '[]'::jsonb
) returns boolean language plpgsql security definer set search_path='' as $fn$
declare v_job public.music_research_jobs%rowtype;v_obj jsonb;v_path text;v_kind text;
begin
 if jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>65536 or
    jsonb_typeof(p_artifacts)<>'array' or jsonb_array_length(p_artifacts)>32 then
    raise exception 'invalid result payload';end if;
 select * into v_job from public.music_research_jobs where id=p_job_id for update;
 if not found or v_job.status<>'processing' or v_job.lease_token is distinct from p_token or
    v_job.leased_until<=now() then raise exception 'stale worker cannot commit';end if;
 for v_obj in select * from jsonb_array_elements(p_artifacts) loop
   v_kind:=v_obj->>'kind';v_path:=v_obj->>'object_path';
   if v_kind not in ('stem','midi','musicxml','pdf','features') or
      v_path !~ ('^research/'||v_job.creator_m_uid::text||'/'||v_job.id::text||'/[a-zA-Z0-9._/-]+$') or
      v_path like '%..%' or (v_obj->>'checksum_sha256')!~'^[a-f0-9]{64}$' or
      (v_obj->>'byte_size')::bigint not between 1 and 104857600 or
      not exists(select 1 from storage.objects o where o.bucket_id='creator-research-outputs'
        and o.name=v_path) then raise exception 'missing/invalid private output';end if;
   insert into public.music_research_artifacts(job_id,creator_m_uid,kind,object_path,checksum_sha256,byte_size)
   values(v_job.id,v_job.creator_m_uid,v_kind,v_path,v_obj->>'checksum_sha256',(v_obj->>'byte_size')::bigint);
 end loop;
 update public.music_research_jobs set status='awaiting_review',result=p_result,
   lease_token=null,leased_until=null,updated_at=now() where id=v_job.id;
 perform pgmq.archive('mcc_music_research_v1',v_job.msg_id);
 return true;
end $fn$;

create or replace function public.mcc_music_research_fail(
 p_job_id uuid,p_token uuid,p_error_code text,p_retryable boolean default true
) returns text language plpgsql security definer set search_path='' as $fn$
declare v_job public.music_research_jobs%rowtype;v_delay int;
begin
 select * into v_job from public.music_research_jobs where id=p_job_id for update;
 if not found or v_job.status<>'processing' or v_job.lease_token is distinct from p_token or
    v_job.leased_until<=now() then raise exception 'stale worker cannot fail job';end if;
 if p_retryable and v_job.attempts<v_job.max_attempts then
   v_delay:=least(1800,60*(2^greatest(0,v_job.attempts-1))::int);
   update public.music_research_jobs set status='queued',lease_token=null,leased_until=null,
     error_code=left(p_error_code,100),updated_at=now() where id=p_job_id;
   perform pgmq.set_vt('mcc_music_research_v1',v_job.msg_id,v_delay);return 'queued';
 end if;
 update public.music_research_jobs set status='failed',lease_token=null,leased_until=null,
   error_code=left(p_error_code,100),updated_at=now() where id=p_job_id;
 perform pgmq.archive('mcc_music_research_v1',v_job.msg_id);return 'failed';
end $fn$;

-- Explicit function grants: otherwise SECURITY DEFINER RPCs inherit PUBLIC EXECUTE.
revoke all on function public.mcc_music_research_enqueue(uuid,text,text,text,uuid),
 public.mcc_music_research_review(uuid,text,text),public.mcc_music_research_cancel(uuid),
 public.mcc_music_research_claim(text,integer),public.mcc_music_research_heartbeat(uuid,uuid,integer),
 public.mcc_music_research_finish(uuid,uuid,jsonb,jsonb),
 public.mcc_music_research_fail(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.mcc_music_research_enqueue(uuid,text,text,text,uuid),
 public.mcc_music_research_review(uuid,text,text),public.mcc_music_research_cancel(uuid) to authenticated;
grant execute on function public.mcc_music_research_claim(text,integer),
 public.mcc_music_research_heartbeat(uuid,uuid,integer),
 public.mcc_music_research_finish(uuid,uuid,jsonb,jsonb),
 public.mcc_music_research_fail(uuid,uuid,text,boolean) to service_role;


-- Authenticated creators may discover only operator-approved models. No model download URLs.
create or replace function public.mcc_music_research_available_models()
returns table(model_id text,stage text,version text)
language plpgsql security definer set search_path='' as $fn$
begin
 if auth.uid() is null or public.current_m_uid() is null then
   raise exception 'creator authentication required';
 end if;
 return query select m.model_id,m.stage,m.version from public.music_research_models m
   where m.enabled and m.license_class in ('first_party','approved_commercial')
     and m.reviewed_at is not null order by m.stage,m.model_id;
end $fn$;
revoke all on function public.mcc_music_research_available_models() from public,anon,authenticated;
grant execute on function public.mcc_music_research_available_models() to authenticated;
 then raise exception 'invalid request idempotency';end if;
 if (select count(*) from public.music_research_jobs j
     where j.creator_m_uid=v_owner and j.created_at>now()-interval '24 hours')>=20 then
   raise exception 'daily creator research limit reached';
 end if;
 v_parent_stage:=case p_stage when 'analyze' then null when 'separate' then 'analyze'
                   when 'transcribe' then 'separate' when 'engrave' then 'transcribe' end;
 if v_parent_stage is null then
   if p_parent_job_id is not null then raise exception 'analysis has no parent';end if;
 else
   select * into v_parent from public.music_research_jobs j where j.id=p_parent_job_id
      and j.track_id=p_track_id and j.creator_m_uid=v_owner
      and j.stage=v_parent_stage and j.status='approved';
   if not found then raise exception 'prior stage must be approved by creator';end if;
 end if;
 insert into public.music_research_jobs(track_id,creator_m_uid,parent_job_id,stage,model_id,idempotency_key)
 values(p_track_id,v_owner,p_parent_job_id,p_stage,p_model_id,p_idempotency_key)
 on conflict(creator_m_uid,track_id,stage,idempotency_key) do nothing returning id into v_id;
 if v_id is null then
   select id into v_id from public.music_research_jobs
   where creator_m_uid=v_owner and track_id=p_track_id and stage=p_stage and idempotency_key=p_idempotency_key;
   return v_id;
 end if;
 select pgmq.send('mcc_music_research_v1',jsonb_build_object('job_id',v_id)) into v_msg;
 update public.music_research_jobs set msg_id=v_msg where id=v_id;
 return v_id;
end $fn$;

create or replace function public.mcc_music_research_review(
 p_job_id uuid,p_decision text,p_note text default null
) returns uuid language plpgsql security definer set search_path='' as $fn$
declare v_owner uuid;v_job public.music_research_jobs%rowtype;
begin
 if auth.uid() is null then raise exception 'authenticated review required';end if;
 v_owner:=public.current_m_uid();
 if p_decision not in ('approved','rejected') or v_owner is null then raise exception 'invalid reviewer/decision';end if;
 select * into v_job from public.music_research_jobs j where j.id=p_job_id and j.creator_m_uid=v_owner for update;
 if not found or v_job.status<>'awaiting_review' then raise exception 'job not awaiting owner review';end if;
 if p_decision='approved' and not exists (
   select 1 from public.creator_tracks t where t.id=v_job.track_id
   and t.m_uid=v_owner and t.rights_status in ('attested','cleared')
   and t.status not in ('rejected','archived')
 ) then raise exception 'rights approval must still be valid';end if;
 update public.music_research_jobs set status=p_decision,review_note=left(p_note,2000),
    reviewed_at=now(),updated_at=now() where id=p_job_id;
 update public.music_research_artifacts set status=case when p_decision='approved'
   then 'creator_approved' else 'rejected' end where job_id=p_job_id and creator_m_uid=v_owner;
 insert into public.music_research_reviews(job_id,creator_m_uid,decision,note)
 values(p_job_id,v_owner,p_decision,left(p_note,2000));
 return p_job_id;
end $fn$;

create or replace function public.mcc_music_research_cancel(p_job_id uuid)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare v_owner uuid;v_job public.music_research_jobs%rowtype;
begin
 if auth.uid() is null then raise exception 'authentication required';end if;
 v_owner:=public.current_m_uid();
 select * into v_job from public.music_research_jobs where id=p_job_id and creator_m_uid=v_owner for update;
 if not found or v_job.status not in ('queued','processing','awaiting_review') then return false;end if;
 update public.music_research_jobs set status='cancelled',lease_token=null,leased_until=null,
   updated_at=now() where id=p_job_id;
 if v_job.msg_id is not null then perform pgmq.archive('mcc_music_research_v1',v_job.msg_id);end if;
 return true;
end $fn$;

-- Service-role RPC consumes the durable queue. A UUID fencing token prevents
-- expired/duplicate workers from committing late results.
create or replace function public.mcc_music_research_claim(
 p_worker text,p_lease_seconds integer default 600
) returns table(job_id uuid,stage text,model_id text,lease_token uuid,
                creator_m_uid uuid,source_objects jsonb)
language plpgsql security definer set search_path='' as $fn$
declare v_msg pgmq.message_record;v_job public.music_research_jobs%rowtype;
 v_track public.creator_tracks%rowtype;v_inputs jsonb;v_token uuid;v_count int;
begin
 if length(coalesce(p_worker,'')) not between 3 and 100 or p_lease_seconds not between 60 and 1800
   then raise exception 'invalid worker or lease';end if;
 for v_count in 1..5 loop
   select * into v_msg from pgmq.read('mcc_music_research_v1',p_lease_seconds,1);
   if v_msg.msg_id is null then return;end if;
   select * into v_job from public.music_research_jobs j
      where j.id=(v_msg.message->>'job_id')::uuid for update;
   if not found or v_job.status in ('approved','awaiting_review','rejected','failed','cancelled') then
     perform pgmq.archive('mcc_music_research_v1',v_msg.msg_id);continue;
   end if;
   if v_job.status='processing' and v_job.leased_until>now() then
     perform pgmq.set_vt('mcc_music_research_v1',v_msg.msg_id,p_lease_seconds);continue;
   end if;
   if v_job.attempts>=v_job.max_attempts then
     update public.music_research_jobs set status='failed',lease_token=null,leased_until=null,
       error_code='attempts_exhausted' where id=v_job.id;
     perform pgmq.archive('mcc_music_research_v1',v_msg.msg_id);continue;
   end if;
   if not exists(select 1 from public.music_research_models m where m.model_id=v_job.model_id
      and m.enabled and m.license_class in ('first_party','approved_commercial')) then
     update public.music_research_jobs set status='failed',error_code='license_revoked' where id=v_job.id;
     perform pgmq.archive('mcc_music_research_v1',v_msg.msg_id);continue;
   end if;
   select * into v_track from public.creator_tracks t where t.id=v_job.track_id;
   if not found or v_track.m_uid is distinct from v_job.creator_m_uid or
      v_track.rights_status not in ('attested','cleared') then
     update public.music_research_jobs set status='failed',error_code='rights_revoked' where id=v_job.id;
     perform pgmq.archive('mcc_music_research_v1',v_msg.msg_id);continue;
   end if;
   if v_job.stage in ('analyze','separate') then
     v_inputs:=jsonb_build_array(jsonb_build_object('bucket',v_track.master_bucket,
       'path',v_track.master_path,'kind','master'));
   else
     select coalesce(jsonb_agg(jsonb_build_object('bucket',a.bucket,'path',a.object_path,'kind',a.kind)),
       '[]'::jsonb) into v_inputs from public.music_research_artifacts a
       where a.job_id=v_job.parent_job_id and a.status='creator_approved'
         and a.kind=case when v_job.stage='transcribe' then 'stem' else 'midi' end;
     if jsonb_array_length(v_inputs)=0 then
       update public.music_research_jobs set status='failed',error_code='no_approved_input' where id=v_job.id;
       perform pgmq.archive('mcc_music_research_v1',v_msg.msg_id);continue;
     end if;
   end if;
   v_token:=gen_random_uuid();
   update public.music_research_jobs set status='processing',attempts=attempts+1,msg_id=v_msg.msg_id,
     lease_token=v_token,leased_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
     where id=v_job.id;
   return query select v_job.id,v_job.stage,v_job.model_id,v_token,v_job.creator_m_uid,v_inputs;
   return;
 end loop;
end $fn$;

create or replace function public.mcc_music_research_heartbeat(p_job_id uuid,p_token uuid,p_seconds int default 600)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare v_msg bigint;
begin
 if p_seconds not between 60 and 1800 then raise exception 'bad lease';end if;
 update public.music_research_jobs set leased_until=now()+make_interval(secs=>p_seconds),updated_at=now()
   where id=p_job_id and status='processing' and lease_token=p_token and leased_until>now()
   returning msg_id into v_msg;
 if not found then return false;end if;
 perform pgmq.set_vt('mcc_music_research_v1',v_msg,p_seconds);return true;
end $fn$;

create or replace function public.mcc_music_research_finish(
 p_job_id uuid,p_token uuid,p_result jsonb,p_artifacts jsonb default '[]'::jsonb
) returns boolean language plpgsql security definer set search_path='' as $fn$
declare v_job public.music_research_jobs%rowtype;v_obj jsonb;v_path text;v_kind text;
begin
 if jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>65536 or
    jsonb_typeof(p_artifacts)<>'array' or jsonb_array_length(p_artifacts)>32 then
    raise exception 'invalid result payload';end if;
 select * into v_job from public.music_research_jobs where id=p_job_id for update;
 if not found or v_job.status<>'processing' or v_job.lease_token is distinct from p_token or
    v_job.leased_until<=now() then raise exception 'stale worker cannot commit';end if;
 for v_obj in select * from jsonb_array_elements(p_artifacts) loop
   v_kind:=v_obj->>'kind';v_path:=v_obj->>'object_path';
   if v_kind not in ('stem','midi','musicxml','pdf','features') or
      v_path !~ ('^research/'||v_job.creator_m_uid::text||'/'||v_job.id::text||'/[a-zA-Z0-9._/-]+$') or
      v_path like '%..%' or (v_obj->>'checksum_sha256')!~'^[a-f0-9]{64}$' or
      (v_obj->>'byte_size')::bigint not between 1 and 104857600 or
      not exists(select 1 from storage.objects o where o.bucket_id='creator-research-outputs'
        and o.name=v_path) then raise exception 'missing/invalid private output';end if;
   insert into public.music_research_artifacts(job_id,creator_m_uid,kind,object_path,checksum_sha256,byte_size)
   values(v_job.id,v_job.creator_m_uid,v_kind,v_path,v_obj->>'checksum_sha256',(v_obj->>'byte_size')::bigint);
 end loop;
 update public.music_research_jobs set status='awaiting_review',result=p_result,
   lease_token=null,leased_until=null,updated_at=now() where id=v_job.id;
 perform pgmq.archive('mcc_music_research_v1',v_job.msg_id);
 return true;
end $fn$;

create or replace function public.mcc_music_research_fail(
 p_job_id uuid,p_token uuid,p_error_code text,p_retryable boolean default true
) returns text language plpgsql security definer set search_path='' as $fn$
declare v_job public.music_research_jobs%rowtype;v_delay int;
begin
 select * into v_job from public.music_research_jobs where id=p_job_id for update;
 if not found or v_job.status<>'processing' or v_job.lease_token is distinct from p_token or
    v_job.leased_until<=now() then raise exception 'stale worker cannot fail job';end if;
 if p_retryable and v_job.attempts<v_job.max_attempts then
   v_delay:=least(1800,60*(2^greatest(0,v_job.attempts-1))::int);
   update public.music_research_jobs set status='queued',lease_token=null,leased_until=null,
     error_code=left(p_error_code,100),updated_at=now() where id=p_job_id;
   perform pgmq.set_vt('mcc_music_research_v1',v_job.msg_id,v_delay);return 'queued';
 end if;
 update public.music_research_jobs set status='failed',lease_token=null,leased_until=null,
   error_code=left(p_error_code,100),updated_at=now() where id=p_job_id;
 perform pgmq.archive('mcc_music_research_v1',v_job.msg_id);return 'failed';
end $fn$;

-- Explicit function grants: otherwise SECURITY DEFINER RPCs inherit PUBLIC EXECUTE.
revoke all on function public.mcc_music_research_enqueue(uuid,text,text,text,uuid),
 public.mcc_music_research_review(uuid,text,text),public.mcc_music_research_cancel(uuid),
 public.mcc_music_research_claim(text,integer),public.mcc_music_research_heartbeat(uuid,uuid,integer),
 public.mcc_music_research_finish(uuid,uuid,jsonb,jsonb),
 public.mcc_music_research_fail(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.mcc_music_research_enqueue(uuid,text,text,text,uuid),
 public.mcc_music_research_review(uuid,text,text),public.mcc_music_research_cancel(uuid) to authenticated;
grant execute on function public.mcc_music_research_claim(text,integer),
 public.mcc_music_research_heartbeat(uuid,uuid,integer),
 public.mcc_music_research_finish(uuid,uuid,jsonb,jsonb),
 public.mcc_music_research_fail(uuid,uuid,text,boolean) to service_role;


-- Authenticated creators may discover only operator-approved models. No model download URLs.
create or replace function public.mcc_music_research_available_models()
returns table(model_id text,stage text,version text)
language plpgsql security definer set search_path='' as $fn$
begin
 if auth.uid() is null or public.current_m_uid() is null then
   raise exception 'creator authentication required';
 end if;
 return query select m.model_id,m.stage,m.version from public.music_research_models m
   where m.enabled and m.license_class in ('first_party','approved_commercial')
     and m.reviewed_at is not null order by m.stage,m.model_id;
end $fn$;
revoke all on function public.mcc_music_research_available_models() from public,anon,authenticated;
grant execute on function public.mcc_music_research_available_models() to authenticated;

-- Creator preview access is RLS-limited to listed, still-reviewable artifacts.
-- No insert/update/delete storage policies are granted to browser clients.
drop policy if exists music_research_artifact_owner_download on storage.objects;
create policy music_research_artifact_owner_download on storage.objects
  for select to authenticated
  using(bucket_id='creator-research-outputs' and exists (
    select 1 from public.music_research_artifacts a
      join public.music_research_jobs j on j.id=a.job_id
      where a.object_path=name and a.creator_m_uid=public.current_m_uid()
        and j.creator_m_uid=a.creator_m_uid and a.status<>'rejected'
        and j.status in ('awaiting_review','approved')
  ));
