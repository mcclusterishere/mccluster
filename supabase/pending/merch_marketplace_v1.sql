-- ============================================================
-- MERCH MARKETPLACE v1 — PENDING, NOT APPLIED IN PRODUCTION.
--
-- Owner, 2026-10-30: "I want my stripe integration to please treat this as a
-- marketplace so others can also sell their merch on it. Remember, its
-- productization we're aiming at here."
--
-- Owner decisions this file encodes:
--   * The seller is the merchant of record: a Stripe Express account per
--     seller, DIRECT charges on that account, McCluster takes
--     application_fee_amount (the model already standardised in
--     workers/mccluster/src/connect.js). One checkout per seller.
--   * The platform cut is 15%, server-controlled:
--     public.marketplace_platform_fee_bps() = 1500, equal to
--     MARKETPLACE_PLATFORM_FEE_BPS in workers/mccluster/src/merch/fee.js
--     (scripts/test/merch-marketplace.test.mjs holds the two equal). The fee
--     is charged on the item subtotal plus shipping, never on sales tax:
--     fee = round((subtotal + shipping) * 1500 / 10000).
--   * A seller is an org (public.orgs / org_members / org_stripe_accounts,
--     the existing Client Connect rail). Anyone can apply and finish Stripe
--     onboarding; the house owner approves a seller before any of its
--     listings is public, and can suspend a seller or remove a listing.
--   * Fulfilment v1: the seller ships, US only. Print on demand (Printful)
--     is the next PR: the slots for it are here (fulfilment_mode, pod_*
--     columns, provider order fields, marketplace_seller_providers) and a
--     check refuses publishing anything that is not 'seller_ships' in v1.
--
-- Tables: marketplace_sellers, marketplace_seller_providers (POD slot, empty),
-- marketplace_assets (who uploaded which image, by the server's record),
-- marketplace_listings, marketplace_variants, marketplace_orders.
-- Bucket: marketplace-media (public images, uploads only through
-- service-signed upload URLs that the Worker records first).
--
-- Every write that moves money, stock or visibility is a security definer
-- function granted to service_role only (the Worker `mccluster` and the
-- `stripe-webhook` Edge Function). Guards on the tables apply to every role,
-- the service role included: terms of an order never change after it is
-- created, an order is paid only from pending under its stored checkout
-- session and connected account, stock is taken atomically when the order
-- is created and given back only if that checkout never completes.
--
-- Decisions documented here (and in the PR):
--   * Stock is reserved when the checkout is created, not when it is paid,
--     so two buyers can never both pay for the last unit. A checkout that
--     expires (Stripe: 30 minutes minimum, the Worker asks for 31) or fails
--     to open gives the unit back.
--   * Stock is never written from a snapshot. After creation a variant's
--     count changes only inside the order functions or
--     marketplace_variant_set_stock(), a compare-and-set against the count
--     the seller loaded; the variant guard refuses any other write, for every
--     role. A stale dashboard cannot erase a reservation or a sale.
--   * Listings waiting for the seller's approval or for Stripe go live when
--     the second of the two arrives, whichever order they come in
--     (marketplace_release_waiting_listings(), called by approval and by a
--     trigger when the org's Stripe rail becomes ready).
--   * A refund does not restock. The unit may not come back, or may come
--     back damaged; the seller adjusts the count by hand.
--
-- Test: bash scripts/test-merch-marketplace-db.sh (scratch Postgres 16+).
-- Rollback: supabase/pending/merch_marketplace_v1.rollback.sql.
-- ============================================================

-- ---------- the fee ----------

create or replace function public.marketplace_platform_fee_bps()
returns integer language sql immutable set search_path = '' as $$ select 1500 $$;

create or replace function public.marketplace_platform_fee_cents(p_basis_cents integer)
returns integer language sql immutable set search_path = '' as $$
  select case when p_basis_cents is null or p_basis_cents < 0 then null
              else round((p_basis_cents::numeric * public.marketplace_platform_fee_bps()) / 10000)::integer end
$$;

-- privileged = not a browser role. Security definer functions run as their
-- owner, so a write made by one of the functions below is privileged.
create or replace function public.marketplace_privileged()
returns boolean language sql stable set search_path = '' as $$
  select current_user not in ('anon', 'authenticated')
$$;

-- ---------- sellers ----------

create table if not exists public.marketplace_sellers (
  org_id        uuid primary key references public.orgs(id) on delete cascade,
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 80),
  bio           text not null default '' check (char_length(bio) <= 2000),
  logo_path     text check (logo_path is null or char_length(logo_path) <= 300),
  status        text not null default 'applied' check (status in ('applied', 'approved', 'suspended')),
  applied_by    uuid not null,
  approved_by   uuid,
  approved_at   timestamptz,
  suspended_at  timestamptz,
  status_reason text check (status_reason is null or char_length(status_reason) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.marketplace_sellers is
  'A merch seller is an org (orgs/org_members/org_stripe_accounts). applied -> approved by the house owner; suspended hides every listing at once.';

-- POD slot (next PR): a seller's own Printful account. The credential itself
-- is never in this table and never readable by a browser: credential_ref names
-- a server-side secret (Supabase Vault). Empty in v1.
create table if not exists public.marketplace_seller_providers (
  org_id            uuid not null references public.marketplace_sellers(org_id) on delete cascade,
  provider          text not null check (provider in ('printful')),
  provider_store_id text,
  credential_ref    text,
  status            text not null default 'unlinked' check (status in ('unlinked', 'linked', 'revoked')),
  linked_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (org_id, provider)
);

-- ---------- images: ownership by the server's record, never by path ----------

create table if not exists public.marketplace_assets (
  object_name   text primary key check (object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  seller_org_id uuid not null references public.marketplace_sellers(org_id) on delete cascade,
  uploaded_by   uuid not null,
  content_type  text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  created_at    timestamptz not null default now()
);

-- ---------- listings and variants ----------

create table if not exists public.marketplace_listings (
  id               uuid primary key default gen_random_uuid(),
  seller_org_id    uuid not null references public.marketplace_sellers(org_id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 1 and 120),
  description      text not null default '' check (char_length(description) <= 5000),
  images           jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(images) = 'array' and jsonb_array_length(images) <= 8),
  status           text not null default 'draft' check (status in ('draft', 'pending_review', 'published', 'removed')),
  price_cents      integer not null check (price_cents between 100 and 1000000),
  currency         text not null default 'usd' check (currency = 'usd'),
  shipping_cents   integer not null default 0 check (shipping_cents between 0 and 100000),
  inventory_policy text not null default 'tracked' check (inventory_policy in ('tracked', 'untracked')),
  fulfilment_mode  text not null default 'seller_ships' check (fulfilment_mode in ('seller_ships', 'pod')),
  pod_provider     text check (pod_provider is null or pod_provider in ('printful')),
  pod_product_id   text check (pod_product_id is null or char_length(pod_product_id) <= 100),
  removed_reason   text check (removed_reason is null or char_length(removed_reason) <= 500),
  removed_by       uuid,
  removed_at       timestamptz,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint marketplace_listings_pod_shape check (
    (fulfilment_mode = 'seller_ships' and pod_provider is null and pod_product_id is null)
    or (fulfilment_mode = 'pod' and pod_provider is not null)),
  -- v1 publishes only what the seller ships. Print on demand is the next PR.
  constraint marketplace_listings_v1_seller_ships check (status <> 'published' or fulfilment_mode = 'seller_ships')
);
create index if not exists marketplace_listings_seller_idx on public.marketplace_listings (seller_org_id, status);

create table if not exists public.marketplace_variants (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references public.marketplace_listings(id) on delete cascade,
  seller_org_id   uuid not null references public.marketplace_sellers(org_id) on delete cascade,
  label           text not null check (char_length(btrim(label)) between 1 and 80),
  options         jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  sku             text check (sku is null or sku ~ '^[A-Za-z0-9._-]{1,64}$'),
  price_cents     integer check (price_cents is null or price_cents between 100 and 1000000),
  inventory_count integer check (inventory_count is null or inventory_count >= 0),
  active          boolean not null default true,
  position        smallint not null default 0,
  fulfilment_mode text not null default 'seller_ships' check (fulfilment_mode in ('seller_ships', 'pod')),
  pod_provider    text check (pod_provider is null or pod_provider in ('printful')),
  pod_variant_id  text check (pod_variant_id is null or char_length(pod_variant_id) <= 100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint marketplace_variants_pod_shape check (
    (fulfilment_mode = 'seller_ships' and pod_provider is null and pod_variant_id is null)
    or (fulfilment_mode = 'pod' and pod_provider is not null)),
  unique (listing_id, sku)
);
create index if not exists marketplace_variants_listing_idx on public.marketplace_variants (listing_id, position);

-- ---------- orders ----------

create table if not exists public.marketplace_orders (
  id                    uuid primary key default gen_random_uuid(),
  seller_org_id         uuid not null references public.marketplace_sellers(org_id),
  listing_id            uuid not null references public.marketplace_listings(id),
  variant_id            uuid not null references public.marketplace_variants(id),
  quantity              integer not null check (quantity between 1 and 10),
  unit_price_cents      integer not null check (unit_price_cents > 0),
  subtotal_cents        integer not null,
  shipping_cents        integer not null check (shipping_cents >= 0),
  fee_basis_cents       integer not null,
  platform_fee_bps      integer not null,
  platform_fee_cents    integer not null,
  tax_cents             integer check (tax_cents is null or tax_cents >= 0),
  total_cents           integer,
  currency              text not null default 'usd' check (currency = 'usd'),
  title_snapshot        text not null,
  variant_label         text not null,
  sku                   text,
  livemode              boolean not null,
  stripe_account_id     text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  checkout_session_id   text unique check (checkout_session_id is null or checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{8,200}$'),
  payment_intent_id     text unique,
  buyer_token_hash      text not null unique check (buyer_token_hash ~ '^[0-9a-f]{64}$'),
  buyer_email           text,
  shipping_address      jsonb,
  status                text not null default 'pending'
                        check (status in ('pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'canceled', 'refunded')),
  inventory_held        boolean not null default false,
  carrier               text check (carrier is null or char_length(carrier) between 1 and 40),
  tracking_number       text check (tracking_number is null or tracking_number ~ '^[A-Za-z0-9 -]{4,64}$'),
  amount_refunded_cents integer not null default 0 check (amount_refunded_cents >= 0),
  fulfilment_mode       text not null default 'seller_ships' check (fulfilment_mode in ('seller_ships', 'pod')),
  provider_order_id     text,
  provider_status       text,
  expires_at            timestamptz,
  paid_at               timestamptz,
  fulfilled_at          timestamptz,
  shipped_at            timestamptz,
  delivered_at          timestamptz,
  canceled_at           timestamptz,
  refunded_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint marketplace_orders_arithmetic check (
    subtotal_cents = unit_price_cents * quantity
    and fee_basis_cents = subtotal_cents + shipping_cents
    and platform_fee_cents = round((fee_basis_cents::numeric * platform_fee_bps) / 10000)::integer
    and (total_cents is null or (tax_cents is not null and total_cents = fee_basis_cents + tax_cents))
    and amount_refunded_cents <= coalesce(total_cents, 0)),
  constraint marketplace_orders_paid_shape check (
    status in ('pending', 'canceled')
    or (checkout_session_id is not null and payment_intent_id is not null and total_cents is not null and paid_at is not null)),
  constraint marketplace_orders_shipped_shape check (
    status <> 'shipped' or (carrier is not null and tracking_number is not null))
);
create index if not exists marketplace_orders_seller_idx on public.marketplace_orders (seller_org_id, created_at desc);
create index if not exists marketplace_orders_status_idx on public.marketplace_orders (status, expires_at);

-- ---------- guards (every role) ----------

create or replace function public.marketplace_seller_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.marketplace_privileged() then
    raise exception 'marketplace sellers are written by the server only';
  end if;
  if new.logo_path is not null and (tg_op = 'INSERT' or new.logo_path is distinct from old.logo_path)
     and not exists (select 1 from public.marketplace_assets a where a.object_name = new.logo_path and a.seller_org_id = new.org_id) then
    raise exception 'logo_not_owned';
  end if;
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.applied_by <> old.applied_by or new.created_at <> old.created_at then
      raise exception 'seller identity is immutable';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists marketplace_seller_guard on public.marketplace_sellers;
create trigger marketplace_seller_guard before insert or update on public.marketplace_sellers
  for each row execute function public.marketplace_seller_guard();

-- is this org's Stripe rail able to take money and pay it out?
create or replace function public.marketplace_rail_ready(p_org uuid, p_livemode boolean default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_stripe_accounts r
     where r.org_id = p_org and r.stripe_account_id is not null
       and (p_livemode is null or r.livemode = p_livemode)
       and r.charges_enabled and r.payouts_enabled and r.details_submitted)
$$;

create or replace function public.marketplace_listing_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_img jsonb;
  v_seller record;
begin
  if tg_op = 'UPDATE' and (new.id <> old.id or new.seller_org_id <> old.seller_org_id or new.created_at <> old.created_at) then
    raise exception 'listing identity is immutable';
  end if;
  if not public.marketplace_privileged() then
    -- a seller's own browser may keep drafts and ask for review, nothing more
    if new.status not in ('draft', 'pending_review') then raise exception 'only the server publishes or removes a listing'; end if;
    if tg_op = 'UPDATE' and old.status not in ('draft', 'pending_review') then raise exception 'listing_locked'; end if;
    if new.removed_by is not null or new.removed_at is not null or new.published_at is distinct from (case when tg_op = 'UPDATE' then old.published_at end) then
      raise exception 'only the server publishes or removes a listing';
    end if;
  end if;
  -- images are objects this seller uploaded, by the server's record
  for v_img in select * from jsonb_array_elements(new.images) loop
    if jsonb_typeof(v_img) <> 'string' or not exists (
      select 1 from public.marketplace_assets a where a.object_name = v_img #>> '{}' and a.seller_org_id = new.seller_org_id) then
      raise exception 'image_not_owned';
    end if;
  end loop;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    select status into v_seller from public.marketplace_sellers where org_id = new.seller_org_id;
    if v_seller.status is distinct from 'approved' then raise exception 'seller_not_approved'; end if;
    if not public.marketplace_rail_ready(new.seller_org_id) then raise exception 'seller_connect_not_ready'; end if;
    new.published_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists marketplace_listing_guard on public.marketplace_listings;
create trigger marketplace_listing_guard before insert or update on public.marketplace_listings
  for each row execute function public.marketplace_listing_guard();

create or replace function public.marketplace_variant_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_listing record;
begin
  select seller_org_id, status into v_listing from public.marketplace_listings where id = new.listing_id;
  if v_listing.seller_org_id is distinct from new.seller_org_id then raise exception 'variant_seller_mismatch'; end if;
  if tg_op = 'UPDATE' and (new.id <> old.id or new.listing_id <> old.listing_id) then
    raise exception 'variant identity is immutable';
  end if;
  if not public.marketplace_privileged() and v_listing.status not in ('draft', 'pending_review') then
    raise exception 'listing_locked';
  end if;
  -- Stock is never written from a snapshot. After creation it changes only
  -- inside marketplace_order_create / _release (a sale, an abandoned
  -- checkout) or marketplace_variant_set_stock (the seller's compare-and-set
  -- against the count they loaded), each of which opens this gate for its
  -- own statement. Any other write, by any role, is refused.
  if tg_op = 'UPDATE' and new.inventory_count is distinct from old.inventory_count
     and coalesce(current_setting('marketplace.stock_write', true), '') <> 'on' then
    raise exception 'stock_write_outside_function';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists marketplace_variant_guard on public.marketplace_variants;
create trigger marketplace_variant_guard before insert or update on public.marketplace_variants
  for each row execute function public.marketplace_variant_guard();

create or replace function public.marketplace_order_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.marketplace_privileged() then
    raise exception 'marketplace orders are written by the server only';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'an order starts pending'; end if;
    if new.platform_fee_bps <> public.marketplace_platform_fee_bps() then raise exception 'platform_fee_mismatch'; end if;
    if new.checkout_session_id is not null or new.payment_intent_id is not null or new.tax_cents is not null
       or new.total_cents is not null or new.paid_at is not null then
      raise exception 'an order is created before its payment';
    end if;
    return new;
  end if;

  -- the terms of the sale never change
  if (new.id, new.seller_org_id, new.listing_id, new.variant_id, new.quantity, new.unit_price_cents,
      new.subtotal_cents, new.shipping_cents, new.fee_basis_cents, new.platform_fee_bps, new.platform_fee_cents,
      new.currency, new.title_snapshot, new.variant_label, new.livemode, new.stripe_account_id,
      new.buyer_token_hash, new.created_at, new.fulfilment_mode)
     is distinct from
     (old.id, old.seller_org_id, old.listing_id, old.variant_id, old.quantity, old.unit_price_cents,
      old.subtotal_cents, old.shipping_cents, old.fee_basis_cents, old.platform_fee_bps, old.platform_fee_cents,
      old.currency, old.title_snapshot, old.variant_label, old.livemode, old.stripe_account_id,
      old.buyer_token_hash, old.created_at, old.fulfilment_mode)
     or new.sku is distinct from old.sku then
    raise exception 'order terms are immutable';
  end if;
  -- the session is attached once, while pending
  if old.checkout_session_id is not null and new.checkout_session_id is distinct from old.checkout_session_id then
    raise exception 'checkout session is immutable';
  end if;
  if old.checkout_session_id is null and new.checkout_session_id is not null and old.status <> 'pending' then
    raise exception 'checkout session attaches only to a pending order';
  end if;
  -- what the payment said is written once, at payment
  if old.status <> 'pending' and (new.payment_intent_id, new.tax_cents, new.total_cents, new.buyer_email, new.shipping_address, new.paid_at)
       is distinct from (old.payment_intent_id, old.tax_cents, old.total_cents, old.buyer_email, old.shipping_address, old.paid_at) then
    raise exception 'payment facts are immutable';
  end if;
  if new.amount_refunded_cents < old.amount_refunded_cents then raise exception 'refunds only grow'; end if;
  if new.status <> old.status and not (
       (old.status = 'pending' and new.status in ('paid', 'canceled'))
    or (old.status = 'paid' and new.status in ('fulfilled', 'shipped', 'delivered', 'refunded'))
    or (old.status = 'fulfilled' and new.status in ('shipped', 'delivered', 'refunded'))
    or (old.status = 'shipped' and new.status in ('delivered', 'refunded'))
    or (old.status = 'delivered' and new.status = 'refunded')) then
    raise exception 'order cannot move from % to %', old.status, new.status;
  end if;
  if new.status = 'paid' and old.status = 'pending' and old.checkout_session_id is null then
    raise exception 'an order is paid only under its stored checkout session';
  end if;
  if old.status = 'refunded' and (new.carrier, new.tracking_number) is distinct from (old.carrier, old.tracking_number) then
    raise exception 'a refunded order is closed';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists marketplace_order_guard on public.marketplace_orders;
create trigger marketplace_order_guard before insert or update on public.marketplace_orders
  for each row execute function public.marketplace_order_guard();

create or replace function public.marketplace_order_no_delete()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'marketplace orders are never deleted'; end $$;
drop trigger if exists marketplace_order_no_delete on public.marketplace_orders;
create trigger marketplace_order_no_delete before delete on public.marketplace_orders
  for each row execute function public.marketplace_order_no_delete();

-- ---------- what the public may see ----------

create or replace function public.marketplace_listing_visible(p_listing uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.marketplace_listings l
      join public.marketplace_sellers s on s.org_id = l.seller_org_id
     where l.id = p_listing and l.status = 'published' and l.fulfilment_mode = 'seller_ships'
       and s.status = 'approved' and public.marketplace_rail_ready(l.seller_org_id))
$$;

-- The storefront's one read: published listings of approved, Connect-ready
-- sellers, with only public fields. Stock is shown as available units, not
-- the seller's books.
create or replace function public.marketplace_public_listings(p_seller_slug text default null, p_listing uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'published_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', l.id, 'title', l.title, 'description', l.description, 'images', l.images,
      'price_cents', l.price_cents, 'currency', l.currency, 'shipping_cents', l.shipping_cents,
      'published_at', l.published_at,
      'seller', jsonb_build_object('slug', s.slug, 'display_name', s.display_name, 'bio', s.bio, 'logo_path', s.logo_path),
      'variants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', v.id, 'label', v.label, 'options', v.options,
          'price_cents', coalesce(v.price_cents, l.price_cents),
          'available', case when l.inventory_policy = 'untracked' then null else coalesce(v.inventory_count, 0) end,
          'in_stock', l.inventory_policy = 'untracked' or coalesce(v.inventory_count, 0) > 0)
          order by v.position, v.created_at)
        from public.marketplace_variants v where v.listing_id = l.id and v.active), '[]'::jsonb)
    ) x
    from public.marketplace_listings l join public.marketplace_sellers s on s.org_id = l.seller_org_id
    where public.marketplace_listing_visible(l.id)
      and (p_seller_slug is null or s.slug = p_seller_slug)
      and (p_listing is null or l.id = p_listing)
    limit 200
  ) q
$$;

-- ---------- RLS ----------

alter table public.marketplace_sellers enable row level security;
alter table public.marketplace_seller_providers enable row level security;
alter table public.marketplace_seller_providers force row level security;
alter table public.marketplace_assets enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.marketplace_variants enable row level security;
alter table public.marketplace_orders enable row level security;

revoke all on public.marketplace_sellers, public.marketplace_seller_providers, public.marketplace_assets,
  public.marketplace_listings, public.marketplace_variants, public.marketplace_orders from anon, authenticated;

-- public: approved sellers' public columns; published listings and their active variants
grant select (org_id, slug, display_name, bio, logo_path, status) on public.marketplace_sellers to anon, authenticated;
grant select (id, seller_org_id, title, description, images, status, price_cents, currency, shipping_cents,
              inventory_policy, fulfilment_mode, published_at) on public.marketplace_listings to anon;
grant select (id, listing_id, seller_org_id, label, options, sku, price_cents, inventory_count, active, position,
              fulfilment_mode) on public.marketplace_variants to anon;
-- seller members: their own rows, and their own drafts
grant select on public.marketplace_listings, public.marketplace_variants, public.marketplace_assets to authenticated;
grant insert (seller_org_id, title, description, images, status, price_cents, shipping_cents, inventory_policy),
      update (title, description, images, status, price_cents, shipping_cents, inventory_policy)
  on public.marketplace_listings to authenticated;
grant insert (listing_id, seller_org_id, label, options, sku, price_cents, inventory_count, active, position),
      update (label, options, sku, price_cents, inventory_count, active, position)
  on public.marketplace_variants to authenticated;
grant select (id, seller_org_id, listing_id, variant_id, quantity, unit_price_cents, subtotal_cents, shipping_cents,
              fee_basis_cents, platform_fee_bps, platform_fee_cents, tax_cents, total_cents, currency, title_snapshot,
              variant_label, sku, livemode, buyer_email, shipping_address, status, carrier, tracking_number,
              amount_refunded_cents, fulfilment_mode, provider_status, paid_at, fulfilled_at, shipped_at,
              delivered_at, canceled_at, refunded_at, created_at, updated_at)
  on public.marketplace_orders to authenticated;

drop policy if exists marketplace_sellers_public_read on public.marketplace_sellers;
create policy marketplace_sellers_public_read on public.marketplace_sellers for select to anon, authenticated
  using (status = 'approved');
drop policy if exists marketplace_sellers_member_read on public.marketplace_sellers;
create policy marketplace_sellers_member_read on public.marketplace_sellers for select to authenticated
  using ((select private.is_org_member(org_id)));

drop policy if exists marketplace_listings_public_read on public.marketplace_listings;
create policy marketplace_listings_public_read on public.marketplace_listings for select to anon, authenticated
  using ((select public.marketplace_listing_visible(id)));
drop policy if exists marketplace_listings_member_read on public.marketplace_listings;
create policy marketplace_listings_member_read on public.marketplace_listings for select to authenticated
  using ((select private.is_org_member(seller_org_id)));
drop policy if exists marketplace_listings_member_insert on public.marketplace_listings;
create policy marketplace_listings_member_insert on public.marketplace_listings for insert to authenticated
  with check ((select private.is_org_member(seller_org_id)) and status in ('draft', 'pending_review'));
drop policy if exists marketplace_listings_member_update on public.marketplace_listings;
create policy marketplace_listings_member_update on public.marketplace_listings for update to authenticated
  using ((select private.is_org_member(seller_org_id)) and status in ('draft', 'pending_review'))
  with check ((select private.is_org_member(seller_org_id)) and status in ('draft', 'pending_review'));

drop policy if exists marketplace_variants_public_read on public.marketplace_variants;
create policy marketplace_variants_public_read on public.marketplace_variants for select to anon, authenticated
  using (active and (select public.marketplace_listing_visible(listing_id)));
drop policy if exists marketplace_variants_member_read on public.marketplace_variants;
create policy marketplace_variants_member_read on public.marketplace_variants for select to authenticated
  using ((select private.is_org_member(seller_org_id)));
drop policy if exists marketplace_variants_member_insert on public.marketplace_variants;
create policy marketplace_variants_member_insert on public.marketplace_variants for insert to authenticated
  with check ((select private.is_org_member(seller_org_id)));
drop policy if exists marketplace_variants_member_update on public.marketplace_variants;
create policy marketplace_variants_member_update on public.marketplace_variants for update to authenticated
  using ((select private.is_org_member(seller_org_id))) with check ((select private.is_org_member(seller_org_id)));

drop policy if exists marketplace_assets_member_read on public.marketplace_assets;
create policy marketplace_assets_member_read on public.marketplace_assets for select to authenticated
  using ((select private.is_org_member(seller_org_id)));

-- a seller's members read that seller's orders, never another seller's; buyers
-- read theirs only through marketplace_order_by_token()
drop policy if exists marketplace_orders_member_read on public.marketplace_orders;
create policy marketplace_orders_member_read on public.marketplace_orders for select to authenticated
  using ((select private.is_org_member(seller_org_id)));

-- ---------- storage: public images, written only through recorded grants ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketplace-media', 'marketplace-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
-- No insert/update/delete policy for browsers: the Worker records the
-- object in marketplace_assets and then signs a one-time upload URL for that
-- exact path. Nothing else can write into the bucket.

-- ---------- audit ----------

create or replace function public.marketplace_audit(p_org uuid, p_actor uuid, p_event text, p_type text, p_id text, p_detail jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.control_audit (org_id, actor_user_id, actor_kind, event, resource_type, resource_id, detail)
  values (p_org, null, case when p_actor is null then 'system' else 'user' end, p_event, p_type, p_id,
          coalesce(p_detail, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('actor', p_actor)))
$$;

-- ---------- seller lifecycle (service role only) ----------

create or replace function public.marketplace_seller_apply(
  p_user uuid, p_slug text, p_display_name text, p_bio text, p_livemode boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing record;
  v_org uuid;
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if p_user is null then raise exception 'sign_in_required'; end if;
  select s.* into v_existing from public.marketplace_sellers s
    join public.org_members m on m.org_id = s.org_id
   where m.profile_id = p_user and m.role = 'owner' order by s.created_at limit 1;
  if found then
    return jsonb_build_object('created', false, 'org_id', v_existing.org_id, 'slug', v_existing.slug, 'status', v_existing.status);
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then raise exception 'invalid_slug'; end if;
  if exists (select 1 from public.marketplace_sellers where slug = v_slug)
     or exists (select 1 from public.orgs where slug = 'shop-' || v_slug) then
    raise exception 'slug_taken';
  end if;
  insert into public.orgs (slug, name, kind, settings)
  values ('shop-' || v_slug, left(btrim(p_display_name), 80), 'business', jsonb_build_object('marketplace_seller', true))
  returning id into v_org;
  insert into public.org_members (org_id, profile_id, role) values (v_org, p_user, 'owner');
  insert into public.marketplace_sellers (org_id, slug, display_name, bio, status, applied_by)
  values (v_org, v_slug, btrim(p_display_name), left(coalesce(p_bio, ''), 2000), 'applied', p_user);
  insert into public.org_stripe_accounts (org_id, livemode, account_reference)
  values (v_org, coalesce(p_livemode, false), 'merch-' || v_slug)
  on conflict do nothing;
  perform public.marketplace_audit(v_org, p_user, 'marketplace.seller_applied', 'marketplace_seller', v_org::text,
    jsonb_build_object('slug', v_slug));
  return jsonb_build_object('created', true, 'org_id', v_org, 'slug', v_slug, 'status', 'applied');
end $$;

-- One rule for "what was waiting may go live now", used by both orders of
-- events: the owner approves a seller whose Stripe is already ready, or Stripe
-- becomes ready (account.updated, a dashboard refresh, any write to
-- org_stripe_accounts) after the owner approved. Publishes the seller's
-- pending_review listings that have an active option, only if the seller is
-- approved and its rail can take and pay out money.
create or replace function public.marketplace_release_waiting_listings(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_published integer := 0;
begin
  if not exists (select 1 from public.marketplace_sellers where org_id = p_org and status = 'approved')
     or not public.marketplace_rail_ready(p_org) then
    return 0;
  end if;
  with moved as (
    update public.marketplace_listings l set status = 'published'
     where l.seller_org_id = p_org and l.status = 'pending_review' and l.fulfilment_mode = 'seller_ships'
       and exists (select 1 from public.marketplace_variants v where v.listing_id = l.id and v.active)
    returning 1)
  select count(*) into v_published from moved;
  if v_published > 0 then
    perform public.marketplace_audit(p_org, null, 'marketplace.listings_released', 'marketplace_seller', p_org::text,
      jsonb_build_object('published', v_published));
  end if;
  return v_published;
end $$;

create or replace function public.marketplace_rail_became_ready()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.marketplace_release_waiting_listings(new.org_id);
  return null;
end $$;
drop trigger if exists marketplace_rail_became_ready on public.org_stripe_accounts;
create trigger marketplace_rail_became_ready
  after insert or update of stripe_account_id, charges_enabled, payouts_enabled, details_submitted on public.org_stripe_accounts
  for each row
  when (new.stripe_account_id is not null and new.charges_enabled and new.payouts_enabled and new.details_submitted)
  execute function public.marketplace_rail_became_ready();

-- The seller's own stock change: a compare-and-set against the count the
-- seller loaded. If an order took (or an expired checkout returned) a unit in
-- between, the count differs and the write is refused (stock_changed), so a
-- stale dashboard can never erase a reservation or a sale.
create or replace function public.marketplace_variant_set_stock(
  p_variant uuid, p_seller_org uuid, p_expected integer, p_count integer, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  if p_count is not null and (p_count < 0 or p_count > 1000000) then raise exception 'invalid_stock'; end if;
  select * into v from public.marketplace_variants where id = p_variant for update;
  if not found or v.seller_org_id <> p_seller_org then raise exception 'unknown_variant'; end if;
  if v.inventory_count is distinct from p_expected then raise exception 'stock_changed'; end if;
  perform set_config('marketplace.stock_write', 'on', true);
  update public.marketplace_variants set inventory_count = p_count where id = p_variant;
  perform set_config('marketplace.stock_write', '', true);
  perform public.marketplace_audit(p_seller_org, p_actor, 'marketplace.stock_set', 'marketplace_variant', p_variant::text,
    jsonb_build_object('from', v.inventory_count, 'to', p_count));
  return jsonb_build_object('id', p_variant, 'inventory_count', p_count);
end $$;

create or replace function public.marketplace_seller_set_status(p_org uuid, p_status text, p_actor uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
  v_published integer := 0;
begin
  if p_status not in ('approved', 'suspended') then raise exception 'invalid_status'; end if;
  select status into v_old from public.marketplace_sellers where org_id = p_org for update;
  if not found then raise exception 'unknown_seller'; end if;
  update public.marketplace_sellers
     set status = p_status,
         approved_by = case when p_status = 'approved' then p_actor else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         suspended_at = case when p_status = 'suspended' then now() else null end,
         status_reason = left(p_reason, 500)
   where org_id = p_org;
  -- approval releases what was waiting for it, if Stripe can pay the seller
  if p_status = 'approved' then
    v_published := public.marketplace_release_waiting_listings(p_org);
  end if;
  perform public.marketplace_audit(p_org, p_actor, 'marketplace.seller_' || p_status, 'marketplace_seller', p_org::text,
    jsonb_strip_nulls(jsonb_build_object('from', v_old, 'reason', p_reason, 'published', v_published)));
  return jsonb_build_object('org_id', p_org, 'status', p_status, 'previous', v_old, 'published', v_published);
end $$;

create or replace function public.marketplace_listing_request_publish(p_listing uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v record;
  v_status text;
  v_reason text;
begin
  select l.*, s.status as seller_status into v
    from public.marketplace_listings l join public.marketplace_sellers s on s.org_id = l.seller_org_id
   where l.id = p_listing for update of l;
  if not found then raise exception 'unknown_listing'; end if;
  if v.status = 'removed' then raise exception 'listing_removed'; end if;
  if v.status = 'published' then return jsonb_build_object('status', 'published'); end if;
  if v.fulfilment_mode <> 'seller_ships' then raise exception 'pod_not_available_in_v1'; end if;
  if not exists (select 1 from public.marketplace_variants where listing_id = p_listing and active) then
    raise exception 'listing_needs_a_variant';
  end if;
  if v.seller_status <> 'approved' then v_status := 'pending_review'; v_reason := 'seller_not_approved';
  elsif not public.marketplace_rail_ready(v.seller_org_id) then v_status := 'pending_review'; v_reason := 'seller_connect_not_ready';
  else v_status := 'published';
  end if;
  update public.marketplace_listings set status = v_status where id = p_listing;
  perform public.marketplace_audit(v.seller_org_id, p_actor, 'marketplace.listing_' || v_status, 'marketplace_listing',
    p_listing::text, jsonb_strip_nulls(jsonb_build_object('waiting_for', v_reason)));
  return jsonb_strip_nulls(jsonb_build_object('status', v_status, 'waiting_for', v_reason));
end $$;

create or replace function public.marketplace_listing_set_removed(p_listing uuid, p_actor uuid, p_removed boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select * into v from public.marketplace_listings where id = p_listing for update;
  if not found then raise exception 'unknown_listing'; end if;
  if p_removed then
    update public.marketplace_listings
       set status = 'removed', removed_reason = left(p_reason, 500), removed_by = p_actor, removed_at = now()
     where id = p_listing;
  elsif v.status = 'removed' then
    -- restored to the seller as a draft; it is published again only by asking
    update public.marketplace_listings
       set status = 'draft', removed_reason = null, removed_by = null, removed_at = null, published_at = null
     where id = p_listing;
  end if;
  perform public.marketplace_audit(v.seller_org_id, p_actor,
    case when p_removed then 'marketplace.listing_removed' else 'marketplace.listing_restored' end,
    'marketplace_listing', p_listing::text, jsonb_strip_nulls(jsonb_build_object('reason', p_reason, 'from', v.status)));
  return jsonb_build_object('id', p_listing, 'status', case when p_removed then 'removed' when v.status = 'removed' then 'draft' else v.status end);
end $$;

-- ---------- orders (service role only) ----------

-- Prices, fee and stock come from here, never from the browser. The unit is
-- taken now (row lock on the variant), so the last one is sold once.
create or replace function public.marketplace_order_create(
  p_listing uuid, p_variant uuid, p_quantity integer, p_livemode boolean, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l record;
  v record;
  r record;
  v_unit integer;
  v_sub integer;
  v_basis integer;
  v_order public.marketplace_orders;
  v_held boolean := false;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 10 then raise exception 'invalid_quantity'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token'; end if;
  select * into v from public.marketplace_variants where id = p_variant for update;
  if not found or v.listing_id <> p_listing or not v.active then raise exception 'variant_unavailable'; end if;
  select * into l from public.marketplace_listings where id = p_listing;
  if not public.marketplace_listing_visible(p_listing) then raise exception 'listing_unavailable'; end if;
  if v.fulfilment_mode <> 'seller_ships' then raise exception 'variant_unavailable'; end if;
  select * into r from public.org_stripe_accounts
   where org_id = l.seller_org_id and livemode = coalesce(p_livemode, false)
     and stripe_account_id is not null and charges_enabled and payouts_enabled and details_submitted;
  if not found then raise exception 'seller_not_ready'; end if;
  if l.inventory_policy = 'tracked' then
    if coalesce(v.inventory_count, 0) < p_quantity then raise exception 'out_of_stock'; end if;
    perform set_config('marketplace.stock_write', 'on', true);
    update public.marketplace_variants set inventory_count = inventory_count - p_quantity where id = p_variant;
    perform set_config('marketplace.stock_write', '', true);
    v_held := true;
  end if;
  v_unit := coalesce(v.price_cents, l.price_cents);
  v_sub := v_unit * p_quantity;
  v_basis := v_sub + l.shipping_cents;
  insert into public.marketplace_orders (
    seller_org_id, listing_id, variant_id, quantity, unit_price_cents, subtotal_cents, shipping_cents,
    fee_basis_cents, platform_fee_bps, platform_fee_cents, currency, title_snapshot, variant_label, sku,
    livemode, stripe_account_id, buyer_token_hash, status, inventory_held, expires_at)
  values (
    l.seller_org_id, p_listing, p_variant, p_quantity, v_unit, v_sub, l.shipping_cents,
    v_basis, public.marketplace_platform_fee_bps(), public.marketplace_platform_fee_cents(v_basis), 'usd',
    l.title, v.label, v.sku, coalesce(p_livemode, false), r.stripe_account_id, p_token_hash, 'pending', v_held,
    now() + interval '35 minutes')
  returning * into v_order;
  return jsonb_build_object(
    'id', v_order.id, 'seller_org_id', v_order.seller_org_id, 'stripe_account_id', v_order.stripe_account_id,
    'title', v_order.title_snapshot, 'variant_label', v_order.variant_label, 'sku', v_order.sku,
    'quantity', v_order.quantity, 'unit_price_cents', v_order.unit_price_cents,
    'subtotal_cents', v_order.subtotal_cents, 'shipping_cents', v_order.shipping_cents,
    'fee_basis_cents', v_order.fee_basis_cents, 'platform_fee_bps', v_order.platform_fee_bps,
    'platform_fee_cents', v_order.platform_fee_cents, 'currency', v_order.currency, 'livemode', v_order.livemode);
end $$;

create or replace function public.marketplace_order_attach_session(p_order uuid, p_session text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.marketplace_orders set checkout_session_id = p_session
   where id = p_order and status = 'pending' and checkout_session_id is null;
  return found;
end $$;

-- A checkout that never completes gives its unit back. With p_session null
-- only an order whose session was never attached (Stripe refused to open it).
create or replace function public.marketplace_order_release(p_order uuid, p_session text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare o record;
begin
  select * into o from public.marketplace_orders where id = p_order for update;
  if not found or o.status <> 'pending' then return false; end if;
  if (p_session is null and o.checkout_session_id is not null)
     or (p_session is not null and o.checkout_session_id is distinct from p_session) then
    return false;
  end if;
  update public.marketplace_orders set status = 'canceled', canceled_at = now(), inventory_held = false where id = p_order;
  if o.inventory_held then
    perform set_config('marketplace.stock_write', 'on', true);
    update public.marketplace_variants set inventory_count = coalesce(inventory_count, 0) + o.quantity where id = o.variant_id;
    perform set_config('marketplace.stock_write', '', true);
  end if;
  perform public.marketplace_audit(o.seller_org_id, null, 'marketplace.order_released', 'marketplace_order', p_order::text,
    jsonb_build_object('restocked', o.inventory_held, 'quantity', o.quantity));
  return true;
end $$;

-- The webhook's binding, enforced again in the database: this order, its
-- stored session, its stored connected account, its mode, and the amounts
-- the server set (tax is Stripe's, on top). Returns a refusal instead of
-- raising, so a session that is not this order's payment is not retried.
create or replace function public.marketplace_order_mark_paid(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o record;
  v_tax integer := (p->>'amount_tax')::integer;
  v_total integer := (p->>'amount_total')::integer;
  v_ship jsonb := case when jsonb_typeof(p->'shipping') = 'object' then p->'shipping' else null end;
begin
  select * into o from public.marketplace_orders where id = nullif(p->>'order_id', '')::uuid for update;
  if not found then return jsonb_build_object('refused', 'order_not_found'); end if;
  if o.stripe_account_id is distinct from nullif(p->>'account', '') then return jsonb_build_object('refused', 'account_mismatch'); end if;
  if o.checkout_session_id is null or o.checkout_session_id is distinct from nullif(p->>'session_id', '') then
    return jsonb_build_object('refused', 'session_mismatch');
  end if;
  if o.livemode is distinct from (p->>'livemode')::boolean then return jsonb_build_object('refused', 'mode_mismatch'); end if;
  if lower(coalesce(p->>'currency', '')) <> o.currency then return jsonb_build_object('refused', 'currency_mismatch'); end if;
  if (p->>'amount_subtotal')::integer is distinct from o.subtotal_cents
     or (p->>'amount_shipping')::integer is distinct from o.shipping_cents
     or coalesce((p->>'amount_discount')::integer, 0) <> 0
     or v_tax is null or v_tax < 0
     or v_total is distinct from o.fee_basis_cents + v_tax then
    return jsonb_build_object('refused', 'amount_mismatch');
  end if;
  if nullif(p->>'payment_intent', '') is null then return jsonb_build_object('refused', 'no_payment_intent'); end if;
  if o.status <> 'pending' then
    if o.status = 'canceled' then return jsonb_build_object('refused', 'order_not_payable'); end if;
    return jsonb_build_object('changed', false, 'order_id', o.id, 'status', o.status);
  end if;
  update public.marketplace_orders
     set status = 'paid', payment_intent_id = p->>'payment_intent', tax_cents = v_tax, total_cents = v_total,
         buyer_email = lower(nullif(btrim(p->>'email'), '')), shipping_address = v_ship, paid_at = now()
   where id = o.id;
  perform public.marketplace_audit(o.seller_org_id, null, 'marketplace.order_paid', 'marketplace_order', o.id::text,
    jsonb_build_object('session', o.checkout_session_id, 'total_cents', v_total, 'tax_cents', v_tax,
                       'platform_fee_cents', o.platform_fee_cents, 'livemode', o.livemode));
  return jsonb_build_object('changed', true, 'order_id', o.id, 'status', 'paid', 'seller_org_id', o.seller_org_id,
                            'platform_fee_cents', o.platform_fee_cents);
end $$;

-- charge.refunded on the seller's account. amount_refunded is Stripe's
-- running total, so an older or repeated event never lowers it.
create or replace function public.marketplace_order_record_refund(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o record;
  v_refunded integer := (p->>'amount_refunded')::integer;
  v_new integer;
begin
  select * into o from public.marketplace_orders where id = nullif(p->>'order_id', '')::uuid for update;
  if not found then return jsonb_build_object('refused', 'order_not_found'); end if;
  if o.stripe_account_id is distinct from nullif(p->>'account', '') then return jsonb_build_object('refused', 'account_mismatch'); end if;
  if o.livemode is distinct from (p->>'livemode')::boolean then return jsonb_build_object('refused', 'mode_mismatch'); end if;
  if o.status = 'pending' then return jsonb_build_object('retry', 'order_not_paid_yet'); end if;
  if o.payment_intent_id is distinct from nullif(p->>'payment_intent', '') then return jsonb_build_object('refused', 'payment_mismatch'); end if;
  if v_refunded is null or v_refunded < 0 then return jsonb_build_object('refused', 'invalid_amount'); end if;
  v_new := least(greatest(o.amount_refunded_cents, v_refunded), o.total_cents);
  update public.marketplace_orders
     set amount_refunded_cents = v_new,
         status = case when v_new >= o.total_cents and o.status <> 'refunded' then 'refunded' else status end,
         refunded_at = case when v_new >= o.total_cents and refunded_at is null then now() else refunded_at end
   where id = o.id;
  perform public.marketplace_audit(o.seller_org_id, null, 'marketplace.order_refund', 'marketplace_order', o.id::text,
    jsonb_build_object('amount_refunded_cents', v_new, 'full', v_new >= o.total_cents));
  return jsonb_build_object('changed', v_new <> o.amount_refunded_cents, 'order_id', o.id,
                            'amount_refunded_cents', v_new, 'status', case when v_new >= o.total_cents then 'refunded' else o.status end);
end $$;

-- The seller's own fulfilment steps: packed, shipped with tracking, delivered.
create or replace function public.marketplace_order_seller_update(
  p_order uuid, p_seller_org uuid, p_status text, p_carrier text, p_tracking text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o record;
begin
  select * into o from public.marketplace_orders where id = p_order for update;
  if not found or o.seller_org_id <> p_seller_org then raise exception 'unknown_order'; end if;
  if p_status not in ('fulfilled', 'shipped', 'delivered') then raise exception 'invalid_status'; end if;
  if p_status = 'shipped' and (nullif(btrim(p_carrier), '') is null or nullif(btrim(p_tracking), '') is null) then
    raise exception 'tracking_required';
  end if;
  update public.marketplace_orders
     set status = p_status,
         carrier = case when p_status = 'shipped' then btrim(p_carrier) else carrier end,
         tracking_number = case when p_status = 'shipped' then btrim(p_tracking) else tracking_number end,
         fulfilled_at = case when p_status = 'fulfilled' then now() else fulfilled_at end,
         shipped_at = case when p_status = 'shipped' then now() else shipped_at end,
         delivered_at = case when p_status = 'delivered' then now() else delivered_at end
   where id = p_order;
  perform public.marketplace_audit(o.seller_org_id, p_actor, 'marketplace.order_' || p_status, 'marketplace_order', p_order::text,
    jsonb_strip_nulls(jsonb_build_object('from', o.status, 'carrier', p_carrier)));
  return jsonb_build_object('id', p_order, 'status', p_status);
end $$;

-- The buyer's view, by the random token handed to them at checkout. Only
-- the hash is stored. No email, street address or payment reference.
create or replace function public.marketplace_order_by_token(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_token is null or char_length(p_token) < 32 then null else (
    select jsonb_build_object(
      'id', o.id, 'status', o.status, 'title', o.title_snapshot, 'variant', o.variant_label, 'quantity', o.quantity,
      'subtotal_cents', o.subtotal_cents, 'shipping_cents', o.shipping_cents, 'tax_cents', o.tax_cents,
      'total_cents', o.total_cents, 'amount_refunded_cents', o.amount_refunded_cents, 'currency', o.currency,
      'carrier', o.carrier, 'tracking_number', o.tracking_number, 'livemode', o.livemode,
      'ship_to', case when o.shipping_address is null then null else jsonb_build_object(
        'city', o.shipping_address->>'city', 'state', o.shipping_address->>'state') end,
      'seller', jsonb_build_object('slug', s.slug, 'display_name', s.display_name),
      'created_at', o.created_at, 'paid_at', o.paid_at, 'shipped_at', o.shipped_at,
      'delivered_at', o.delivered_at, 'refunded_at', o.refunded_at, 'canceled_at', o.canceled_at)
    from public.marketplace_orders o join public.marketplace_sellers s on s.org_id = o.seller_org_id
    where o.buyer_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) end
$$;

-- ---------- privileges on functions ----------

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.marketplace_seller_apply(uuid, text, text, text, boolean)',
    'public.marketplace_seller_set_status(uuid, text, uuid, text)',
    'public.marketplace_listing_request_publish(uuid, uuid)',
    'public.marketplace_listing_set_removed(uuid, uuid, boolean, text)',
    'public.marketplace_order_create(uuid, uuid, integer, boolean, text)',
    'public.marketplace_order_attach_session(uuid, text)',
    'public.marketplace_order_release(uuid, text)',
    'public.marketplace_order_mark_paid(jsonb)',
    'public.marketplace_order_record_refund(jsonb)',
    'public.marketplace_order_seller_update(uuid, uuid, text, text, text, uuid)',
    'public.marketplace_audit(uuid, uuid, text, text, text, jsonb)',
    'public.marketplace_release_waiting_listings(uuid)',
    'public.marketplace_variant_set_stock(uuid, uuid, integer, integer, uuid)',
    'public.marketplace_rail_became_ready()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.marketplace_public_listings(text, uuid)',
    'public.marketplace_order_by_token(text)',
    'public.marketplace_listing_visible(uuid)',
    'public.marketplace_rail_ready(uuid, boolean)',
    'public.marketplace_platform_fee_bps()',
    'public.marketplace_platform_fee_cents(integer)',
    'public.marketplace_privileged()'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $grants$;
