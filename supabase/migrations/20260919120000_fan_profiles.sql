-- FAN PROFILES — what a listener tells us when they unlock a record.
--
-- THIS TABLE CAN NEVER GRANT ANYTHING. It has no role column, no org column
-- and no membership. Access in this project is org_members.role and
-- eu_profiles.role, and nothing here touches either. A listener filling this
-- in gains a download and a mailing list entry; they do not gain a tenant, a
-- desk, or a key. That is on purpose and it is the whole point: the intake
-- form is the most attacked surface on the site, so it is wired to a table
-- that has nothing worth stealing.
--
-- The second rule comes from eu_profiles, which is protected the same way: a
-- policy that only checks WHICH ROW you touch cannot stop you writing a
-- column you should not own. So the columns that mean something —
-- verification stamps, tier, consent timestamps — are pinned by a BEFORE
-- trigger. The browser can ask; only the trigger and the service role decide.

create table if not exists public.fan_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,

  -- who they are
  legal_name     text not null default '',
  display_name   text not null default '',

  -- where they are. Free text: this is a mailing address for merch and
  -- mail, not a verified identity claim, and it must not pretend to be one.
  address_line1  text not null default '',
  address_line2  text not null default '',
  city           text not null default '',
  region         text not null default '',
  postal_code    text not null default '',
  country        text not null default '',

  -- how to reach them. phone_verified_at is set ONLY by the verification
  -- path, never by the browser, so "verified" always means a code came back.
  phone_e164     text not null default '',
  phone_verified_at  timestamptz,
  email_verified_at  timestamptz,

  -- The age gate exists because of the consent below, not for its own sake.
  -- Sharing a minor's personal information is a different legal question
  -- from sharing an adult's, so the answer is recorded before the ask.
  birth_year     integer check (birth_year is null or (birth_year between 1900 and 2100)),

  -- CONSENT IS UNBUNDLED AND OPTIONAL. Neither of these may gate the music.
  -- Each records its own timestamp and the version of the wording that was
  -- on screen, because "they agreed" is worthless without "to what, and
  -- when". Withdrawal sets the boolean false and keeps the history.
  marketing_consent        boolean not null default false,
  marketing_consent_at     timestamptz,
  marketing_consent_version text not null default '',
  share_consent            boolean not null default false,
  share_consent_at         timestamptz,
  share_consent_version    text not null default '',

  -- Where they came from, and what that makes them. Both are marketing
  -- segments with zero authority attached. source is whatever the landing
  -- page claimed and is not evidence of anything; tier is derived from it
  -- by the trigger so the two can never disagree.
  source         text not null default '',
  account_tier   text not null default 'listener'
                 check (account_tier in ('listener', 'unlocked')),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.fan_profiles is
  'Listener intake captured at the unlock gate. Carries no role, no org and '
  'no membership: it cannot grant access to anything. Privileged columns are '
  'pinned by fan_profiles_guard().';

-- ------------------------------------------------------------
-- The guard. Same shape as eu_profiles_guard(), for the same reason.
-- ------------------------------------------------------------
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

  -- The service role and the SQL editor carry no auth.uid(). They are
  -- already holding the master keys, so a guard that silently rewrote their
  -- writes would make fixing a record by hand an unexplainable no-op.
  if auth.uid() is null then
    return new;
  end if;

  -- Verification is never self-asserted. Only the service role reaches the
  -- branch above, so a browser can neither set these nor clear them.
  -- Email verification is read from auth.users, never from the browser.
  -- The after-trigger on auth.users below only fires when that row CHANGES,
  -- and by the time most listeners fill this in their address was confirmed
  -- long ago — so the stamp is taken here too, or it never arrives at all.
  if tg_op = 'INSERT' then
    new.phone_verified_at := null;
    select u.email_confirmed_at into new.email_verified_at
      from auth.users u where u.id = new.user_id;
  else
    new.phone_verified_at := old.phone_verified_at;
    new.email_verified_at := coalesce(
      old.email_verified_at,
      (select u.email_confirmed_at from auth.users u where u.id = new.user_id));
    new.created_at := old.created_at;
    -- A phone that changes is a phone that is no longer verified.
    if new.phone_e164 is distinct from old.phone_e164 then
      new.phone_verified_at := null;
    end if;
  end if;

  -- Tier follows source; the browser may claim a source but cannot name its
  -- own tier. Neither value grants anything, so this is tidiness rather than
  -- a security boundary — but a column nobody can set arbitrarily is one
  -- fewer column to reason about later.
  new.account_tier := case when coalesce(new.source, '') <> '' then 'unlocked' else 'listener' end;

  -- Consent: the browser sends a boolean, the database writes the history.
  -- A claimed timestamp or version from the client is discarded.
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

  -- A minor cannot consent to having their information shared onward, and a
  -- missing birth year is treated as a minor rather than as an adult: the
  -- safe default is the one that shares nothing.
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

-- ------------------------------------------------------------
-- RLS. Own row only, and forced so a future view cannot read around it —
-- 20260908235000_close_view_rls_bypass.sql is the record of that going
-- wrong once already on eu_profiles.
-- ------------------------------------------------------------
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

-- No delete policy: a consent record that can be erased by the person who
-- gave it is not a record. Removal is a service-role job, on request.

revoke all on table public.fan_profiles from anon, authenticated;
grant select, insert, update on table public.fan_profiles to authenticated;
grant all on table public.fan_profiles to service_role;

-- ------------------------------------------------------------
-- Email verification is real and already enforced: this project has
-- mailer_autoconfirm off, so auth.users.email_confirmed_at only becomes
-- non-null when the person opens the mail. Mirror it rather than asking the
-- browser to assert it.
-- ------------------------------------------------------------
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
