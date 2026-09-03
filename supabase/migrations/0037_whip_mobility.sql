-- ============================================================
-- WHIP EQUIPPED MOBILITY TABLES.
--
-- The three Whip Equipped applications were finished and calling
-- /api/rides, /api/drivers/me and /api/rentals/vehicles against this
-- project. None of the tables those calls need existed here: migration
-- 0034 built the platform core -- apps, fee policies, ledger, OAuth --
-- and stopped before mobility. So even once the routes were ported into
-- workers/mccluster/src/whip/, there was nothing for them to write to.
--
-- This is Whip-Equipped/backend/schema.sql and its 002_identity.sql,
-- brought into this repository's migration sequence and qualified to the
-- public schema. Nothing about the shape is invented here: it is the
-- schema the satellite's handlers were written against, so the columns
-- match the code that reads them.
--
-- NON-DESTRUCTIVE. Every statement is create-if-not-exists, add-column-
-- if-not-exists, or an upsert that leaves existing rows alone. Running
-- it twice changes nothing the second time.
--
-- NO ANONYMOUS POLICIES, ON PURPOSE. Row level security is on for every
-- table and no policy is granted to anon or authenticated. The apps do
-- not touch these tables directly -- they go through the Worker on the
-- service role, which is the only thing holding a key.
--
-- The seed rows at the foot (one tenant, one demo driver, four rental
-- vehicles, six candidate partners with enabled=false) come from the
-- satellite as written. The vehicles are placeholders for a real lot.
-- ============================================================

-- Whip Equipped shared backend schema
-- Idempotent production bootstrap for Rider, Driver, Rentals, operators, payments and partner referrals.

create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  logo_url text,
  primary_color text not null default '#F04449',
  secondary_color text not null default '#F6AD62',
  tagline text not null default 'IN THIS TOGETHER',
  white_label_enabled boolean not null default false,
  platform_fee_percent numeric(5,4) not null default 0.03,
  stripe_account_id text,
  subscription_status text not null default 'network',
  created_at timestamptz not null default now()
);

alter table public.tenants add column if not exists contact_email text;
alter table public.tenants add column if not exists stripe_customer_id text;
alter table public.tenants add column if not exists stripe_subscription_id text;
alter table public.tenants add column if not exists stripe_charges_enabled boolean not null default false;
alter table public.tenants add column if not exists stripe_payouts_enabled boolean not null default false;
alter table public.tenants add column if not exists stripe_details_submitted boolean not null default false;
alter table public.tenants add column if not exists updated_at timestamptz not null default now();

create table if not exists public.operator_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  auth_user_id text,
  email text not null,
  role text not null default 'owner' check (role in ('owner','admin','dispatcher','finance','viewer')),
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table if not exists public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  hostname text unique not null,
  verified boolean not null default false,
  cloudflare_custom_hostname_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  auth_user_id uuid,
  display_name text not null,
  phone text,
  rating numeric(3,2) default 5.00,
  vehicle_make text,
  vehicle_model text,
  vehicle_color text,
  license_plate text,
  seats int default 4,
  online boolean not null default false,
  lat double precision,
  lng double precision,
  heading double precision,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete restrict,
  rider_id text not null,
  driver_id uuid references public.drivers(id),
  status text not null default 'REQUESTED' check (status in (
    'REQUESTED','OFFERED','ACCEPTED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','VERIFIED','IN_PROGRESS','COMPLETED','CANCELED'
  )),
  pickup_label text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_label text not null,
  dropoff_lat double precision,
  dropoff_lng double precision,
  miles numeric(8,2),
  minutes int,
  ride_tier text not null default 'WE Standard',
  fare_cents int not null,
  platform_fee_cents int not null default 0,
  pickup_pin text,
  rider_name text default 'Rider',
  driver_name text,
  driver_vehicle text,
  driver_plate text,
  driver_rating numeric(3,2),
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.rides add column if not exists payment_status text not null default 'unpaid';
alter table public.rides add column if not exists stripe_payment_intent_id text;

create table if not exists public.rental_vehicles (
  id text primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  name text not null,
  category text not null,
  operator_name text not null,
  location_label text not null,
  daily_rate_cents int not null,
  rating numeric(3,2) default 5.00,
  rental_count int not null default 0,
  seats int default 5,
  transmission text default 'Automatic',
  fuel_type text default 'Gas',
  color_hex text default '#222222',
  mileage_per_day int not null default 200,
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rental_bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete restrict,
  vehicle_id text references public.rental_vehicles(id) on delete restrict,
  renter_id text not null,
  status text not null default 'CHECKIN_REQUIRED' check (status in (
    'BOOKED','CHECKIN_REQUIRED','READY_FOR_PICKUP','ACTIVE','RETURN_DUE','COMPLETED','CANCELED'
  )),
  start_at timestamptz not null,
  end_at timestamptz not null,
  pickup_label text not null,
  rental_days int not null,
  daily_rate_cents int not null,
  extras_cents int not null default 0,
  protection_cents int not null default 0,
  tax_cents int not null default 0,
  platform_fee_cents int not null default 0,
  total_cents int not null,
  license_verified boolean not null default false,
  pretrip_photos_complete boolean not null default false,
  pickup_instructions_seen boolean not null default false,
  return_photos_complete boolean not null default false,
  fuel_return_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.rental_bookings add column if not exists payment_status text not null default 'unpaid';
alter table public.rental_bookings add column if not exists stripe_checkout_session_id text;
alter table public.rental_bookings add column if not exists stripe_payment_intent_id text;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete restrict,
  resource_type text not null check (resource_type in ('ride','rental','white_label_subscription')),
  resource_id text not null,
  connected_account_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  amount_cents int not null default 0,
  application_fee_cents int not null default 0,
  currency text not null default 'usd',
  status text not null default 'created',
  refunded_cents int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists payments_checkout_session_unique on public.payments(stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create unique index if not exists payments_payment_intent_unique on public.payments(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists payments_resource_idx on public.payments(resource_type, resource_id, created_at desc);

create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text not null,
  stripe_account_id text,
  processed_at timestamptz not null default now()
);

create table if not exists public.partner_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  category text not null,
  public_url text,
  integration_mode text not null default 'referral',
  status text not null default 'candidate' check (status in ('candidate','contacted','sandbox','live','paused','rejected')),
  enabled boolean not null default false,
  revenue_share_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_referrals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references public.partner_catalog(id) on delete restrict,
  tenant_id uuid references public.tenants(id) on delete cascade,
  customer_id text,
  resource_type text,
  resource_id text,
  source text,
  external_reference text,
  status text not null default 'clicked',
  commission_cents int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  market text,
  website text,
  email text,
  phone text,
  fleet_note text,
  app_gap_note text,
  status text not null default 'prospect' check (status in ('prospect','contacted','demo','negotiating','won','lost')),
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rides_status_idx on public.rides(status, requested_at desc);
create index if not exists rides_rider_idx on public.rides(rider_id, requested_at desc);
create index if not exists rides_driver_idx on public.rides(driver_id, requested_at desc);
create index if not exists drivers_online_idx on public.drivers(online, last_seen_at desc);
create index if not exists rental_vehicle_availability_idx on public.rental_vehicles(available, category);
create index if not exists rental_booking_renter_idx on public.rental_bookings(renter_id, created_at desc);
create index if not exists rental_booking_status_idx on public.rental_bookings(status, start_at);
create index if not exists partner_referrals_tenant_idx on public.partner_referrals(tenant_id, created_at desc);
create index if not exists sales_leads_status_idx on public.sales_leads(status, market);

alter table public.tenants enable row level security;
alter table public.operator_members enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.drivers enable row level security;
alter table public.rides enable row level security;
alter table public.rental_vehicles enable row level security;
alter table public.rental_bookings enable row level security;
alter table public.payments enable row level security;
alter table public.stripe_events enable row level security;
alter table public.partner_catalog enable row level security;
alter table public.partner_referrals enable row level security;
alter table public.sales_leads enable row level security;

-- No anonymous policies are intentionally created. Public apps use the Cloudflare Worker API.

insert into public.tenants (slug, name, primary_color, secondary_color, tagline, white_label_enabled, platform_fee_percent, subscription_status)
values ('whip-equipped','Whip Equipped','#F04449','#F6AD62','IN THIS TOGETHER',false,0.03,'network')
on conflict (slug) do nothing;

insert into public.drivers (
  id, tenant_id, display_name, rating, vehicle_make, vehicle_model, vehicle_color, license_plate, seats, online
)
select
  '00000000-0000-0000-0000-000000000001'::uuid,
  id,
  'Jordan A.',
  4.97,
  'Toyota',
  'Camry',
  'Black',
  'WE1234',
  4,
  false
from public.tenants
where slug = 'whip-equipped'
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  display_name = excluded.display_name,
  rating = excluded.rating,
  vehicle_make = excluded.vehicle_make,
  vehicle_model = excluded.vehicle_model,
  vehicle_color = excluded.vehicle_color,
  license_plate = excluded.license_plate;

insert into public.rental_vehicles (id, tenant_id, name, category, operator_name, location_label, daily_rate_cents, rating, rental_count, seats, transmission, fuel_type, color_hex)
select v.id, t.id, v.name, v.category, v.operator_name, v.location_label, v.daily_rate_cents, v.rating, v.rental_count, v.seats, v.transmission, v.fuel_type, v.color_hex
from public.tenants t
cross join (values
  ('we-rental-standard','Toyota Camry 2025','economy','WE Midtown Fleet','Midtown · 0.8 mi',4400,4.96,218,5,'Automatic','Gas','#d7d7d5'),
  ('we-rental-suv','Toyota Highlander 2025','suv','WE Local Partner','Downtown · 1.4 mi',7200,4.98,146,7,'Automatic','Hybrid','#d0c2ad'),
  ('we-rental-black','Mercedes-Benz E-Class','luxury','WE Black Partner','Business District · 2.1 mi',11800,5.00,91,5,'Automatic','Gas','#171719'),
  ('we-rental-ev','Tesla Model 3 Long Range','ev','WE Electric Fleet','Central Station · 2.7 mi',8300,4.95,173,5,'Single-speed','EV','#e9eeee')
) as v(id,name,category,operator_name,location_label,daily_rate_cents,rating,rental_count,seats,transmission,fuel_type,color_hex)
where t.slug = 'whip-equipped'
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  name = excluded.name,
  category = excluded.category,
  operator_name = excluded.operator_name,
  location_label = excluded.location_label,
  daily_rate_cents = excluded.daily_rate_cents,
  rating = excluded.rating,
  rental_count = excluded.rental_count,
  seats = excluded.seats,
  transmission = excluded.transmission,
  fuel_type = excluded.fuel_type,
  color_hex = excluded.color_hex,
  updated_at = now();

-- Candidate partners are research targets only. enabled=false prevents customer exposure before contracts/API credentials exist.
insert into public.partner_catalog (slug, name, category, public_url, integration_mode, status, enabled, revenue_share_note)
values
  ('zapcover','ZapCover','insurance','https://www.zapcover.com/','referral_or_api','candidate',false,'Public site advertises partner revenue share; commercial terms require approval.'),
  ('tint','Tint','insurance','https://www.tint.ai/','api','candidate',false,'Embedded mobility insurance; commercial program required.'),
  ('inshur','INSHUR','insurance','https://inshur.com/','api','candidate',false,'Commercial auto mobility API partnership; requires scoping and production credentials.'),
  ('axa-partners','AXA Partners','roadside','https://developers.axapartners.com/motor','api','candidate',false,'Motor assistance APIs; production credentials require partnership.'),
  ('truvo','Truvo','consumer_insurance','https://partners.truvo.com/','referral_widget_api','candidate',false,'Partner site advertises referral compensation; approval required.'),
  ('hellosafe','HelloSafe','travel_insurance','https://atlas.hellosafe.com/for/saas/','api','candidate',false,'SaaS insurance module advertises revenue share; approval required.')
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  public_url = excluded.public_url,
  integration_mode = excluded.integration_mode,
  revenue_share_note = excluded.revenue_share_note,
  updated_at = now();

-- ---------- identity verification (satellite 002_identity.sql) ----------

create table if not exists public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  purpose text not null check (purpose in ('renter','driver')),
  stripe_verification_session_id text unique not null,
  status text not null default 'requires_input',
  verified_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists identity_verifications_user_idx on public.identity_verifications(user_id, purpose, created_at desc);
alter table public.identity_verifications enable row level security;

alter table public.drivers add column if not exists identity_verified boolean not null default false;
alter table public.drivers add column if not exists identity_verification_session_id text;

alter table public.rental_bookings add column if not exists identity_verified boolean not null default false;
