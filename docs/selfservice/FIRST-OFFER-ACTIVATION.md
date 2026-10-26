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
The independent `world` switch also controls the shared bottom-bar World tab and
the tenant World endpoint and footer globe. Unknown/loading tenant fronts keep
the footer dormant; a disabled module hides it and stops its existing iframe.
A disabled tenant endpoint rejects direct reads.
Personal websites project their owner's public top-level native posts; project
feeds require explicit `metadata.site_project` attribution by the same owner.
Neither includes private, group, reply, deleted or removed posts. This is a view
over canonical posts, not a second queue. Project composer attribution is still
a subsequent milestone; untagged posts do not silently become project updates.
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

`data/site-advertising-contract.json` describes the inert architecture. The tested
`customer-site-advertising.js` server resolver validates the authenticated owner,
website and known placement, then always returns disabled/no-fill: collapse display
space or continue playback. It rejects provider/activation/owner input, does not
request a provider, and has no enabling flag. No browser requests this endpoint.
Actual provider/property/format approvals, consent/rights verification, exclusivity,
creative slots, revenue and payouts remain **not implemented**. Those future
controls cannot be bypassed by treating this disabled decision as approval.

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

Cloudflare request-size limits and the actual configured plan must be checked
before advertising large individual uploads. The total 500 MB allowance does not
promise that a single 300 MB upload will pass the configured ingress. Studio's
existing 64 MiB input limit and separate compute allowance remain in force.

## Exact current candidate order and flags

This supersedes the old two-file minimum in ACTIVATION-PROPOSAL.md for PR638.
Recheck live ledger/object definitions immediately before proposing application.
Do not apply the whole pending directory or create artificial production ledger
entries. Supabase's pending-file promotion procedure still governs actual release.

1. Existing identity/auth/network profile authority first: `auth.users`,
   `m_people`, `m_auth_user_links`, `network_profiles`, current membership policy.
2. `member_fronts_v1.sql` then `managed_projects_v1.sql`, if still absent. Existing
   front-media owner listing/deletion and public-byte disclosure stay in force.
3. `customer_site_storage_v1.sql` after that storage/identity authority. It denies
   direct member site writes, so coordinate with quota-aware Worker and editor
   assets. Let previously-issued signed uploads expire first. Read/reconcile
   existing bytes and unknown size metadata; never delete over-quota data.
4. `customer_site_modules_v1.sql` and `customer_site_addresses_v1.sql` after
   managed-project ownership. No production tenant, alias or module is seeded.
5. For tiles only: existing canonical media/billing/compute prerequisites →
   `website_studio_v2.sql` → `project_tiles_v1.sql` → `project_tiles_free_v1.sql`.
   The new free publisher verifies owner, active identity, public profile and
   exact saved revision. Existing API/public-read media approval checks remain.
   It grants no processing allowance or custom-domain entitlement. Every tile
   still requires a registered, ready, explicitly public-approved media source.
   An ordinary free account can reuse its existing approved media without a new
   preparation job. A basic text/image-only tile path independent of preparation
   is not implemented. New Studio media cannot finish publication until the
   separate native model/executor/preparation-allowance gates are satisfied.
   The fixture's free-publication test removes its subscription but retains a
   separately approved preparation allowance; it does not prove that an ordinary
   unprovisioned free account can prepare media. Cinematic front uploads use the
   separate device-prepared path and its existing public-byte disclosure.
6. Review one exact combined Worker/assets SHA and require terminal CI. Proposed
   flags: `CUSTOMER_SITE_OFFER_ENABLED=true` enables modules/aliases/free tile
   publication; `WEBSITE_STUDIO_ENABLED=true` enables the recovered tile editor.
   `WEBSITE_STUDIO_PROCESSOR_ENABLED` is separate and remains off absent approved
   native model, executor and existing preparation allowance. Quota routes require
   their schema; there is no insecure direct-upload fallback if it is absent.
   All registrar/payment/provider/live-execution flags stay under their prior
   separate gates; no ad activation flag is introduced.
7. Company-host routing must be read-only verified before describing free URLs as
   live. Assigned `mccluster.org/<slug>` uses canonical renderers and immutable
   owner/source binding. Known company/World/static/API roots retain priority;
   unassigned paths retain the legacy redirect. Hidden sources return 404 rather
   than falling back to another owner. WWW aliases redirect to canonical apex.
   Real custom DNS/TLS and both BYOD/platform-purchase fulfillment remain separate.

New pending file hashes at this checkpoint:

| File | SHA256 |
| --- | --- |
| `customer_site_storage_v1.sql` | `f1ab68dfd9bc73602d283441e70f4eb2ccce95e1f7680c3134e0a88901f561d3` |
| `customer_site_modules_v1.sql` | `950add4d0d05a7476def1cfb70c8f70f2bb95c424773e1090589d3699d84ae74` |
| `customer_site_addresses_v1.sql` | `0ba2475b8eeb56b5329819c530e7393b3968cb8db9acfeafbf04f16bfc17f59c` |
| `project_tiles_free_v1.sql` | `cbe6dc9ebc5ee27ea7de53677793d054198fe6f2240b9c1d4e0f3212109f78b1` |

Rollback disables entry points/feature flags and reverts application behavior
while retaining customer data. Re-enabling legacy unrestricted uploads is not a
safe rollback of quota enforcement. Application/schema cutover needs its own
reviewed operational plan; this document does not authorize it.

## Acceptance evidence and remaining gates

| Requirement | Local/CI evidence | Limit |
| --- | --- | --- |
| Landing → existing membership → saved draft | `first-offer-acceptance.e2e.mjs`, customer-site fixture | Synthetic sessions; real signup/mail/approval unchanged and unverified |
| Repeated/interrupted checkout | Browser reuses request ID after retry/reload; existing checkout reservation SQL/Worker fixtures | No Stripe request, money or provider webhook delivery |
| Media quota | Actual SQL/RLS, streamed over/under-size checks, durable HEAD/recovery, replacement/deletion; native CI two-session race | Managed Storage and ingress cutover still need authorized verification |
| Tile edit/preview/publish | Free-publisher SQL/Worker cases plus actual browser/native FFmpeg approval/revision path | Existing approved media only without a preparation allowance; basic text/image-only tiles remain unimplemented; 500 MB provides no compute allowance |
| Module off/on | Owner settings, direct API rejection, real shared bottom-tab browser hide/restore | Project-native post attribution composer remains subsequent work |
| Tenant switching/unauthorized access | Account-switch browser suites, owner filters, direct table/function denial | No production account created or impersonated |
| Four pilot fixtures/free addresses | Equity Uprise, Whip Equipped, Zone Five Fitness, Benji Chase isolated SQL aliases; collision/WWW/private-source tests | Fixture-only suffixes; no real namespace/DNS/BenjiChase.com ownership or availability claim |
| Existing identities/navigation | Existing personal/Vaunt source and browser suites | Uploaded remote logos retain prior validation/fallback; no arbitrary image-host trust |
| Advertising | Tested owner/placement-bound server resolver always disabled/no-fill with zero provider requests | Real eligibility, actual placements/revenue/payouts are not implemented |

Production read-only audit on 2026-10-26 found `member_fronts`, `managed_projects`
and `customer_site_addresses` absent (`to_regclass` null) in canonical project
`zmnhbrjyhxzhkxmhkexs`; no schema was applied. The civic Equity Uprise organization
exists as `dce185c3-5837-4863-ba47-7337618fdc37`, slug `equity-uprise`, type project,
verified, with website `https://matthew.mccluster.org/docket-516.html` and null
`created_by`. No matching network group or music creator profile established an
owned artist destination. Docket 516R's album credit is already Equity Uprise;
its stable act ID `catalogue.html#artist-equity-uprise` is distinct from the civic
`#equity-uprise`. Do not map it to the docket civic page, invent a member handle,
seed an owner or change credits/ISRCs. The artist-link correction needs a verified
act-to-owned-profile mapping; that production migration is not performed here.

## Deferred additions from the continuing owner request

Complete the first offer before expanding the existing composer and Stories.
The next website engineering gap is a basic text/image tile path that preserves
ownership, rights, explicit public approval and quota enforcement without
requiring the existing native media-preparation pipeline. This is unfinished
engineering, not a provider-permission gate. The current candidate offers free
cinematic profile/media editing plus free publication of approved prepared tile
assets; it does not complete a general free tile builder.
Composer work must reconcile #624/#628/#634's durable World/Instagram delivery
identity, use server-verified creator/business and owned-account capabilities,
preserve regular native posting, and implement an overlay/bottom sheet with
draft/back/focus recovery. Do not create a second queue or unsupported networks.
Stories require an audit of current storage/audience/expiry/reporting and actual
media access after expiration; a timestamp alone does not revoke public bytes.
Research the exact requested REA repository before installing or running it.
Read-only research identified `https://github.com/morluto/rea`, cross-linked by
rea.tools. Its MIT license covers its own code, not observed third-party code or
assets. No REA installation/execution is part of this checkpoint.

Future advertising economics remain inactive and configurable. Free eligible
creators need not buy a domain. A 50/50 split is a consideration, not a decision;
track settled network receipts, attribution, reversals, platform share and
rights-holder obligations separately. No post is promised earnings and no
royalty distribution or payout account is activated.

The subsequent Equity Uprise on-demand streaming milestone should audit/reuse
existing player, release, listener-state and commerce code before building:
US-first direct-authorized indie catalog, per-track territory/use/term rights,
private original/signed playback enforcement, validated usage records and
estimated/earned/payable/paid reporting. Master and composition permissions are
distinct; public full-track URLs and missing usage-ledger controls are gaps.
No commercial catalog import, license acceptance, paid streaming subscription,
per-stream guarantee or royalty payment is authorized by this website checkpoint.
