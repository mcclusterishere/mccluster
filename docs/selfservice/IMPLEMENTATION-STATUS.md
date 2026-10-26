# Customer self-service implementation status

This is proposed engineering, not a deployed product or release authorization.
Read-only baseline: main `16bf23358b742b47f6c77138701f59465dfed34f`, Pages
`85ab1350cebd38a5c983cedf2167d2a673944b4a`, active Worker version
`87ff8184-0389-4b07-8d4a-70fe93358b28`. The baseline Worker had no exact Git SHA attestation. Local integration was later rebased onto `396760eb` after the separately authorized #620/#621 releases; those releases are not self-service activation.
The audit found no production `member_fronts` table or `front-media` bucket and
no Stripe secret/creator price configuration in the active Worker bindings.
No production writes, real customers, posts, accounts, purchases or payments were
performed for this work. Current membership policy has not been changed.

## Reviewable capability boundaries

| Journey | Proposed implementation and evidence | Remaining limit |
| --- | --- | --- |
| Existing account to site | `customer-site.html`, `js/customer-site.js`; server readiness, recovery, links from account/editor; browser fixtures | Production member schema/storage absent at audit |
| Personal media page | `front-studio.html`, `js/front-studio.js`, `member-fronts.js`; draft/preview/publish/unpublish; strict public profile, auth-change clearing | Existing email/account recovery not exercised with real mail |
| Multiple projects | `managed-projects.js`, `managed_projects_v1.sql`, `customer-projects.html`, `project-studio.html`; owner-derived writes, stable slugs, private drafts, separate media prefixes | Pending schema; no project seeded |
| Vaunt named profile | Reserved slug and immutable registry binding contract; project ownership backend reusable | No Vaunt row; integrated renderer preserves #621 assets and fails closed for nonpublic managed projects |
| Purchase site plan | `creator-billing.js`, `creator-entitlement.js`; authenticated price catalog, persisted checkout reservation, portal, provider-confirmed expiry recovery | Stripe sandbox/live configuration and webhook delivery unverified |
| Paid publication RPC | `20261010009100_creator_publish_cohort_entitlement.sql` fixes existing five-argument caller compatibility | Compare exact production function/schema and approve migration; do not remove ownership parameter |
| Seller onboarding | `creator-commerce.js`, `customer-seller.js`; owned paid workspace, Stripe hosted onboarding/recovery, provider status and payout dashboard | Connected-account provider verification and live activation required |
| Products/services | `creator-store.js`, `customer-store.js`, `customer-checkout.html`; immutable order price, verified paid/refund state, owner fulfillment | Fixed-price USD, US shipping included; no inventory, automatic tax, digital delivery or booking calendar |
| Domains already owned | `creator-domains.js`, `creator-domain-host.js`; TXT ownership, CNAME, provider TLS state, immutable owner binding | Cloudflare SaaS hosting configuration/credentials, real DNS/TLS verification and approved route needed |
| Domain purchases/renewals | `creator-domain-orders.js`; immutable quote/contact/consent, funding and fulfillment state machine, replay/reconciliation fixtures | Default disabled; complete verified registrar adapter, processor checkout wiring and reviewed terms required |
| World posts + cross-posting | Existing World composer plus opt-in connected Instagram Reels; separate delivery state/retry; fixture proves one World post despite external retry | No cross-network scheduling; local in-memory retry state; actual provider delivery unverified |
| World directory | `world-directory.js`, `world-discover.html`; explicit owner listings, strict visibility/discoverability/source checks, category/locality/search | Business/service/project only; no invented coordinates or event/campaign listing support |
| Music collaboration | `music-workspace.js`, private projects/invites/roles, originals/credits, microphone review, ordered versions/comments/release-ready snapshot | Async collaboration, not DAW; no waveform editing/mixing/export/video editing/stem or MIDI/MusicXML analysis |
| External social | `social/customer.js` + existing queue; owner OAuth/account selection, uploads, status/retry/cancel/disconnect | Instagram Professional Reels only; Meta app approval/configuration and live callback/Vault encryption unverified |
| Platform navigation | `platform-home.html`, `js/tabbar.js`; verified supplied E=Up mark, separate personal/artist destination | New public-domain hosting not configured; no blind technical rename |
| Campaign participation | Existing clipping screen linked; sponsor launch honestly assisted | General mission marketplace/payment automation not completed by this change |
| Backing / apps / streaming | Explicit roadmap and availability states; no fake purchase/install controls | Backing processor/terms/release gates; tenant module installer and RTMP multi-destination remain future work |

Worker module paths above are under `workers/mccluster/src`; SQL paths are under
`supabase/pending` or the repository's existing `supabase/migrations/pending`.
Customer pages are root static files, with their scripts under `js`.

## Activation sequence — none performed

1. Review and integrate draft dependencies. The local branch reconciles #621's
   static project branch with managed project lookup. Keep #620 unrelated. Preserve
   #621's media order, albums, shared footer hooks and explicit project attribution.
   A private/removed managed project must never fall back to public static content.
2. Verify the live ledger and missing objects immediately before a separately
   approved migration. Review `member_fronts_v1.sql`, `managed_projects_v1.sql`,
   missing cohort grants/five-argument publisher compatibility, checkout reservation,
   creator store, creator domains/orders and customer social SQL in isolation.
   Apply only approved missing migrations, record actual ledger versions, then run
   the repository drift checks. Never mark pending SQL applied merely because tests pass.
3. Configure approved provider sandboxes and exact return/webhook URLs. Exercise
   actual delivery, duplicate/out-of-order events, cancellation and recovery before
   requesting live flags. Fixture signatures do not prove provider webhook delivery.
4. For custom hosting, approve the exact zone, scoped credential, fallback origin,
   CNAME and route. Real ownership/TLS checks are still required. Purchases must not
   collect money while registrar fulfillment is incomplete. An ambiguous registrar
   timeout is reconciliation-required, never automatic purchase retry.
5. For Instagram, approve the app/scopes/callback and credential storage; test the
   actual provider with authorized test accounts before enabling customer connections.
6. Approve an exact reviewed release SHA and deployment separately. Only then verify
   the end-to-end customer journey on the deployed version.

## Public domain and homepage boundary

The requested public destination is EquityUprise.com. A read-only Cloudflare zone
lookup on 2026-10-26 returned no matching zone in the connected account. Registrar
lookup returned only `name` and `supported_tld`, not proof of registration/control.
Public RDAP and DNS requests were blocked by the execution environment's proxy
(403), so ownership and current public routing remain unverified. No registration,
transfer, DNS, security or hosting change was attempted.

The platform landing is a separate product destination and the center navigation
links there on the existing working property. Matthew's personal pages and the
Vaunt draft remain separate. Switching the public root/domain requires the verified
ownership/routing work above; the draft does not silently replace a personal route.

## Evidence limits

Offline Worker/source tests and Chromium fixture flows exercise actual handlers,
editors and renderers with synthetic accounts/provider responses. PGlite executes
PostgreSQL RLS/roles/constraints in isolated fixture databases; Storage/Vault fixtures
are not the managed Supabase services or proof of Vault encryption. Native PostgreSQL
member-storage checks are configured in CI. No real bank verification, funds,
domain registration, Meta publishing, physical-device Safari or live mail recovery
is claimed. Specific reproduction commands and provider gates are in
`customer-billing.md`, `domains.md`, `../self-service/customer-social.md`,
`../control-plane/MANAGED-PROJECTS.md`, and `platform-offers.md`.
