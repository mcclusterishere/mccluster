# McCluster program ledger — the 19 items

The running status of the program, in the canonical order. Update this table
in the same PR that changes an item's state, so a new session reads the
current position instead of rediscovering closed gaps. "Production" names
what was verified live, not what was merely merged.

Last updated 2026-10-05 against `main` after the Control workspace and security re-audit slices.

| # | Item | Status | Landed in | Production verification | Next action |
|---|---|---|---|---|---|
| 1 | Control plane | PARTIAL — top priority | #353, #355, #360, #365, #366, #367 (post-sale graph), #368 (workspace scoping, Home errors) | Worker deployed and route-smoked per slice; migrations verified (RLS forced, browser roles revoked) | Remaining: per-view inventory of staged capabilities; client-facing approval and payment-provider reconciliation stay staged |
| 2 | Resident-AI web grounding | COMPLETE | #363 | Signed broker calls, bounded queries, DDG fallback | — |
| 3 | FAL / paid-media input safety | COMPLETE | #362 | Whole-bakeoff preflight, strict input contract | Re-audit the FAL catalog (#269) on top of this contract |
| 4 | Create lifecycle races | COMPLETE | #349 | — | — |
| 5 | Analytics exact-window correctness | COMPLETE | #264 closed | 52/47 after fix | — |
| 6 | Pending production migrations | COMPLETE | #352 | Ledger matches production | Keep every new migration in the ledger + drift contract in its own PR |
| 7 | Owned meeting engine | PARTIAL — #154 open | code architecture in repo | Not yet live-proven | calendar → Core → OVH bot → Meet → local transcript → Qwen debrief → durable session, notes mode first |
| 8 | Security hardening | PARTIAL — current DB/Edge re-audit closed | #369, posture follow-up (per-function controls, `l3-login` ordering, `pay-now` retired) | `20261005082148` + `20261005082220` live; anon-callable definer findings 31→20, authenticated 100→88, mutable search-path findings 2→0; all 27 `verify_jwt=false` functions match `config.toml` | Remaining: enable leaked-password protection; owner: delete the `pay-now` deployment (retired in code, answers 410) and reconcile `music-publish-internal`; `v_track_signals` cold-cache timeout; plan `vector` / `pg_trgm` relocation; keep the two aggregate ranking views SELECT-only or replace them with invoker-safe projections; rotate long-lived credentials on a controlled schedule |
| 9 | ai_context.decisions canonicalization + transitions | COMPLETE | #353, #355 | Owner approve/reject live | — |
| 10 | Real observability events / traces | COMPLETE for Worker + Control; Core pending promotion | #365, #366 | `20261005071308` + `20261005074135` live; Worker `6e6eb95d` returns trace/request ids; owner-gated route answers 401 unauthenticated | Promote `deploy/ovh-production` so Core job / resident-AI / capability events start; later: OTel/Logpush ingestion into the same contract (`OBSERVABILITY.md`) |
| 11 | Aggregate media budget | COMPLETE | #355 | DB-boundary monthly cap | — |
| 12 | Publish retry / cancel | COMPLETE | #360 | — | — |
| 13 | Native Action Network | PARTIAL | Expo app + native player exist | — | Phase 1: shared session, native feed, groups, missions, Action Record, onboarding/deletion, deep links |
| 14 | Commercial / post-sale lifecycle | PARTIAL | post-sale slice | `20261005075808`…`20261005075956` live: work_relationships, work_projects, work_deliverables, work_renewals, work_payments (forced RLS, no browser grants) | Stripe/Square payment reconciler (sets `provider_verified`), client-facing deliverable approval, entitlement linkage, lead→relationship→booking→order→project automation |
| 15 | Operational intelligence | Gate 0 COMPLETE; Gate 1 IN PROGRESS | `OPERATIONAL-INTELLIGENCE-FINISH-LINE.md` | — | Continue Gates 1–9 without replacing source systems |
| 16 | Playable Equity Uprise building | PARTIAL | ~1,883 assets, ~1,330 connections, 40 labs | — | Stateful devices, room-visible traces, tactical visibility, LOD/streaming, deterministic multiplayer |
| 17 | Uprise World / Site 0 | LATER | `_unfinished/` | — | Deliberately lower priority; keep the Site 0 geometry/program mismatch for later resolution |
| 18 | VideoObject SEO | COMPLETE | #48 closed, #338 | — | Restore a VideoObject only with a primary first-publication record |
| 19 | Repo governance | OPEN — #132 | — | `main` reports protected: false | Owner/admin: protect `main` and `deploy/ovh-production`, required checks, block force-push/delete, restrict bypass, ancestor-only promotion, branch-ledger cleanup |
