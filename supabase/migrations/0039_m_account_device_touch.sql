-- Preserve the first app seen on a device while allowing later apps to refresh continuity.
-- SECURITY INVOKER + RLS keeps the user scoped to auth.uid().
create or replace function public.platform_touch_device(
  p_device_id uuid,
  p_app_key text default null,
  p_client_meta jsonb default '{}'::jsonb
)
returns public.platform_user_devices
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.platform_user_devices;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  insert into public.platform_user_devices (
    user_id, device_id, first_app_key, last_app_key,
    first_seen_at, last_seen_at, client_meta
  ) values (
    v_uid, p_device_id, p_app_key, p_app_key,
    now(), now(), coalesce(p_client_meta, '{}'::jsonb)
  )
  on conflict (user_id, device_id) do update set
    last_app_key = excluded.last_app_key,
    last_seen_at = now(),
    client_meta = excluded.client_meta
  returning * into v_row;

  return v_row;
end;
$$;
revoke execute on function public.platform_touch_device(uuid, text, jsonb) from public, anon;
grant execute on function public.platform_touch_device(uuid, text, jsonb) to authenticated, service_role;
