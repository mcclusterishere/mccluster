# Customer self-service implementation status

This is proposed engineering, not a deployed product or release authorization.
Read [the historical reconciliation](RECONCILIATION-2026-10-26.md) before extending
these drafts: substantial editors, commerce and music implementations already
exist on main and parked branches. "Not integrated here" does not mean absent
from the repository. In particular, #493 Studio, #396 canonical commerce and
#278/#541/#543 recording/analysis require deliberate consolidation.
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
| Products/services | `creator-store.js`, `customer-store.js`, `customer-checkout.html`; immutable order price, verified paid/refund state, owner fulfillment | Integration with existing #396 canonical work_orders/payments/fulfillment is a release blocker. Fixed-price USD, US shipping included; no inventory, automatic tax, digital delivery or booking calendar |
| Domains already owned | `creator-domains.js`, `creator-domain-host.js`; TXT ownership, CNAME, provider TLS state, immutable owner binding | Personal fronts and immutable managed-project targets now resolve through canonical handlers, including tile Studio; We Trust targets remain unsupported and fail closed. Cloudflare SaaS configuration, real DNS/TLS verification and approved route needed |
| Domain purchases/renewals | `creator-domain-orders.js`; immutable quote/contact/consent, funding and fulfillment state machine, replay/reconciliation fixtures | Default disabled; complete verified registrar adapter, processor checkout wiring and reviewed terms required |
| World posts + cross-posting | Existing World composer plus opt-in connected Instagram Reels; separate delivery state/retry; fixture proves one World post despite external retry | Durable World/content/job identity and recovery now implemented in #634; no cross-network scheduling; actual provider delivery unverified |
| World directory | `world-directory.js`, `world-discover.html`; explicit owner listings, strict visibility/discoverability/source checks, category/locality/search | Business/service/project only; no invented coordinates or event/campaign listing support |
| Music collaboration | `music-workspace.js`, private projects/invites/roles, originals/credits, microphone review, ordered versions/comments/release-ready snapshot | Async collaboration, not DAW. #635 adds private original/credits/rights-preserving release handoff and repairs the existing analysis queue behind default-off gates; capture links reuse #278. Analysis review UI, real PGMQ compatibility and execution remain pending |
| External social | `social/customer.js` + existing queue; owner OAuth/account selection, uploads, status/retry/cancel/disconnect | Instagram Professional Reels only; Meta app approval/configuration and live callback/Vault encryption unverified |
| Platform navigation | `platform-home.html`, `js/tabbar.js`; supplied E=Up mark for platform default, separate personal/artist destination | Profile-specific center branding and platform fallback integrated in #632; Chromium145 profile-preview CI remains failing, so navigation is not merge-ready. New public-domain hosting not configured |
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

The platform landing is a separate product destination. The latest owner direction
supersedes the draft's global center-tab replacement: use the active profile's
verified logo and destination on branded profiles (Vaunt on Vaunt, Matthew's mark
on Matthew), and E=Up only for platform/default context. Preserve that context
through navigation and clear stale branding on owner switches. The separate Vaunt
follow-up owns this correction; reconcile its tabbar/brand contract before merging
the audience landing changes. Matthew's personal pages and Vaunt remain separate.
Switching the public root/domain requires the verified
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

## Saved consolidation milestone — 2026-10-26

Draft sequence after #631: [#632 profile navigation/account races](https://github.com/mcclusterishere/mccluster/pull/632), [#633 canonical commerce adapter](https://github.com/mcclusterishere/mccluster/pull/633), [#634 durable World delivery](https://github.com/mcclusterishere/mccluster/pull/634), [#635 music release/research](https://github.com/mcclusterishere/mccluster/pull/635), [#636 recovered tile Studio/domain targets](https://github.com/mcclusterishere/mccluster/pull/636), [#637 disabled registrar adapter/integrated CI](https://github.com/mcclusterishere/mccluster/pull/637). These are proposed branches, not current main/live capabilities.

Integrated local evidence: 1,285 Worker tests and 1,168 source tests passed; eight database/Worker fixture scripts passed. Targeted browser flows cover account-switch races, template/private-preview/publication/native playback, validated redirects, private original release handoff and recoverable World delivery. Worker entry bundles with the existing Node compatibility imports and HTML loader. Fixtures do not prove provider delivery or live customer navigation. Chromium145 profile preview fails in remote CI; local Chromium154 passes do not clear it. Other checks must reach terminal success at the reviewed head.

Engineering still required: registrar encrypted inline-contact intake, full extension validator, checkout/status UI and funding bridge; media upload/executor/allowance integration; music analysis consent/review-page integration and real PGMQ validation. Registrar renewals are unsupported. The registration adapter reports ownership pending reconciliation because Cloudflare does not expose charge/contact readback; neither a quote nor submitted digest is that evidence. We Trust authorization and integration are not established. A file uploader/collaboration workspace is not a full DAW.

Activation remains separately gated: review pending migration dependencies and promote approved SQL to the canonical ledger; authorize production application/deployment; verify/configure existing payment price IDs, webhook endpoints and seller configuration in sandbox; verify customer OAuth/provider app approval and encryption; approve DNS/TLS routing and registrar sandbox access only when the missing integration is complete. No new credentials, legal acceptances, real charges, DNS changes or schema writes were made. Membership approval policy remains unchanged.

Migration evidence is in `reconciliation/ledger-diff.json`: the read-only audit found matching 348-entry production/repository ledgers, with pending artifacts unapplied. Matching names/versions do not prove SQL equivalence. Commerce order is canonical v3 → storefront093 → adapter095, with Worker and legacy Edge guards released together. Tile order is existing media/billing/managed projects → website_studio_v2 → project_tiles_v1, plus creator_domain_targets_v1 for custom hosts. World delivery follows existing Action/customer-social schema. Music follows workspace/creator → release handoff → repaired queue → research bridge. Registration attempts follow domain orders. Exact prerequisites and feature gates are documented in each linked implementation handoff; this is not permission to apply them.
