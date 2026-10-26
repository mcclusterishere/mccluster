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

## Proposed 500 MB storage boundary

`customer_site_storage_v1.sql` remains pending. 500 MB means 500,000,000 bytes
shared by one account's personal front and managed websites, including private
Studio originals and prepared outputs. This is a proposed initial allowance,
not an activated plan or a bandwidth/processing price. Existing over-quota files
remain readable and deletable. Storage metadata supplies used bytes; missing or
invalid size metadata blocks new reservations for reconciliation.

The Worker reserves under an account row lock, streams a bounded upload, rejects
short/oversized bodies, verifies Storage HEAD size and settles the reservation.
Replacement reserves positive growth; deletes use the Storage API and the next
usage query observes actual metadata. No storage schema triggers, direct object
row writes or automatic deletion are introduced. Old browser writes are denied
by restrictive Storage RLS. Studio no longer issues signed upload URLs; it uses
the same authenticated stream boundary. Prepared media also uses that boundary.

A lost response keeps its reservation. Recovery settles matching provider bytes;
confirmed absence releases only after 24 hours, beyond the upload's 120-second
deadline. Provider outages or mismatched sizes do not release reserved bytes.
Recovery processes at most 100 reservations per request; retry to continue.
Any previously issued signed upload URLs must expire before activation, and
existing service-role upload paths must be audited at the reviewed release SHA.
Service-role credentials remain privileged and must never be issued to clients.

Local proof uses real pending PostgreSQL functions/RLS in PGlite with fixture
Storage/auth. Native two-session reservation contention is wired into CI.
Real managed Supabase Storage upload/overwrite/HEAD/delete semantics and gateway
streaming limits still require an authorized sandbox check before activation.
Fixtures are not that evidence. Files continue to disclose public front-media
versus private Studio media; a draft is not a promise that front-media is private.

## Deferred additions from the continuing owner request

Complete the first offer before expanding the existing composer and Stories.
Composer work must reconcile #624/#628/#634's durable World/Instagram delivery
identity, use server-verified creator/business and owned-account capabilities,
preserve regular native posting, and implement an overlay/bottom sheet with
draft/back/focus recovery. Do not create a second queue or unsupported networks.
Stories require an audit of current storage/audience/expiry/reporting and actual
media access after expiration; a timestamp alone does not revoke public bytes.
Research the exact requested REA repository before installing or running it.

Future advertising economics remain inactive and configurable. Free eligible
creators need not buy a domain. A 50/50 split is a consideration, not a decision;
track settled network receipts, attribution, reversals, platform share and
rights-holder obligations separately. No post is promised earnings and no
royalty distribution or payout account is activated.
