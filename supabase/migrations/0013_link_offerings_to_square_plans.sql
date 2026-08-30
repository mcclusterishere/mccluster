-- ============================================================
-- WHICH PROVIDER PLAN AN OFFERING ACTUALLY MAPS TO.
--
-- A recurring offering in this table is a promise ("$33 a month");
-- the thing that collects the money every month lives at the provider.
-- Square models that as a SUBSCRIPTION_PLAN_VARIATION, and until now
-- nothing on this side knew which one -- so "is hosting actually set up
-- to bill?" was a question you answered by opening two dashboards.
--
-- Populated from what already exists in the McCluster Square account
-- (location LYTBAM2H7536B):
--
--   hosting-monthly  -> FCJ6U3XZSBIWORCIO2YGJEBN  "Hosting", MONTHLY,
--                       relative pricing off item "Website Hosting" $33
--   domain-renewal   -> BV4FHFB5FZPU765NX5CYIEG4  "Domain hosting", ANNUAL,
--                       relative pricing off item "Domain" $33
--
-- A NULL here on a recurring offering is not a formatting detail. It
-- means the page is advertising a subscription that has nothing behind
-- it at the provider, which is precisely the failure this column exists
-- to make visible.
-- ============================================================

alter table public.offerings
  add column if not exists provider_plan_id text;

comment on column public.offerings.provider_plan_id is
  'The provider-side recurring plan this offering maps to. For Square this is a SUBSCRIPTION_PLAN_VARIATION id, which is the object the Subscriptions API actually takes. Null on one-time offerings, and null on a recurring one means the plan has not been built at the provider yet, which is a real state worth being able to see rather than assume.';

update public.offerings set provider_plan_id = 'FCJ6U3XZSBIWORCIO2YGJEBN'
  where slug = 'hosting-monthly';
update public.offerings set provider_plan_id = 'BV4FHFB5FZPU765NX5CYIEG4'
  where slug = 'domain-renewal';
