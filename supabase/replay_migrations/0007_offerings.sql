-- THE OFFERINGS LEDGER — one seller, every product on the record.
-- The single-seller model: McCluster is the only merchant. Every
-- purchasable thing on any McCluster property is a row here, and the
-- checkout function reads THIS table for the authoritative price,
-- seller, and destination — never a query parameter.
--
-- Custom amounts (donation, approved invoice, pay-what-you-want) are
-- allowed only where price_type says so, inside server-side bounds.
--
-- Apply: Supabase Dashboard → SQL editor → run this file.

create table if not exists public.offerings (
  id                        uuid primary key default gen_random_uuid(),
  slug                      text not null unique,
  site_id                   text not null,           -- here | matthew | future subdomains (data/domains.json)
  brand_id                  text not null,           -- here-album | mccluster | equity-uprise | …
  legal_entity_id           text not null,           -- mccluster-corp | whip-equipped-llc | …
  offering_type             text not null check (offering_type in
    ('music','digital_download','physical_product','merchandise','service',
     'booking','subscription','license','sponsorship','donation','event')),
  revenue_type              text not null check (revenue_type in
    ('music_sale','digital_sale','product_sale','service_fee','booking_deposit',
     'subscription','license_fee','sponsorship','donation')),
  title                     text not null,
  short_description         text,
  full_description          text,
  price                     numeric,                 -- null only when price_type = 'custom'
  currency                  text not null default 'usd',
  price_type                text not null default 'fixed' check (price_type in ('fixed','custom')),
  custom_min                numeric,                 -- required when price_type = 'custom'
  custom_max                numeric,                 -- required when price_type = 'custom'
  payment_provider          text not null default 'stripe' check (payment_provider in ('stripe','square')),
  payment_account_reference text not null default 'mccluster-primary',
  fulfillment_type          text not null check (fulfillment_type in
    ('digital_delivery','physical_shipping','service_scheduling','access_grant','none')),
  inventory_policy          text not null default 'unlimited' check (inventory_policy in
    ('unlimited','limited','made_to_order','unavailable')),
  primary_action            text not null default 'buy' check (primary_action in
    ('buy','book','license','subscribe','sponsor','donate','stream')),
  status                    text not null default 'draft' check (status in ('draft','live','retired')),
  campaign_namespace        text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.offerings enable row level security;

-- the storefronts read live offerings; nobody but the owner writes
drop policy if exists of_read on public.offerings;
create policy of_read on public.offerings
  for select to anon, authenticated using (status = 'live');
drop policy if exists of_admin on public.offerings;
create policy of_admin on public.offerings
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');
grant select on public.offerings to anon, authenticated;
grant all on public.offerings to authenticated;

-- ---------- CAMPAIGNS — every outreach vector, attributable ----------
create table if not exists public.campaigns (
  campaign_id     text primary key,
  site_id         text not null,
  audience        text not null,
  objective       text not null,
  landing_page    text not null,
  primary_action  text not null,
  offering_id     uuid references public.offerings (id),
  sender_identity text not null,
  utm_source      text not null,
  utm_medium      text not null,
  utm_campaign    text not null,
  utm_content     text,
  created_at      timestamptz not null default now()
);
alter table public.campaigns enable row level security;
drop policy if exists cp_admin on public.campaigns;
create policy cp_admin on public.campaigns
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');
grant all on public.campaigns to authenticated;

-- ---------- SEED: the inventory that is actually configured today ----------
-- Prints & files ride the shop's derived price ladder (data/prints.json);
-- prices here must match what the ladder shows. Draft rows are built
-- infrastructure with no published inventory yet — they go live only
-- when the product is real.
insert into public.offerings
  (slug, site_id, brand_id, legal_entity_id, offering_type, revenue_type, title,
   short_description, price, price_type, custom_min, custom_max, payment_provider,
   fulfillment_type, inventory_policy, primary_action, status, campaign_namespace)
values
  ('print-5x7',  'here', 'mccluster', 'mccluster-corp', 'physical_product', 'product_sale',
   '5×7 print',   'Museum-stock giclée, shipped tracked', 15, 'fixed', null, null, 'stripe',
   'physical_shipping', 'made_to_order', 'buy', 'live', 'print-shop'),
  ('print-8x10', 'here', 'mccluster', 'mccluster-corp', 'physical_product', 'product_sale',
   '8×10 print',  'Museum-stock giclée, shipped tracked', 25, 'fixed', null, null, 'stripe',
   'physical_shipping', 'made_to_order', 'buy', 'live', 'print-shop'),
  ('print-11x14','here', 'mccluster', 'mccluster-corp', 'physical_product', 'product_sale',
   '11×14 print', 'Museum-stock giclée, shipped tracked', 40, 'fixed', null, null, 'stripe',
   'physical_shipping', 'made_to_order', 'buy', 'live', 'print-shop'),
  ('print-16x20','here', 'mccluster', 'mccluster-corp', 'physical_product', 'product_sale',
   '16×20 print', 'Museum-stock giclée, shipped tracked', 55, 'fixed', null, null, 'stripe',
   'physical_shipping', 'made_to_order', 'buy', 'live', 'print-shop'),
  ('print-24x36','here', 'mccluster', 'mccluster-corp', 'physical_product', 'product_sale',
   '24×36 print', 'Museum-stock giclée, shipped tracked', 85, 'fixed', null, null, 'stripe',
   'physical_shipping', 'made_to_order', 'buy', 'live', 'print-shop'),
  ('file-png',   'here', 'mccluster', 'mccluster-corp', 'digital_download', 'digital_sale',
   'PNG — personal use', 'Full-size PNG, personal use only', 15, 'fixed', null, null, 'stripe',
   'digital_delivery', 'unlimited', 'buy', 'live', 'print-shop'),
  ('file-fullres','here','mccluster', 'mccluster-corp', 'digital_download', 'digital_sale',
   'Full-res + print rights', 'Maximum-quality file with personal print rights', 40, 'fixed', null, null, 'stripe',
   'digital_delivery', 'unlimited', 'buy', 'live', 'print-shop'),
  ('file-raw',   'here', 'mccluster', 'mccluster-corp', 'digital_download', 'license_fee',
   'RAW + license', 'The negative with a written license (commercial on released frames, editorial-use otherwise)', 250, 'fixed', null, null, 'stripe',
   'digital_delivery', 'unlimited', 'buy', 'live', 'print-shop'),
  ('here-digital-album', 'here', 'here-album', 'mccluster-corp', 'music', 'music_sale',
   'HERE — the digital album', 'All six tracks, full quality, yours', 10, 'fixed', null, null, 'stripe',
   'digital_delivery', 'unavailable', 'buy', 'draft', 'here-album'),
  ('mission-fund-donation', 'here', 'mccluster', 'mccluster-corp', 'donation', 'donation',
   'The Mission Fund', 'Charitable support for McCluster Corp programs', null, 'custom', 5, 25000, 'square',
   'none', 'unlimited', 'donate', 'live', 'mission-fund'),
  ('approved-invoice', 'here', 'mccluster', 'mccluster-corp', 'service', 'service_fee',
   'Approved invoice', 'Pay an invoice issued by the desk — amount as invoiced', null, 'custom', 25, 25000, 'stripe',
   'none', 'unlimited', 'buy', 'live', 'invoices'),
  ('booking-deposit', 'here', 'mccluster', 'mccluster-corp', 'booking', 'booking_deposit',
   'Booking deposit', 'Lock a shoot date — the deposit applies to your project', null, 'custom', 100, 10000, 'stripe',
   'service_scheduling', 'unlimited', 'book', 'live', 'bookings')
on conflict (slug) do nothing;
