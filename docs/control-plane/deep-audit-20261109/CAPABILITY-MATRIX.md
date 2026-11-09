# Capability matrix, 9 November 2026

Columns follow the handoff's evidence vocabulary and are deliberately separate. "Tested" names the checkout: **this branch** = `claude/new-session-83ken5` (working tree on main `578e6830` plus this session's changes; the exact commit is in `HANDOFF.md`). "Deployed" rows cite the packet's dated receipts: Worker/Pages main `578e6830` (Pages commit `22259d57`), Core `9c5b7503`. **Nothing in this session touched a deployment, a database or a credential**, so every "Verified in use" cell is unknown unless a prior receipt says otherwise, and prior receipts are dated evidence, not fresh probes.

| Capability | Vision | Source present | Locally tested (checkout) | Merged to main | Deployed | Verified in use |
| --- | --- | --- | --- | --- | --- | --- |
| Public social World feed on the globe (`mnet.html`, social-only switch) | yes | main | selected Worker/world suites pass on this branch | yes | Pages `22259d57` | unknown this session; prior publish/verify-live records exist |
| Owner Travel / Missions tabs (`js/world-owner-modes.js`) | yes | main | source suites | yes | Pages | unknown |
| E=Up environment tab: issue → mission → assignment → proof → review → consent | yes | **this branch** (vendored product `645d68a…` + local EQ1/EQ2/EQ4 patches), pending SQL unapplied | this branch: consumer + Worker suites, lifecycle regressions; PGlite scripts see HANDOFF | **no** | no | no |
| Environment data: sources, freshness, coverage, provider health labels | yes | this branch (`evidence.mjs`) | unit fixtures | no | no | no |
| Live watching, mission funding, sponsor outreach | vision | no (deterministic sponsor draft only) | n/a | no | no | no |
| PRIM3 World generated side operations (recipe → Forge → resolver) | yes | main; **compiler relocated to `js/prim3-tactics/levels/recipe.mjs`** on this branch | this branch: `prim3-generated-missions.test.mjs`, published-import-closure test, **e2e from the stripped export in local Chromium** | fix: no | published artifact `22259d57` is **broken** for this graph (W1) | no |
| PRIM3 reviewed releases (owner attestation, digest, expiry) | yes | main (Worker), pending SQL | Worker prim3 suites 105/105 on this branch | yes (code) | flag/SQL state unknown | no |
| PRIM3 adaptive practice (HMAC replay, server questions) | yes | main | Worker suites | yes | flag/key state unknown | no |
| HQ / B1 tactical sandbox | yes | main; elevator landings fixed on this branch (EQ3) | this branch: 171 pass / 3 skip across `prim3-*` suites | fix: no | Pages | no |
| City Arcade (Tea, Sole) local play | yes | main; outbox + start idempotency on this branch (W2/W3) | this branch: 17 + 31 PGlite assertions, Chromium e2e | fix: no | Pages; **schema applied `20261109181623`, flag absent, live Worker pre-startKey** | no |
| Chemistry Game Hub (owner) / public 7-day trial (#758) | yes / PR | main / #758 | audit: 95 Arcade/Chemistry tests on main | hub yes / trial no | hub yes / trial no | no |
| Default Control shell account lifecycle (A1) | yes | this branch | this branch: see HANDOFF | no | no | no |
| Cross-origin handoff commit fence (A2) and auth loader retry (A5) | yes | this branch (`js/tabbar.js`) | this branch | no | no | no |
| Owner front page / inactive widget editors (#776) | yes | PR #776 | audit: PGlite 10+10, unit 10 | no | no | no |
| Admin category nav + analytics layout (#784→#789) | yes | PR #789, not mounted by `control.html` | audit: 7 unit, 10 SQL | no | no | no |
| Music direct sales: purchased-asset pinning (COM-1), download attempt settlement (COM-2) | yes | **applied form imported** (`20261109175747`, Edge v42 source) | local PostgreSQL 16 suite + native 17.7 release integration | no | **yes: migration + Edge v42 (receipt)** | no real purchase/download |
| Customer checkout reservation recovery (COM-3) | yes | PR #782 only | audit reproduction only | no | no | no |
| Core job lease fencing + lost-lease abort (C3) | yes | this branch (`locked_by` lease, no schema change) | 4 tests | no | no | no |
| Core reflection child idempotency (C2) | yes | this branch | 2 tests | no | no | no |
| Core daily report persisted as success condition (C7) + house org lookup fix | yes | this branch | 3 tests | no | no | no |
| Core health: unknown evidence not shown as healthy zero (C1) | yes | this branch | 4 tests | no | no | no |
| Core code-patch complete-inventory path policy (C4) | yes | this branch | 8 tests | no | no | no |
| Local-model readiness vs liveness + deploy gate (C6) | yes | this branch (`/ready`, `ovh-core-health.sh`, `deploy-ovh-core.sh`) | 5 tests, `bash -n` | no | no | no |
| Core-signed media mutation replay protection across isolates (C5) | yes | this branch: shared nonce claim; `CORE_REPLAY_STORE="supabase"` in wrangler.toml; operation claim follow-up (see HANDOFF) | Worker suite | no | **nonce table applied `20261109180829`; Worker not deployed** | no |
| Finance (owner-only IEX paper simulation) | bounded | main | audit fixtures | yes | flags unknown | no |
| Email-link sign-in (#753) | yes | PR | audit: 13 unit | no | no | no |
| Reusable Equity Uprise independent installation | vision | control subsystem on local branch `1c76d641…` only | audit: 46/46, native PG lock/drain/CAS, PGlite restore | no | n/a | no |

Columns that are "no" for merged/deployed are not failures; they are the honest state of a review branch. The release matrix per repair (schema prerequisites, receipts, gates, review location, rollback) is in `DEFECT-LEDGER.md` and `HANDOFF.md`.
