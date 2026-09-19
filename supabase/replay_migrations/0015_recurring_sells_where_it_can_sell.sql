-- ============================================================
-- THE RECURRING OFFERS SELL THROUGH THE RAIL THAT CAN SELL THEM.
--
-- 0014 routed the recurring rows to Square because that is where their
-- plans live. Then the checkout function went live and told the truth
-- out loud: Square's hosted link is a one-time charge, so those rows
-- came back square_subscription_not_self_serve. Correct, and useless to
-- somebody standing on the page with a card out.
--
-- Stripe subscriptions work end to end from the same button, so that is
-- where they route. Nothing about the Square side is discarded:
-- provider_plan_id still records the plan variation each one maps to, so
-- a deal closed in person can be started as a Square subscription
-- against the same plan, at the same price, and the two rails describe
-- one offer rather than two.
--
--   hosting-monthly   $33/month   Stripe self-serve  | Square FCJ6U3XZSBIWORCIO2YGJEBN
--   domain-renewal    $33/year    Stripe self-serve  | Square BV4FHFB5FZPU765NX5CYIEG4
--   anti-social-m     $875/month  Stripe self-serve  | Square L47BLEZHFT63UVLI4JUXBG3V
--                                                      (phase 0: one month at $0)
--
-- THE FREE MONTH IS THE ONE THING THE TWO RAILS DO NOT AGREE ON. Square
-- carries it in the plan's first phase. Stripe subscriptions started
-- from this button begin billing immediately, so a free first month sold
-- that way has to be applied as a trial on the session or handled at the
-- desk. Written down here because it is exactly the kind of difference
-- that gets discovered by a customer.
-- ============================================================

update public.offerings
set payment_provider = 'stripe'
where billing_interval is not null;
