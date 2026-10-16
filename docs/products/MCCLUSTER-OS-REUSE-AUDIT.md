# McCluster OS: reuse audit and first release boundary

Owner direction: Matthew McCluster, 16 October 2026.
Companion contract: PR #473, `docs/products/MISSION-APPLICATIONS-AND-MODULAR-PRODUCTS.md`.
This audit extends that contract; it does not supersede its application requirements.

## Decision

Evolve the canonical McCluster repository into a modular product platform. Keep
McCluster OS as a source of reusable concepts and, eventually, a distribution name
or SDK surface. Do not restart production or move the platform into its historical
repository. The existing identity, tenant boundaries, durable data, Core runner,
financial reconciliation and Control operations are the valuable foundation.

Audited sources:
- mccluster main `5e0a9e750b6fb93a33bb65b2283a199682b2b1b5`.
- McCluster-OS default branch `claude/product-integration-4o3p2j`: repository tree,
  README, dial implementation/presets, task-queue README, queue and file-store code.
- Current architecture: `docs/control-plane/CANONICAL-ARCHITECTURE.md` and
  `registry.json` (McCluster-OS has role `archive-os`).
- Current first-party license: root `LICENSE`, McCluster Corp Proprietary License.

## Source comparison

| Area | McCluster-OS source | Current McCluster foundation | Decision |
| --- | --- | --- | --- |
| Shared arithmetic | Pure TypeScript dial, configurable weights, confidence and cold-start models; README says products have not adopted it | Product-specific analytics and operational capabilities | Reuse the pure-function/package pattern; adopt scoring only for an explicitly defined purpose after input validation and reproduction tests |
| Task execution | Node filesystem queue; per-state JSON directories, rename claims, leases, retries | Canonical `ops_agent_jobs`, objectives and Core execution | Keep the canonical execution plane; do not install a second queue |
| Product isolation | Queue store interface and pure dial separate mechanism from product meaning | Shared identity, tenant-scoped data, Worker adapters, capability catalog | Preserve stable contracts and logical ownership on existing infrastructure |
| Applications and release management | No corresponding application, tax, release-control or product-billing module in the audited tree | Existing mission/proof, membership, commerce and Control integration points | Build these features here; the OS repo is not an implementation shortcut |
| Commercial distribution | Small packages, not a complete supported edition | Existing proprietary first-party license and deployed product surfaces | Define versioned product manifests, distribution/support contracts and dependency rights before selling standalone editions |

The task queue's source uses a rename followed by a separate write of its lease
metadata. That is not evidence of atomic lease publication or multi-host recovery.
The public API also accepts caller-provided IDs that the file store uses as paths.
These are reasons to review it before reuse, not claims that the package has been
security-tested here. Its tests were not executed in this source audit. The dial
also needs validation of weights, finite maxima and invalid configurations before
being treated as a supported shared dependency. No private OS source is copied.

## Product model

Package reusable objects as contracts, capabilities as sellable options, modules
as products, and products as compositions. An object does not require a repository,
deployment or subscription of its own. A tab can expose several capabilities.

| Product boundary | Reusable objects | Commercial units to evaluate, not prices |
| --- | --- | --- |
| Missions | application, assignment, requirement, proof, review | tenant, reviewer seat, active mission |
| Globe | layer, place, mission pin, curated preset | tenant, approved layer, usage |
| Halo | connector, observation, source, evidence | connector, refresh/processing usage, operator seat |
| Analytics | event, aggregate, funnel, report | tracked property, event volume, retention |
| Creator presence | profile, portfolio, offering, site | published site, domain, edition |
| Media | asset, release, credit, rights record | storage, delivery, catalogue edition |
| Commerce | order, payable earning, transfer, refund | supported commercial bundle and transaction services |
| Control | review queue, release revision, tenant configuration | operator seats and administrative edition |

Every future module manifest should identify its stable ID, version, owned data,
API/event contracts, dependencies, permission requirements, readiness checks,
configuration, meters and SKU mapping. Prices remain unset. Release status,
commercial entitlement and permission are independent: payment does not release a
withdrawn feature; admin preview does not waive financial or privacy requirements.

Use the existing first-party proprietary license. Third-party libraries, assets
and provider data retain their own applicable rights. Public repository visibility
does not by itself grant an open-source license. This change does not alter source
visibility, relicense dependencies or establish redistribution rights.

## Mission admission decision, retained across sessions

Account creation never approves a mission. Creator and organization labels do not
bypass the application. Working labels: Curator (provisional), Creator, Partner
organization (provisional); permission roles remain separate.

The in-page application must include face-visible introduction video (record,
preview, retake, or video-file fallback), mission-specific rationale, relevant
experience, resume and review/consent. It stays over the current page and restores
focus/position on close. A submitted application receives a durable receipt and
human review; only an approved application can create an active assignment. An
introduction video is not automatically verified identity or an appearance score.

Application approval, agreements, tax documentation, Stripe onboarding, verified
earnings and payout are distinct states. W-9 is tax-identification/certification
paperwork, not mission approval. Tax documents and identifiers must be handled in
restricted onboarding, separately from video/resume attachments and analytics.
IRS reference reviewed: https://www.irs.gov/forms-pubs/about-form-w-9
No tax-document collection, recorder or mission application backend is implemented
by the accompanying globe restriction. Those require their own end-to-end build.

## Implemented first restriction

`packages/release-policy/globe.mjs` is a pure policy module consumed by the current
Worker. Optional globe layers are `admin_preview`; unknown features deny access.
The canonical router checks live house-owner membership before dispatching flight,
satellite, launch, CCTV, enhanced ion, intelligence-geography and Halo-projection
requests. Existing feature authorization, privacy and rate limits still apply.
No alternative account tiers or user-editable metadata grant admin preview.

The access map reports no optional layers for non-admins. Controls begin hidden,
including in embedded/explorer modes; missing or older access responses deny access.
Creator-mode postMessage cannot reveal the audience layer. Token changes, failed
access checks and subsequent policy refreshes remove active layers; pending data
responses check access again before drawing. Visible pages refresh access each
60 seconds; returning to the page refreshes it. A previously issued external ion
asset credential retains its provider expiry; removing a layer cannot revoke an
already-issued provider credential. New Worker requests still check authorization.

`WORLD_GLOBE_WITHDRAWN` is a reviewed Worker configuration kill switch: comma-separated
feature IDs, or `*`. Empty means owner preview. Unknown/malformed values withdraw
all optional features. Withdrawing a feature denies owners too. This is an initial
operational withdrawal path, not the future Control publish/withdraw manager.

The base globe, navigation, curated missions and news stay available. Business data,
mission history, earnings and existing assignments are not deleted. Public creator
analytics outside the globe retains its existing authorization.

## Remaining product implementation

1. Mission application records, private attachments, in-page recording, reviewer
   queue, versioned approval and enforcement across API/RPC/native entry points.
2. Separate agreement/tax onboarding and payout readiness gates.
3. Persistent release revisions and audit, tenant/cohort/public audiences,
   dependency checks, Control preview/publish/withdraw controls and rollback.
4. Extract one product behind stable adapters; prove standalone and bundle use.
5. Add usage metering, SKU mapping, supported commercial editions and maintenance.

This PR does not merge/deploy, migrate production data, set prices, move all source
into packages, or claim that the remaining application/release manager is complete.
