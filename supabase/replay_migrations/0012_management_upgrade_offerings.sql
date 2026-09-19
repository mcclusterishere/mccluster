-- ============================================================
-- THE UPGRADE, MADE CHARGEABLE.
--
-- The first month of management is free, delivered as four weekly
-- sprints (0011). At the end of it a client either keeps the service or
-- cruises. "Keeps it" had no row to charge against, so the one moment
-- the whole activation program is built to arrive at was the one moment
-- the checkout could not serve.
--
-- M Mode goes live. Equity Uprise goes in as DRAFT on purpose: the
-- ledger says it requires a program-fit review and a signed agreement,
-- and status='live' would put a $437.50 revenue-share subscription
-- behind a button anybody could press. Draft means the row exists, the
-- price is on the record, and the checkout refuses it -- which is the
-- correct behaviour for a thing that is sold by agreement, not by click.
-- ============================================================

insert into public.offerings
  (slug, site_id, brand_id, legal_entity_id, offering_type, revenue_type, title,
   short_description, price, price_type, custom_min, custom_max, payment_provider,
   fulfillment_type, inventory_policy, primary_action, status, campaign_namespace,
   billing_interval)
values
  ('anti-social-m', 'here', 'mccluster', 'mccluster-corp', 'subscription', 'subscription',
   'Anti-Social Management',
   'Website and social run as one service, with the inbound, outbound and social modules staying on. You keep 100% of what you make.',
   875, 'fixed', null, null, 'stripe',
   'none', 'unlimited', 'subscribe', 'live', 'sites', 'month'),

  ('anti-social-equity', 'here', 'mccluster', 'mccluster-corp', 'subscription', 'subscription',
   'Anti-Social Management, Equity Uprise',
   'The same service at half the monthly price, against a capped, time-limited share of eligible connected revenue. No ownership is taken. Requires a program-fit review and a signed agreement, so it is never sold from a button.',
   437.50, 'fixed', null, null, 'stripe',
   'none', 'unlimited', 'subscribe', 'draft', 'sites', 'month')
on conflict (slug) do nothing;
