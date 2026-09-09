-- ============================================================
-- LEVEL 3 MEDIA — register the satellite on the control plane.
--
-- The site (mcclusterishere/Lvl-3-Media) is a satellite; the tenancy is
-- here. Its studio dashboard already signs in against Supabase auth on
-- this project, which is the M network — but until now there was no org
-- for it to belong to and no app_key for m_touch_app() to accept, so a
-- Level 3 sign-in registered as nothing in particular.
--
-- Three rows fix that: an org (tenancy), a platform_app (registry, and
-- the anchor m_touch_app resolves), and a pre-authorization naming the
-- studio's own address as the owner of the org.
--
-- Deliberately absent: a fee policy. Level 3's rates and the split on
-- them are not settled, and repo law says a migration does not invent a
-- number the owner has not given. Nothing here needs one to work.
-- ============================================================

insert into public.orgs (slug, name, kind, enabled)
values ('level-3-media', 'Level 3 Media', 'client', true)
on conflict (slug) do update set name = excluded.name, kind = excluded.kind;

-- app_key matches MCC_APP_KEY in the satellite's dashboard. Changing one
-- without the other silently turns every Level 3 sign-in back into an
-- untracked one, because m_touch_app() rejects an unknown key.
insert into public.platform_apps (app_key, name, product_family, kind, public_url)
values (
  'level-3-media-web',
  'Level 3 Media',
  'client-sites',
  'web',
  'https://mcclusterishere.github.io/Lvl-3-Media/'
)
on conflict (app_key) do update set
  name = excluded.name,
  product_family = excluded.product_family,
  public_url = excluded.public_url,
  updated_at = now();

-- The studio's sign-in owns the org. Recorded as an invitation rather
-- than an org_members row on purpose: grant_pending_org_invitations()
-- attaches it when the address is CONFIRMED, so ownership of a tenant
-- is never handed out on the strength of someone typing an email into a
-- signup form. If the account already exists and is confirmed, the same
-- claim happens on its next confirmation update.
--
-- One trap, learned the hard way on this one: the trigger fires on
-- CONFIRMATION, so an account that confirmed BEFORE this row existed has
-- nothing left to fire and the invitation sits pending forever. Applying
-- this after the fact means checking org_members and granting directly.
insert into public.org_invitations (org_id, email, role)
select o.id, 'level3mediallc@gmail.com', 'owner'
from public.orgs o
where o.slug = 'level-3-media'
on conflict (org_id, email) do nothing;

-- The Connect reference exists before the Stripe account does.
-- Onboarding fills in stripe_account_id; until then the row says plainly
-- that this client cannot yet be paid, which is the truth.
insert into public.org_stripe_accounts (org_id, livemode, account_reference, onboarding_status)
select o.id, m.livemode, 'level-3-media', 'not_started'
from public.orgs o
cross join (values (false), (true)) as m(livemode)
where o.slug = 'level-3-media'
on conflict (org_id, livemode) do nothing;
