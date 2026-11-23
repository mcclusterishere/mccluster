-- Creator distribution details v1 (2026-11-23, owner: "its own distribution hub for real").
-- Rollback: 20261123200000_music_creator_distribution_v1.rollback.sql
--
-- creator_tracks.distribution  what the stores need that the release does not already say, written by the creator in
--                              Creator Studio (js/music-creator-studio.js) under their own row rights, shaped and
--                              checked by js/music-distribution.js: release date, explicit, language, P/C lines,
--                              master owner, credits, master and publishing splits, and an ISRC / UPC the creator
--                              already owns (optional). McCluster never mints a code from here.
--
-- It is NOT release content (music_track_content leaves it out): it changes nothing a listener hears or sees, so a
-- creator setting a release date or a split does not take a live release off the shelf. It is reviewed where it is
-- used instead: Control stages a copy into the store pipeline (eu_releases / eu_recordings / eu_rights_splits), where
-- eu-music preflight and the music.deliver approval check it before anything is delivered.
--
-- music_track_content is otherwise exactly 20261030001000_music_release_payment_integrity_v1.sql's.

alter table public.creator_tracks add column if not exists distribution jsonb;

do $$ begin
  alter table public.creator_tracks add constraint creator_tracks_distribution_shape
    check (distribution is null or (jsonb_typeof(distribution) = 'object' and pg_column_size(distribution) <= 65536));
exception when duplicate_object then null; end $$;

create or replace function public.music_track_content(p_row public.creator_tracks)
returns jsonb language sql immutable set search_path = pg_catalog, public as $$
  select to_jsonb(p_row) - array['id','uid','m_uid','created_at','updated_at','status','rights_status',
                                 'moderation_note','published_at','reviewed_snapshot','reviewed_digest','reviewed_at',
                                 'approved_master_version_id','distribution']
$$;
revoke all on function public.music_track_content(public.creator_tracks) from public, anon, authenticated;
