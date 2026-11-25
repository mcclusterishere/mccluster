-- Rollback of supabase/pending/20261125090000_mentor_outreach_pipeline_v1.sql (migration name mentor_outreach_pipeline_v1_rollback).
-- Never a forward migration. Owner approval required; applied as postgres. It refuses (55000), changing nothing, while any
-- send is recorded: the send and reply history is the campaign record and must be exported before it is dropped.
begin;
set local lock_timeout = '5s';
do $refuse$
begin
  if to_regclass('public.outreach_sends') is not null and exists (select 1 from public.outreach_sends) then
    raise exception 'mentor_outreach_pipeline_v1 rollback refused: outreach_sends has rows; export them first; nothing changed' using errcode = '55000';
  end if;
end $refuse$;
drop view if exists public.outreach_frame_stats;
drop table if exists public.outreach_replies;
drop table if exists public.outreach_sends;
drop table if exists public.outreach_drafts;
drop table if exists public.outreach_sources;
drop table if exists public.outreach_candidates;
drop table if exists public.outreach_runs;
drop function if exists public.outreach_sends_guard();
drop function if exists public.outreach_drafts_guard();
commit;
