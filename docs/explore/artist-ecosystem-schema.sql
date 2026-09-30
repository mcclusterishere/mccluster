-- PROPOSED. NOT APPLIED. Deliberately kept out of supabase/migrations.
--
-- Artist ecosystems on the canonical plane: an artist room is an org + app
-- membership on the one McCluster identity, never a second user table.
-- Read docs/explore/ARTIST-ECOSYSTEM.md first. There is intentionally no
-- buyback, no share, no unit and no resale-price table here.

-- One row per artist room. Branding moves here from data/artists/*.json once
-- the owner wants it editable without a deploy.
create table if not exists public.artist_ecosystems (
  slug          text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  artist_m_uid  uuid references public.m_people(id) on delete set null,
  org_id        uuid,                       -- the artist's org on the plane
  music_handle  text,                       -- music_creator_profiles.handle
  status        text not null default 'exploration'
                check (status in ('exploration','live','paused')),
  config        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A drop: a rewards campaign. Backers pre-pay for items; nothing financial
-- is promised back.
create table if not exists public.artist_drops (
  id            uuid primary key default gen_random_uuid(),
  artist_slug   text not null references public.artist_ecosystems(slug) on delete cascade,
  title         text not null,
  goal_cents    integer check (goal_cents is null or goal_cents > 0),
  opens_at      timestamptz,
  closes_at     timestamptz,
  status        text not null default 'draft'
                check (status in ('draft','open','funded','fulfilling','closed','cancelled')),
  created_at    timestamptz not null default now()
);

-- The backer ledger. Append-only. "What I put in and what I got."
create table if not exists public.backer_ledger (
  id            bigserial primary key,
  m_uid         uuid not null references public.m_people(id) on delete cascade,
  artist_slug   text not null references public.artist_ecosystems(slug) on delete cascade,
  drop_id       uuid references public.artist_drops(id) on delete set null,
  kind          text not null check (kind in
                  ('backed','refunded','item_shipped','item_delivered','store_credit_earned','store_credit_spent')),
  amount_cents  integer not null default 0,
  item_ref      text,                       -- sku / edition number, e.g. 'tee-black-017/100'
  stripe_ref    text,
  note          text not null default '',
  at            timestamptz not null default now()
);
create index if not exists backer_ledger_person on public.backer_ledger(m_uid, artist_slug, at desc);

-- Single-level referral links. Pay only on real sales; no fee to join.
create table if not exists public.referral_links (
  code          text primary key check (code ~ '^[a-z0-9-]{4,40}$'),
  m_uid         uuid not null references public.m_people(id) on delete cascade,
  artist_slug   text not null references public.artist_ecosystems(slug) on delete cascade,
  commission_bp integer not null default 1000 check (commission_bp between 0 and 5000),
  created_at    timestamptz not null default now(),
  unique (m_uid, artist_slug)
);

create table if not exists public.referral_attributions (
  id               bigserial primary key,
  code             text not null references public.referral_links(code),
  order_ref        text not null unique,    -- the paid order, one attribution each
  sale_cents       integer not null check (sale_cents > 0),
  commission_cents integer not null check (commission_cents >= 0),
  status           text not null default 'pending'
                   check (status in ('pending','payable','paid','reversed')),
  at               timestamptz not null default now()
);

alter table public.artist_ecosystems      enable row level security;
alter table public.artist_drops           enable row level security;
alter table public.backer_ledger          enable row level security;
alter table public.referral_links         enable row level security;
alter table public.referral_attributions  enable row level security;

create policy artist_ecosystems_public on public.artist_ecosystems
  for select to anon, authenticated using (status = 'live');
create policy artist_drops_public on public.artist_drops
  for select to anon, authenticated using (status <> 'draft');
create policy backer_ledger_self on public.backer_ledger
  for select to authenticated using (m_uid = public.current_m_uid());
create policy referral_links_self on public.referral_links
  for select to authenticated using (m_uid = public.current_m_uid());
create policy referral_attributions_self on public.referral_attributions
  for select to authenticated using (
    exists (select 1 from public.referral_links l
            where l.code = referral_attributions.code and l.m_uid = public.current_m_uid()));
-- Writes: service role only (Stripe webhook / checkout function). No client writes.
