-- ORGS: the thing this stops being a website back office and starts being
-- a platform.
--
-- Everything before this assumed one customer, because there was one. The
-- moment a second exists — somebody else's shop, somebody else's building
-- — every question in here gains a "whose": whose Instagram, whose
-- knowledge base, whose thermostat, whose bill.
--
-- ---- THE SPLIT THAT MAKES IT WORK -------------------------------------
--
-- inbox_channels stops meaning two things at once. What Instagram CAN do
-- is a fact about Instagram: it is the same for every customer and no
-- amount of configuring changes it. Whether a given customer has turned
-- it on, and which account they turned on, is theirs. Those were the same
-- table and the same `enabled` column, which worked exactly as long as
-- there was one customer.
--
--   inbox_channels   the catalogue. Global, reference data, one row per
--                    platform. `enabled` here is a PLATFORM kill switch:
--                    "this integration is broken, nobody use it."
--   org_channels     per customer: on or off, which account, which
--                    secret, what the greeting says, what broke last.
--
-- ---- WHERE THE TOKENS GO ----------------------------------------------
--
-- One customer could keep tokens in the function's own environment. N
-- customers cannot: environment variables do not have rows. So a channel
-- names EITHER an env var (the house's own org, unchanged) OR a Vault
-- secret id (everyone else). Still never the token itself — a token in a
-- table is a token in every backup, and that was true when there was one
-- of them too.
--
-- ---- WHY org_id IS DENORMALISED ONTO SOME CHILDREN --------------------
--
-- A message's org is its conversation's org, and could be reached by a
-- join. It is stored anyway on the tables whose parent is NULLABLE —
-- inbox_outbound has no conversation for a follower greeting, and
-- inbox_flow_runs has none for an ingestion error. A policy that joins
-- through a null FK does not deny access; it returns nothing, which looks
-- exactly like an empty inbox and is the worst possible way to fail.
-- Tables whose parent is NOT NULL (kb_chunks, memory_facts, ai_evals,
-- inbox_tags) reach their org through it and stay narrow.

-- ============================================================
-- 1. THE TENANTS
-- ============================================================

create table if not exists public.orgs (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  -- 'studio'   the house itself
  -- 'business' somebody else's shop, restaurant, practice
  -- 'building' a site with hardware in it: sensors, cameras, sound
  kind       text not null default 'business'
             check (kind in ('studio', 'business', 'building')),
  -- Per-tenant knobs that do not deserve a column each: bot voice, daily
  -- AI budget, timezone, quiet hours.
  settings   jsonb not null default '{}'::jsonb,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

comment on column public.orgs.settings is
  'Per-tenant knobs: voice, ai_day_budget_usd, timezone, quiet_hours. Anything that would otherwise be an env var and therefore could only ever have one value.';

create table if not exists public.org_members (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  profile_id uuid not null,
  -- owner: can change credentials and spend money
  -- staff:  can read and reply
  -- viewer: can read
  role       text not null default 'staff' check (role in ('owner', 'staff', 'viewer')),
  added_at   timestamptz not null default now(),
  primary key (org_id, profile_id)
);

create index if not exists org_members_profile on public.org_members (profile_id);

-- The house. Everything that exists today belongs to it.
insert into public.orgs (slug, name, kind)
values ('mccluster', 'McCluster', 'studio')
on conflict (slug) do nothing;

-- Whoever was already staff is an owner of the house org.
insert into public.org_members (org_id, profile_id, role)
select o.id, s.profile_id, 'owner'
  from public.orgs o, public.inbox_staff s
 where o.slug = 'mccluster'
on conflict do nothing;

-- ============================================================
-- 2. WHOSE
-- ============================================================

do $$
declare
  house uuid;
  t text;
begin
  select id into house from public.orgs where slug = 'mccluster';

  foreach t in array array[
    'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_outbound',
    'inbox_flows', 'inbox_flow_runs', 'inbox_followers',
    'kb_documents', 'memory_shared', 'ai_calls'
  ] loop
    execute format('alter table public.%I add column if not exists org_id uuid references public.orgs(id) on delete cascade', t);
    execute format('update public.%I set org_id = %L where org_id is null', t, house);
    execute format('alter table public.%I alter column org_id set default %L', t, house);
    execute format('alter table public.%I alter column org_id set not null', t);
    execute format('create index if not exists %I on public.%I (org_id)', t || '_org', t);
  end loop;
end $$;

-- ============================================================
-- 3. PER-TENANT CHANNELS
--
-- inbox_credentials was one row per channel, which is one row per channel
-- per WORLD. This is one row per channel per customer, and it carries the
-- on/off switch too, because "is Instagram on" was never a global fact.
-- ============================================================

create table if not exists public.org_channels (
  org_id        uuid not null references public.orgs(id) on delete cascade,
  channel       text not null references public.inbox_channels(key) on delete cascade,
  enabled       boolean not null default false,

  -- ONE of these two, never a token. token_env is an environment variable
  -- and therefore can only ever hold one customer's token — it is the
  -- house's own path and nobody else's. secret_id points into the Vault,
  -- which has rows, and is how every other tenant's token is held.
  token_env     text,
  secret_id     uuid,

  -- the non-secret half: a WhatsApp phone_number_id, a Bluesky PDS host,
  -- a Page id. Some sends cannot be built without it.
  account_id    text,
  account_label text,
  -- ids that are US on that platform, so our own posts are never answered
  self_ids      text[] not null default '{}',

  -- Names the env var holding the secret that authenticates INBOUND
  -- webhooks for this tenant: Telegram's setWebhook secret_token, Slack's
  -- signing secret. Different from token_env, which is what we send OUT
  -- with. Null falls back to the platform-wide secret, which is right for
  -- the house and wrong the moment there are two customers on one app.
  webhook_secret_env text,

  follow_greeting text,
  auto_greet    boolean not null default false,

  connected_at  timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  last_error_at timestamptz,
  updated_at    timestamptz not null default now(),

  primary key (org_id, channel),
  constraint org_channels_one_credential
    check (token_env is null or secret_id is null)
);

create index if not exists org_channels_channel on public.org_channels (channel);

comment on constraint org_channels_one_credential on public.org_channels is
  'A channel names an env var or a Vault secret, never both. Two answers to "where is the token" is one answer too many.';

-- Fold the single-tenant credentials in, keeping the enabled flag that
-- currently lives on the catalogue row.
insert into public.org_channels
  (org_id, channel, enabled, token_env, account_id, account_label, self_ids,
   follow_greeting, auto_greet, connected_at, last_ok_at, last_error, last_error_at)
select o.id, c.key, coalesce(ch.enabled, false),
       cr.token_env, cr.account_id, cr.account_label, coalesce(cr.self_ids, '{}'),
       cr.follow_greeting, coalesce(cr.auto_greet, false),
       cr.connected_at, cr.last_ok_at, cr.last_error, cr.last_error_at
  from public.orgs o
  join public.inbox_channels c on true
  left join public.inbox_channels ch on ch.key = c.key
  left join public.inbox_credentials cr on cr.channel = c.key
 where o.slug = 'mccluster'
on conflict (org_id, channel) do nothing;

-- inbox_credentials is not dropped. It is the thing every currently
-- deployed function reads, and dropping it here would break the running
-- system between this migration and that deploy. It is superseded, and
-- 0027 removes it once nothing reads it.
comment on table public.inbox_credentials is
  'SUPERSEDED by org_channels. Kept so a running deployment does not break mid-migration; remove once nothing reads it.';

comment on column public.inbox_channels.enabled is
  'A PLATFORM kill switch: this integration is broken, nobody use it. Whether a given customer has it on lives in org_channels.enabled.';

-- ============================================================
-- 3b. READING A TENANT'S TOKEN
--
-- Supabase Vault stores secrets encrypted and exposes them through
-- vault.decrypted_secrets, which only the service role may read. The
-- function needs one specific secret by id and has no business selecting
-- from that view generally, so this is the narrowest possible door: one
-- id in, one string out, and nothing that can enumerate.
--
-- Wrapped in a check for the extension because a database without the
-- Vault is a perfectly good database — it just cannot host a second
-- tenant, and this returns null there rather than failing to install.
-- ============================================================

create or replace function public.vault_secret(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return null;                       -- no Vault here; token_env is the path
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where id = $1'
     into v using p_id;
  return v;
end $$;

-- Nobody but the service role. This returns a live credential in plain
-- text; there is no version of "a browser may call this" that is correct.
revoke all on function public.vault_secret(uuid) from public, anon, authenticated;

comment on function public.vault_secret(uuid) is
  'One secret, by id, for the edge function on the service role. Returns null where the Vault extension is not installed, so a single-tenant database still works.';

-- ============================================================
-- 4. WHO MAY SEE IT
-- ============================================================

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.eu_is_admin()
      or exists (
           select 1 from public.org_members m
            where m.org_id = p_org and m.profile_id = auth.uid()
         );
$$;

create or replace function public.is_org_owner(p_org uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.eu_is_admin()
      or exists (
           select 1 from public.org_members m
            where m.org_id = p_org and m.profile_id = auth.uid() and m.role = 'owner'
         );
$$;

alter table public.orgs         enable row level security;
alter table public.org_members  enable row level security;
alter table public.org_channels enable row level security;

drop policy if exists orgs_mine on public.orgs;
create policy orgs_mine on public.orgs
  for select using (public.is_org_member(id));

drop policy if exists orgs_admin on public.orgs;
create policy orgs_admin on public.orgs
  for all using (public.eu_is_admin()) with check (public.eu_is_admin());

drop policy if exists org_members_mine on public.org_members;
create policy org_members_mine on public.org_members
  for select using (public.is_org_member(org_id));

drop policy if exists org_members_owner on public.org_members;
create policy org_members_owner on public.org_members
  for all using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

-- A channel row names a secret and can spend money. Reading it is staff;
-- changing it is the owner.
drop policy if exists org_channels_read on public.org_channels;
create policy org_channels_read on public.org_channels
  for select using (public.is_org_member(org_id));

drop policy if exists org_channels_write on public.org_channels;
create policy org_channels_write on public.org_channels
  for all using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

-- ---- the tables that gained an org --------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'inbox_contacts', 'inbox_conversations', 'inbox_messages',
    'inbox_flows', 'inbox_followers'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))',
      t || '_org', t);
  end loop;

  -- read-only for staff: these are the record of what happened, and a
  -- desk that can rewrite the audit trail is not an audit trail
  foreach t in array array['inbox_flow_runs', 'inbox_outbound', 'ai_calls'] loop
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_org_member(org_id))',
      t || '_org', t);
  end loop;
end $$;

-- The knowledge base is what the bot is allowed to say. Staff read it;
-- changing it is the owner's, because adding a document is authorising a
-- claim to be made in the org's name.
drop policy if exists kb_documents_org on public.kb_documents;
create policy kb_documents_org on public.kb_documents
  for select using (public.is_org_member(org_id));
drop policy if exists kb_documents_owner on public.kb_documents;
create policy kb_documents_owner on public.kb_documents
  for all using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

drop policy if exists kb_chunks_org on public.kb_chunks;
create policy kb_chunks_org on public.kb_chunks
  for select using (exists (
    select 1 from public.kb_documents d
     where d.id = kb_chunks.document_id and public.is_org_member(d.org_id)));

drop policy if exists memory_shared_org on public.memory_shared;
create policy memory_shared_org on public.memory_shared
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- memory_facts is what people said in private. Reachable only through
-- the contact, and only by that contact's org.
drop policy if exists memory_facts_org on public.memory_facts;
create policy memory_facts_org on public.memory_facts
  for select using (exists (
    select 1 from public.inbox_contacts c
     where c.id = memory_facts.contact_id and public.is_org_member(c.org_id)));

drop policy if exists inbox_tags_org on public.inbox_tags;
create policy inbox_tags_org on public.inbox_tags
  for all using (exists (
    select 1 from public.inbox_contacts c
     where c.id = inbox_tags.contact_id and public.is_org_member(c.org_id)))
  with check (exists (
    select 1 from public.inbox_contacts c
     where c.id = inbox_tags.contact_id and public.is_org_member(c.org_id)));

drop policy if exists ai_evals_org on public.ai_evals;
create policy ai_evals_org on public.ai_evals
  for all using (exists (
    select 1 from public.ai_calls a
     where a.id = ai_evals.call_id and public.is_org_member(a.org_id)))
  with check (exists (
    select 1 from public.ai_calls a
     where a.id = ai_evals.call_id and public.is_org_member(a.org_id)));

-- ---- grants, stated rather than inherited --------------------------
--
-- Supabase grants anon and authenticated access to new public tables by
-- default. That default is fine when every table is meant to be reachable
-- and catastrophic when one is not, and it is invisible in the migration
-- that created the table. So these are written down here, and this file
-- means the same thing on a database that does not have that default.

revoke all on public.orgs, public.org_members, public.org_channels from anon, authenticated;
grant select on public.orgs, public.org_members, public.org_channels to authenticated;
-- writes pass the owner policies above; the grant only says "may try"
grant insert, update, delete on public.org_members, public.org_channels to authenticated;

-- The knowledge base, the memory and the ledger stay closed to every
-- browser role, exactly as 0023 left them: they are read through the
-- function, which re-checks the caller, and written by nothing but the
-- service role. The org policies above are defence in depth — correct
-- already, so that a grant added in a hurry one day cannot open more
-- than that one table.
revoke all on public.kb_documents, public.kb_chunks, public.memory_facts,
              public.memory_shared, public.ai_calls, public.ai_evals
  from anon, authenticated;

-- ============================================================
-- 5. WHAT IT COST, PER TENANT
--
-- The single-org view had no way to say whose. This one groups.
-- ============================================================

drop view if exists public.ai_spend_24h;
create or replace view public.ai_spend_24h
  with (security_invoker = true) as
  select org_id,
         coalesce(sum(cost_micros), 0)::bigint as cost_micros,
         count(*)::int                          as calls,
         count(*) filter (where not ok)::int    as failures
    from public.ai_calls
   where at > now() - interval '24 hours'
   group by org_id;

-- security_invoker, so this can never become a way around the RLS on
-- ai_calls: the view sees what the CALLER may see, not what its owner may.
-- Which is also why it is not granted to a browser — a browser has no
-- rights on ai_calls at all, so the view would only ever raise. Spend is
-- read through the function, which re-checks the caller and scopes to
-- their org.
revoke all on public.ai_spend_24h from anon, authenticated;

comment on view public.ai_spend_24h is
  'Per-tenant spend in the last day. security_invoker: it shows what the caller may see, never more. Served to the desk through the inbox function, not read directly.';
