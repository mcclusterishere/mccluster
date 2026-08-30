-- ============================================================
-- THE DOMAIN-AND-HOSTING DEAL, MADE CHARGEABLE.
--
-- data/offers.json is the ledger the PAGES render from. It has never
-- been the thing the checkout charges: supabase/functions/checkout reads
-- public.offerings and takes the price from there, on the server, so a
-- query parameter can never set an amount. That is the right design, and
-- it meant the front-door offer was fully described on the site and
-- completely unsellable -- there was no offerings row for it. Somebody
-- who read the page, agreed to the price and pressed the button got
-- unknown_offering.
--
-- Three rows fix that, and they must stay in step with the ledger:
--
--   domain-hosting-deposit  $33  once      starts the draft
--   domain-hosting-start    $66  once      domain + first month, going live
--   hosting-monthly         $33  monthly   every month after the first
--
-- THE DEPOSIT IS NOT EXTRA MONEY. It is the first month of hosting paid
-- early so the draft can be built and previewed before the domain is
-- bought. Whoever settles the account applies it; the row says so in its
-- description so the customer's receipt says so too.
--
-- RECURRING. The checkout function was one-time only (mode: "payment"),
-- which is fine for prints and deposits and no use at all for hosting.
-- billing_interval is how a row asks for a subscription instead. Null,
-- the default, means exactly what it meant before this migration ran, so
-- every existing offering is untouched.
-- ============================================================

alter table public.offerings
  add column if not exists billing_interval text;

comment on column public.offerings.billing_interval is
  'null = a one-time charge (the default, and what every offering was before this column existed). "month" or "year" = Stripe subscription mode at that interval. Square offerings ignore this; the Square rail here creates one-time payment links only.';

alter table public.offerings
  drop constraint if exists offerings_billing_interval_check;
alter table public.offerings
  add constraint offerings_billing_interval_check
  check (billing_interval is null or billing_interval in ('month', 'year'));

-- a subscription needs a real recurring price; a custom amount cannot be
-- one, because there is nothing to charge again next month
alter table public.offerings
  drop constraint if exists offerings_recurring_needs_fixed_price;
alter table public.offerings
  add constraint offerings_recurring_needs_fixed_price
  check (billing_interval is null or (price_type = 'fixed' and price is not null));

insert into public.offerings
  (slug, site_id, brand_id, legal_entity_id, offering_type, revenue_type, title,
   short_description, price, price_type, custom_min, custom_max, payment_provider,
   fulfillment_type, inventory_policy, primary_action, status, campaign_namespace,
   billing_interval)
values
  ('domain-hosting-deposit', 'here', 'mccluster', 'mccluster-corp', 'service', 'service_fee',
   'Start the draft',
   'Your first month of hosting, paid early so the site gets built and previewed before you buy the domain. It is credited to that first month, not charged on top of it.',
   33, 'fixed', null, null, 'stripe',
   'none', 'unlimited', 'buy', 'live', 'sites', null),

  ('domain-hosting-start', 'here', 'mccluster', 'mccluster-corp', 'service', 'service_fee',
   'Go live: domain and first month',
   'Registers your domain for the year and covers the first month of hosting. The website build itself is free.',
   66, 'fixed', null, null, 'stripe',
   'none', 'unlimited', 'buy', 'live', 'sites', null),

  ('hosting-monthly', 'here', 'mccluster', 'mccluster-corp', 'service', 'service_fee',
   'Hosting',
   'Hosting, SSL and backups for your site, every month after the first. Cancel any time; the site and its code are yours.',
   33, 'fixed', null, null, 'stripe',
   'none', 'unlimited', 'buy', 'live', 'sites', 'month')
on conflict (slug) do nothing;
