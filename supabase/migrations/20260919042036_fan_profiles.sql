create table if not exists public.fan_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  legal_name     text not null default '',
  display_name   text not null default '',
  address_line1  text not null default '',
  address_line2  text not null default '',
  city           text not null default '',
  region         text not null default '',
  postal_code    text not null default '',
  country        text not null default '',
  phone_e164     text not null default '',
  phone_verified_at  timestamptz,
  email_verified_at  timestamptz,
  birth_year     integer check (birth_year is null or (birth_year between 1900 and 2100)),
  marketing_consent        boolean not null default false,
  marketing_consent_at     timestamptz,
  marketing_consent_version text not null default '',
  share_consent            boolean not null default false,
  share_consent_at         timestamptz,
  share_consent_version    text not null default '',
  source         text not null default '',
  account_tier   text not null default 'listener'
                 check (account_tier in ('listener', 'unlocked')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.fan_profiles is
  'Listener intake captured at the unlock gate. Carries no role, no org and no membership: it cannot grant access to anything. Privileged columns are pinned by fan_profiles_guard().';

create or replace function public.fan_profiles_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_consent_version constant text := '2026-09-19';
  v_adult boolean;
begin
  new.updated_at := now();
  new.phone_e164 := regexp_replace(coalesce(new.phone_e164, ''), '[^0-9+]', '', 'g');
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.phone_verified_at := null;
    new.email_verified_at := null;
  else
    new.phone_verified_at := old.phone_verified_at;
    new.email_verified_at := old.email_verified_at;
    new.created_at := old.created_at;
    if new.phone_e164 is distinct from old.phone_e164 then
      new.phone_verified_at := null;
    end if;
  end if;
  new.account_tier := case when coalesce(new.source, '') <> '' then 'unlocked' else 'listener' end;
  v_adult := new.birth_year is not null
             and (extract(year from now())::int - new.birth_year) >= 18;
  if new.marketing_consent then
    new.marketing_consent_at := coalesce(
      case when tg_op = 'UPDATE' and old.marketing_consent then old.marketing_consent_at end,
      now());
    new.marketing_consent_version := v_consent_version;
  else
    new.marketing_consent_at := null;
    new.marketing_consent_version := '';
  end if;
  if new.share_consent and v_adult then
    new.share_consent_at := coalesce(
      case when tg_op = 'UPDATE' and old.share_consent then old.share_consent_at end,
      now());
    new.share_consent_version := v_consent_version;
  else
    new.share_consent := false;
    new.share_consent_at := null;
    new.share_consent_version := '';
  end if;
  return new;
end $$;

revoke all on function public.fan_profiles_guard() from public, anon, authenticated;

drop trigger if exists fan_profiles_guard_t on public.fan_profiles;
create trigger fan_profiles_guard_t
  before insert or update on public.fan_profiles
  for each row execute function public.fan_profiles_guard();

alter table public.fan_profiles enable row level security;
alter table public.fan_profiles force row level security;

drop policy if exists fan_profiles_read_self on public.fan_profiles;
create policy fan_profiles_read_self on public.fan_profiles
  for select to authenticated using (user_id = auth.uid());

drop policy if exists fan_profiles_insert_self on public.fan_profiles;
create policy fan_profiles_insert_self on public.fan_profiles
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists fan_profiles_update_self on public.fan_profiles;
create policy fan_profiles_update_self on public.fan_profiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on table public.fan_profiles from anon, authenticated;
grant select, insert, update on table public.fan_profiles to authenticated;
grant all on table public.fan_profiles to service_role;

create or replace function public.fan_profiles_sync_email_verified()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.email_confirmed_at is not null then
    update public.fan_profiles
       set email_verified_at = new.email_confirmed_at
     where user_id = new.id and email_verified_at is distinct from new.email_confirmed_at;
  end if;
  return new;
end $$;

revoke all on function public.fan_profiles_sync_email_verified() from public, anon, authenticated;

drop trigger if exists fan_profiles_sync_email_verified_t on auth.users;
create trigger fan_profiles_sync_email_verified_t
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.fan_profiles_sync_email_verified();
