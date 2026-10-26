# First website offer — implementation checkpoint, not production activation

## Reconciliation on 2026-10-26

All remote heads were fetched and compared with the saved branch inventory before
editing. Main is `396760eb72121e9673c6fc3df062f3af29660c10`. The integrated draft
#637 is `f06fb54508dec1ad537ef9c7d642c23970ce762b`, byte-identical to the prior local
`9cb4b2fa` tree. The changed/new remote refs are the known #628/#629 completions,
#630 navigation fix, #631 audit, and #632–637 consolidations. No intervening
Claude branch head differs from the saved audit. PR637 had seven successful
terminal checks and a Supabase Preview skip; that skip is not database evidence.
Current live deployment content could not be independently attested through the
environment's blocked public requests. No production state was changed.

The first offer reuses account/membership, member fronts, managed projects,
versioned tile Studio, creator billing, domains and the World directory. It does
not create tenant admin authority or change access approval. Personal Matthew
and Vaunt identities, logos and existing URLs remain owned by their existing
contracts. The platform entry points directly to `customer-site.html`.

## Website modules

`customer_site_modules_v1.sql` is pending after `managed_projects_v1.sql`.
`CUSTOMER_SITE_OFFER_ENABLED=true` enables the customer registry and enforces
World directory opt-in by owner and website. Default is off. Missing preferences
mean discovery off; missing schema fails closed. Existing listing records are
retained when disabled, but publication requests are refused and directory reads
exclude them. Private profiles and unpublished/removed sources remain excluded.
The member's independent global World membership is unchanged. Hosting/domain
entitlement remains with the existing billing/domain services. Advertising is
unavailable and cannot be enabled through this registry.

## Provider research and activation boundaries

Cloudflare has a beta Registrar API with search, availability and registration;
the adapter must not claim that no API exists. Its API is not itself resale
permission. Cloudflare's [service terms](https://www.cloudflare.com/terms/)
section 2.2.1(a) require express written permission for the listed resale/account
activities; its [domain registration agreement](https://www.cloudflare.com/domain-registration-agreement/)
section 1.3 retains holder-of-record responsibility when licensing use. Before
platform domain purchase: establish written permission, tenant registrant/holder
identity, renewal responsibility, transfer-out and support terms, and exact
provider readback/reconciliation. The existing adapter stays disabled; it does
not prove tenant domain ownership or support renewals. BYOD and platform purchase
must ultimately resolve to the same immutable owned site target. BYOD alone does
not complete platform purchase.

Sources: [Registrar API](https://developers.cloudflare.com/registrar/registrar-api/),
[registration operation](https://developers.cloudflare.com/api/resources/registrar/subresources/registrations/methods/create/),
[Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/).
Verify conflicting overview/reference operations before exposing them. SaaS
custom-hostname charges are separate from registration and the customer plan.
No fixed customer price is chosen without storage, delivery, processing, support
and payment-cost evidence.

## Advertising architecture only

Google Ads purchases promotion; AdSense and Ad Manager serve publisher inventory.
Use a provider-neutral inventory contract: tenant, owned site, placement ID,
format, dimensions/duration, consent state, rights attestation, audience/content
eligibility, provider approval, revenue beneficiary and a kill switch. Default
state is disabled/no-fill. Display slots collapse when no eligible creative is
returned. No scripts, network requests, SDK, auction, financial account or revenue
promise is introduced by this implementation.

Music opportunities require deliberate opted-in placements such as a sponsor
card, interstitial between tracks or a reviewed pre-roll. Never interrupt an
arbitrary song or alter credits. Content rights, listener consent, age/region,
tenant controls, frequency limits and no-fill fallback all precede any request.
[Ad Manager audio](https://support.google.com/admanager/answer/7642796?hl=en)
depends on eligible accounts/demand; VAST/IMA integration does not guarantee ads.
Legacy [AdSense for Video ended May 31, 2026](https://support.google.com/adsense/answer/16966307?hl=en).
[AdSense for Platforms](https://developers.google.com/adsense/platforms/) may fit
future tenant revenue sharing, subject to platform onboarding/eligibility. A
standard AdSense account is not evidence of that permission. No direct advertiser
marketplace is in this first-offer scope.
