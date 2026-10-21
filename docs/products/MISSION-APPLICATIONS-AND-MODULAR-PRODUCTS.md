# Mission applications, curated releases, and product boundaries
Owner direction: Matthew McCluster, 2026-10-16.
Status: implementation contract/proposal; this document does not claim deployed behavior.
Audited mccluster main: 5e0a9e750b6fb93a33bb65b2283a199682b2b1b5.
Supersedes the earlier public/member globe-layer unlocking direction for the requested public experience.

## Required product behavior
An account is identity, not mission approval. Every person must submit an application and receive approval for the specific mission before receiving an active assignment or performing it through the platform. Creator, business, paid subscription, verified identity, and organization membership do not bypass this. Mission completion review remains a separate later decision.

Keep one ecosystem identity. Working audience names are Curator (audience/supporter), Creator (individual creator or service provider), and Partner organization. Curator and Partner organization are provisional labels, not finalized branding. Organization membership and admin permissions remain separate from these labels; people can have multiple roles. Do not rename database roles in bulk.

All extra public globe data-layer toggles are withheld initially from every non-admin, including signed-out visitors, signed-in members, creators, and business users. Preserve the base globe, navigation, and curated mission experience. Admin explicitly previews, releases, and withdraws individual features. Hidden controls must not imply availability through account upgrades. The existing admin workspace retains its authorized capabilities.

## Application experience
Open Apply in a modal/bottom sheet over the current mission/page; retain page position, mission selection, and return focus when closed. The normal path never requires navigating to a separate landing page.

1. Show mission scope, requirements, compensation if applicable, availability, and selection process.
2. Capture a short on-camera introduction with face visible. Request camera/microphone permission only on Record. Provide preview, retake, progress, cancel, and resumable upload. Suggested default 30–60 seconds is a product recommendation, not an owner-fixed limit.
3. Ask why this mission, relevant experience, availability, résumé, and optional portfolio/work samples. Reuse an applicant-controlled profile with confirmation; keep the mission-specific explanation.
4. Review the complete application and consent before Submit. Show a durable submitted receipt and status on the same page.
5. Reviewer requests changes, approves, or rejects with a recorded decision. Approval is bound to mission, applicant, and application version. Material mission changes require renewed acceptance.

Handle iOS/Safari recording formats, camera denial, interrupted uploads, and poor connections explicitly. A face-visible video file upload is a fallback when in-page recording is unavailable; it does not waive the video requirement. Provide an assisted/accommodation path. Do not automatically assess appearance, infer sensitive traits, or treat the video as verified identity. Human review assesses relevant qualifications.

Suggested lifecycle: draft → submitted → under review → changes requested / approved / rejected; withdrawn is applicant-controlled where appropriate. Submission does not create a joined assignment. Acceptance and any required agreement create the assignment atomically after approval. Capacity reservation, expiry, repeat applications, cancellation, and existing assignments need explicit migration rules before rollout. Preserve earned balances and existing approved work.

Enforce this on every entry: globe, campaign, feed, direct API, RPC, clip claim, live mission, native app, and any database grants. A browser-only Apply button is insufficient. Direct inserts and old join routes must fail closed without an approved application. Avoid silently granting approval to legacy signups.

## Payment and paperwork
Keep distinct records for application review, assignment/agreement, tax documentation, Stripe onboarding, verified earnings, transfers, and payouts. A completed Stripe connection alone must not mark paperwork complete or qualify someone for a mission.

For paid work, determine the actual payer and engagement type. Collect the appropriate tax certification in restricted onboarding, normally after conditional selection and before payout readiness; don't ask every rejected applicant to submit a tax ID. W-9 is the U.S.-person path; foreign payees require the appropriate alternative. Employment versus contractor classification is not established by calling the experience a job application.

Store tax documents outside general application attachments with narrowly authorized access, encryption, access audit, and retention rules. General reviewer UI gets completion status, not SSN/TIN. Never put tax IDs in analytics, logs, public profiles, or browser storage. Application videos and résumés are private to authorized review, not automatically feed posts. Publish retention/deletion behavior.

Payout gate: approved assignment + accepted agreement if required + verified payable earnings + appropriate tax status + connected-account readiness + available reserved funds. Existing anti-duplicate transfer and reconciliation requirements remain.

Tax references checked 2026-10-16:
- https://www.irs.gov/forms-pubs/about-form-w-9
- https://www.irs.gov/instructions/iw9
- https://www.irs.gov/businesses/small-businesses-self-employed/forms-and-associated-taxes-for-independent-contractors

## What the repository inspection found
- McCluster-OS default branch claude/product-integration-4o3p2j README describes @mccluster/dial, a zero-dependency TypeScript reputation-scoring package with reproduction tests. The README says consuming products have not adopted it. This is README evidence, not a completed code/test audit of that repository.
- docs/control-plane/registry.json explicitly classifies McCluster-OS as archive-os.
- AGENTS.md and docs/control-plane/ECOSYSTEM.md make mccluster the canonical control plane, with one identity and shared durable data plane. Product repos are satellites.
- workers/mccluster/src/world-access.js currently gives public flights and progressively unlocks other layers using account levels and CCTV prerequisites. This conflicts with the new release policy.
- js/action-globe.js currently falls back to session-based unlocking if the access map fails; unreleased features instead need a deny-by-default fallback.
- workers/mccluster/src/world-layers.js directly serves flights publicly and satellites/launches to authenticated users. Hiding controls alone would leave these routes available.
- Existing identity/entitlement routes, creator entitlement, application-specific environment flags, and Control are integration points; their existence is not evidence of a unified release manager.
- Existing mission approval SQL in supabase/pending concerns assignment/completion review. Do not assume it already supplies the requested pre-assignment application workflow, and do not assume pending migrations are deployed.

Recommendation: evolve current mccluster incrementally. Recover useful pure packages from McCluster-OS after source/license/testing review, under current architecture. Do not restart production or revive the archive as a competing backend. A new product shell can consume existing services; it should not duplicate their authority.

## Product architecture
Use a modular monolith first: independently versioned package contracts and data ownership with one operational control plane. A tab is an entry point to a product, not necessarily its complete package. A domain object is reusable through a stable contract; it does not need a separate deploy, repository, or subscription by default.

Proposed boundaries:
| Product | Owned capability | Dependencies |
| --- | --- | --- |
| Missions | applications, assignment lifecycle, proof and review | identity, media, authorization |
| Globe | globe presentation, curated layer composition and discovery | release policy, geospatial adapters |
| Halo | advanced operational data and authorized analysis | connectors, provenance, authorization |
| Analytics | authorized events, aggregates, funnels and reporting | event contracts, tenant policy |
| Media/catalogue | releases, credits, playback and rights | identity, storage, commerce |
| Creator presence | provider profile, portfolio and public site | identity, media, publishing |
| Commerce/payouts | orders, earnings, transfers and reconciliation | identity, financial policy |
| Control | operations, review, release and tenant administration | module contracts and audit |

Shared packages: identity client, authorization/entitlements, product registry, event schemas, media capture/upload, design system, billing adapters, release policy. Keep runtime adapters outside pure domain code. Each module has a manifest with stable ID/version, capabilities, dependencies, configuration schema, API/event versions, data ownership, migrations, permissions, metering units, release state, and commercial SKU mappings.

Proposed layout, introduced incrementally rather than moving all existing code:
- packages/contracts/
- packages/release-policy/
- packages/media-capture/
- packages/modules/{missions,globe,analytics,creator-presence,...}/
- products/{human-uprise,halo,control}/ for compositions
- workers/mccluster/ for the canonical API adapters
- docs/products/ for product contracts and extraction ledgers

Keep the deployed URL/API contracts stable while implementations move. Modules communicate through versioned APIs/events, not imports into another module's internals. Data is logically owned and tenant-scoped on the existing data plane. Separately deployable licensed editions are a later packaging target, requiring explicit supported deployment and isolation contracts.

## Admin release and withdrawal
Maintain independent axes:
- release audience: admin preview, selected tenant/cohort, public, withdrawn;
- authorization: what this user may do;
- commercial entitlement: what this tenant purchased;
- readiness: dependencies, configuration, migration compatibility, service health.

Access requires every applicable axis. Payment never overrides withdrawal; admin preview never overrides privacy or financial authorization. Unknown feature, missing policy, malformed policy, and failed policy lookup deny access.

Control should show feature ID/version, audience, prerequisites, owner, dependencies, published configuration, price mapping, usage, errors, and audit history. Preview → publish with audience → observe → withdraw/rollback. Record actor, reason, previous/new revision, and time. Enforce policy server-side before loading upstream data or serving a cached response; invalidate stale release caches with bounded revocation latency. Handle sign-out and role loss by clearing active private layers and cancelling refreshes.

Initial scope: extra globe toggles are admin-only. Admin curation can release a preset display separately from permission to manipulate raw layers. Cover standalone globe, embedded globe, public hosts, saved URLs, keyboard controls, postMessage commands, APIs, and cached sessions. Admin status must be verified by existing server authority, never query strings or localStorage.

Withdrawal disables new use while preserving user records, completed work, earnings, required reporting, and safe exports. Define how in-flight missions/jobs finish; never make a toggle delete business data.

## Commercial packaging
Support standalone modules, bundles, white-label editions, and hosted tenant deployments. Pricing can map to a module, seat, usage unit, tenant, or edition. Record versioned entitlements and meters before wiring a billing price. Do not set actual prices without cost and packaging decisions.

The requested pre-AI software-company model means repeatable releases, documented contracts, installation/configuration, support, maintenance, licensing, upgrades, and measured unit economics. AI can be an optional capability rather than a prerequisite for every product.

The repository is public. Before distributing an exclusive proprietary edition, inventory first-party ownership, dependency and asset licenses, attribution, and data-provider redistribution rights. New packaging does not turn third-party code or previously distributed source into exclusively owned code. Separate private commercial source only through a deliberate release strategy; do not change repository visibility here.

## Implementation order and acceptance
1. Close non-admin globe toggle access and its server data paths; regression tests for guest, member, creator/business, admin, unavailable policy, sign-out, and embedded entry points.
2. Build application records, secure attachments, in-page recorder/form, reviewer queue, and approved-assignment enforcement. Test direct API/RPC bypass, duplicates, capacity races, revisions, and private file access. Render at 390px and verify no horizontal overflow.
3. Add appropriate tax-document and agreement flow with payout gates; test that no raw tax identifiers enter telemetry.
4. Add release registry and Control publish/withdraw UI on existing authority. Test tenant isolation, dependencies, revocation, stale sessions, and rollback.
5. Extract one product at a time behind compatibility adapters; prove standalone composition and bundle composition before moving another.
6. Add pricing/usage mapping and a supported licensed distribution.

This proposal records direction and audited gaps. It does not implement the recorder, approval gate, globe restrictions, release manager, database migration, or product extraction. Future implementation PRs must report their exact shipped scope.
