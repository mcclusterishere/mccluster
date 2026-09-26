# McCluster branch reconciliation ledger — 2026-09-26

Status: **review artifact only — no feature implementation, merge, branch deletion, deployment, or database mutation is authorized by this file.**

Authority: current `main`, `AGENTS.md`, `CLAUDE.md`, `docs/control-plane/ECOSYSTEM.md`, `docs/control-plane/CANONICAL-ARCHITECTURE.md`, and `docs/control-plane/canonical-architecture.json`.

## Purpose

The repository has accumulated branch history from rapid product, control-plane, analytics, and Equity Uprise work. Historical branches are evidence, not architecture authority. This ledger gives every currently visible branch one disposition so future work cannot revive an obsolete architecture merely because code still exists on a branch.

## Status contract

- **still-live** — canonical source, operational promotion/publication ref, or currently open PR. Do not delete.
- **absorbed** — implementation is already represented by current `main`; branch is a cleanup candidate after retention review.
- **superseded** — branch contains historical or divergent work that is not a current promotion path. Never merge wholesale; salvage only the smallest useful concept onto fresh current `main`.
- **archive** — intentionally historical/checkpoint/backup evidence. Retain unless a separate archive-retention decision removes it.

A donor flag does **not** make a branch live. It only identifies a concept worth harvesting.

## Snapshot

| Status | Branches |
| --- | ---: |
| still-live | 6 |
| absorbed | 192 |
| superseded | 90 |
| archive | 20 |
| **Total** | **308** |

## Still-live refs

- `deploy/ovh-production` — canonical OVH production promotion pointer
- `feat/analytics-attribution-relationships-detail-20260926` — open PR #242: Deepen analytics with signup attribution, relationship graphs, and visitor detail; donor theme: **analytics-v3**
- `feat/analytics-identity-forensics-20260926` — open PR #244: Deepen analytics with signup attribution and owner forensics; donor theme: **analytics-v3**
- `feat/equity-uprise-floor-native-lab-depth-v1` — open PR #200: Deepen Equity Uprise labs into floor-native curriculum; donor theme: **floor-native-scenario-ids**
- `gh-pages` — publication branch; retain until GitHub Pages configuration proves it is unnecessary
- `main` — canonical source branch; architecture authority

## Six donor themes, in execution order

### 1. analytics-v3

**Decision:** rebuild from current main

**Sources:** `feat/analytics-identity-forensics-20260926`, `feat/analytics-attribution-relationships-detail-20260926`

**Harvest:** owner-only signup attribution; real account_created conversion; source/song/account relationship views; page-path relationships; reach-vs-repeat analysis; country-forwarding repair.

**Reject:** page_view titles treated as music; stale async dashboard overwrite; mismatched attribution denominator; 50k oldest-row bridge truncation; removing permissioned precise geolocation.

### 2. account-integrity-v2

**Decision:** rebuild missing enforcement on top of merged #245

**Sources:** `feat/privacy-gate-account-integrity-20260926`

**Harvest:** shared signup-layer first/last-name enforcement; incomplete-profile routing; cross-surface account/privacy CI.

**Reject:** parallel privacy gate; client-only identity proof claims.

### 3. sovereign-assets-preview

**Decision:** reconstruct only missing backend primitives

**Sources:** `selfhost/preview-runtime-v1`, `selfhost/sovereign-media-fabric-v1`, `product/mccluster-console-v1`

**Harvest:** content-addressed asset ingress; asset gateway; owned preview runtime; runtime sovereignty audit.

**Reject:** old duplicate MCP implementation; parallel owner console.

### 4. provider-estate-control-graph

**Decision:** targeted current-main gap audit before implementation

**Sources:** `architecture/platform-reconstruction-v1`, `feature/global-infrastructure-plane`

**Harvest:** provider adapters; estate snapshots; GitHub/Cloudflare/Supabase/OVH control graph.

**Reject:** parallel control plane; historical provider assumptions without live evidence.

### 5. governed-first-touch-outreach

**Decision:** rebuild as governed McCluster Work/control-plane action

**Sources:** `feat/first-touch-outreach-agent`

**Harvest:** suppression checks; reply/bounce/complaint/unsubscribe stops; public-evidence gate; per-domain throttling; explicit live-send enablement.

**Reject:** 100-per-day default; standalone Gmail subsystem.

### 6. floor-native-scenario-ids

**Decision:** defer until Equity Uprise returns to active implementation priority

**Sources:** `feat/equity-uprise-floor-native-lab-depth-v1`, `fix/floor-native-curriculum-current-20260925`

**Harvest:** stable scenario_id separate from source_lab_id; reusable skills across floors; minimum floor-native scenario coverage; cross-floor incidents.

**Reject:** whole-branch merge; stale runtime/generated artifacts.


## Open PR dispositions

- **#244 — Deepen analytics with signup attribution and owner forensics** (`feat/analytics-identity-forensics-20260926`): do-not-merge-as-is; reconcile/rebuild from current main. Harvest under **analytics-v3**.
- **#242 — Deepen analytics with signup attribution, relationship graphs, and visitor detail** (`feat/analytics-attribution-relationships-detail-20260926`): do-not-merge-as-is; reconcile/rebuild from current main. Harvest under **analytics-v3**.
- **#200 — Deepen Equity Uprise labs into floor-native curriculum** (`feat/equity-uprise-floor-native-lab-depth-v1`): do-not-merge-as-is; reconcile/rebuild from current main. Harvest under **floor-native-scenario-ids**.

## Implementation sequence

1. Stabilize **analytics-v3** on a fresh branch from the then-current `main`; do not merge #242 or #244 unchanged.
2. Add only the missing **account-integrity-v2** enforcement on top of merged #245.
3. Reconstruct the missing **sovereign-assets-preview** backend primitives without reviving the old MCP path or parallel console.
4. Run a targeted gap audit for **provider-estate-control-graph** before writing implementation.
5. Rebuild **governed-first-touch-outreach** through existing McCluster Work/control-plane policy gates and conservative deliverability limits.
6. Defer **floor-native-scenario-ids** until Equity Uprise is explicitly returned to active implementation priority; when resumed, port the concept to current runtime rather than merging historical branches.

Every implementation gets its own fresh branch from current `main`, tests, and review. No donor branch becomes a merge base.

## Cleanup policy

No deletion happens in this PR.

After donor harvesting is complete:
- `absorbed` branches may be deleted after retention review;
- `superseded` branches may be deleted after any flagged donor concepts are reconstructed;
- `archive` branches remain retained evidence unless an explicit archive-retention pass says otherwise;
- `still-live` branches are protected from cleanup.

## Machine-readable ledger

See `docs/control-plane/branch-reconciliation-2026-09-26.json` for every branch, current SHA, status, PR lineage, donor flag, and merge policy.
