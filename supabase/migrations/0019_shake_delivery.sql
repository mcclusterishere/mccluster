-- ============================================================
-- THE SHAKE RUN — delivery on the Southern campus, New Haven.
--
-- A small, real business: one person makes shakes and walks them to a
-- building on campus. The software has exactly three jobs — take money
-- correctly, tell the runner what to make and where to take it, and tell
-- the customer the truth about where their order is.
--
-- ---- THE THREE THINGS THIS SCHEMA REFUSES TO GET WRONG ---------------
--
-- 1. THE CLIENT NEVER SETS A PRICE. There is no insert policy on
--    shake_orders for anybody. Orders are written by the shake-order edge
--    function on the service role, after it has re-priced the whole cart
--    from these tables. A checkout that trusts a number from the browser
--    is a checkout that sells shakes for a penny.
--
-- 2. A CLOSED SHOP TAKES NO ORDERS. The window is a row, the shop is open
--    only while that row says so, and the function checks it. Otherwise
--    somebody orders at 3am and there is a paid order nobody can fill.
--
-- 3. CUSTOMER ADDRESSES ARE NOT A GENERAL STAFF PERMISSION. The Equity
--    Uprise editor role does NOT reach this data. Someone helping moderate
--    civic perspectives has no business holding a list of which dorm room
--    a named person is in at 9pm. Crew is its own allowlist, and it is
--    the owner who grants it.
--
-- PASTE: Supabase → SQL Editor. Idempotent; safe to re-run.
-- Depends on 0017 for eu_profiles and eu_is_admin().
-- ============================================================

-- ============================================================
-- 1. WHO CAN WORK THE QUEUE
-- ============================================================

create table if not exists public.shake_crew (
  profile_id uuid primary key references public.eu_profiles(id) on delete cascade,
  added_by   uuid references public.eu_profiles(id) on delete set null,
  at         timestamptz not null default now()
);

comment on table public.shake_crew is
  'Who may see orders and work the queue. Deliberately NOT the eu_profiles editor role: civic moderation and a list of which room a customer is in at 9pm are different trust levels.';

create or replace function public.shake_is_crew()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.eu_is_admin()
      or exists (select 1 from public.shake_crew c where c.profile_id = auth.uid());
$$;

-- ============================================================
-- 2. THE MENU
--
-- `options` is where sizes and add-ins live, as a list of groups:
--   [{"key":"size","label":"Size","required":true,"choices":[
--       {"value":"16","label":"16 oz","delta_cents":0},
--       {"value":"24","label":"24 oz","delta_cents":200}]}]
-- The edge function walks this to price a cart, so a choice that is not
-- in here cannot be charged for and cannot be ordered.
-- ============================================================

create table if not exists public.shake_products (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  blurb       text not null default '',
  price_cents int  not null check (price_cents >= 0),
  image       text not null default '',
  category    text not null default 'shake' check (category in ('shake', 'extra')),
  options     jsonb not null default '[]'::jsonb,
  allergens   text not null default '',
  available   boolean not null default true,
  ordinal     int not null default 0,
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- 3. WHERE IT GETS DELIVERED
--
-- The service area is one campus, so the delivery address is a pick from
-- a short list plus a room number — not a free-text address. That is not
-- a limitation, it is the whole safety model: an order can only ever be
-- addressed somewhere the runner has agreed to walk to.
-- ============================================================

create table if not exists public.shake_stops (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  note     text not null default '',
  active   boolean not null default true,
  ordinal  int not null default 0
);

comment on table public.shake_stops is
  'The buildings on the Southern campus this run serves. Owner-managed from the desk: add the ones you actually walk to, deactivate the rest. An order cannot name a stop that is not here.';

-- ============================================================
-- 4. THE WINDOW
--
-- The shop is open when a row here says open AND now() is inside it.
-- Both halves matter: the status lets the runner close early when they
-- are out of bananas, and the clock closes it for them when they forget.
-- ============================================================

create table if not exists public.shake_windows (
  id             uuid primary key default gen_random_uuid(),
  opens_at       timestamptz not null default now(),
  closes_at      timestamptz not null,
  status         text not null default 'open' check (status in ('open', 'closed')),
  note           text not null default '',
  max_orders     int not null default 20 check (max_orders > 0),
  fee_cents      int not null default 0 check (fee_cents >= 0),
  opened_by      uuid references public.eu_profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists shake_windows_live on public.shake_windows (status, closes_at desc);

-- (The shake_open_window view lives after shake_orders, below: it counts
--  orders, and a view is parsed the moment it is created.)

-- ============================================================
-- 5. ORDERS
--
-- `items` is a SNAPSHOT written by the edge function: the name, the
-- chosen options and the price as they were at the moment of sale. It is
-- not a set of foreign keys on purpose — a price change next week must
-- never rewrite what somebody was charged last week.
-- ============================================================

create table if not exists public.shake_orders (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  window_id      uuid references public.shake_windows(id) on delete set null,
  profile_id     uuid references public.eu_profiles(id) on delete set null,
  claim_token    text not null default '',
  customer_name  text not null default '',
  contact_phone  text not null default '',
  contact_email  text not null default '',
  stop_id        uuid references public.shake_stops(id) on delete set null,
  stop_name      text not null default '',
  room_detail    text not null default '',
  items          jsonb not null default '[]'::jsonb,
  subtotal_cents int not null default 0,
  fee_cents      int not null default 0,
  total_cents    int not null default 0,
  status         text not null default 'pending_payment'
                 check (status in ('pending_payment','paid','making','on_the_way','delivered','canceled','refunded')),
  payment_provider text not null default '',
  payment_ref    text not null default '',
  note           text not null default '',
  placed_at      timestamptz not null default now(),
  paid_at        timestamptz,
  delivered_at   timestamptz
);

create index if not exists shake_orders_queue on public.shake_orders (status, placed_at);
create index if not exists shake_orders_mine on public.shake_orders (profile_id, placed_at desc);
create index if not exists shake_orders_claim on public.shake_orders (claim_token);

create table if not exists public.shake_order_events (
  id       bigserial primary key,
  order_id uuid not null references public.shake_orders(id) on delete cascade,
  from_status text not null default '',
  to_status   text not null,
  actor    text not null default '',
  note     text not null default '',
  at       timestamptz not null default now()
);

create index if not exists shake_order_events_order on public.shake_order_events (order_id, at);

-- Every status change writes its own line. The runner's word for where an
-- order got to is not a memory, it is a row.
create or replace function public.shake_orders_track()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'paid' and new.paid_at is null then new.paid_at := now(); end if;
    if new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); end if;
    insert into public.shake_order_events (order_id, from_status, to_status, actor)
    values (new.id, old.status, new.status, coalesce(auth.jwt() ->> 'email', 'system'));
  end if;
  return new;
end;
$$;

drop trigger if exists shake_orders_track_t on public.shake_orders;
create trigger shake_orders_track_t
  before update on public.shake_orders
  for each row execute function public.shake_orders_track();

-- The one question every page asks: is the shop open, and is there room?
-- A view, so the storefront and the checkout can never disagree about it.
create or replace view public.shake_open_window as
select w.id, w.opens_at, w.closes_at, w.note, w.max_orders, w.fee_cents,
       (select count(*) from public.shake_orders o
         where o.window_id = w.id and o.status <> 'canceled') as taken
from public.shake_windows w
where w.status = 'open' and now() between w.opens_at and w.closes_at
order by w.closes_at desc
limit 1;

-- ============================================================
-- 6. THE WALLS
-- ============================================================

alter table public.shake_crew        enable row level security;
alter table public.shake_products    enable row level security;
alter table public.shake_stops       enable row level security;
alter table public.shake_windows     enable row level security;
alter table public.shake_orders      enable row level security;
alter table public.shake_order_events enable row level security;

-- the menu and the stops are a shop window: anyone may look
drop policy if exists shake_products_read on public.shake_products;
create policy shake_products_read on public.shake_products
  for select to anon, authenticated using (available or public.shake_is_crew());

drop policy if exists shake_products_crew on public.shake_products;
create policy shake_products_crew on public.shake_products
  for all to authenticated using (public.shake_is_crew()) with check (public.shake_is_crew());

drop policy if exists shake_stops_read on public.shake_stops;
create policy shake_stops_read on public.shake_stops
  for select to anon, authenticated using (active or public.shake_is_crew());

drop policy if exists shake_stops_crew on public.shake_stops;
create policy shake_stops_crew on public.shake_stops
  for all to authenticated using (public.shake_is_crew()) with check (public.shake_is_crew());

drop policy if exists shake_windows_read on public.shake_windows;
create policy shake_windows_read on public.shake_windows
  for select to anon, authenticated using (true);

drop policy if exists shake_windows_crew on public.shake_windows;
create policy shake_windows_crew on public.shake_windows
  for all to authenticated using (public.shake_is_crew()) with check (public.shake_is_crew());

-- ORDERS. Note what is missing: there is no insert policy, for anyone.
-- The only writer is the edge function on the service role, which prices
-- the cart itself. A browser cannot create an order at all, so a browser
-- cannot create a cheap one.
drop policy if exists shake_orders_mine on public.shake_orders;
create policy shake_orders_mine on public.shake_orders
  for select to authenticated
  using (profile_id = auth.uid() or public.shake_is_crew());

drop policy if exists shake_orders_crew on public.shake_orders;
create policy shake_orders_crew on public.shake_orders
  for update to authenticated using (public.shake_is_crew()) with check (public.shake_is_crew());

drop policy if exists shake_orders_admin_del on public.shake_orders;
create policy shake_orders_admin_del on public.shake_orders
  for delete to authenticated using (public.eu_is_admin());

drop policy if exists shake_events_read on public.shake_order_events;
create policy shake_events_read on public.shake_order_events
  for select to authenticated
  using (public.shake_is_crew()
         or exists (select 1 from public.shake_orders o
                    where o.id = order_id and o.profile_id = auth.uid()));

drop policy if exists shake_crew_read on public.shake_crew;
create policy shake_crew_read on public.shake_crew
  for select to authenticated using (profile_id = auth.uid() or public.eu_is_admin());

drop policy if exists shake_crew_admin on public.shake_crew;
create policy shake_crew_admin on public.shake_crew
  for all to authenticated using (public.eu_is_admin()) with check (public.eu_is_admin());

-- ============================================================
-- 7. GRANTS
-- ============================================================

grant select on public.shake_products, public.shake_stops, public.shake_windows,
               public.shake_open_window to anon, authenticated;
grant select, insert, update, delete on public.shake_products, public.shake_stops,
               public.shake_windows to authenticated;
grant select, update, delete on public.shake_orders to authenticated;
grant select on public.shake_order_events to authenticated;
grant select, insert, delete on public.shake_crew to authenticated;

grant execute on function public.shake_is_crew() to anon, authenticated;

-- ============================================================
-- 8. THE STARTING SHOP
--
-- Placeholder prices and a placeholder menu, on purpose: the owner edits
-- these from the desk. The stops are deliberately EMPTY — inventing
-- building names for a campus is exactly the kind of confident guess that
-- sends somebody to the wrong door. Add the buildings you actually walk
-- to, from the desk, before opening the first window.
-- ============================================================

insert into public.shake_products (slug, name, blurb, price_cents, category, options, ordinal) values
  ('house-shake', 'The House Shake', 'Vanilla base, whatever fruit is good that week.', 700, 'shake',
   '[{"key":"size","label":"Size","required":true,"choices":[
       {"value":"16","label":"16 oz","delta_cents":0},
       {"value":"24","label":"24 oz","delta_cents":200}]},
     {"key":"addin","label":"Add-in","required":false,"choices":[
       {"value":"none","label":"None","delta_cents":0},
       {"value":"peanut-butter","label":"Peanut butter","delta_cents":100},
       {"value":"protein","label":"Protein scoop","delta_cents":150}]}]'::jsonb, 1),
  ('chocolate-malt', 'Chocolate Malt', 'Thick. Bring a spoon.', 750, 'shake',
   '[{"key":"size","label":"Size","required":true,"choices":[
       {"value":"16","label":"16 oz","delta_cents":0},
       {"value":"24","label":"24 oz","delta_cents":200}]}]'::jsonb, 2),
  ('strawberry', 'Strawberry', 'Real strawberries, not syrup.', 750, 'shake',
   '[{"key":"size","label":"Size","required":true,"choices":[
       {"value":"16","label":"16 oz","delta_cents":0},
       {"value":"24","label":"24 oz","delta_cents":200}]}]'::jsonb, 3),
  ('extra-shot', 'Extra protein scoop', 'On the side.', 150, 'extra', '[]'::jsonb, 10)
on conflict (slug) do nothing;

-- ============================================================
-- SELF-CHECK — expect 6 tables, all with RLS, and 0 stops until you add
-- the buildings you actually deliver to.
-- ============================================================
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'shake\_%') as tables,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'shake\_%' and c.relrowsecurity) as rls_on,
  (select count(*) from public.shake_products) as products,
  (select count(*) from public.shake_stops) as stops;
