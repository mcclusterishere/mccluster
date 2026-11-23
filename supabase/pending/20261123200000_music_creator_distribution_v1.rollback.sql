-- Rollback for 20261123200000_music_creator_distribution_v1.sql.
-- music_track_content goes back to 20261030001000's list. The column is kept by default (it holds creators' credits
-- and splits); uncomment the last statements to remove it.
create or replace function public.music_track_content(p_row public.creator_tracks)
returns jsonb language sql immutable set search_path = pg_catalog, public as $$
  select to_jsonb(p_row) - array['id','uid','m_uid','created_at','updated_at','status','rights_status',
                                 'moderation_note','published_at','reviewed_snapshot','reviewed_digest','reviewed_at',
                                 'approved_master_version_id']
$$;
revoke all on function public.music_track_content(public.creator_tracks) from public, anon, authenticated;
-- alter table public.creator_tracks drop constraint if exists creator_tracks_distribution_shape;
-- alter table public.creator_tracks drop column if exists distribution;
