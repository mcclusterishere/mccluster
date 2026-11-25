# Equity Uprise: reusable product composition and pinned consumer contract

Date: 2026-11-09. Written on branch `claude/new-session-83ken5` from main `578e683088fdd49fb77848733e70dd4f3af039c3`. This is the composition plan the deep audit asked for, plus the state of the McCluster consumer after this branch. It is not a statement that the independent product is installable.

## Revisions that exist and how they relate

| Revision | Where | What it is | Composed? |
| --- | --- | --- | --- |
| Remote private #2 `4ad69a35…` (tree `4b8545a4…`) | `mcclusterishere/Equity-Uprise` | Initial environmental UI/server extraction: installation config, confined transport, panel/pin adapters, installation-owned identity/policy/repository/provider/response adapters. | Base of both local follow-ons via local stage-2 snapshot `5880179…`. |
| Local control follow-on `1c76d641…` | packet `local-source-review/portable-control-followon.patch` (base `5880179…`, excludes `AGENTS.md`) | Portable PostgreSQL control schema, trusted installer/owner verification, restricted runtime grants, owner commands with revision/idempotency, enabled → draining → disabled, same-transaction guarded writes. 46/46 locally; native PostgreSQL 17.7 lock/drain/CAS and PGlite restore passed in the audit. | **No.** Not referenced by the consumer. |
| Local mission follow-on `645d68a…` | packet `local-source-review/portable-mission-followon.patch` (base `5880179…`) | Saved assignments through feed outages, stale-identity clearing, revision-bound proof decisions, explicit proof-sharing consent, reviewed news provenance, deterministic sponsor candidates/drafts. 60/60 locally. | Pinned by the consumer. |
| Local McCluster consumer `95a133b…` | packet `local-source-review/mccluster-environment-consumer.patch` (base `942c37fc…`, an ancestor of main) | E=Up tab on the existing World globe, `vendor/equity-uprise` pinned copy of the mission follow-on with hash lock, Worker routes, pending SQL, PGlite scripts, e2e fixtures. | **Applied on this branch** as review material with EQ1/EQ2/EQ4 repaired locally (see `DEFECT-LEDGER.md`). |
| Original environmental source `b5a7fb13…` | local only | Provenance of the extraction; not in the packet. | Reference only. |

The two local follow-ons diverge from the same base and have never been merged with each other. Their test counts (46 and 60) are not additive and are not a composed candidate's result.

## What this branch did and did not do

Done here, in `mcclusterishere/mccluster` only:

- Applied the consumer patch so the environmental journey (source-labelled issue → mission → saved assignment → proof → revision-bound review → exact-consent sharing) exists on the existing globe behind the World mode bar, with the owner-supplied E=Up artwork and the shared Cesium frame. Pending SQL under `supabase/pending/` is not applied anywhere.
- Repaired, inside the vendored copy, the three product defects the audit reproduced: EQ1 (A's confirmed team action could fire with B's bearer after unmount), EQ2 (an old panel's second destroy cleared a newer mount), EQ4 (browser fixtures violated the pinned `ok:true` envelope). The fixes are recorded in `vendor/equity-uprise/product-source.lock.json` as local patches against upstream `645d68a…`; the lock does not claim upstream changed.

Not done, and not claimable:

- No write to the private `Equity-Uprise` repository. This session's GitHub access is scoped to `mcclusterishere/mccluster`, so the EQ1/EQ2 fixes still have to be upstreamed there (the exact design is in `audit-details/equity-product-audit.md`, Defects 1–2, and the vendored diff on this branch is the reference implementation).
- No composition of the control follow-on with the mission follow-on. The consumer still uses a constant-enabled policy and independent REST writes; `withEnabledModule`'s transaction lock is not on the path of any McCluster domain write or job.
- No independent installation, upgrade, backup/restore, or two-install isolation proof.

## Composition order (the actual next engineering work)

1. **One composed product candidate in `Equity-Uprise`.** Start from remote #2, apply the mission follow-on, then the control follow-on, resolving `src/environment/panel.mjs` and `transport.mjs` by taking the mission versions plus this branch's EQ1/EQ2 guard (identity + lifecycle epoch captured for every mutation, rechecked after the transport's last credential step and before fetch; idempotent, owner-checked destroy). Keep both local branches as history; record provenance (`PATCH_PROVENANCE.json` hashes) in the candidate's lock.
2. **Make the guard a transport contract, not a parameter.** `createEnvironmentTransport` refuses a mutation without `{identity, epoch, isCurrent}`; the panel supplies them for team join/leave, mission join, approve/pause/close, proof submit/share/review, planning. Integrated panel + real-transport tests must assert zero fetches after A→B switch, sign-out, destroy and cancel.
3. **Put domain writes under module policy transactionally.** In the McCluster consumer, route team/mission/proof mutations and the environment jobs through one canonical Supabase RPC that takes the control policy share lock in the same transaction (`guard_enabled` semantics from `database/control/001-baseline.sql`), so draining actually waits for in-flight domain writes and refuses new ones. REST on a second connection is not inside that lock; do not fake it with a client flag.
4. **Owner controls.** Expose enable/drain/disable, revision, last command, and recovery for the environment module through the existing Control destinations (shared bottom navigator, no new menus), authorised by canonical house ownership (`mnet_is_admin()`), with the disabled-house boundary resolved by the A7 decision.
5. **Clean-install baseline.** Schema-only baseline separated from historical repair/seed SQL; fresh authenticated owner bootstrap; explicit supported runtime/provider versions; no fallback to any McCluster production identity, database, Stripe account, OAuth app, mail, storage, telemetry or API origin. `src/environment/module.json` keeps `independent_install_accepted:false` until the proofs below exist.
6. **Proofs before the word "productized".** Two synthetic installations with blocked production access, role/RLS/storage isolation, complete supported journeys, N-1 → N upgrade preserving data/customisation/entitlements, interrupted-upgrade recovery, native `pg_dump`/`pg_restore`, drain under real work, removal semantics, and a new operator installing from the documentation without agent database repairs.

## Pinned product/consumer contract (what the consumer may rely on)

- Installation config is immutable, public, credential-free, HTTPS-only, with no default production backend.
- Transport: exact route/verb allowlist, no caller headers, cookies omitted, redirects refused, no automatic mutation retry, every private success envelope carries `ok:true`, every mutation carries initiating identity and lifecycle epoch and is dropped when either changes.
- Server: installation-owned identity and literal owner authorisation, policy/installation mismatch rejected, bounded bodies, `no-store`, public mission projection, known error codes redacted.
- Evidence: source attribution, observation time, retrieval time, geometry/coverage limits, freshness after I/O, provider health; absent coverage is labelled absent.
- Proof and sharing are separate decisions bound to exact revisions; precise location and private application evidence stay private by default.
- Live watching, funding and automatic sponsor outreach are unavailable and labelled so; a deterministic sponsor draft is not an outreach.

## Verification ledger for this branch's environmental slice

See `HANDOFF.md` → "Environment consumer" for the exact commands, counts and NOT RUN items recorded in this session.
