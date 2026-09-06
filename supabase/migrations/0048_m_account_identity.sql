-- M Account identity continuity
--
-- auth.users.id is the authentication record at this stage. OAuth identities
-- are attached by Supabase Auth; this migration records which McCluster app/org
-- a signed-in user touched and a random first-party installation id. The
-- device id is not derived from browser/hardware fingerprinting and never
-- authenticates a user. Migration 0049 adds the canonical M person layer.

create table if not exists public.m_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_key text not null check (char_length(device_key) between 20 and 200),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_app_id uuid references public.platform_apps(id) on delete set null,
  last_org_id uuid references public.orgs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, device_key)
);

comment on table public.m_devices is 'First-party M Account installation identifiers. The browser creates a random opaque id; this is not a hardware/browser fingerprint. One installation may legitimately be associated with more than one M account.';
comment on column public.m_devices.device_key is 'Opaque random first-party installation id supplied by an M client. Never derive this from hardware/browser fingerprinting.';

create index if not exists m_devices_device_key_idx on public.m_devices (device_key);
create index if not exists m_devices_user_last_seen_idx on public.m_devices (user_id, last_seen_at desc);

alter table public.m_devices enable row level security;

drop policy if exists m_devices_read_self on public.m_devices;
create policy m_devices_read_self on public.m_devices
  for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.m_devices from anon, authenticated;
grant select on table public.m_devices to authenticated;

create or replace function public.m_touch_app(
  p_app_key text,
  p_device_key text,
  p_org_slug text default 'mccluster',
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_app public.platform_apps%rowtype;
  v_org public.orgs%rowtype;
  v_device_id uuid;
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_app_key is null or char_length(btrim(p_app_key)) = 0 then raise exception 'app key required' using errcode = '22023'; end if;
  if p_device_key is null or char_length(p_device_key) < 20 or char_length(p_device_key) > 200 then raise exception 'invalid device key' using errcode = '22023'; end if;
  if jsonb_typeof(v_meta) is distinct from 'object' then raise exception 'metadata must be an object' using errcode = '22023'; end if;
  if pg_column_size(v_meta) > 8192 then raise exception 'metadata too large' using errcode = '22023'; end if;

  select * into v_app from public.platform_apps where app_key = btrim(p_app_key) and enabled = true;
  if not found then raise exception 'unknown or disabled app' using errcode = '22023'; end if;

  select * into v_org from public.orgs where slug = coalesce(nullif(btrim(p_org_slug), ''), 'mccluster') and enabled = true;
  if not found then raise exception 'unknown or disabled organization' using errcode = '22023'; end if;

  insert into public.m_devices (user_id, device_key, last_app_id, last_org_id, metadata)
  values (v_user_id, p_device_key, v_app.id, v_org.id, v_meta)
  on conflict (user_id, device_key) do update
    set last_seen_at = now(), last_app_id = excluded.last_app_id,
        last_org_id = excluded.last_org_id, metadata = public.m_devices.metadata || excluded.metadata
  returning id into v_device_id;

  insert into public.platform_user_apps (user_id, app_id, org_id, last_seen_at)
  values (v_user_id, v_app.id, v_org.id, now())
  on conflict (user_id, app_id, org_id) do update set last_seen_at = now();

  return jsonb_build_object('m_uid', v_user_id, 'device_id', v_device_id, 'app_key', v_app.app_key, 'org_slug', v_org.slug);
end;
$$;

revoke all on function public.m_touch_app(text, text, text, jsonb) from public, anon;
grant execute on function public.m_touch_app(text, text, text, jsonb) to authenticated;

create or replace function public.m_my_identities()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('id', i.id, 'provider', i.provider, 'provider_id', i.provider_id,
      'email', i.email, 'created_at', i.created_at, 'last_sign_in_at', i.last_sign_in_at) order by i.created_at),
    '[]'::jsonb
  )
  from auth.identities i
  where i.user_id = auth.uid();
$$;

revoke all on function public.m_my_identities() from public, anon;
grant execute on function public.m_my_identities() to authenticated;
