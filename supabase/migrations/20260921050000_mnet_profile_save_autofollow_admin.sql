-- MNET: THE SAVE THAT NEVER SAVED, AND THE THREE THINGS A NETWORK NEEDS.
--
-- 1. THE BLOCKING BUG. Saving a profile answered
--    "trigger functions can only be called as triggers". That error has
--    exactly one cause: something did PERFORM/SELECT on a function declared
--    RETURNS trigger. 20260920045944 already found and removed such a call
--    from mnet_surface_bootstrap and wrote down why:
--
--      "Production drift had added PERFORM ensure_network_profile_for_auth_user()
--       here ... The profile row is already maintained by the auth trigger."
--
--    The same drift is in mnet_complete_surface_profile, which is the
--    function the Save button calls, and no migration ever corrected it —
--    the repo's copy in replay 0068 is clean, so the bad body exists only in
--    production and nothing in git would ever overwrite it. This re-creates
--    the function from the known-good definition, which is the only thing
--    that evicts a drifted body. Nothing here calls a trigger function:
--    zz_network_profile_after_auth on auth.users already maintains the row,
--    and the insert below is idempotent anyway.
--
-- 2. EVERY NEW ACCOUNT FOLLOWS THE HOUSE. A network whose first members open
--    to an empty feed leaves believing it is broken, and they are not wrong:
--    a feed with no follows has nothing to show. New profiles now follow the
--    owner automatically, and the existing ones are backfilled.
--
-- 3. THE OWNER GETS POWERS. Pin a post to the top of the feed, and remove
--    one. Both are recorded.

-- ---------------------------------------------------------------
-- WHO THE HOUSE IS
-- ---------------------------------------------------------------
-- The owner is identified the way eu_role() has identified them since
-- replay 0017 — by the email on the account. One definition of "admin" in
-- this database, not two.
create or replace function public.mnet_admin_m_uids()
returns setof uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select l.m_uid
  from public.m_auth_user_links l
  join auth.users u on u.id = l.auth_user_id
  where l.is_primary = true
    and lower(coalesce(u.email, '')) = 'matthew@mccluster.org'
$$;

create or replace function public.mnet_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.mnet_admin_m_uids() a
    where a = public.current_m_uid()
  )
$$;

-- ---------------------------------------------------------------
-- 1. THE SAVE, RE-CREATED CLEAN
-- ---------------------------------------------------------------
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
declare v_uid uuid := auth.uid(); v_m_uid uuid; v_app_id uuid; v_mccluster_id text;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  if nullif(btrim(coalesce(p_display_name,'')),'') is null then raise exception 'display_name_required'; end if;
  select id into v_app_id from public.platform_apps where app_key=p_app_key and enabled=true limit 1;
  if v_app_id is null then raise exception 'unknown_app'; end if;
  select public.current_m_uid() into v_m_uid;
  if v_m_uid is null then raise exception 'identity_missing'; end if;
  select mccluster_id into v_mccluster_id from public.platform_profiles where user_id=v_uid;
  if nullif(btrim(coalesce(v_mccluster_id,'')),'') is null then raise exception 'mccluster_id_required'; end if;

  -- The row is normally already here, put there by the auth trigger. This
  -- insert covers the account that predates the trigger; it does NOT call
  -- the trigger's function, which is the bug being evicted.
  insert into public.network_profiles(m_uid,display_name)
  values(v_m_uid,btrim(p_display_name))
  on conflict (m_uid) do nothing;

  update public.network_profiles
  set display_name=btrim(p_display_name),headline=coalesce(p_headline,''),bio=coalesce(p_bio,''),
      avatar_url=coalesce(p_avatar_url,''),banner_url=coalesce(p_banner_url,''),website_url=coalesce(p_website_url,''),
      updated_at=now(),profile_version=profile_version+1
  where m_uid=v_m_uid;

  insert into public.mnet_onboarding_state(m_uid,app_id,status,profile_completed_at,last_seen_at)
  values(v_m_uid,v_app_id,'feed_ready',now(),now())
  on conflict (m_uid,app_id) do update set
    status='feed_ready',profile_completed_at=coalesce(public.mnet_onboarding_state.profile_completed_at,now()),last_seen_at=now();

  insert into public.network_outbox(topic,aggregate_type,aggregate_id,event_type,payload,idempotency_key)
  values('network.profile','person',v_m_uid::text,'profile.completed',jsonb_build_object('m_uid',v_m_uid,'app_id',v_app_id),concat('profile.completed:',v_m_uid,':',v_app_id))
  on conflict (idempotency_key) do nothing;

  -- Somebody who just filled in a profile should not then look at an empty
  -- room. Idempotent, so editing a profile later costs nothing.
  perform public.mnet_follow_admins(v_m_uid);

  return public.mnet_surface_bootstrap(p_app_key);
end;
$$;

-- ---------------------------------------------------------------
-- 2. THE AUTO-FOLLOW
-- ---------------------------------------------------------------
create or replace function public.mnet_follow_admins(p_m_uid uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  if p_m_uid is null then return 0; end if;
  insert into public.network_follows(follower_m_uid, followed_m_uid, status)
  select p_m_uid, a, 'following'
  from public.mnet_admin_m_uids() a
  -- network_follows carries `check (follower_m_uid <> followed_m_uid)`, so
  -- the owner's own profile has to be excluded or this raises on their row.
  where a <> p_m_uid
  on conflict (follower_m_uid, followed_m_uid) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Fires for a profile created any way at all — the auth trigger, the RPC
-- above, a backfill — so there is one place this behaviour lives.
create or replace function public.mnet_autofollow_on_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mnet_follow_admins(new.m_uid);
  return new;
end;
$$;

drop trigger if exists zz_mnet_autofollow_admins on public.network_profiles;
create trigger zz_mnet_autofollow_admins
  after insert on public.network_profiles
  for each row execute function public.mnet_autofollow_on_profile();

-- Everybody who signed up before this existed.
insert into public.network_follows(follower_m_uid, followed_m_uid, status)
select p.m_uid, a, 'following'
from public.network_profiles p
cross join public.mnet_admin_m_uids() a
where a <> p.m_uid
on conflict (follower_m_uid, followed_m_uid) do nothing;

-- ---------------------------------------------------------------
-- 3. ADMIN POWERS
-- ---------------------------------------------------------------
alter table public.network_posts add column if not exists pinned_at timestamptz;

create or replace function public.mnet_admin_set_pinned(p_post_id uuid, p_pinned boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mnet_is_admin() then raise exception 'admin_required'; end if;
  update public.network_posts
     set pinned_at = case when p_pinned then now() else null end
   where id = p_post_id;
  if not found then raise exception 'post_not_found'; end if;
  return jsonb_build_object('post_id', p_post_id, 'pinned', p_pinned);
end;
$$;

-- Removal is a soft delete: the feed item goes, the row stays, because a
-- moderation decision somebody can no longer inspect is not a record of
-- anything.
alter table public.network_posts add column if not exists removed_at timestamptz;
alter table public.network_posts add column if not exists removed_by uuid;

create or replace function public.mnet_admin_remove_post(p_post_id uuid, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := public.current_m_uid();
begin
  if not public.mnet_is_admin() then raise exception 'admin_required'; end if;
  update public.network_posts
     set removed_at = now(), removed_by = v_me,
         metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('removal_reason', left(coalesce(p_reason,''), 400))
   where id = p_post_id;
  if not found then raise exception 'post_not_found'; end if;
  delete from public.network_feed_items where post_id = p_post_id;
  return jsonb_build_object('post_id', p_post_id, 'removed', true);
end;
$$;

revoke all on function public.mnet_admin_m_uids() from public, anon;
revoke all on function public.mnet_follow_admins(uuid) from public, anon;
grant execute on function public.mnet_is_admin() to authenticated, service_role;
grant execute on function public.mnet_admin_set_pinned(uuid, boolean) to authenticated, service_role;
grant execute on function public.mnet_admin_remove_post(uuid, text) to authenticated, service_role;
grant execute on function public.mnet_admin_m_uids() to authenticated, service_role;
grant execute on function public.mnet_follow_admins(uuid) to authenticated, service_role;
grant execute on function public.mnet_complete_surface_profile(text,text,text,text,text,text,text) to authenticated, service_role;
