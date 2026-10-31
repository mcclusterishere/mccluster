-- Rollback for 20261031180000_lyrics_machine_v1.sql.
-- Drops the trigger and function. The lyrics_sheet column is kept by default
-- (it may hold creators' words); uncomment the last statements to remove it.
drop trigger if exists trg_creator_tracks_lyrics_align on public.creator_tracks;
drop function if exists public.music_queue_lyrics_align();
-- queued jobs that no executor will run once the trigger is gone
update public.ops_agent_jobs set status = 'failed', last_error = 'lyrics machine rolled back'
 where job_type = 'lyrics_align' and status = 'queued';
-- alter table public.creator_tracks drop constraint if exists creator_tracks_lyrics_sheet_len;
-- alter table public.creator_tracks drop column if exists lyrics_sheet;
