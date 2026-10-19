-- Run ONLY against disposable local test database AFTER the pending migration.
-- No production data or privileged credentials are needed.
\set ON_ERROR_STOP on
begin;
do $test$
declare v_count int;v_public boolean;
begin
  if not exists(select 1 from pgmq.list_queues() where queue_name='mcc_music_research_v1') then
    raise exception 'durable music PGMQ queue not installed';
  end if;
  select count(*) into v_count from public.music_research_models
    where enabled and stage in ('separate','transcribe','engrave');
  if v_count<>0 then raise exception 'unreviewed model checkpoints must stay disabled';end if;
  if not exists(select 1 from public.music_research_models
    where model_id='mcc_spectral_v1' and enabled and license_class='first_party') then
    raise exception 'first party spectral analysis model missing';end if;
  select b.public into v_public from storage.buckets b where b.id='creator-research-outputs';
  if v_public is distinct from false then raise exception 'research output bucket must be private';end if;
  if not exists(select 1 from pg_policies where schemaname='storage'
    and tablename='objects' and policyname='music_research_creator_artifact_read') then
    raise exception 'creator-private artifact preview policy missing';end if;
  if has_function_privilege('anon','public.mcc_music_research_claim(text,integer)','EXECUTE') or
     has_function_privilege('authenticated','public.mcc_music_research_claim(text,integer)','EXECUTE') or
     has_function_privilege('anon','public.mcc_music_research_enqueue(uuid,text,text,text,uuid)','EXECUTE') or
     has_function_privilege('anon','public.mcc_music_research_review(uuid,text,text)','EXECUTE') or
     has_function_privilege('authenticated','public.mcc_music_research_finish(uuid,uuid,jsonb,jsonb)','EXECUTE') then
    raise exception 'privileged research queue operation is exposed';
  end if;
  if not has_function_privilege('authenticated','public.mcc_music_research_enqueue(uuid,text,text,text,uuid)','EXECUTE') or
     not has_function_privilege('authenticated','public.mcc_music_research_review(uuid,text,text)','EXECUTE') or
     not has_function_privilege('service_role','public.mcc_music_research_finish(uuid,uuid,jsonb,jsonb)','EXECUTE') then
    raise exception 'expected creator/server grants missing';
  end if;
  if exists(select 1 from public.music_research_jobs) then
    raise exception 'fixture must have no inherited music job records';
  end if;
  if (select count(*) from public.mcc_music_research_claim('test-worker',60))<>0 then
    raise exception 'empty queue claim should yield no jobs';
  end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in
      ('music_research_jobs','music_research_models','music_research_reviews',
       'music_research_artifacts') and c.relrowsecurity=false) then
    raise exception 'new research data must have RLS enabled';
  end if;
end $test$;

-- Negative access checks: database roles must not get worker-only grants.
set local role anon;
do $test$
begin
 if has_function_privilege(current_user,'public.mcc_music_research_claim(text,integer)','EXECUTE') then
   raise exception 'anon can claim private queued masters';
 end if;
 if has_function_privilege(current_user,'public.mcc_music_research_review(uuid,text,text)','EXECUTE') then
   raise exception 'anon can review private research artifacts';
 end if;
end $test$;
reset role;
rollback;
