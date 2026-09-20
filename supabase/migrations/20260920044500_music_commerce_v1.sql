-- McCluster Music commerce v1: platform checkout, creator accounting, entitlements.

alter table public.music_license_offers
  add column if not exists platform_fee_bps integer not null default 1500,
  add column if not exists checkout_enabled boolean not null default false;

do $$ begin
  alter table public.music_license_offers add constraint music_license_platform_fee_check
    check (platform_fee_bps between 0 and 10000);
exception when duplicate_object then null; end $$;

create table if not exists public.music_orders (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.music_license_offers(id) on delete restrict,
  track_id uuid not null references public.creator_tracks(id) on delete restrict,
  creator_m_uid uuid not null references public.m_people(id) on delete restrict,
  customer_user_id uuid references auth.users(id) on delete set null,
  customer_email text not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  amount_cents integer not null check (amount_cents >= 0),
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  creator_net_cents integer not null check (creator_net_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  status text not null default 'pending' check (status in ('pending','paid','refunded','failed','canceled')),
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (platform_fee_cents + creator_net_cents = amount_cents)
);
create index if not exists music_orders_creator_idx on public.music_orders(creator_m_uid,created_at desc);
create index if not exists music_orders_customer_idx on public.music_orders(customer_user_id,created_at desc);
create index if not exists music_orders_payment_idx on public.music_orders(stripe_payment_intent_id) where stripe_payment_intent_id is not null;

create table if not exists public.music_entitlements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.music_orders(id) on delete cascade,
  offer_id uuid not null references public.music_license_offers(id) on delete restrict,
  track_id uuid not null references public.creator_tracks(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  customer_email text not null,
  token uuid not null unique default gen_random_uuid(),
  download_count integer not null default 0,
  last_download_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists music_entitlements_user_idx on public.music_entitlements(user_id,track_id) where revoked_at is null;
create index if not exists music_entitlements_email_idx on public.music_entitlements(lower(customer_email),track_id) where revoked_at is null;

alter table public.music_orders enable row level security;
alter table public.music_entitlements enable row level security;

drop policy if exists music_orders_read on public.music_orders;
create policy music_orders_read on public.music_orders for select to authenticated
using (customer_user_id=auth.uid() or creator_m_uid=public.current_m_uid());
drop policy if exists music_entitlements_read on public.music_entitlements;
create policy music_entitlements_read on public.music_entitlements for select to authenticated
using (user_id=auth.uid());

revoke all on public.music_orders,public.music_entitlements from public,anon,authenticated;
grant select on public.music_orders,public.music_entitlements to authenticated;
grant select,insert,update,delete on public.music_orders,public.music_entitlements to service_role;