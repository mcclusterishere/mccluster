-- ============================================================
-- ESMER — register the client satellite on the control plane.
--
-- The site is a satellite; the tenant is here. This gives Esmer the three
-- rows a client needs before any server-side surface will answer for it:
-- an org (tenancy), a platform_app (registry + fee policy anchor), and a
-- Connect reference (where money would land).
--
-- Deliberately absent: priced offerings. Esmer's rates are not settled, and
-- the repo law says do not guess rates. The Book tab ships inquiry-first, so
-- nothing here needs a price to work.
-- ============================================================

-- `orgs.kind` was written for McCluster's own shapes (studio/business/building)
-- and has no word for the thing this whole rail exists to serve: a client
-- tenant whose site McCluster builds and whose money is their own. Widen the
-- set rather than file Esmer under a label that is not true. More client
-- satellites are already in registry.json behind this one.
alter table public.orgs drop constraint if exists orgs_kind_check;
alter table public.orgs add constraint orgs_kind_check
  check (kind in ('studio','business','building','client'));

insert into public.orgs (slug, name, kind, enabled)
values ('esmer', 'Esmer — Justin Esmer', 'client', true)
on conflict (slug) do update set name = excluded.name, kind = excluded.kind;

insert into public.platform_apps (app_key, name, product_family, kind, public_url)
values ('esmer-web', 'Esmer', 'client-sites', 'web', null)
on conflict (app_key) do update set
  name = excluded.name,
  product_family = excluded.product_family,
  updated_at = now();

-- The Connect reference exists before the Stripe account does. Onboarding
-- fills in stripe_account_id; until then the row states plainly that this
-- client cannot yet be paid, which is the truth.
insert into public.org_stripe_accounts (org_id, livemode, account_reference, onboarding_status)
select o.id, m.livemode, 'esmer', 'not_started'
from public.orgs o
cross join (values (false), (true)) as m(livemode)
where o.slug = 'esmer'
on conflict (org_id, livemode) do nothing;

-- Fee policy at zero. This is not a placeholder to be tidied later: Esmer is
-- a barter engagement, and a fee the owner has not set must never be invented
-- by a migration. Raising it is a deliberate act, on the record, in its own
-- migration.
insert into public.platform_fee_policies
  (app_id, org_id, policy_key, payer_fee_bps, payee_fee_bps, white_label_payee_fee_bps, currency)
select a.id, o.id, 'client-site-barter', 0, 0, 0, 'usd'
from public.platform_apps a
cross join public.orgs o
where a.app_key = 'esmer-web' and o.slug = 'esmer'
on conflict (app_id, org_id, policy_key) do nothing;
