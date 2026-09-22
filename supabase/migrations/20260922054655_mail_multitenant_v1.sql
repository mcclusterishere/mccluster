-- ============================================================
-- MULTI-TENANT MAIL — domains, mailboxes and aliases as data.
--
-- The single-tenant server keeps its one mailbox in a flat file at
-- /etc/dovecot/private/users. That is fine for one address and useless
-- for selling them: every new client would be an SSH session, and there
-- would be no record of who owns what.
--
-- So the mail server reads Postfix's and Dovecot's lookup tables
-- straight out of Postgres. Minting an address becomes a row.
--
-- WHAT POSTFIX AND DOVECOT ACTUALLY SEE: the three mail_v_* views at the
-- bottom, and nothing else. They connect as a dedicated role that has
-- SELECT on those views and no rights on any base table. A mail server
-- is internet-facing and occasionally has bad days; it does not get to
-- read auth.users or the listener records.
--
-- PASSWORDS are bcrypt via pgcrypto and never stored in the clear.
-- Dovecot verifies them itself with default_pass_scheme = BLF-CRYPT, so
-- the plaintext exists only in the mint call that created it.
--
-- THE FAILURE MODE, stated because it is the cost of this design:
-- authentication and recipient validation now depend on Postgres being
-- reachable from the mail host. If it is not, IMAP logins fail and
-- Postfix DEFERS incoming mail rather than rejecting it -- senders retry
-- for days, so an outage delays mail instead of losing it. That is the
-- right trade, but it is a trade.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- DOMAINS. One row per domain we accept mail for.
-- ------------------------------------------------------------
create table if not exists public.mail_domains (
  id             uuid primary key default gen_random_uuid(),
  domain         text not null,
  owner_org_id   uuid references public.orgs(id) on delete restrict,

  -- Each domain signs with its own key. Shared keys mean one client's
  -- spam complaint drags every other client's reputation down with it.
  dkim_selector  text not null default 'mail',

  -- A ceiling per domain, so a client cannot mint mailboxes until the
  -- disk is full. Enforced by the mint function, not by convention.
  max_mailboxes  integer not null default 10 check (max_mailboxes >= 0),
  quota_bytes    bigint  not null default 2147483648 check (quota_bytes >= 0),

  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint mail_domains_domain_lower check (domain = lower(domain)),
  constraint mail_domains_domain_shape check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);
create unique index if not exists mail_domains_domain_key on public.mail_domains(domain);

comment on table public.mail_domains is
  'Domains this mail server accepts and signs for. One DKIM selector each, so no client can damage another''s sending reputation.';

-- ------------------------------------------------------------
-- MAILBOXES.
-- ------------------------------------------------------------
create table if not exists public.mail_users (
  id             uuid primary key default gen_random_uuid(),
  domain_id      uuid not null references public.mail_domains(id) on delete cascade,
  local_part     text not null,
  email          text not null,

  -- bcrypt. Dovecot checks it; nothing here ever sees the plaintext again.
  password_hash  text not null,

  -- Relative to the vmail root. Matches bootstrap-mailbox.sh's
  -- mail_location = maildir:/var/mail/vhosts/%d/%n exactly; if one moves,
  -- both move or delivery lands somewhere nobody is reading.
  maildir        text not null,

  quota_bytes    bigint not null default 2147483648 check (quota_bytes >= 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz,

  constraint mail_users_email_lower check (email = lower(email)),
  constraint mail_users_local_lower check (local_part = lower(local_part)),
  -- Keeps '../' and whitespace out of a value that becomes a filesystem path.
  constraint mail_users_local_shape check (local_part ~ '^[a-z0-9]([a-z0-9._+-]*[a-z0-9])?$')
);
create unique index if not exists mail_users_email_key on public.mail_users(email);
create unique index if not exists mail_users_domain_local on public.mail_users(domain_id, local_part);

-- email must actually be local_part @ its own domain, or Postfix accepts
-- mail for an address Dovecot cannot authenticate.
create or replace function public.mail_users_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp
as $fn$
declare v_domain text;
begin
  select domain into v_domain from public.mail_domains where id = new.domain_id;
  if v_domain is null then raise exception 'unknown mail domain'; end if;
  new.local_part := lower(trim(new.local_part));
  new.email      := new.local_part || '@' || v_domain;
  new.maildir    := v_domain || '/' || new.local_part;
  return new;
end $fn$;

drop trigger if exists mail_users_guard_t on public.mail_users;
create trigger mail_users_guard_t before insert or update on public.mail_users
  for each row execute function public.mail_users_guard();

-- ------------------------------------------------------------
-- ALIASES. Forwarding, including to addresses we do not host.
-- ------------------------------------------------------------
create table if not exists public.mail_aliases (
  id           uuid primary key default gen_random_uuid(),
  domain_id    uuid not null references public.mail_domains(id) on delete cascade,
  source       text not null,
  destination  text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint mail_aliases_lower check (source = lower(source) and destination = lower(destination))
);
create unique index if not exists mail_aliases_pair on public.mail_aliases(source, destination);

-- ------------------------------------------------------------
-- MINTING. One function, so the ceiling and the hashing cannot be
-- skipped by writing the row directly.
-- ------------------------------------------------------------
create or replace function public.mail_mint_mailbox(
  p_domain text, p_local_part text, p_password text, p_quota_bytes bigint default null)
returns text language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp
as $fn$
declare v_dom public.mail_domains; v_count integer; v_email text;
begin
  if not public.mnet_is_admin() then
    raise exception 'only the house admin may mint mailboxes';
  end if;
  if p_password is null or length(p_password) < 12 then
    raise exception 'mailbox password must be at least 12 characters';
  end if;

  select * into v_dom from public.mail_domains where domain = lower(trim(p_domain));
  if v_dom.id is null then raise exception 'no such mail domain: %', p_domain; end if;
  if not v_dom.active then raise exception 'mail domain % is not active', p_domain; end if;

  select count(*) into v_count from public.mail_users where domain_id = v_dom.id;
  if v_count >= v_dom.max_mailboxes then
    raise exception 'domain % is at its ceiling of % mailboxes', p_domain, v_dom.max_mailboxes;
  end if;

  insert into public.mail_users (domain_id, local_part, email, password_hash, maildir, quota_bytes)
  values (v_dom.id, lower(trim(p_local_part)), 'set-by-trigger',
          crypt(p_password, gen_salt('bf', 10)), 'set-by-trigger',
          coalesce(p_quota_bytes, v_dom.quota_bytes))
  returning email into v_email;

  return v_email;
end $fn$;

create or replace function public.mail_set_password(p_email text, p_password text)
returns void language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp
as $fn$
begin
  if not public.mnet_is_admin() then raise exception 'only the house admin may reset mailbox passwords'; end if;
  if p_password is null or length(p_password) < 12 then
    raise exception 'mailbox password must be at least 12 characters';
  end if;
  update public.mail_users set password_hash = crypt(p_password, gen_salt('bf', 10))
   where email = lower(trim(p_email));
  if not found then raise exception 'no such mailbox: %', p_email; end if;
end $fn$;

-- ------------------------------------------------------------
-- WHAT THE MAIL SERVER SEES. Views only, and only these three.
-- ------------------------------------------------------------
create or replace view public.mail_v_domains as
  select domain from public.mail_domains where active;

create or replace view public.mail_v_users as
  select u.email, u.password_hash, u.maildir, u.quota_bytes
    from public.mail_users u
    join public.mail_domains d on d.id = u.domain_id
   where u.active and d.active;

create or replace view public.mail_v_aliases as
  select a.source, a.destination
    from public.mail_aliases a
    join public.mail_domains d on d.id = a.domain_id
   where a.active and d.active;

-- ------------------------------------------------------------
-- LOCKDOWN.
-- ------------------------------------------------------------
alter table public.mail_domains enable row level security;
alter table public.mail_users   enable row level security;
alter table public.mail_aliases enable row level security;

drop policy if exists mail_domains_admin on public.mail_domains;
create policy mail_domains_admin on public.mail_domains for all to authenticated
  using (public.mnet_is_admin()) with check (public.mnet_is_admin());
drop policy if exists mail_users_admin on public.mail_users;
create policy mail_users_admin on public.mail_users for all to authenticated
  using (public.mnet_is_admin()) with check (public.mnet_is_admin());
drop policy if exists mail_aliases_admin on public.mail_aliases;
create policy mail_aliases_admin on public.mail_aliases for all to authenticated
  using (public.mnet_is_admin()) with check (public.mnet_is_admin());

revoke all on public.mail_domains, public.mail_users, public.mail_aliases from public, anon, authenticated;
grant select, insert, update, delete on public.mail_domains, public.mail_users, public.mail_aliases to authenticated;
revoke all on function public.mail_mint_mailbox(text,text,text,bigint) from public, anon;
revoke all on function public.mail_set_password(text,text) from public, anon;
grant execute on function public.mail_mint_mailbox(text,text,text,bigint) to authenticated;
grant execute on function public.mail_set_password(text,text) to authenticated;

-- password_hash never leaves the database for anyone but the mail server.
revoke all on public.mail_v_domains, public.mail_v_users, public.mail_v_aliases
  from public, anon, authenticated;
