-- HOSTING BY THE YEAR.
--
--   domain-hosting-year   $393  once   domain + twelve months at $30
--   hosting-year          $360  once   the twelve months on their own
--
-- The rate is the only decision: $30 a month instead of $33 when the year
-- is paid together. Everything else is arithmetic on it, and it is done in
-- one place — data/offers.json holds the rate, js/offers.js derives the
-- year, the go-live total and the saving, and these two rows are what the
-- checkout charges. Three surfaces, one number.
--
-- $393 is the domain ($33, one year) plus twelve months at $30. The
-- monthly path is $66 to go live and $33 a month after, which comes to
-- $429 over the same twelve months — so the year saves $36 and does not
-- change the service by a single thing.
--
-- SEEDED HERE BECAUSE THE PRICE IS THE DATABASE'S. pay.html paints from
-- data/offerings.json, but the checkout function reads THIS row for the
-- authoritative amount. A published mirror without its row is a button
-- that looks priced and cannot charge.

insert into public.offerings
  (slug, site_id, brand_id, legal_entity_id, offering_type, revenue_type, title,
   short_description, price, price_type, custom_min, custom_max, payment_provider,
   fulfillment_type, inventory_policy, primary_action, status, campaign_namespace,
   billing_interval)
values
  ('domain-hosting-year', 'here', 'mccluster', 'mccluster-corp', 'service', 'service_fee',
   'Go live: domain and the year of hosting',
   'Registers your domain for the year and pays the twelve months of hosting together, which drops the rate from $33 a month to $30. The website build itself is free.',
   393, 'fixed', null, null, 'stripe',
   'none', 'unlimited', 'buy', 'live', 'sites', null),

  ('hosting-year', 'here', 'mccluster', 'mccluster-corp', 'service', 'service_fee',
   'Hosting, by the year',
   'Twelve months of hosting, SSL and backups paid together at $30 a month instead of $33. The site and its code are yours either way.',
   360, 'fixed', null, null, 'stripe',
   'none', 'unlimited', 'buy', 'live', 'sites', null)
on conflict (slug) do nothing;
