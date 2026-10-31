-- PENDING; requires reconciled #543 queue and music_workspace_release_handoff.
-- A narrow bridge into the existing queue. No second queue or provider runner.
begin;
create function public.music_workspace_research_enqueue(
 p_track_id uuid,p_stage text,p_model_id text,p_idempotency_key text,
 p_parent_job_id uuid default null,p_consent boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_consent is distinct from true then
   raise exception 'signed in creator and explicit analysis consent required';
 end if;
 if not exists(select 1 from public.creator_tracks t
   join public.music_workspace_release_handoffs h on h.track_id=t.id
   where t.id=p_track_id and t.uid=auth.uid() and t.m_uid=public.current_m_uid()
     and h.owner_id=auth.uid() and h.creator_m_uid=t.m_uid and h.completed_at is not null
     and t.master_bucket='creator-masters' and t.master_path=h.master_path
     and t.rights_declaration->'workspace_handoff'->>'id'=h.id::text) then
   raise exception 'completed creator-owned workspace handoff required';
 end if;
 return public.mcc_music_research_enqueue(p_track_id,p_stage,p_model_id,p_idempotency_key,p_parent_job_id,p_consent);
end $$;
revoke all on function public.music_workspace_research_enqueue(uuid,text,text,text,uuid,boolean) from public,anon;
grant execute on function public.music_workspace_research_enqueue(uuid,text,text,text,uuid,boolean) to authenticated;

commit;
