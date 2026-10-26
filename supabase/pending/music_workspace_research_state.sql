-- PENDING. Read-only owner state for the existing private review UI.
-- Requires workspace handoff + reconciled research queue. Enables nothing.
begin;
create function public.music_workspace_research_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_uid uuid:=auth.uid();owner_muid uuid:=public.current_m_uid();answer jsonb;
begin
 if owner_uid is null or owner_muid is null then raise exception 'creator authentication required';end if;
 with owned as (
  select t.id,t.title,t.status,t.rights_status,
    (t.status not in ('rejected','archived') and t.rights_status in ('attested','cleared')
      and exists(select 1 from public.music_rights_attestations a where a.track_id=t.id
        and a.creator_m_uid=owner_muid and a.owns_master and a.collaborators_cleared)) eligible
  from public.creator_tracks t join public.music_workspace_release_handoffs h on h.track_id=t.id
  where t.uid=owner_uid and t.m_uid=owner_muid and h.owner_id=owner_uid
    and h.creator_m_uid=owner_muid and h.completed_at is not null
    and t.master_bucket='creator-masters' and t.master_path=h.master_path
    and t.rights_declaration->'workspace_handoff'->>'id'=h.id::text
  order by h.completed_at desc limit 100
 ), history as (
  select j.* from public.music_research_jobs j join owned t on t.id=j.track_id
  where j.creator_m_uid=owner_muid order by j.created_at desc limit 100
 ) select jsonb_build_object(
  'enqueue_enabled',coalesce((select enqueue_enabled from public.music_research_capabilities where singleton),false),
  'execution_enabled',coalesce((select execution_enabled from public.music_research_capabilities where singleton),false),
  'tracks',coalesce((select jsonb_agg(to_jsonb(t)) from owned t),'[]'::jsonb),
  'models',coalesce((select jsonb_agg(jsonb_build_object('model_id',m.model_id,'stage',m.stage,'version',m.version))
    from public.music_research_models m where m.enabled and m.license_class in ('first_party','approved_commercial') and m.reviewed_at is not null),'[]'::jsonb),
  'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'track_id',j.track_id,'stage',j.stage,'model_id',j.model_id,'status',j.status,'created_at',j.created_at,'error_code',j.error_code,'result',j.result)) from history j),'[]'::jsonb),
  'artifacts',coalesce((select jsonb_agg(to_jsonb(a)) from (
    select a.id,a.job_id,a.kind,a.object_path,a.checksum_sha256,a.byte_size,a.status
    from public.music_research_artifacts a join history j on j.id=a.job_id
    where a.creator_m_uid=owner_muid and j.status in ('awaiting_review','approved')
      and a.status in ('quarantined','creator_approved') order by a.created_at desc limit 300
   ) a),'[]'::jsonb)
 ) into answer;
 return answer;
end $$;
revoke all on function public.music_workspace_research_state() from public,anon;
grant execute on function public.music_workspace_research_state() to authenticated;
commit;
