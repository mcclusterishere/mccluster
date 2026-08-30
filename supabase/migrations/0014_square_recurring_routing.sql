-- ============================================================
-- THE RECURRING OFFERINGS BILL THROUGH SQUARE, AND SAY SO.
--
-- 0013 recorded which Square plan each recurring offering maps to but
-- left payment_provider reading 'stripe', so three rows named a Square
-- plan variation and claimed to charge through Stripe. Both cannot be
-- true, and the one that is true is Square: those plans exist, they are
-- priced, and they are what the merchant account will actually bill.
--
-- anti-social-m gets the plan built today: a two-phase variation, one
-- MONTHLY period at $0 and then $875 monthly, open-ended. The free month
-- is enforced by the plan itself rather than by anybody remembering to
-- start charging on day thirty-one.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It does not make these sellable
-- from the checkout function. Square's hosted payment link is a one-time
-- charge; Square subscriptions need a customer and a card on file and
-- are started against the plan variation. Routing a recurring row into
-- quick_pay would take one month's money and never charge again, which
-- is worse than failing, so supabase/functions/checkout now refuses that
-- combination with square_subscription_not_self_serve and hands back the
-- plan id. The desk starts the subscription; the record says which plan.
-- ============================================================

update public.offerings
set payment_provider = 'square'
where billing_interval is not null
  and provider_plan_id is not null;

update public.offerings
set provider_plan_id = 'L47BLEZHFT63UVLI4JUXBG3V',
    payment_provider = 'square',
    short_description = 'Website and social run as one service, with the inbound, outbound and social modules staying on. The first month is free; billing starts at month two. You keep 100% of what you make.'
where slug = 'anti-social-m';
