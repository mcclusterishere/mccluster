-- ============================================================
-- THE OFFER LADDER lands on the client desk.
--
-- Before this migration a submission carried its plan identity
-- only inside site_requests.body, as the first line of prose:
--   "NEW CLIENT ONBOARDING · Web Management ($309/mo)"
-- The desk read that line by eye and set site_accounts.plan by
-- hand. That still works and is not being taken away.
--
-- This adds the canonical identifiers alongside it, so the four
-- offers and seven configurations are queryable instead of being
-- parsed out of a sentence.
--
-- Everything here is additive and nullable. Existing rows stay
-- valid, existing reads (select kind,body,status,reply,created_at)
-- are untouched, and js/offer-crm.js feature-detects these columns
-- so an insert still succeeds against a database where this
-- migration has not been applied yet.
-- ============================================================

-- ---------- site_requests: what was asked for ----------
alter table public.site_requests
  add column if not exists offer        text,   -- runway | anti-social | who-did-the-shoot | write-a-song
  add column if not exists mode         text,   -- m | equity   (null for runway, which has no mode)
  add column if not exists config       text,   -- the seven: runway, anti-social.m, anti-social.equity, ...
  add column if not exists legacy_plan  text;   -- hosting | management | social — the pre-ladder slug, where one applies

comment on column public.site_requests.offer is
  'Canonical offer id from data/offers.json. One of the four core offers.';
comment on column public.site_requests.mode is
  'M Mode or Equity Uprise. Null for Runway, which has no Equity version.';
comment on column public.site_requests.config is
  'One of the seven selectable configurations. offer for Runway, offer.mode for the rest.';
comment on column public.site_requests.legacy_plan is
  'Backward compatibility: the data/sites.json plan slug this configuration corresponds to, so pre-ladder records and reports still line up. Null where the offer never had a lane (production and campaign work).';

-- the desk pulls its queue by offer, newest first
create index if not exists site_requests_by_offer
  on public.site_requests (offer, created_at desc);

-- Guard the vocabulary without breaking history: the checks allow
-- NULL, so every row written before this migration stays valid.
alter table public.site_requests
  drop constraint if exists site_requests_offer_known;
alter table public.site_requests
  add constraint site_requests_offer_known
  check (offer is null or offer in
    ('runway','anti-social','who-did-the-shoot','write-a-song'));

alter table public.site_requests
  drop constraint if exists site_requests_mode_known;
alter table public.site_requests
  add constraint site_requests_mode_known
  check (mode is null or mode in ('m','equity'));

-- Runway has no Equity Uprise version. Enforce it at the table so
-- no client, page or future script can file one.
alter table public.site_requests
  drop constraint if exists site_requests_runway_has_no_equity;
alter table public.site_requests
  add constraint site_requests_runway_has_no_equity
  check (not (offer = 'runway' and mode = 'equity'));

-- ---------- site_accounts: what they ended up on ----------
-- site_accounts.plan already carries the legacy slug and keeps doing
-- so; grandfathered $87 and $309 agreements stay exactly as written.
-- These columns record the current-ladder identity for new work.
alter table public.site_accounts
  add column if not exists offer   text,
  add column if not exists mode    text,
  add column if not exists config  text;

comment on column public.site_accounts.plan is
  'LEGACY, still authoritative for grandfathered agreements: the data/sites.json slug (hosting $87, management $309, social $875). Never rewrite this on an existing agreement — historical pricing is a record, not a default.';
comment on column public.site_accounts.config is
  'Current-ladder identity for engagements sold on the four-offer system. Coexists with plan; plan is what the client is billed under, config is what they bought.';

alter table public.site_accounts
  drop constraint if exists site_accounts_offer_known;
alter table public.site_accounts
  add constraint site_accounts_offer_known
  check (offer is null or offer in
    ('runway','anti-social','who-did-the-shoot','write-a-song'));

-- No RLS changes. site_requests inserts are still "user_id = auth.uid()",
-- which permits these columns without a new policy; site_accounts is still
-- desk-written (service role) and client-readable only.
