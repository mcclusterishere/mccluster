-- Signed-out reads stop failing on current_m_uid().
--
-- The P0 containment (20260913174500) closed EXECUTE on public.current_m_uid()
-- to anon, rightly. Twenty-one row policies still applied to anon (or to
-- PUBLIC) and called it, so every signed-out read of those tables failed with
-- a permission error that PostgREST answers as 401: the "From creators" shelf
-- on listen.html (creator_tracks, music_creator_profiles) has been empty for
-- every visitor, and the public network reads were one anonymous request away
-- from the same.
--
-- Nothing is re-granted. Policies about a member's own rows now apply to
-- authenticated only (a visitor owns none of them), and each mixed read rule
-- is split: anon gets exactly its public half, members keep the whole rule.
-- For anon the owner half was always false (no session, no M person), so what
-- anyone can read is unchanged; only the error goes away.

set local lock_timeout = '5s';

-- a member's own rows
alter policy network_activity_self_insert on public.network_activity to authenticated;
alter policy network_attribution_self_insert on public.network_attribution to authenticated;
alter policy network_blocks_self on public.network_blocks to authenticated;
alter policy network_bookmarks_self on public.network_bookmarks to authenticated;
alter policy network_connections_member_read on public.network_connections to authenticated;
alter policy network_connections_self_update on public.network_connections to authenticated;
alter policy network_connections_self_write on public.network_connections to authenticated;
alter policy network_follows_self_read on public.network_follows to authenticated;
alter policy network_follows_self_write on public.network_follows to authenticated;
alter policy network_mutes_self on public.network_mutes to authenticated;
alter policy network_post_edges_self_write on public.network_post_edges to authenticated;
alter policy network_profiles_self on public.network_profiles to authenticated;
alter policy network_sessions_self_insert on public.network_sessions to authenticated;
alter policy network_sessions_self_read on public.network_sessions to authenticated;
alter policy network_telemetry_self_insert on public.network_telemetry_events to authenticated;

-- public halves for visitors, whole rules for members
alter policy music_creator_tracks_read on public.creator_tracks to authenticated;
drop policy if exists music_creator_tracks_public_read on public.creator_tracks;
create policy music_creator_tracks_public_read on public.creator_tracks
  for select to anon using (status = 'published');

alter policy music_creator_profiles_read on public.music_creator_profiles to authenticated;
drop policy if exists music_creator_profiles_public_read on public.music_creator_profiles;
create policy music_creator_profiles_public_read on public.music_creator_profiles
  for select to anon using (status = 'active');

alter policy music_license_offers_read on public.music_license_offers to authenticated;
drop policy if exists music_license_offers_public_read on public.music_license_offers;
create policy music_license_offers_public_read on public.music_license_offers
  for select to anon using (active = true);

alter policy network_activity_read on public.network_activity to authenticated;
drop policy if exists network_activity_public_read on public.network_activity;
create policy network_activity_public_read on public.network_activity
  for select to anon using (visibility = 'public');

alter policy action_network_posts_read on public.network_posts to authenticated;
drop policy if exists action_network_posts_public_read on public.network_posts;
create policy action_network_posts_public_read on public.network_posts
  for select to anon using (
    deleted_at is null and removed_at is null and reply_to_id is null
    and group_id is null and visibility = 'public');

alter policy network_profiles_read on public.network_profiles to authenticated;
drop policy if exists network_profiles_public_read on public.network_profiles;
create policy network_profiles_public_read on public.network_profiles
  for select to anon using (visibility = 'public');
