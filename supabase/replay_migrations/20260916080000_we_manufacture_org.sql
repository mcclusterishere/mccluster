-- ============================================================
-- WE MANUFACTURE — register the product satellite on the plane.
--
-- The site is a satellite (mcclusterishere/We-manufacture). The tenant
-- is here. Same three rows Esmer needed before any server-side surface
-- would answer: an org (tenancy), a platform_app (registry + fee policy
-- anchor), and a Connect reference (where money would land).
--
-- Kind is `client` on purpose. WE Manufacture is a house product, not a
-- third-party shop, but the inquiry / inbox / CRM rail is the client
-- rail. Filing it under a different kind would 404 every list signup
-- and every municipal site package. Do not invent a WE-specific Worker
-- path for this.
--
-- Deliberately absent: priced offerings. $2,995 is a target, not a
-- price. A fee the owner has not set must never be invented here.
-- ============================================================

insert into public.orgs (slug, name, kind, enabled, settings)
values (
  'we-manufacture',
  'WE Manufacture',
  'client',
  true,
  jsonb_build_object('notify_email', 'matthew@mccluster.org')
)
on conflict (slug) do update set
  name = excluded.name,
  kind = excluded.kind,
  enabled = true,
  settings = coalesce(public.orgs.settings, '{}'::jsonb)
          || jsonb_build_object('notify_email', 'matthew@mccluster.org');

insert into public.platform_apps (app_key, name, product_family, kind, public_url)
values ('we-manufacture-web', 'WE Manufacture', 'we-manufacture', 'web', null)
on conflict (app_key) do update set
  name = excluded.name,
  product_family = excluded.product_family,
  updated_at = now();

-- The Connect reference exists before the Stripe account does.
-- account_reference is unique per livemode; do not reuse 'esmer' or
-- 'mccluster-primary'.
insert into public.org_stripe_accounts (org_id, livemode, account_reference, onboarding_status)
select o.id, m.livemode, 'we-manufacture', 'not_started'
from public.orgs o
cross join (values (false), (true)) as m(livemode)
where o.slug = 'we-manufacture'
on conflict (org_id, livemode) do nothing;

-- Fee policy at zero. This is the house's own line. Raising it is a
-- deliberate act, on the record, in its own migration.
insert into public.platform_fee_policies
  (app_id, org_id, policy_key, payer_fee_bps, payee_fee_bps, white_label_payee_fee_bps, currency)
select a.id, o.id, 'we-manufacture-house', 0, 0, 0, 'usd'
from public.platform_apps a
cross join public.orgs o
where a.app_key = 'we-manufacture-web' and o.slug = 'we-manufacture'
on conflict (app_id, org_id, policy_key) do nothing;

-- House owners operate this tenant from Control. The Worker also
-- grants house owners an override, but the membership rows are the
-- grant of record so the desk still works if that override is later
-- tightened.
insert into public.org_members (org_id, profile_id, role)
select o.id, m.profile_id, 'owner'
from public.orgs o
join public.orgs house on house.slug = 'mccluster'
join public.org_members m on m.org_id = house.id and m.role = 'owner'
where o.slug = 'we-manufacture'
on conflict do nothing;
