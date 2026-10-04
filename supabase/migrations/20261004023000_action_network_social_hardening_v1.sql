-- ACTION NETWORK SOCIAL HARDENING v1
-- Group rooms are membership boundaries, ordinary reactions/comments are
-- retired, and the unused legacy network_outbox is intentionally retired.

-- A signed-in member may only self-join an open room through direct Data API
-- access. Request/invite membership transitions remain server/desk controlled.
drop policy if exists "a member joins for themselves" on public.network_group_members;
drop policy if exists "a member reads memberships they can see" on public.network_group_members;

create policy "a member joins open groups for themselves"
  on public.network_group_members
  for insert
  to authenticated
  with check (
    m_uid = (select public.current_m_uid())
    and state = 'joined'
    and role = 'member'
    and exists (
      select 1
      from public.network_groups g
      where g.id = network_group_members.group_id
        and g.visibility = 'open'
    )
  );

create policy "a member reads own group memberships"
  on public.network_group_members
  for select
  to authenticated
  using (m_uid = (select public.current_m_uid()));

-- Group posts are members-only. Replies/comments are no longer a write
-- primitive on the Action Network; action missions and proof are.
drop policy if exists network_posts_self_write on public.network_posts;
drop policy if exists network_posts_read on public.network_posts;

create policy network_posts_read
  on public.network_posts
  for select
  to anon, authenticated
  using (
    deleted_at is null
    and removed_at is null
    and reply_to_id is null
    and (
      author_m_uid = (select public.current_m_uid())
      or (
        group_id is not null
        and exists (
          select 1
          from public.network_group_members gm
          where gm.group_id = network_posts.group_id
            and gm.m_uid = (select public.current_m_uid())
            and gm.state = 'joined'
        )
      )
      or (
        group_id is null
        and visibility = 'public'
      )
      or (
        group_id is null
        and visibility = 'network'
        and exists (
          select 1
          from public.network_follows f
          where f.follower_m_uid = (select public.current_m_uid())
            and f.followed_m_uid = network_posts.author_m_uid
            and f.status = 'following'
        )
      )
    )
  );

create policy network_posts_self_insert
  on public.network_posts
  for insert
  to authenticated
  with check (
    author_m_uid = (select public.current_m_uid())
    and reply_to_id is null
    and (
      group_id is null
      or exists (
        select 1
        from public.network_group_members gm
        where gm.group_id = network_posts.group_id
          and gm.m_uid = (select public.current_m_uid())
          and gm.state = 'joined'
      )
    )
  );

create policy network_posts_self_update
  on public.network_posts
  for update
  to authenticated
  using (author_m_uid = (select public.current_m_uid()))
  with check (
    author_m_uid = (select public.current_m_uid())
    and reply_to_id is null
    and (
      group_id is null
      or exists (
        select 1
        from public.network_group_members gm
        where gm.group_id = network_posts.group_id
          and gm.m_uid = (select public.current_m_uid())
          and gm.state = 'joined'
      )
    )
  );

create policy network_posts_self_delete
  on public.network_posts
  for delete
  to authenticated
  using (author_m_uid = (select public.current_m_uid()));

revoke insert, update, delete on public.network_posts from anon;
grant insert, update, delete on public.network_posts to authenticated;

-- Historical reaction rows remain for audit/analytics, but clients can no
-- longer read or mutate them. The Worker also returns HTTP 410 for the old
-- reaction mutation route.
drop policy if exists network_reactions_self_write on public.network_reactions;
drop policy if exists network_reactions_read on public.network_reactions;
revoke select, insert, update, delete on public.network_reactions from anon, authenticated;

-- The outbox has never had a delivery target or ack path. Feed items,
-- notifications, action events and analytics are written directly to their
-- canonical tables, so stop creating dead-letter work.
drop trigger if exists mnet_post_outbox_trg on public.network_posts;
drop trigger if exists mnet_reaction_outbox_trg on public.network_reactions;
drop trigger if exists mnet_follow_outbox_trg on public.network_follows;

update public.network_outbox
set status = 'dead',
    last_error = 'retired: Action Network uses direct canonical feed/notification/action-event paths'
where status in ('pending','processing','failed');

-- Profile completion previously wrote the same unused outbox. Keep the
-- canonical profile/onboarding/welcome behavior, minus the dead event.
create or replace function public.mnet_complete_surface_profile(
  p_app_key text,
  p_display_name text,
  p_headline text default '',
  p_bio text default '',
  p_avatar_url text default '',
  p_banner_url text default '',
  p_website_url text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_m_uid uuid;
  v_app_id uuid;
  v_mccluster_id text;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  if nullif(btrim(coalesce(p_display_name,'')),'') is null then raise exception 'display_name_required'; end if;

  select id into v_app_id
  from public.platform_apps
  where app_key = p_app_key and enabled = true
  limit 1;
  if v_app_id is null then raise exception 'unknown_app'; end if;

  select public.current_m_uid() into v_m_uid;
  if v_m_uid is null then raise exception 'identity_missing'; end if;

  select mccluster_id into v_mccluster_id
  from public.platform_profiles
  where user_id = v_uid;
  if nullif(btrim(coalesce(v_mccluster_id,'')),'') is null then raise exception 'mccluster_id_required'; end if;

  insert into public.network_profiles(m_uid,display_name)
  values(v_m_uid,btrim(p_display_name))
  on conflict (m_uid) do nothing;

  update public.network_profiles
  set display_name = btrim(p_display_name),
      headline = coalesce(p_headline,''),
      bio = coalesce(p_bio,''),
      avatar_url = coalesce(p_avatar_url,''),
      banner_url = coalesce(p_banner_url,''),
      website_url = coalesce(p_website_url,''),
      updated_at = now(),
      profile_version = profile_version + 1
  where m_uid = v_m_uid;

  insert into public.mnet_onboarding_state(m_uid,app_id,status,profile_completed_at,last_seen_at)
  values(v_m_uid,v_app_id,'feed_ready',now(),now())
  on conflict (m_uid,app_id) do update set
    status = 'feed_ready',
    profile_completed_at = coalesce(public.mnet_onboarding_state.profile_completed_at,now()),
    last_seen_at = now();

  perform public.mnet_follow_admins(v_m_uid);

  begin
    perform public.mnet_send_welcome(v_m_uid);
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true, 'mccluster_id', v_mccluster_id);
end;
$$;

revoke all on function public.mnet_complete_surface_profile(text,text,text,text,text,text,text)
  from public, anon;
grant execute on function public.mnet_complete_surface_profile(text,text,text,text,text,text,text)
  to authenticated, service_role;

drop function if exists public.mnet_claim_outbox(integer);
drop function if exists public.mnet_enqueue_outbox();

comment on table public.network_outbox is
  'Retired legacy Mnet delivery outbox. Historical rows are retained for audit only; Action Network writes directly to canonical feed, notification, action-event and analytics paths.';
