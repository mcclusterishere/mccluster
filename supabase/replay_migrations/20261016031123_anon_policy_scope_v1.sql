-- Replay twin of supabase/migrations/20261016031123_anon_policy_scope_v1.sql,
-- used only by scripts/supabase-local-reset-with-replay.sh (CI rebuilds).
--
-- Production created the fifteen network_* self policies and the mixed read
-- policies outside the replayable history, so a rebuilt database lacks some of
-- them and a bare ALTER POLICY fails (42704). This twin applies the same
-- changes only where the policy (or table) exists; on production, where every
-- object exists, it is the same effect as the recorded migration, which stays
-- byte-identical to the stored statement.
set local lock_timeout = '5s';

do $$
declare
  r record;
begin
  -- a member's own rows: authenticated only
  for r in select * from (values
    ('network_activity_self_insert','network_activity'),
    ('network_attribution_self_insert','network_attribution'),
    ('network_blocks_self','network_blocks'),
    ('network_bookmarks_self','network_bookmarks'),
    ('network_connections_member_read','network_connections'),
    ('network_connections_self_update','network_connections'),
    ('network_connections_self_write','network_connections'),
    ('network_follows_self_read','network_follows'),
    ('network_follows_self_write','network_follows'),
    ('network_mutes_self','network_mutes'),
    ('network_post_edges_self_write','network_post_edges'),
    ('network_profiles_self','network_profiles'),
    ('network_sessions_self_insert','network_sessions'),
    ('network_sessions_self_read','network_sessions'),
    ('network_telemetry_self_insert','network_telemetry_events'),
    -- the whole mixed read rules stay for members
    ('music_creator_tracks_read','creator_tracks'),
    ('music_creator_profiles_read','music_creator_profiles'),
    ('music_license_offers_read','music_license_offers'),
    ('network_activity_read','network_activity'),
    ('action_network_posts_read','network_posts'),
    ('network_profiles_read','network_profiles'),
    ('creator_service_read','creator_service_offers')
  ) v(pol, tbl) loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tbl and policyname = r.pol) then
      execute format('alter policy %I on public.%I to authenticated', r.pol, r.tbl);
    end if;
  end loop;
end $$;

-- the public halves for visitors, where the table exists
do $$
begin
  if to_regclass('public.creator_tracks') is not null then
    drop policy if exists music_creator_tracks_public_read on public.creator_tracks;
    create policy music_creator_tracks_public_read on public.creator_tracks
      for select to anon using (status = 'published');
  end if;
  if to_regclass('public.music_creator_profiles') is not null then
    drop policy if exists music_creator_profiles_public_read on public.music_creator_profiles;
    create policy music_creator_profiles_public_read on public.music_creator_profiles
      for select to anon using (status = 'active');
  end if;
  if to_regclass('public.music_license_offers') is not null then
    drop policy if exists music_license_offers_public_read on public.music_license_offers;
    create policy music_license_offers_public_read on public.music_license_offers
      for select to anon using (active = true);
  end if;
  if to_regclass('public.network_activity') is not null then
    drop policy if exists network_activity_public_read on public.network_activity;
    create policy network_activity_public_read on public.network_activity
      for select to anon using (visibility = 'public');
  end if;
  if to_regclass('public.network_posts') is not null then
    drop policy if exists action_network_posts_public_read on public.network_posts;
    create policy action_network_posts_public_read on public.network_posts
      for select to anon using (
        deleted_at is null and removed_at is null and reply_to_id is null
        and group_id is null and visibility = 'public');
  end if;
  if to_regclass('public.network_profiles') is not null then
    drop policy if exists network_profiles_public_read on public.network_profiles;
    create policy network_profiles_public_read on public.network_profiles
      for select to anon using (visibility = 'public');
  end if;
  if to_regclass('public.creator_service_offers') is not null and to_regclass('public.network_profiles') is not null then
    drop policy if exists creator_service_public_read on public.creator_service_offers;
    create policy creator_service_public_read on public.creator_service_offers
      for select to anon using (
        status = 'published' and exists (
          select 1 from public.network_profiles p
          where p.m_uid = creator_service_offers.m_uid and p.visibility = 'public'));
  end if;
end $$;
