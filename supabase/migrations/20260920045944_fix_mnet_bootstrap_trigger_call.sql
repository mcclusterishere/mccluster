-- Mnet hotfix: bootstrap must not invoke an auth.users trigger function directly.
--
-- ensure_network_profile_for_auth_user() RETURNS trigger and is valid only when
-- Postgres invokes it from zz_network_profile_after_auth. Production drift had
-- added PERFORM ensure_network_profile_for_auth_user() here, which makes every
-- authenticated Mnet bootstrap fail with "trigger functions can only be called
-- as triggers". The profile row is already maintained by the auth trigger.

create or replace function public.mnet_surface_bootstrap(p_app_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_m_uid uuid;
  v_app public.platform_apps%rowtype;
  v_cfg public.mnet_surface_config%rowtype;
  v_profile public.network_profiles%rowtype;
  v_platform public.platform_profiles%rowtype;
  v_state public.mnet_onboarding_state%rowtype;
  v_complete boolean := false;
  v_next text;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  select * into v_app from public.platform_apps where app_key=p_app_key and enabled=true limit 1;
  if not found then raise exception 'unknown_app'; end if;
  select * into v_cfg from public.mnet_surface_config where app_id=v_app.id;
  if not found or not v_cfg.network_enabled or v_cfg.entry_mode='disabled' then raise exception 'network_disabled'; end if;
  select public.current_m_uid() into v_m_uid;
  if v_m_uid is null then raise exception 'identity_missing'; end if;

  select * into v_profile from public.network_profiles where m_uid=v_m_uid;
  select * into v_platform from public.platform_profiles where user_id=v_uid;

  v_complete := nullif(btrim(coalesce(v_platform.mccluster_id,'')),'') is not null
    and nullif(btrim(coalesce(v_profile.display_name,'')),'') is not null;

  insert into public.mnet_onboarding_state(m_uid,app_id,status,profile_completed_at,last_seen_at)
  values(
    v_m_uid,
    v_app.id,
    case when v_complete then 'feed_ready' else 'profile_required' end,
    case when v_complete then now() end,
    now()
  )
  on conflict (m_uid,app_id) do update set
    status=case when excluded.status='feed_ready' then 'feed_ready' else public.mnet_onboarding_state.status end,
    profile_completed_at=coalesce(public.mnet_onboarding_state.profile_completed_at,excluded.profile_completed_at),
    last_seen_at=now()
  returning * into v_state;

  v_next := case when v_cfg.entry_mode='feed' or v_state.status='feed_ready' then 'feed' else 'profile' end;

  return jsonb_build_object(
    'app',jsonb_build_object(
      'id',v_app.id,
      'app_key',v_app.app_key,
      'name',v_app.name,
      'product_family',v_app.product_family,
      'public_url',v_app.public_url
    ),
    'surface',to_jsonb(v_cfg),
    'identity',jsonb_build_object('m_uid',v_m_uid,'mccluster_id',v_platform.mccluster_id),
    'profile',to_jsonb(v_profile),
    'onboarding',to_jsonb(v_state),
    'next_step',v_next,
    'feed',jsonb_build_object(
      'scope',v_cfg.default_feed_scope,
      'source_app_id',case when v_cfg.default_feed_scope='app' then v_app.id else null end,
      'product_family',case when v_cfg.default_feed_scope='family' then v_app.product_family else null end
    )
  );
end;
$$;

revoke all on function public.mnet_surface_bootstrap(text) from public, anon;
grant execute on function public.mnet_surface_bootstrap(text) to authenticated, service_role;
