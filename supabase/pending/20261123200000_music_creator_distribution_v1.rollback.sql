-- Shared music-platform support used by Equity Uprise; no building capability is added.
-- Rollback for 20261123200000_music_creator_distribution_v1.sql.
-- Explicit approval and one transaction required. Disable distribution writes
-- first. Refuse stored credits/splits, or a later content-contract migration.
-- Keeping the column while restoring the old helper would add it to reviewed
-- content and break the next update of a published release. An empty column
-- can be removed safely; nonempty data stays until separately reconciled.
set local lock_timeout = '5s';
select pg_advisory_xact_lock(823, 20261123);
lock table public.creator_tracks in access exclusive mode;
do $distribution_rollback_guard$
declare actual record; has_data boolean;
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
        ('b2f96e6d2fa145d00adcc6267bbe0944', 'e4c86461a97fa7eb69a291fe184188de') then
    raise exception using errcode='55000', message='MUSIC_CONTENT_BASELINE_CHANGED: retain distribution while a later content contract exists';
  end if;
  if exists(select 1 from pg_attribute where attrelid='public.creator_tracks'::regclass
     and attname='distribution' and not attisdropped) then
    execute 'select exists(select 1 from public.creator_tracks where distribution is not null)' into has_data;
    if has_data then
      raise exception using errcode='55000', message='DISTRIBUTION_ROLLBACK_DATA_PRESENT: retain creator credits and splits';
    end if;
  end if;
end $distribution_rollback_guard$;

create or replace function public.music_track_content(p_row public.creator_tracks)
returns jsonb language sql immutable set search_path = pg_catalog, public as $$
  select to_jsonb(p_row) - array['id','uid','m_uid','created_at','updated_at','status','rights_status',
                                 'moderation_note','published_at','reviewed_snapshot','reviewed_digest','reviewed_at',
                                 'approved_master_version_id']
$$;
revoke all on function public.music_track_content(public.creator_tracks) from public, anon, authenticated;
alter table public.creator_tracks drop constraint if exists creator_tracks_distribution_shape;
alter table public.creator_tracks drop column if exists distribution;
