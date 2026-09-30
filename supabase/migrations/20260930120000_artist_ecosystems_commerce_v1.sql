-- ARTIST ECOSYSTEMS — COMMERCE V1
--
-- An artist room (artist.html?a=<slug>) is an org on the plane with its own
-- Stripe connected account. The money path is deliberate:
--
--   buyer ──direct charge──► ARTIST's connected account   (artist = merchant of record)
--                              └─ application fee ──────► McCluster platform account
--
-- McCluster Corp is a public charity. It never takes the sale onto its own
-- books: it collects only the disclosed platform fee. Sales tax, refunds,
-- disputes and the statement descriptor belong to the artist's account.
--
-- What this migration deliberately does NOT contain: buyback prices, units,
-- shares, resale markets, or cash referral payouts. See
-- docs/explore/ARTIST-ECOSYSTEM.md for why.
--
-- Referral rewards in v1 are STORE CREDIT funded by the artist: redeeming
-- credit lowers the price charged on the artist's account. No money moves to
-- the referrer, so the charity pays no one and issues no 1099s.
--
-- All writes go through service-role functions (artist-checkout,
-- stripe-webhook) or the SECURITY DEFINER RPCs below. Clients only read
-- their own rows.

create table if not exists public.artist_ecosystems (
  slug               text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  org_id             uuid not null unique references public.orgs(id) on delete restrict,
  artist_m_uid       uuid references public.m_people(id) on delete set null,
  display_name       text not null check (char_length(display_name) between 1 and 120),
  music_handle       text,
  status             text not null default 'draft' check (status in ('draft','live','paused')),
  platform_fee_bps   integer not null default 1000 check (platform_fee_bps between 0 and 3000),
  referral_credit_bps integer not null default 1000 check (referral_credit_bps between 0 and 3000),
  config             jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.artist_ecosystems is
  'One artist room per org. Sales settle to the org''s Stripe connected account (org_stripe_accounts); McCluster takes platform_fee_bps as an application fee.';

create table if not exists public.artist_products (
  id            uuid primary key default gen_random_uuid(),
  artist_slug   text not null references public.artist_ecosystems(slug) on delete cascade,
  sku           text not null check (sku ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  title         text not null check (char_length(title) between 1 and 160),
  description   text not null default '' check (char_length(description) <= 2000),
  image_url     text not null default '',
  price_cents   integer not null check (price_cents >= 100),
  currency      text not null default 'usd' check (currency = 'usd'),
  edition_size  integer check (edition_size is null or edition_size > 0),
  ships         boolean not null default true,
  status        text not null default 'draft' check (status in ('draft','live','sold_out','archived')),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (artist_slug, sku)
);

create table if not exists public.artist_orders (
  id                          uuid primary key default gen_random_uuid(),
  artist_slug                 text not null references public.artist_ecosystems(slug) on delete restrict,
  product_id                  uuid not null references public.artist_products(id) on delete restrict,
  customer_m_uid              uuid not null references public.m_people(id) on delete restrict,
  customer_email              text not null default '',
  connected_account_id        text not null,
  livemode                    boolean not null,
  stripe_checkout_session_id  text unique,
  stripe_payment_intent_id    text unique,
  list_price_cents            integer not null check (list_price_cents > 0),
  credit_applied_cents        integer not null default 0 check (credit_applied_cents >= 0),
  amount_cents                integer not null check (amount_cents > 0),
  application_fee_cents       integer not null check (application_fee_cents >= 0),
  currency                    text not null default 'usd',
  referral_code               text,
  edition_number              integer,
  status                      text not null default 'pending'
                              check (status in ('pending','paid','canceled','failed','refunded')),
  paid_at                     timestamptz,
  refunded_at                 timestamptz,
  metadata                    jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (amount_cents = list_price_cents - credit_applied_cents),
  check (application_fee_cents <= amount_cents)
);
create index if not exists artist_orders_customer on public.artist_orders(customer_m_uid, created_at desc);
create unique index if not exists artist_orders_edition
  on public.artist_orders(product_id, edition_number) where edition_number is not null;

-- THE BACKER LEDGER. Append-only: "what I put in and what I got".
-- Credit balance = earned + returned - spent - reversed.
create table if not exists public.backer_ledger (
  id            bigserial primary key,
  m_uid         uuid not null references public.m_people(id) on delete cascade,
  artist_slug   text not null references public.artist_ecosystems(slug) on delete cascade,
  order_id      uuid references public.artist_orders(id) on delete set null,
  kind          text not null check (kind in (
                  'backed','refunded','item_shipped','item_delivered',
                  'store_credit_earned','store_credit_spent','store_credit_returned','store_credit_reversed')),
  amount_cents  integer not null default 0 check (amount_cents >= 0),
  item_ref      text,
  note          text not null default '',
  at            timestamptz not null default now()
);
create index if not exists backer_ledger_person on public.backer_ledger(m_uid, artist_slug, at desc);
create unique index if not exists backer_ledger_once_per_order
  on public.backer_ledger(order_id, kind, m_uid) where order_id is not null;

-- Single-level referral links. No fee to join, no purchase required.
create table if not exists public.referral_links (
  code         text primary key check (code ~ '^[a-z0-9-]{6,48}$'),
  m_uid        uuid not null references public.m_people(id) on delete cascade,
  artist_slug  text not null references public.artist_ecosystems(slug) on delete cascade,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (m_uid, artist_slug)
);

create table if not exists public.referral_attributions (
  id            bigserial primary key,
  code          text not null references public.referral_links(code),
  order_id      uuid not null unique references public.artist_orders(id) on delete cascade,
  credit_cents  integer not null check (credit_cents >= 0),
  status        text not null default 'earned' check (status in ('earned','reversed')),
  at            timestamptz not null default now()
);

alter table public.artist_ecosystems     enable row level security;
alter table public.artist_products       enable row level security;
alter table public.artist_orders         enable row level security;
alter table public.backer_ledger         enable row level security;
alter table public.referral_links        enable row level security;
alter table public.referral_attributions enable row level security;

drop policy if exists artist_ecosystems_public on public.artist_ecosystems;
create policy artist_ecosystems_public on public.artist_ecosystems
  for select to anon, authenticated using (status = 'live');
drop policy if exists artist_products_public on public.artist_products;
create policy artist_products_public on public.artist_products
  for select to anon, authenticated using (
    status in ('live','sold_out')
    and exists (select 1 from public.artist_ecosystems e where e.slug = artist_slug and e.status = 'live'));
drop policy if exists artist_orders_self on public.artist_orders;
create policy artist_orders_self on public.artist_orders
  for select to authenticated using (customer_m_uid = public.current_m_uid());
drop policy if exists backer_ledger_self on public.backer_ledger;
create policy backer_ledger_self on public.backer_ledger
  for select to authenticated using (m_uid = public.current_m_uid());
drop policy if exists referral_links_self on public.referral_links;
create policy referral_links_self on public.referral_links
  for select to authenticated using (m_uid = public.current_m_uid());
drop policy if exists referral_attributions_self on public.referral_attributions;
create policy referral_attributions_self on public.referral_attributions
  for select to authenticated using (exists (
    select 1 from public.referral_links l where l.code = referral_attributions.code and l.m_uid = public.current_m_uid()));

revoke insert, update, delete on public.artist_ecosystems, public.artist_products, public.artist_orders,
  public.backer_ledger, public.referral_links, public.referral_attributions from anon, authenticated;

-- Credit balance for one person in one room.
create or replace function public.artist_credit_balance(p_m_uid uuid, p_slug text)
returns integer language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
  select greatest(0, coalesce(sum(case
           when kind in ('store_credit_earned','store_credit_returned') then amount_cents
           when kind in ('store_credit_spent','store_credit_reversed') then -amount_cents
           else 0 end), 0))::integer
    from public.backer_ledger
   where m_uid = p_m_uid and artist_slug = p_slug;
$fn$;

-- The signed-in person's own balance.
create or replace function public.artist_my_credit(p_slug text)
returns integer language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
  select case when public.current_m_uid() is null then 0
              else public.artist_credit_balance(public.current_m_uid(), p_slug) end;
$fn$;

-- Get or create the signed-in person's referral link for a live room.
create or replace function public.artist_referral_link(p_slug text)
returns text language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  me uuid := public.current_m_uid();
  c  text;
begin
  if me is null then raise exception 'sign in first' using errcode = '28000'; end if;
  if not exists (select 1 from public.artist_ecosystems where slug = p_slug and status = 'live') then
    raise exception 'room is not live' using errcode = 'P0002';
  end if;
  select code into c from public.referral_links where m_uid = me and artist_slug = p_slug;
  if c is not null then return c; end if;
  c := left(p_slug, 24) || '-' || substr(md5(gen_random_uuid()::text), 1, 8);
  insert into public.referral_links(code, m_uid, artist_slug) values (c, me, p_slug)
  on conflict (m_uid, artist_slug) do nothing;
  select code into c from public.referral_links where m_uid = me and artist_slug = p_slug;
  return c;
end;
$fn$;

-- Open a pending order and hold any credit against it, in one transaction.
-- Serialised per person+room so two checkouts cannot spend the same credit.
-- Price, credit and fee are computed here from rows, never from the client.
create or replace function public.artist_open_order(
  p_slug text, p_product uuid, p_m_uid uuid, p_email text,
  p_account text, p_livemode boolean, p_referral text, p_use_credit boolean)
returns public.artist_orders language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  e public.artist_ecosystems;
  p public.artist_products;
  sold integer;
  take integer := 0;
  amt integer;
  ref text;
  o public.artist_orders;
begin
  select * into e from public.artist_ecosystems where slug = p_slug and status = 'live';
  if e.slug is null then raise exception 'room is not live' using errcode = 'P0002'; end if;
  select * into p from public.artist_products where id = p_product and artist_slug = p_slug and status = 'live';
  if p.id is null then raise exception 'product unavailable' using errcode = 'P0002'; end if;
  if p.edition_size is not null then
    select count(*) into sold from public.artist_orders where product_id = p.id and status = 'paid';
    if sold >= p.edition_size then raise exception 'sold out' using errcode = 'P0001'; end if;
  end if;

  -- Only a live link, for this room, that is not the buyer's own.
  select code into ref from public.referral_links
   where code = p_referral and artist_slug = p_slug and active and m_uid <> p_m_uid;

  perform pg_advisory_xact_lock(hashtext('artist_credit:' || p_m_uid::text || ':' || p_slug));
  if p_use_credit then
    -- Stripe needs a real charge: leave at least $1.00 on the card.
    take := least(public.artist_credit_balance(p_m_uid, p_slug), greatest(p.price_cents - 100, 0));
  end if;
  amt := p.price_cents - take;

  insert into public.artist_orders(artist_slug, product_id, customer_m_uid, customer_email,
         connected_account_id, livemode, list_price_cents, credit_applied_cents, amount_cents,
         application_fee_cents, currency, referral_code)
  values (p_slug, p.id, p_m_uid, lower(coalesce(p_email, '')), p_account, p_livemode,
          p.price_cents, take, amt, floor(amt * e.platform_fee_bps / 10000.0), p.currency, ref)
  returning * into o;

  if take > 0 then
    insert into public.backer_ledger(m_uid, artist_slug, order_id, kind, amount_cents, note)
    values (p_m_uid, p_slug, o.id, 'store_credit_spent', take, 'held for checkout');
  end if;
  return o;
end;
$fn$;

-- Attach the Stripe session once it exists.
create or replace function public.artist_attach_session(p_order uuid, p_session text)
returns void language sql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
  update public.artist_orders set stripe_checkout_session_id = p_session, updated_at = now()
   where id = p_order and status = 'pending' and stripe_checkout_session_id is null;
$fn$;

-- Checkout abandoned or failed: give held credit back, once.
create or replace function public.artist_cancel_order(p_order uuid, p_status text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  o public.artist_orders;
begin
  if p_status not in ('canceled','failed') then raise exception 'bad status'; end if;
  update public.artist_orders set status = p_status, updated_at = now()
   where id = p_order and status = 'pending' returning * into o;
  if o.id is null then return; end if;
  if o.credit_applied_cents > 0 then
    insert into public.backer_ledger(m_uid, artist_slug, order_id, kind, amount_cents, note)
    values (o.customer_m_uid, o.artist_slug, o.id, 'store_credit_returned', o.credit_applied_cents, 'checkout not completed')
    on conflict do nothing;
  end if;
end;
$fn$;

-- Payment confirmed: stamp the order, number the edition, write the ledger,
-- credit the referrer. Idempotent: a replayed webhook changes nothing.
create or replace function public.artist_mark_order_paid(p_order uuid, p_payment_intent text, p_email text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  o public.artist_orders;
  p public.artist_products;
  e public.artist_ecosystems;
  ed integer;
  ref public.referral_links;
  credit integer;
begin
  select * into o from public.artist_orders where id = p_order for update;
  if o.id is null then raise exception 'artist order % not found', p_order; end if;
  if o.status = 'paid' then return; end if;
  select * into p from public.artist_products where id = o.product_id for update;
  select * into e from public.artist_ecosystems where slug = o.artist_slug;

  if p.edition_size is not null then
    select coalesce(max(edition_number), 0) + 1 into ed
      from public.artist_orders where product_id = p.id and edition_number is not null;
    if ed > p.edition_size then ed := null; end if;   -- oversold: honour the sale, no number
  end if;

  update public.artist_orders
     set status = 'paid', stripe_payment_intent_id = coalesce(p_payment_intent, stripe_payment_intent_id),
         customer_email = coalesce(nullif(lower(p_email), ''), customer_email),
         edition_number = ed, paid_at = now(), updated_at = now(),
         metadata = metadata || case when p.edition_size is not null and ed is null
                                     then '{"oversold":true}'::jsonb else '{}'::jsonb end
   where id = o.id;

  if p.edition_size is not null and ed is not null and ed >= p.edition_size then
    update public.artist_products set status = 'sold_out', updated_at = now() where id = p.id and status = 'live';
  end if;

  insert into public.backer_ledger(m_uid, artist_slug, order_id, kind, amount_cents, item_ref, note)
  values (o.customer_m_uid, o.artist_slug, o.id, 'backed', o.amount_cents,
          p.sku || coalesce('-' || lpad(ed::text, 3, '0') || '/' || p.edition_size, ''), p.title)
  on conflict do nothing;

  if o.referral_code is not null then
    select * into ref from public.referral_links where code = o.referral_code and active;
    if ref.code is not null and ref.m_uid <> o.customer_m_uid and ref.artist_slug = o.artist_slug then
      credit := floor(o.amount_cents * e.referral_credit_bps / 10000.0);
      if credit > 0 then
        insert into public.referral_attributions(code, order_id, credit_cents) values (ref.code, o.id, credit)
        on conflict (order_id) do nothing;
        insert into public.backer_ledger(m_uid, artist_slug, order_id, kind, amount_cents, note)
        values (ref.m_uid, o.artist_slug, o.id, 'store_credit_earned', credit, 'someone bought through your link')
        on conflict do nothing;
      end if;
    end if;
  end if;
end;
$fn$;

-- Refund: record it, claw back the referrer's credit. The buyer's spent
-- credit is returned so a refund leaves them whole.
create or replace function public.artist_mark_order_refunded(p_payment_intent text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  o public.artist_orders;
  a public.referral_attributions;
  ref_m uuid;
begin
  select * into o from public.artist_orders where stripe_payment_intent_id = p_payment_intent for update;
  if o.id is null or o.status = 'refunded' then return; end if;
  update public.artist_orders set status = 'refunded', refunded_at = now(), updated_at = now() where id = o.id;
  insert into public.backer_ledger(m_uid, artist_slug, order_id, kind, amount_cents, note)
  values (o.customer_m_uid, o.artist_slug, o.id, 'refunded', o.amount_cents, 'refunded')
  on conflict do nothing;
  if o.credit_applied_cents > 0 then
    insert into public.backer_ledger(m_uid, artist_slug, order_id, kind, amount_cents, note)
    values (o.customer_m_uid, o.artist_slug, o.id, 'store_credit_returned', o.credit_applied_cents, 'refund')
    on conflict do nothing;
  end if;
  select * into a from public.referral_attributions where order_id = o.id and status = 'earned' for update;
  if a.id is not null then
    update public.referral_attributions set status = 'reversed' where id = a.id;
    select m_uid into ref_m from public.referral_links where code = a.code;
    insert into public.backer_ledger(m_uid, artist_slug, order_id, kind, amount_cents, note)
    values (ref_m, o.artist_slug, o.id, 'store_credit_reversed', a.credit_cents, 'referred order was refunded')
    on conflict do nothing;
  end if;
end;
$fn$;

revoke all on function public.artist_credit_balance(uuid, text) from public, anon, authenticated;
revoke all on function public.artist_open_order(text, uuid, uuid, text, text, boolean, text, boolean) from public, anon, authenticated;
revoke all on function public.artist_attach_session(uuid, text) from public, anon, authenticated;
revoke all on function public.artist_cancel_order(uuid, text) from public, anon, authenticated;
revoke all on function public.artist_mark_order_paid(uuid, text, text) from public, anon, authenticated;
revoke all on function public.artist_mark_order_refunded(text) from public, anon, authenticated;
grant execute on function public.artist_credit_balance(uuid, text) to service_role;
grant execute on function public.artist_open_order(text, uuid, uuid, text, text, boolean, text, boolean) to service_role;
grant execute on function public.artist_attach_session(uuid, text) to service_role;
grant execute on function public.artist_cancel_order(uuid, text) to service_role;
grant execute on function public.artist_mark_order_paid(uuid, text, text) to service_role;
grant execute on function public.artist_mark_order_refunded(text) to service_role;
revoke all on function public.artist_my_credit(text) from public, anon;
revoke all on function public.artist_referral_link(text) from public, anon;
grant execute on function public.artist_my_credit(text) to authenticated;
grant execute on function public.artist_referral_link(text) to authenticated;
