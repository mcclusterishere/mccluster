-- Creator onboarding in one click (owner, 2026-10-15: "a click of a button,
-- because we already have all the user data; only ask for data they missed
-- … I should never see it again unless I'm editing profile data").
--
-- Two calls, one answer shape, server truth only (never localStorage):
--
--   public.music_creator_state()
--     What Creator Studio needs to decide what to show. Writes nothing.
--     creator = true the moment this member has a music_creator_profiles
--     row (any status): the onboarding screen is never shown again.
--
--   public.music_become_creator(p_handle, p_artist_name, p_accept_terms)
--     The one button. Builds the creator profile from data the member
--     already gave the platform (artist name from their public profile
--     name, handle from their M handle, bio, https website and https
--     picture from their public profile); p_handle / p_artist_name are only for what is
--     missing. Inserts the music_creator_profiles row and links the
--     presentation (identity_presentations.music_enabled) in ONE
--     transaction. Idempotent: run it again and it inserts nothing,
--     overwrites nothing (editing is profile edit, not onboarding), and
--     returns the same state. A handle another creator holds, or an
--     invalid one, comes back as problems.handle; nothing is written.
--
-- Answer:
--   { ok, creator, created, linked, profile{handle,artist_name,status,
--     verification_state,avatar_url,banner_url} | null,
--     missing[] ('handle','artist_name'), problems{handle:'taken'|'invalid'},
--     prefill{handle,artist_name,handle_suggestion,has_bio,has_website,avatar_url},
--     terms_version, error? ('not_signed_in','terms_required') }
--
-- Owner repair of one account, as the service role (Supabase SQL editor /
-- MCP), idempotent:
--   select public.music_creator_onboarding_core('<m_uid>'::uuid, null, null, true, true);
--
-- Rollback (no data is changed by the rollback; profiles created through
-- these functions are ordinary music_creator_profiles rows and stay valid):
--   drop function if exists public.music_become_creator(text, text, boolean);
--   drop function if exists public.music_creator_state();
--   drop function if exists public.music_creator_onboarding_core(uuid, text, text, boolean, boolean);
--
-- Behaviour tests: supabase/tests/music_creator_one_click.behaviour.sql,
-- run by scripts/test-music-creator-db.sh on a scratch Postgres.

set local lock_timeout = '5s';

create or replace function public.music_creator_onboarding_core(
  p_m uuid, p_handle text, p_artist_name text, p_accept_terms boolean, p_write boolean
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  c_handle_re constant text := '^[a-z0-9][a-z0-9._-]{2,39}$';
  c_terms constant text := 'music-creator-v1';
  v_row public.music_creator_profiles%rowtype;
  v_auth uuid;
  v_np_name text; v_np_bio text; v_np_web text; v_np_avatar text;
  v_pp_name text; v_mid text;
  v_handle text; v_problem text; v_suggest text; v_base text;
  v_name text; v_missing text[] := '{}';
  v_bio text; v_web text; v_avatar text;
  v_created boolean := false;
  v_linked boolean := false;
  i int;
begin
  if p_m is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'creator', false, 'created', false);
  end if;

  select * into v_row from public.music_creator_profiles where m_uid = p_m;
  if found then
    if p_write then
      insert into public.identity_presentations as ip (m_uid, music_enabled) values (p_m, true)
      on conflict (m_uid) do update set music_enabled = true, updated_at = now()
        where ip.music_enabled is distinct from true;
    end if;
    select coalesce(music_enabled, false) into v_linked from public.identity_presentations where m_uid = p_m;
    return jsonb_build_object(
      'ok', true, 'creator', true, 'created', false, 'linked', coalesce(v_linked, false),
      'profile', jsonb_build_object('handle', v_row.handle, 'artist_name', v_row.artist_name,
        'status', v_row.status, 'verification_state', v_row.verification_state,
        'avatar_url', v_row.avatar_url, 'banner_url', v_row.banner_url),
      'missing', '[]'::jsonb, 'problems', '{}'::jsonb, 'terms_version', v_row.terms_version);
  end if;

  -- what the platform already knows about this member
  select auth_user_id into v_auth from public.m_auth_user_links where m_uid = p_m and is_primary limit 1;
  select display_name, bio, website_url, avatar_url into v_np_name, v_np_bio, v_np_web, v_np_avatar
    from public.network_profiles where m_uid = p_m;
  if v_auth is not null then
    select mccluster_id, display_name into v_mid, v_pp_name from public.platform_profiles where user_id = v_auth;
  end if;

  -- artist name: what they typed now, else the name they already show
  v_name := left(coalesce(nullif(btrim(p_artist_name), ''), nullif(btrim(v_np_name), ''), nullif(btrim(v_pp_name), '')), 160);
  v_name := nullif(btrim(v_name), '');
  if v_name is null then v_missing := array_append(v_missing, 'artist_name'); end if;

  -- handle: what they typed now, else their M handle
  if nullif(btrim(coalesce(p_handle, '')), '') is not null then
    v_handle := lower(regexp_replace(btrim(p_handle), '^@+', ''));
    if v_handle !~ c_handle_re then v_problem := 'invalid';
    elsif exists (select 1 from public.music_creator_profiles where handle = v_handle and m_uid <> p_m) then v_problem := 'taken';
    end if;
  else
    v_handle := lower(btrim(coalesce(v_mid, '')));
    if v_handle !~ c_handle_re then v_handle := null;
    elsif exists (select 1 from public.music_creator_profiles where handle = v_handle and m_uid <> p_m) then v_problem := 'taken';
    end if;
  end if;
  if v_handle is null or v_problem is not null then
    v_missing := array_append(v_missing, 'handle');
    -- a free handle to offer, from the name they use
    v_base := left(btrim(regexp_replace(lower(coalesce(v_name, v_mid, '')), '[^a-z0-9._-]+', '-', 'g'), '-._'), 34);
    if v_base ~ c_handle_re then
      for i in 0..20 loop
        v_suggest := case when i = 0 then v_base else v_base || '-' || i end;
        exit when not exists (select 1 from public.music_creator_profiles where handle = v_suggest);
        v_suggest := null;
      end loop;
    end if;
  end if;

  v_bio := left(coalesce(v_np_bio, ''), 2000);
  v_web := case when coalesce(v_np_web, '') ~* '^https://[^\s]+$' and length(v_np_web) <= 500 then v_np_web else '' end;
  -- the member's picture comes along too (owner, 2026-10-20: never re-enter what the profile has); https only
  v_avatar := case when coalesce(v_np_avatar, '') ~* '^https://[^\s]+$' and length(v_np_avatar) <= 2000 then v_np_avatar else '' end;

  if array_length(v_missing, 1) is not null or not p_write or not coalesce(p_accept_terms, false) then
    return jsonb_build_object(
      'ok', array_length(v_missing, 1) is null and (not p_write or coalesce(p_accept_terms, false)),
      'creator', false, 'created', false, 'linked', false, 'profile', null,
      'missing', to_jsonb(v_missing),
      'problems', case when v_problem is null then '{}'::jsonb else jsonb_build_object('handle', v_problem) end,
      'prefill', jsonb_build_object('handle', case when v_problem is null then v_handle end,
        'artist_name', v_name, 'handle_suggestion', v_suggest,
        'has_bio', v_bio <> '', 'has_website', v_web <> '', 'avatar_url', nullif(v_avatar, '')),
      'terms_version', c_terms,
      'error', case when p_write and not coalesce(p_accept_terms, false) then 'terms_required' end);
  end if;

  begin
    insert into public.music_creator_profiles (m_uid, handle, artist_name, bio, website_url, avatar_url, terms_version, terms_accepted_at)
    values (p_m, v_handle, v_name, v_bio, v_web, v_avatar, c_terms, now())
    on conflict (m_uid) do nothing
    returning true into v_created;
  exception when unique_violation then
    -- another member took the handle between the check and the insert
    return jsonb_build_object('ok', false, 'creator', false, 'created', false, 'linked', false, 'profile', null,
      'missing', '["handle"]'::jsonb, 'problems', jsonb_build_object('handle', 'taken'),
      'prefill', jsonb_build_object('handle', null, 'artist_name', v_name, 'handle_suggestion', null,
        'has_bio', v_bio <> '', 'has_website', v_web <> ''),
      'terms_version', c_terms);
  end;

  insert into public.identity_presentations as ip (m_uid, music_enabled) values (p_m, true)
  on conflict (m_uid) do update set music_enabled = true, updated_at = now()
    where ip.music_enabled is distinct from true;

  select * into v_row from public.music_creator_profiles where m_uid = p_m;
  return jsonb_build_object(
    'ok', true, 'creator', true, 'created', coalesce(v_created, false), 'linked', true,
    'profile', jsonb_build_object('handle', v_row.handle, 'artist_name', v_row.artist_name,
      'status', v_row.status, 'verification_state', v_row.verification_state,
      'avatar_url', v_row.avatar_url, 'banner_url', v_row.banner_url),
    'missing', '[]'::jsonb, 'problems', '{}'::jsonb, 'terms_version', v_row.terms_version);
end $$;

create or replace function public.music_creator_state() returns jsonb
language sql security definer set search_path = pg_catalog, public as $$
  select public.music_creator_onboarding_core(public.current_m_uid(), null, null, false, false);
$$;

create or replace function public.music_become_creator(
  p_handle text default null, p_artist_name text default null, p_accept_terms boolean default false
) returns jsonb
language sql security definer set search_path = pg_catalog, public as $$
  select public.music_creator_onboarding_core(public.current_m_uid(), p_handle, p_artist_name, p_accept_terms, true);
$$;

revoke all on function public.music_creator_onboarding_core(uuid, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.music_creator_state() from public, anon;
revoke all on function public.music_become_creator(text, text, boolean) from public, anon;
grant execute on function public.music_creator_onboarding_core(uuid, text, text, boolean, boolean) to service_role;
grant execute on function public.music_creator_state() to authenticated, service_role;
grant execute on function public.music_become_creator(text, text, boolean) to authenticated, service_role;
