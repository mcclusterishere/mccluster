-- End Racism direct track sale: fixed-price public checkout, private fulfillment.
-- APPLIED TO PRODUCTION 2026-10-06 as 20261006232625_music_direct_track_sales_v1.

create table if not exists public.music_direct_offers (
  offer_key text primary key check (offer_key ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  catalog_key text not null unique,
  title text not null,
  price_cents integer not null check (price_cents >= 50),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  asset_bucket text not null,
  asset_path text not null,
  download_name text not null,
  campaign_key text,
  purpose_statement text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.music_direct_orders (
  id uuid primary key default gen_random_uuid(),
  offer_key text not null references public.music_direct_offers(offer_key) on delete restrict,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  customer_email text,
  amount_cents integer not null check (amount_cents >= 50),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  status text not null default 'pending' check (status in ('pending','paid','refunded','failed','canceled')),
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists music_direct_orders_payment_idx on public.music_direct_orders(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists music_direct_orders_email_idx on public.music_direct_orders(lower(customer_email),created_at desc) where customer_email is not null;

create table if not exists public.music_direct_entitlements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.music_direct_orders(id) on delete cascade,
  offer_key text not null references public.music_direct_offers(offer_key) on delete restrict,
  customer_email text,
  token uuid not null unique default gen_random_uuid(),
  download_count integer not null default 0,
  last_download_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists music_direct_entitlements_offer_idx on public.music_direct_entitlements(offer_key,created_at desc) where revoked_at is null;

alter table public.music_direct_offers enable row level security;
alter table public.music_direct_orders enable row level security;
alter table public.music_direct_entitlements enable row level security;

revoke all on table public.music_direct_offers from public, anon, authenticated;
revoke all on table public.music_direct_orders from public, anon, authenticated;
revoke all on table public.music_direct_entitlements from public, anon, authenticated;
grant select,insert,update,delete on table public.music_direct_offers to service_role;
grant select,insert,update,delete on table public.music_direct_orders to service_role;
grant select,insert,update,delete on table public.music_direct_entitlements to service_role;

insert into public.music_direct_offers
  (offer_key,catalog_key,title,price_cents,currency,asset_bucket,asset_path,download_name,campaign_key,purpose_statement,active)
values
  ('end-racism-niggy-nigg-full','cia-mind-control:niggy-nigg-niggr','Niggy Nigg Niggr — Full MP3',100,'usd',
   'mcc-gated-audio','niggy-nigg/niggy-nigg.mp3','Niggy Nigg Niggr.mp3','end-racism-002',
   'A $1 track purchase supports the End Racism campaign. It is not represented as a tax-deductible charitable contribution.',true)
on conflict (offer_key) do update set
  catalog_key=excluded.catalog_key,title=excluded.title,price_cents=excluded.price_cents,currency=excluded.currency,
  asset_bucket=excluded.asset_bucket,asset_path=excluded.asset_path,download_name=excluded.download_name,
  campaign_key=excluded.campaign_key,purpose_statement=excluded.purpose_statement,active=excluded.active,updated_at=now();
