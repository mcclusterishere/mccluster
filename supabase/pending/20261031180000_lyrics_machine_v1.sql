-- Shared music-platform support used by Equity Uprise; no building capability is added.
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
--   creator_tracks.lyrics_input_rev  md5(master_path || lyrics_sheet), kept by
--                                the database on every write: the revision of
--                                the inputs the lyrics must match
--   a trigger queues a `lyrics_align` job on public.ops_agent_jobs (house org)
--   when a release is created with a master, when its master changes, or when
--   its lyric sheet changes. A job that is still QUEUED covers the change (it
--   reads the release when it starts); a job already RUNNING does not, so a new
--   one is queued behind it. Core downloads the master with its service key,
--   runs separation -> recognition -> alignment, and writes creator_tracks.lyrics
--   only where lyrics_input_rev still equals the revision it listened to (a run
--   whose inputs changed underneath it writes nothing) and only when the current
--   lyrics are empty or machine-made and unreviewed: lyrics the owner reviewed
--   are never overwritten.

-- Apply after 20261123200000_music_creator_distribution_v1.sql, in one
-- transaction. The sheet and its derived revision are processing inputs;
-- the existing `lyrics` field remains reviewed release content. Excluding
-- only these inputs preserves prior published snapshots during the backfill.
set local lock_timeout = '5s';
select pg_advisory_xact_lock(823, 20261123);
lock table public.creator_tracks in access exclusive mode;
do $lyrics_preflight$
declare actual record; expected record;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000', message='MUSIC_READ_COMMITTED_REQUIRED: a stale snapshot cannot prove current content or recovery state';
  end if;
  if not exists(select 1 from pg_attribute where attrelid='public.creator_tracks'::regclass
      and attname='distribution' and atttypid='jsonb'::regtype and not attisdropped) then
    raise exception using errcode='55000', message='MUSIC_DISTRIBUTION_REQUIRED: apply the distribution migration before lyrics inputs';
  end if;
  select p.*, l.lanname into actual from pg_proc p join pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure('public.music_track_content(public.creator_tracks)');
  if not found or actual.lanname <> 'sql' or actual.prosecdef or actual.provolatile <> 'i'
     or actual.proconfig is distinct from array['search_path=pg_catalog, public']
     or actual.prorettype <> 'jsonb'::regtype
     or md5(replace(actual.prosrc, E'\r\n', E'\n')) not in
        ('e4c86461a97fa7eb69a291fe184188de', 'a6e0e769dd46117627e815fc2f613fec') then
    raise exception using errcode='55000', message='MUSIC_CONTENT_BASELINE_CHANGED: review the live content helper before lyrics inputs';
  end if;
  if to_regclass('public.orgs') is null or to_regclass('public.ops_agent_jobs') is null then
    raise exception using errcode='55000', message='MUSIC_LYRICS_QUEUE_REQUIRED: canonical organization and job tables are required';
  end if;
  for expected in select * from (values
      ('public.music_lyrics_input_rev()', 'd4a097c879044a4c745b3fae1497af14', false),
      ('public.music_queue_lyrics_align()', 'cf90bda0e81d56b9822e87cb8d61537a', true)
    ) as reviewed(signature, body_md5, is_definer) loop
    select p.*, l.lanname into actual from pg_proc p join pg_language l on l.oid=p.prolang
     where p.oid=to_regprocedure(expected.signature);
    if found and (actual.lanname <> 'plpgsql' or actual.prosecdef is distinct from expected.is_definer
       or actual.proconfig is distinct from array['search_path=public, pg_temp']
       or actual.prorettype <> 'trigger'::regtype
       or md5(replace(actual.prosrc, E'\r\n', E'\n')) <> expected.body_md5) then
      raise exception using errcode='55000', message='MUSIC_LYRICS_BASELINE_CHANGED: review the existing lyrics trigger function';
    end if;
  end loop;
end $lyrics_preflight$;

alter table public.creator_tracks
  add column if not exists lyrics_sheet text,
  add column if not exists lyrics_input_rev text;

create or replace function public.music_track_content(p_row public.creator_tracks)
returns jsonb language sql immutable set search_path = pg_catalog, public as $$
  select to_jsonb(p_row) - array['id','uid','m_uid','created_at','updated_at','status','rights_status',
                                 'moderation_note','published_at','reviewed_snapshot','reviewed_digest','reviewed_at',
                                 'approved_master_version_id','distribution','lyrics_sheet','lyrics_input_rev']
$$;
revoke all on function public.music_track_content(public.creator_tracks) from public, anon, authenticated;

create or replace function public.music_lyrics_input_rev()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.lyrics_input_rev := md5(coalesce(new.master_path, '') || chr(10) || coalesce(new.lyrics_sheet, ''));
  return new;
end;
$$;

revoke all on function public.music_lyrics_input_rev() from public, anon, authenticated;

drop trigger if exists trg_creator_tracks_lyrics_input_rev on public.creator_tracks;
create trigger trg_creator_tracks_lyrics_input_rev
before insert or update on public.creator_tracks
for each row execute function public.music_lyrics_input_rev();

-- The canonical track guard distinguishes the service claim from a creator.
-- This administrative backfill must use that claim and restore the caller's
-- prior setting afterwards. It neither approves content nor queues old rows.
do $lyrics_backfill$
declare prior_claims text := current_setting('request.jwt.claims', true);
        prior_role text := current_setting('request.jwt.claim.role', true);
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.creator_tracks
     set lyrics_input_rev = md5(coalesce(master_path, '') || chr(10) || coalesce(lyrics_sheet, ''))
   where lyrics_input_rev is distinct from md5(coalesce(master_path, '') || chr(10) || coalesce(lyrics_sheet, ''));
  perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(prior_role, ''), true);
end $lyrics_backfill$;

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
      and j.status = 'queued'   -- a running job heard the old inputs: never let it stand in for the new ones
  ) then
    insert into public.ops_agent_jobs(org_id, job_type, target_type, target_id, priority, max_attempts, input)
    values (
      v_org, 'lyrics_align', 'creator_track', new.id::text, 40, 2,
      jsonb_build_object('track_id', new.id, 'trigger', lower(tg_op), 'input_rev', new.lyrics_input_rev,
                         'with_sheet', new.lyrics_sheet is not null and new.lyrics_sheet <> '')
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
