# Decision Intelligence — implementation contract (PR #407)

Status: foundation in progress. No new API, database schema, scheduled monitoring or agent execution is deployed by this document.

## Product boundary
Owner-authenticated McCluster decision support. Canonical Worker, Supabase, commerce and analytics remain authoritative. This is not a separate identity, payments, observability or spatial backend. Human approval is required for spending, transfers, publishing, deployments and other consequential mutations.

## Existing reuse points
- `workers/mccluster/src/analytics/router.js`: authenticated analytics and commerce summary.
- `workers/mccluster/src/analytics/audience-science.js`: behavioral features, not inferred intent.
- `workers/mccluster/src/lib/observability.js`: bounded trace/domain events; not a research archive.
- `core/src/tools/research.mjs`: bounded research queries and URL filtering; retrieved text is untrusted.
- `ai_context.decisions`: existing decision/approval/supersession schema; verify production migration before use.
- `workers/mccluster/src/seek-first/index.js`: governed spatial API and source entitlements.

## Phase A — deterministic business economics (started)
`workers/mccluster/src/decision-intelligence/economics.js` evaluates a supplied observed campaign scenario using integer minor currency units. It **does not** retrieve Stripe data, claim causality, forecast conversion, or determine attribution. Callers must reconcile all inputs before using the results. Zero-denominator metrics are null. No external side effects.

Acceptance: valid fixture arithmetic; reject negative/fractional/unsafe money, impossible funnels and refunds exceeding revenue; preserve missing denominator semantics.

## Phase B — evidence registry and research intelligence
Versioned source registry with source URI, retrieval timestamp, published timestamp, owner org, license/usage lane, content hash, retention policy and source reliability metadata. Evidence-to-claim links with quoted span or pointer, extraction model/version and verification state. Enforce org isolation, allowlist outbound fetch destinations, detect prompt injection, deduplicate by content hash. Avoid treating AI summaries as primary evidence.

Acceptance: citations resolve, deleted/expired sources are identified, cross-tenant access denied, adversarial retrieved instructions cannot trigger tools.

## Phase C — financial source adapters and scenarios
Read-only, reconciled Stripe/commerce and analytics adapters; explicit period, currency, revenue recognition and attribution contracts. Distinguish booked/settled/refunded/pending and cash vs accrual. Extend economics with assumptions and low/base/high scenarios. Never pass raw unverified payment events directly to the economics engine.

Acceptance: fixture reconciliation against ledger, duplicates/refunds/chargebacks, missing and late events, currency mismatches, provenance of every input.

## Phase D — decision agents
Research, economics, risk and critic workers behind bounded orchestrator. Structured output with citations, competing options, assumptions, uncertainty and defer option. Deterministic math via economics module. Hard tool budgets and timeouts. Read-only by default; owner authorization and explicit approval for consequential mutations.

Acceptance: unsupported-claim evaluations, adversarial prompt injection, budget exhaustion, tool failure, cross-tenant denial, approval bypass tests.

## Phase E — lifecycle monitoring
Persisted watch definitions, materiality thresholds, last-seen cursors, dedup keys, cooldowns, last successful run and outcome snapshots. Scheduled checks via existing Worker cron/queue architecture, not browser timers. Alert only on meaningful change and retain source evidence.

Acceptance: idempotency, replay, stale events, concurrent runs, alert suppression, bounded spend, failed-source recovery.

## Phase F — spatial intelligence
Read-only adapter to canonical Seek First APIs. Enforce provider entitlements and permitted retention. Mark observed vs simulated/fictional and freshness. Hitman's Halo may visualize permitted results but is not a financial or operational source of truth.

Acceptance: source-license refusal, provenance and age display, no PRIM3 fictional-state leakage, no bypass via owner/agent privileges.

## Delivery order
1. Audit production schema and CI status of PR #407.
2. Land tested economics core (initial implementation in this PR).
3. Implement evidence registry with RLS and tests.
4. Add reconciled read-only financial adapters.
5. Add bounded decision workflow and owner dashboard.
6. Add monitors and geographic adapter only after earlier release gates.

## Release gates
No production migration or deployment without verified RLS and migration ledger. Zero unauthorized agent actions in adversarial tests. Reconciled financial fixture suite. Research citations reproducible. All PR checks green. Keep new feature disabled until a real business pilot is validated.

## Economics definitions
`netRevenueMinor = verifiedRevenueMinor - refundsMinor`.
`totalCostMinor = paymentFeesMinor + acquisitionCostMinor + creatorCostMinor + infrastructureCostMinor`.
`contributionMinor = netRevenueMinor - totalCostMinor`.
`contributionMargin = contributionMinor / netRevenueMinor` when net revenue is nonzero.
`customerConversionRate = customers / visitors` when visitors are nonzero.
No forecast or causal interpretation is implied.
