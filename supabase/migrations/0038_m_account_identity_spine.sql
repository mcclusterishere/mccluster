-- M Account identity spine: one canonical auth UUID, many apps/devices/providers.
-- Devices are continuity signals only. A device never merges or reassigns users.

create table if not exists public.platform_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  primary_email text not null default '',
  phone text not null default '',
  avatar_url text not null default '',
  locale text not null default '',
  timezone text not null default '',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.platform_profiles is 'Canonical McCluster M Account profile keyed 1:1 to auth.users.id. Provider identities remain in auth.identities.';
comment on column public.platform_profiles.user_id is 'Permanent M_UID. Never derive identity from email, device, or provider handle.';
alter table public.platform_profiles enable row level security;
drop policy if exists platform_profiles_select_own on public.platform_profiles;
create policy platform_profiles_select_own on public.platform_profiles for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists platform_profiles_update_own on public.platform_profiles;
create policy platform_profiles_update_own on public.platform_profiles for update to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id) with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
revoke all on table public.platform_profiles from anon;
grant select, update on table public.platform_profiles to authenticated;
grant all on table public.platform_profiles to service_role;

create table if not exists public.platform_user_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  first_app_key text,
  last_app_key text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  trust_level text not null default 'observed' check (trust_level in ('observed','verified','revoked')),
  client_meta jsonb not null default '{}'::jsonb,
  primary key (user_id, device_id)
);
comment on table public.platform_user_devices is 'First-party random device continuity per M_UID. The same physical/shared device may legitimately be associated with multiple M_UIDs; never use this table to merge accounts.';
create index if not exists platform_user_devices_device_idx on public.platform_user_devices(device_id);
create index if not exists platform_user_devices_last_seen_idx on public.platform_user_devices(user_id, last_seen_at desc);
alter table public.platform_user_devices enable row level security;
drop policy if exists platform_user_devices_select_own on public.platform_user_devices;
create policy platform_user_devices_select_own on public.platform_user_devices for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists platform_user_devices_insert_own on public.platform_user_devices;
create policy platform_user_devices_insert_own on public.platform_user_devices for insert to authenticated with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists platform_user_devices_update_own on public.platform_user_devices;
create policy platform_user_devices_update_own on public.platform_user_devices for update to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id) with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists platform_user_devices_delete_own on public.platform_user_devices;
create policy platform_user_devices_delete_own on public.platform_user_devices for delete to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
revoke all on table public.platform_user_devices from anon;
grant select, insert, update, delete on table public.platform_user_devices to authenticated;
grant all on table public.platform_user_devices to service_role;

create or replace function public.platform_sync_profile_from_auth()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  insert into public.platform_profiles (user_id, display_name, primary_email, phone, avatar_url, updated_at)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', ''), lower(coalesce(new.email, '')), coalesce(new.phone, ''), coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', ''), now())
  on conflict (user_id) do update set
    primary_email = excluded.primary_email,
    phone = excluded.phone,
    display_name = case when public.platform_profiles.display_name = '' then excluded.display_name else public.platform_profiles.display_name end,
    avatar_url = case when public.platform_profiles.avatar_url = '' then excluded.avatar_url else public.platform_profiles.avatar_url end,
    updated_at = now();
  return new;
end;
$$;
revoke execute on function public.platform_sync_profile_from_auth() from public, anon, authenticated;
grant execute on function public.platform_sync_profile_from_auth() to service_role;
drop trigger if exists platform_sync_profile_from_auth_trg on auth.users;
create trigger platform_sync_profile_from_auth_trg after insert or update of email, phone, raw_user_meta_data on auth.users for each row execute function public.platform_sync_profile_from_auth();

insert into public.platform_profiles (user_id, display_name, primary_email, phone, avatar_url)
select u.id, coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', ''), lower(coalesce(u.email, '')), coalesce(u.phone, ''), coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', '')
from auth.users u on conflict (user_id) do nothing;
