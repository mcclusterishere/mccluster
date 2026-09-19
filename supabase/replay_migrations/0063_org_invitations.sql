-- ============================================================
-- INVITE A CLIENT BEFORE THEY HAVE AN ACCOUNT
--
-- Justin Esmer's site is built and his org exists, but org_members is
-- keyed on profile_id — a uuid that does not exist until he signs up.
-- So there was no way to say "when this person arrives, they own the
-- esmer org" except to wait for him to sign up and then remember to run
-- an INSERT by hand.
--
-- For an agency onboarding clients repeatedly, "remember to run an
-- INSERT by hand" is a step that gets forgotten, and the failure mode is
-- the client signing in, seeing nothing, and concluding the product is
-- broken. This closes it: the intent is recorded against the EMAIL now,
-- and attaches itself when the account appears.
--
-- Two triggers already hang off auth.users insert in this project
-- (m_auth_user_after_insert, platform_sync_profile_from_auth_trg), so
-- this follows an established pattern rather than inventing one.
-- ============================================================


-- ------------------------------------------------------------
-- 1. The pre-authorization
-- ------------------------------------------------------------
create table if not exists public.org_invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  -- Stored lower-cased and matched case-insensitively. Mail is
  -- case-insensitive in practice and "Justin@" not matching "justin@"
  -- is exactly the kind of bug that looks like the invite silently
  -- failed.
  email       text not null check (email = lower(email) and position('@' in email) > 1),
  role        text not null check (role in ('owner', 'staff', 'viewer')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  claimed_by  uuid references auth.users(id) on delete set null,
  -- One live invitation per email per org. A second invitation with a
  -- different role would make "which role wins" a race.
  unique (org_id, email)
);

comment on table public.org_invitations is
  'Membership promised to an email address before that person has an '
  'account. Claimed automatically on email confirmation by '
  'grant_pending_org_invitations(). See 0063_org_invitations.sql.';

create index if not exists org_invitations_unclaimed_email_idx
  on public.org_invitations (email) where claimed_at is null;

-- Fail closed, like the rest of the control plane: RLS on, no policies,
-- so only the service role reaches it. An invitation names who is about
-- to get access to a tenant; it is not public.
alter table public.org_invitations enable row level security;


-- ------------------------------------------------------------
-- 2. Claim on CONFIRMATION, not on signup
--
-- Supabase inserts the auth.users row before the address is verified.
-- Granting there would hand a client's organisation to anyone who typed
-- their email into a signup form. The grant therefore fires when
-- email_confirmed_at becomes non-null — proof the person actually holds
-- the mailbox the invitation was addressed to.
--
-- Covers both paths: an OAuth signup (Google), which arrives already
-- confirmed on INSERT, and an email signup, which is confirmed later by
-- UPDATE.
-- ------------------------------------------------------------
create or replace function public.grant_pending_org_invitations()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.email_confirmed_at is null or new.email is null then
    return new;
  end if;

  -- Only on the transition, so an unrelated UPDATE to a long-confirmed
  -- user does not re-run this every time.
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then
    return new;
  end if;

  with claimed as (
    update public.org_invitations i
       set claimed_at = now(), claimed_by = new.id
     where lower(i.email) = lower(new.email)
       and i.claimed_at is null
    returning i.org_id, i.role
  )
  insert into public.org_members (org_id, profile_id, role)
  select c.org_id, new.id, c.role from claimed c
  -- Never demote or overwrite an existing membership. If they are
  -- already in the org, the invitation is simply spent.
  on conflict (org_id, profile_id) do nothing;

  return new;
end $function$;

comment on function public.grant_pending_org_invitations() is
  'Attaches pre-authorized org membership when a user confirms their '
  'email. Fires on confirmation rather than signup so an invitation '
  'cannot be claimed by someone who merely typed the address.';

drop trigger if exists grant_pending_org_invitations_trg on auth.users;
create trigger grant_pending_org_invitations_trg
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.grant_pending_org_invitations();


-- ------------------------------------------------------------
-- 3. Justin
--
-- Address supplied by Matthew McCluster on 2026-09-08. Owner, because
-- it is his site — the whole point of the tenant model is that the
-- client runs his own property rather than filing requests.
-- ------------------------------------------------------------
insert into public.org_invitations (org_id, email, role, invited_by)
select o.id, 'justinesmer@gmail.com', 'owner', u.id
  from public.orgs o
  left join auth.users u on u.email = 'matthew@mccluster.org'
 where o.slug = 'esmer'
on conflict (org_id, email) do nothing;


-- ------------------------------------------------------------
-- 4. Verify
-- ------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n
    from public.org_invitations i join public.orgs o on o.id = i.org_id
   where o.slug = 'esmer' and i.email = 'justinesmer@gmail.com' and i.role = 'owner';
  if n <> 1 then
    raise exception 'Justin''s invitation to the esmer org was not recorded (found %)', n;
  end if;

  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'auth' and c.relname = 'users'
       and t.tgname = 'grant_pending_org_invitations_trg'
  ) then
    raise exception 'the invitation trigger is not attached; invitations would never be claimed';
  end if;
end $$;
