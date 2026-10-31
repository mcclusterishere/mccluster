-- Lyric machine v1: an uploaded release gets timed lyrics automatically.
--
-- PENDING: not applied. The owner applies it after McCluster Core is deployed
-- with the `lyrics_align` executor (core/src/executors/lyrics-align.mjs);
-- applied earlier, Core quarantines the jobs as an unsupported type.
-- Rollback: 20261031180000_lyrics_machine_v1.rollback.sql
--
-- What it does, on the existing tables only (no new backend, no new queue):
--   creator_tracks.lyrics_sheet  the creator's optional lyric sheet (plain text,
--                                docx/LRC/TTML already read to text in the browser)
--   creator_tracks.lyrics        (existing jsonb) receives the timed lyrics
--   a trigger queues ONE `lyrics_align` job on public.ops_agent_jobs (house org)
--   when a release is created with a master, when its master changes, or when
--   its lyric sheet changes. Core downloads the master with its service key,
--   runs separation -> recognition -> alignment, and writes creator_tracks.lyrics
--   only when the current lyrics are empty or machine-made and unreviewed:
--   lyrics the owner reviewed are never overwritten.

alter table public.creator_tracks
  add column if not exists lyrics_sheet text;

do $$ begin
  alter table public.creator_tracks add constraint creator_tracks_lyrics_sheet_len
    check (lyrics_sheet is null or char_length(lyrics_sheet) <= 40000);
exception when duplicate_object then null; end $$;

create or replace function public.music_queue_lyrics_align()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  if new.master_path is null or new.master_path = '' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.master_path is not distinct from old.master_path
     and new.lyrics_sheet is not distinct from old.lyrics_sheet then
    return new;
  end if;
  select id into v_org from public.orgs where slug = 'mccluster' limit 1;
  if v_org is null then
    return new;
  end if;
  if not exists (
    select 1 from public.ops_agent_jobs j
    where j.org_id = v_org
      and j.job_type = 'lyrics_align'
      and j.target_type = 'creator_track'
      and j.target_id = new.id::text
      and j.status in ('queued', 'running')
  ) then
    insert into public.ops_agent_jobs(org_id, job_type, target_type, target_id, priority, max_attempts, input)
    values (
      v_org, 'lyrics_align', 'creator_track', new.id::text, 40, 2,
      jsonb_build_object('track_id', new.id, 'trigger', lower(tg_op), 'with_sheet', new.lyrics_sheet is not null and new.lyrics_sheet <> '')
    );
  end if;
  return new;
end;
$$;

revoke all on function public.music_queue_lyrics_align() from public, anon, authenticated;

drop trigger if exists trg_creator_tracks_lyrics_align on public.creator_tracks;
create trigger trg_creator_tracks_lyrics_align
after insert or update of master_path, lyrics_sheet on public.creator_tracks
for each row execute function public.music_queue_lyrics_align();
