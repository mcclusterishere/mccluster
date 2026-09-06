-- Canonical M person layer
--
-- auth.users records remain authentication credentials. M identities live one
-- layer above them so one verified person can own more than one auth record
-- (different emails/providers) without forcing an unsafe automatic merge.
-- Device similarity is evidence only; m_merge_people is service-role-only.

create table if not exists public.m_people (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active','merged','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.m_auth_user_links (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  link_method text not null default 'bootstrap' check (link_method in ('bootstrap','signup','manual','provider_verified','admin_merge')),
  is_primary boolean not null default true,
  linked_at timestamptz not null default now()
);

create index if not exists m_auth_user_links_m_uid_idx on public.m_auth_user_links(m_uid);
create unique index if not exists m_auth_user_links_one_primary_idx on public.m_auth_user_links(m_uid) where is_primary;

comment on table public.m_people is 'Canonical M identities. One M person can own multiple Supabase auth.users records after explicit verified linking; apps should track the M UID returned by m_touch_app.';
comment on table public.m_auth_user_links is 'Maps authentication records to a canonical M UID. Do not merge people solely from device similarity; a shared device is evidence, not authentication.';

do $$
declare
  r record;
  v_m_uid uuid;
begin
  for r in select u.id from auth.users u left join public.m_auth_user_links l on l.auth_user_id = u.id where l.auth_user_id is null loop
    insert into public.m_people default values returning id into v_m_uid;
    insert into public.m_auth_user_links(auth_user_id, m_uid, link_method, is_primary)
    values (r.id, v_m_uid, 'bootstrap', true);
  end loop;
end $$;

create or replace function public.m_auth_user_after_insert()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_m_uid uuid;
begin
  if exists (select 1 from public.m_auth_user_links where auth_user_id = new.id) then return new; end if;
  insert into public.m_people default values returning id into v_m_uid;
  insert into public.m_auth_user_links(auth_user_id, m_uid, link_method, is_primary)
  values (new.id, v_m_uid, 'signup', true);
  return new;
end;
$$;
revoke all on function public.m_auth_user_after_insert() from public, anon, authenticated;
drop trigger if exists m_auth_user_after_insert on auth.users;
create trigger m_auth_user_after_insert after insert on auth.users for each row execute function public.m_auth_user_after_insert();

alter table public.m_people enable row level security;
alter table public.m_auth_user_links enable row level security;

drop policy if exists m_people_read_self on public.m_people;
create policy m_people_read_self on public.m_people for select to authenticated
  using (exists (select 1 from public.m_auth_user_links l where l.m_uid = m_people.id and l.auth_user_id = auth.uid()));

drop policy if exists m_auth_user_links_read_self on public.m_auth_user_links;
create policy m_auth_user_links_read_self on public.m_auth_user_links for select to authenticated
  using (m_uid = (select l.m_uid from public.m_auth_user_links l where l.auth_user_id = auth.uid()));

revoke all on table public.m_people from anon, authenticated;
revoke all on table public.m_auth_user_links from anon, authenticated;
grant select on table public.m_people to authenticated;
grant select on table public.m_auth_user_links to authenticated;

alter table public.m_devices add column if not exists m_uid uuid references public.m_people(id) on delete cascade;
update public.m_devices d set m_uid = l.m_uid from public.m_auth_user_links l where d.user_id = l.auth_user_id and d.m_uid is null;
alter table public.m_devices alter column m_uid set not null;
create unique index if not exists m_devices_m_uid_device_key_idx on public.m_devices(m_uid, device_key);

create table if not exists public.m_person_apps (
  m_uid uuid not null references public.m_people(id) on delete cascade,
  app_id uuid not null references public.platform_apps(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  role text not null default 'user',
  settings jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (m_uid, app_id, org_id)
);
alter table public.m_person_apps enable row level security;
drop policy if exists m_person_apps_read_self on public.m_person_apps;
create policy m_person_apps_read_self on public.m_person_apps for select to authenticated
  using (exists (select 1 from public.m_auth_user_links l where l.m_uid = m_person_apps.m_uid and l.auth_user_id = auth.uid()));
revoke all on table public.m_person_apps from anon, authenticated;
grant select on table public.m_person_apps to authenticated;

create or replace function public.m_touch_app(
  p_app_key text,
  p_device_key text,
  p_org_slug text default 'mccluster',
  p_meta jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_user_id uuid := auth.uid();
  v_m_uid uuid;
  v_app public.platform_apps%rowtype;
  v_org public.orgs%rowtype;
  v_device_id uuid;
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select l.m_uid into v_m_uid from public.m_auth_user_links l where l.auth_user_id = v_user_id;
  if v_m_uid is null then raise exception 'M identity missing' using errcode = '23503'; end if;
  if p_app_key is null or char_length(btrim(p_app_key)) = 0 then raise exception 'app key required' using errcode = '22023'; end if;
  if p_device_key is null or char_length(p_device_key) < 20 or char_length(p_device_key) > 200 then raise exception 'invalid device key' using errcode = '22023'; end if;
  if jsonb_typeof(v_meta) is distinct from 'object' then raise exception 'metadata must be an object' using errcode = '22023'; end if;
  if pg_column_size(v_meta) > 8192 then raise exception 'metadata too large' using errcode = '22023'; end if;

  select * into v_app from public.platform_apps where app_key = btrim(p_app_key) and enabled = true;
  if not found then raise exception 'unknown or disabled app' using errcode = '22023'; end if;
  select * into v_org from public.orgs where slug = coalesce(nullif(btrim(p_org_slug), ''), 'mccluster') and enabled = true;
  if not found then raise exception 'unknown or disabled organization' using errcode = '22023'; end if;

  insert into public.m_devices (user_id, m_uid, device_key, last_app_id, last_org_id, metadata)
  values (v_user_id, v_m_uid, p_device_key, v_app.id, v_org.id, v_meta)
  on conflict (m_uid, device_key) do update
    set user_id = excluded.user_id, last_seen_at = now(), last_app_id = excluded.last_app_id,
        last_org_id = excluded.last_org_id, metadata = public.m_devices.metadata || excluded.metadata
  returning id into v_device_id;

  insert into public.platform_user_apps (user_id, app_id, org_id, last_seen_at)
  values (v_user_id, v_app.id, v_org.id, now())
  on conflict (user_id, app_id, org_id) do update set last_seen_at = now();

  insert into public.m_person_apps (m_uid, app_id, org_id, last_seen_at)
  values (v_m_uid, v_app.id, v_org.id, now())
  on conflict (m_uid, app_id, org_id) do update set last_seen_at = now();

  return jsonb_build_object('m_uid', v_m_uid, 'auth_user_id', v_user_id, 'device_id', v_device_id, 'app_key', v_app.app_key, 'org_slug', v_org.slug);
end;
$$;
revoke all on function public.m_touch_app(text, text, text, jsonb) from public, anon;
grant execute on function public.m_touch_app(text, text, text, jsonb) to authenticated;

create or replace function public.m_my_identities()
returns jsonb language sql stable security definer set search_path = pg_catalog, public, auth as $$
  with me as (select l.m_uid from public.m_auth_user_links l where l.auth_user_id = auth.uid()),
  linked as (select l.auth_user_id from public.m_auth_user_links l, me where l.m_uid = me.m_uid)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'provider', i.provider, 'provider_id', i.provider_id, 'email', i.email,
    'auth_user_id', i.user_id, 'created_at', i.created_at, 'last_sign_in_at', i.last_sign_in_at
  ) order by i.created_at), '[]'::jsonb)
  from auth.identities i where i.user_id in (select auth_user_id from linked);
$$;
revoke all on function public.m_my_identities() from public, anon;
grant execute on function public.m_my_identities() to authenticated;

create or replace function public.m_merge_people(p_keep uuid, p_merge uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare r record;
begin
  if p_keep is null or p_merge is null or p_keep = p_merge then raise exception 'two distinct M UIDs are required'; end if;
  if not exists (select 1 from public.m_people where id = p_keep) or not exists (select 1 from public.m_people where id = p_merge) then raise exception 'M UID not found'; end if;

  for r in select * from public.m_devices where m_uid = p_merge loop
    if exists (select 1 from public.m_devices where m_uid = p_keep and device_key = r.device_key) then
      update public.m_devices set last_seen_at = greatest(last_seen_at, r.last_seen_at),
        last_app_id = coalesce(r.last_app_id, last_app_id), last_org_id = coalesce(r.last_org_id, last_org_id),
        metadata = metadata || r.metadata where m_uid = p_keep and device_key = r.device_key;
      delete from public.m_devices where id = r.id;
    else
      update public.m_devices set m_uid = p_keep where id = r.id;
    end if;
  end loop;

  insert into public.m_person_apps(m_uid, app_id, org_id, role, settings, first_seen_at, last_seen_at)
  select p_keep, app_id, org_id, role, settings, first_seen_at, last_seen_at from public.m_person_apps where m_uid = p_merge
  on conflict (m_uid, app_id, org_id) do update set
    first_seen_at = least(public.m_person_apps.first_seen_at, excluded.first_seen_at),
    last_seen_at = greatest(public.m_person_apps.last_seen_at, excluded.last_seen_at),
    settings = public.m_person_apps.settings || excluded.settings;
  delete from public.m_person_apps where m_uid = p_merge;

  update public.m_auth_user_links set is_primary = false where m_uid = p_merge;
  update public.m_auth_user_links set m_uid = p_keep, link_method = 'admin_merge' where m_uid = p_merge;
  update public.m_people set status = 'merged', updated_at = now() where id = p_merge;
  update public.m_people set updated_at = now() where id = p_keep;
end;
$$;
revoke all on function public.m_merge_people(uuid, uuid) from public, anon, authenticated;
grant execute on function public.m_merge_people(uuid, uuid) to service_role;
