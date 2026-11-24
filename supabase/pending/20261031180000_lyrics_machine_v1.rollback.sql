-- Shared music-platform support used by Equity Uprise; no building capability is added.
-- Operational rollback for 20261031180000_lyrics_machine_v1.sql.
-- Explicit approval and one transaction required. Stop new lyrics admission
-- and drain all queued/running lyrics jobs first; this file refuses otherwise.
-- Keep creators' sheets, derived revisions, actual lyrics and job history.
-- Keep the revision trigger and content exclusions so a later edit neither
-- forges a revision nor breaks a published release's reviewed digest.
-- Reapplying the forward file restores automatic enqueueing. Removing stored
-- inputs is a separate reviewed data migration, never an uncommented DROP.
set local lock_timeout = '5s';
select pg_advisory_xact_lock(823, 20261123);
lock table public.creator_tracks in access exclusive mode;
lock table public.ops_agent_jobs in share row exclusive mode;
do $lyrics_rollback_guard$
declare actual record;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000', message='MUSIC_READ_COMMITTED_REQUIRED: a stale snapshot cannot prove current content or recovery state';
  end if;
  select p.*, l.lanname into actual from pg_proc p join pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure('public.music_track_content(public.creator_tracks)');
  if not found or actual.lanname <> 'sql' or actual.prosecdef or actual.provolatile <> 'i'
     or actual.proconfig is distinct from array['search_path=pg_catalog, public']
     or actual.prorettype <> 'jsonb'::regtype
     or md5(replace(actual.prosrc, E'\r\n', E'\n')) not in
        ('e4c86461a97fa7eb69a291fe184188de', 'a6e0e769dd46117627e815fc2f613fec') then
    raise exception using errcode='55000', message='MUSIC_CONTENT_BASELINE_CHANGED: retain lyrics inputs under an unknown content contract';
  end if;
  if exists(select 1 from public.ops_agent_jobs where job_type='lyrics_align' and status in ('queued','running')) then
    raise exception using errcode='55000', message='LYRICS_ROLLBACK_ACTIVE_JOBS: drain queued and running lyrics work before recovery';
  end if;
  select p.*, l.lanname into actual from pg_proc p join pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure('public.music_queue_lyrics_align()');
  if found and (actual.lanname <> 'plpgsql' or not actual.prosecdef
     or actual.proconfig is distinct from array['search_path=public, pg_temp']
     or actual.prorettype <> 'trigger'::regtype
     or md5(replace(actual.prosrc, E'\r\n', E'\n')) <> 'cf90bda0e81d56b9822e87cb8d61537a') then
    raise exception using errcode='55000', message='MUSIC_LYRICS_BASELINE_CHANGED: retain the changed lyrics queue function';
  end if;
end $lyrics_rollback_guard$;

drop trigger if exists trg_creator_tracks_lyrics_align on public.creator_tracks;
drop function if exists public.music_queue_lyrics_align();
