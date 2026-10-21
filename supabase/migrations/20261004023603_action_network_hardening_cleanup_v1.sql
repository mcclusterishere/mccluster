-- ACTION NETWORK HARDENING CLEANUP v1
-- Canonicalize the policy set created by action_network_hardening_v1,
-- fully retire comments/reactions from the client data plane, and remove
-- the legacy outbox producers/claim surface so the queue cannot regrow.

-- Groups: members may discover their own membership; direct self-join is
-- only allowed for open groups. Request/invite transitions stay server-side.
drop policy if exists "a member joins for themselves" on public.network_group_members;
drop policy if exists "a member reads memberships they can see" on public.network_group_members;
drop policy if exists "action_network_open_group_join_boundary" on public.network_group_members;
drop policy if exists "action_network_group_membership_read_boundary" on public.network_group_members;

create policy "action_network_open_group_self_join"
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

create policy "action_network_own_group_membership_read"
  on public.network_group_members
  for select
  to authenticated
  using (m_uid = (select public.current_m_uid()));

-- Posts: a group is a real room boundary. Historical replies/comments are
-- not a readable or writable interaction primitive on the Action Network.
drop policy if exists network_posts_self_write on public.network_posts;
drop policy if exists network_posts_read on public.network_posts;
drop policy if exists action_network_group_read_boundary on public.network_posts;
drop policy if exists action_network_post_insert_boundary on public.network_posts;
drop policy if exists action_network_post_update_boundary on public.network_posts;

create policy action_network_posts_read
  on public.network_posts
  for select
  to anon, authenticated
  using (
    deleted_at is null
    and removed_at is null
    and reply_to_id is null
    and (
      (
        group_id is not null
        and (select public.current_m_uid()) is not null
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
        and (
          author_m_uid = (select public.current_m_uid())
          or visibility = 'public'
          or (
            visibility = 'network'
            and exists (
              select 1
              from public.network_follows f
              where f.follower_m_uid = (select public.current_m_uid())
                and f.followed_m_uid = network_posts.author_m_uid
                and f.status = 'following'
            )
          )
        )
      )
    )
  );

create policy action_network_posts_insert
  on public.network_posts
  for insert
  to authenticated
  with check (
    author_m_uid = (select public.current_m_uid())
    and reply_to_id is null
    and (
      group_id is null
      or (
        visibility = 'network'
        and exists (
          select 1
          from public.network_group_members gm
          where gm.group_id = network_posts.group_id
            and gm.m_uid = (select public.current_m_uid())
            and gm.state = 'joined'
        )
      )
    )
  );

create policy action_network_posts_update
  on public.network_posts
  for update
  to authenticated
  using (author_m_uid = (select public.current_m_uid()) and reply_to_id is null)
  with check (
    author_m_uid = (select public.current_m_uid())
    and reply_to_id is null
    and (
      group_id is null
      or (
        visibility = 'network'
        and exists (
          select 1
          from public.network_group_members gm
          where gm.group_id = network_posts.group_id
            and gm.m_uid = (select public.current_m_uid())
            and gm.state = 'joined'
        )
      )
    )
  );

create policy action_network_posts_delete
  on public.network_posts
  for delete
  to authenticated
  using (author_m_uid = (select public.current_m_uid()));

revoke insert, update, delete on public.network_posts from anon;
grant select on public.network_posts to anon, authenticated;
grant insert, update, delete on public.network_posts to authenticated;

-- Historical reaction rows stay in storage for audit/analytics only.
drop policy if exists network_reactions_self_write on public.network_reactions;
drop policy if exists network_reactions_read on public.network_reactions;
drop policy if exists action_network_reactions_insert_retired on public.network_reactions;
drop policy if exists action_network_reactions_update_retired on public.network_reactions;
drop policy if exists action_network_reactions_delete_retired on public.network_reactions;
revoke select, insert, update, delete on public.network_reactions from anon, authenticated;

-- Remove the legacy outbox writers entirely, not just disable them.
drop trigger if exists mnet_post_outbox_trg on public.network_posts;
drop trigger if exists mnet_reaction_outbox_trg on public.network_reactions;
drop trigger if exists mnet_follow_outbox_trg on public.network_follows;

-- Profile completion was the fourth outbox producer. Preserve the profile,
-- onboarding, owner-follow and welcome behavior without emitting dead work.
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
  set display_name=btrim(p_display_name),
      headline=coalesce(p_headline,''),
      bio=coalesce(p_bio,''),
      avatar_url=coalesce(p_avatar_url,''),
      banner_url=coalesce(p_banner_url,''),
      website_url=coalesce(p_website_url,''),
      updated_at=now(),
      profile_version=profile_version+1
  where m_uid=v_m_uid;

  insert into public.mnet_onboarding_state(m_uid,app_id,status,profile_completed_at,last_seen_at)
  values(v_m_uid,v_app_id,'feed_ready',now(),now())
  on conflict (m_uid,app_id) do update set
    status='feed_ready',
    profile_completed_at=coalesce(public.mnet_onboarding_state.profile_completed_at,now()),
    last_seen_at=now();

  perform public.mnet_follow_admins(v_m_uid);

  begin
    perform public.mnet_send_welcome(v_m_uid);
  exception when others then
    null;
  end;

  return jsonb_build_object('ok',true,'mccluster_id',v_mccluster_id);
end;
$$;

revoke all on function public.mnet_complete_surface_profile(text,text,text,text,text,text,text)
  from public, anon;
grant execute on function public.mnet_complete_surface_profile(text,text,text,text,text,text,text)
  to authenticated, service_role;

drop function if exists public.mnet_claim_outbox(integer);
drop function if exists public.mnet_enqueue_outbox();

update public.network_outbox
set status='dead',
    last_error='Retired by action_network_hardening_cleanup_v1: no canonical consumer exists.'
where status in ('pending','processing','failed');

comment on table public.network_outbox is
  'Retired legacy Mnet event outbox. Historical rows are audit-only; canonical feed, notification, mission and proof paths write directly.';
