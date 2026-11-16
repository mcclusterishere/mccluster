# Work queue for the deep-audit branch

Branch `claude/new-session-83ken5`, merged into main through PR #793. This file is the resume point: anyone, or any later session, can read it and continue. It is updated in the same push as the work it describes. "Done" meant source and tests on this branch; the branch itself applied nothing to a database and deployed nothing.

## Status on 2026-11-16: closed

Nothing is in flight, and nothing exists only on a build machine.

- The owner merged this branch into main through PR #793 on 2026-11-10 at 22:38 UTC (merge `7e41f0b3`), after adding four commits on top of `9d296160`. The gates the merge depends on are in the PR description.
- The installation core (stages 1 to 3 and the `site` task module) is in `mcclusterishere/equity-uprise` main through that repository's PR #4 (`bdb7ce8`), together with the stage 3 records from `claude/installation-core-handoff` and the owner's three follow-up commits.
- COM-3 was built from `patches/pr-782-com3/BRIEF.md` as PR #796, which the owner merged into #782's branch on 2026-11-10. #782 itself is still a draft.
- The 15-minute checkpoint scheduled tasks are off.

What remains is the owner's: the decisions at the end of this file, the "Next step" column of the queue, and the state of each priority in `TRACEABILITY.md`.

## How the work was run

1. Iterative by the owner's direction (2026-11-10): at most one background workflow runs at a time, and nothing finished stays only on the build machine. A checkpoint every 15 minutes pushes what is committed here and pushes every new green commit of the product repository to its `claude/installation-core-m1` branch (the owner granted push access to `mcclusterishere/equity-uprise` on 2026-11-10; its `main` is never pushed). One item at a time is finished and pushed. A slice goes onto the branch as soon as its own tests and the three suites pass on the combined tree (Worker, Core, root), with the source validator.
2. Work happens in small steps that each end in a commit. A restart of the machine loses at most the step in flight.
3. Reviews follow as fix commits. Finished work is not held back waiting for them.
4. At most three small jobs run at once (the machine ran out of memory at higher load).
5. Never push another branch, never merge, never apply SQL, never deploy, never touch the OVH host.

## Resume from GitHub alone

Everything needed to finish is pushed. If the build machine is gone, another agent can pick up from these:

- **This repository**, main (PR #793 merged the branch). Read this file first, then:
  - `HANDOFF.md` (session 4 first);
  - `DEFECT-LEDGER.md`;
  - `TRACEABILITY.md`;
  - `patches/README.md`;
  - `supabase/pending/PROMOTION-ORDER.md`.

  CI is green on `7473dc06`: all 68 checks passed or were skipped by their own conditions (read 2026-11-10 20:10 UTC).
- **`mcclusterishere/equity-uprise`** (private product repository):

  | Branch | What it holds |
  | --- | --- |
  | `claude/installation-core-m1` | stage 3, complete at `b1f2723` (0.1.0-review.11): the first task module, `site`; merged into the product's main through its PR #4 (`bdb7ce8`) |
  | `claude/installation-core-m1-wip` | snapshots of uncommitted edits taken at each checkpoint; unverified, for recovery only |
  | `claude/installation-core-stage1`, `claude/installation-core-stage2` | the delivered stages |
  | `claude/composed-candidate-r1` | the repaired candidate |
  | `claude/installation-core-handoff` | `handoff/README.md` (where stage 3 stands and its open notes) and `handoff/stage3/` (the builders' brief, the frozen design, the two reviews, and the lane, repair, verification and follow-up reports) |

- **COM-3 (#782)**: built from `patches/pr-782-com3/BRIEF.md` as PR #796, merged into #782's branch on 2026-11-10. The
  series, its manifest, the two reviews and the evidence are in `patches/pr-782-com3/` on that branch (#796 head `6906aae1`).

Open items and the next step for each:

1. **Stage 3.** Done at `b1f2723` and merged into the product's main (PR #4). Its open notes, none blocking, are in
   `handoff/README.md`.
2. **COM-3.** Done in #796. #782 stays a draft: hosted checks on its exact head, the authorized SQL rollout and the
   owner's cutover decision come before any paid activation.
3. **Close-out.** Done. PR #793 merged on 2026-11-10, and the owner's P0 to P9 priorities are mapped to their state in
   `TRACEABILITY.md`. This session did not confirm CI on the merged head `6ce5ef7c`, which carries the owner's four commits.

Rules for whoever continues:
- `AGENTS.md` applies.
- Push only `claude/new-session-83ken5` here, and only `claude/*` branches in the product repository (never `main`,
  never force).
- No merge, no SQL applied to any real database, no deploy, no step on the OVH host.
- One background workflow at a time. Commit and push at every green step.
- No model names in any file.

## Queue

| # | Item | State | Next step |
| --- | --- | --- | --- |
| 1 | Member mission "Write a song for a healthier world" (League) | Done on the branch, then reviewed adversarially: 27 findings confirmed, 22 fixed with tests that fail before (one blocker, the majors, two deadlocks). Journey 1590, native 1591 on PostgreSQL 16 and 17, browser 274 and 235. | Owner or contract decisions: the begin-replay grant, the module-state disclosure order, re-hashing on `complete`, a recording on a hidden page, and the app bar on the member page (HANDOFF session 4). Applying the SQL and enabling the module are the owner's steps. |
| 2 | Third C5 gap (crash and operator recovery) | Done on the branch, with the review's surviving mutants killed, the late-success audit written before assets, and the close-out's race and route tests (claim-row lock, bind versus retry, the hint race, Core-signed generations through `entry.fetch`). Control's C5 line now reports the configured replay store. | Owner decisions: the lost-ERROR-webhook class (when a reservation may be released without the provider's ERROR), expiry of `core_signed_nonces` rows, and a retried delivery not re-saving assets after a failed save. |
| 3 | OVH evidence hardening and runbook | On the branch. All three reviews are done (the SSH setup script; the cycle receipts; the promotion workflow and runbooks), every finding fixed with a test that fails without it and each fix re-checked by an independent skeptic. The receipts and workflow reviews (rerun after a usage limit cut them off) found two blockers: a failed drift comparison was recorded as a verified cycle, so health reported a drifted host as verified (now a failed cycle at `drift_compare`); and the promotion's check reported success for a release that failed its deploy gate (now an observation that must see the target served for 20 minutes and says it is not acceptance). Also fixed: the runbook's way back is a forward promotion, not a forced ref move (the never-list forbids one); timer inference on systemd older than 252 reads the last elapse as a number over D-Bus; `last-success.json` is replaced by rename; a clock stepped back no longer hides a failing cycle; the stale window counts the timer's accuracy; Control's host tile and Needs you show a degraded or failing host; `activate` proves its own first cycle ran over SSH; and five runbook corrections. | Nothing on the branch. Every host step stays the owner's (runbook `OVH-510-CONTRACT-AND-AUTH-RUNBOOK.md`). |
| 4 | Buyer download retry | Done on the branch: a 4xx without the function's reason is an unknown outcome; the key is shared with a second tab; a limit answer just after a signing failure is not final; the key lifetime stays the server's longest answer window (checked against the applied SQL: shorter could cost a download). 18 page tests, 12 real-handler scenarios. | Nothing. The purchased-version title fix stays a separate patch (merging it deploys the function). |
| 5 | Native concurrency proofs for module policy and intake | Done on the branch: `scripts/test/eup-module-policy.native.integration.mjs` (96) and `scripts/test/eup-intake.native.integration.mjs` (33) on a disposable local server (`scripts/test/support/native-postgres.mjs`), green on PostgreSQL 16.15 and 17.7; seven SQL mutations each make them fail. The policy proof uses a guarded fixture table, so it does not depend on the League commands being rewritten. | Nothing. |
| 6 | Core follow-ups | Done on the branch: a lost lease stops ten executors before their next outward action (coding agent, push, pull request, preview build and publish, meeting join and chat, text message, public posts and comments, news pairs); the daily report is one row per window (pending unique index, not applied; the digest reads a racing run's row and leaves its text to that run). | Applying the index is the owner's, on its own, after the duplicate check (none on production today). |
| 7 | Findings that live on other PR heads (758, 760, 789, 787, 734, 782, 792, and the A7 decision) | Series under `docs/control-plane/deep-audit-20261109/patches/` with manifests and a README: #760 (A3, A4), #758 (W4), #789 (A6), #787 (W5) and #734 (C8), each checked to apply on its PR head; the W5 and C8 series were each re-run by an independent skeptic. | COM-3 (#782): done in #796 (persisted attempts, release only after a proven pre-session rejection, an audited owner queue), merged into #782's branch on 2026-11-10; A7 is the owner's decision; #792 needs a rebase. All three are listed in the README with their next step. Applying a series to its PR is that PR owner's step. |
| 8 | Reusable product: composed candidate and a small installation core | Candidate repaired as 0.1.0-review.5 (panel ownership across host nodes and module copies; PostgreSQL 17 provisioning): `npm run check` 394/394, PGlite control PASS, native PostgreSQL 17.7 acceptance PASS. Installation core stage 1 (configuration, independence guard, secret references, registry, installation-owned identity, operator CLI) at `635395d` (0.1.0-review.6) and stage 2 (reference host, effects ledger, backup and restore into a fresh database, two unrelated installations, operator runbook, and two review-and-repair rounds) at `e0be88a` (0.1.0-review.9): `npm run check` 522/522, PGlite 38/38. Now pushed to `mcclusterishere/equity-uprise` (the owner granted push access on 2026-11-10): `claude/composed-candidate-20261109`, `claude/composed-candidate-r1`, `claude/installation-core-stage1`, `claude/installation-core-stage2`. | Merged into the product's main through its PR #4 (`bdb7ce8`). Stage 3 is done at `b1f2723` (0.1.0-review.11) on `claude/installation-core-m1`: the first task module, `site` (a neutral site draft, preview, review, publish, rollback, unpublish and export, as one swappable module). Two adversarial reviews found 10 findings (3 major), all fixed with tests that fail before; an independent verification took each fix back out and saw its test fail (17 of 17); two follow-ups corrected the documents where that verification and its own check found them wrong (a findings count, the runbook's deploy and nginx block, a stale capacity figure, and whether systemd was installed) and proved two claims with native tests. `npm run check` 560/560 on Node 22 and 24 and inside an export; PGlite 77/77; native suites on PostgreSQL 16.15 and 17.7 (17.7 backups unproven: no `pg_dump` 17). Records on `claude/installation-core-handoff`. Owner: `independent_install_accepted` stays false until the owner accepts the edition; the runbook's open notes (`handoff/README.md`). |
| 9 | Close-out | Verification done: every ledger row checked by a verifier and an independent skeptic; 16 rows stood, the rest are rewritten and their code and test gaps fixed on this branch (C4's swallowed publication gate, A1's per-view state across accounts, W2's lost 409 text and dropped receipts, and tests that now bite for C5, C5-c, C6, C7, C7b, W3, COM-1, EQ1). | Done: P0 to P9 are mapped to their state in `TRACEABILITY.md`, and PR #793 merged on 2026-11-10. CI on the merged head was not confirmed by this session. |

## Owner decisions that do not block the queue

- Split PR 793 into separate pull requests, or keep one.
- First installed task for the product (default: one neutral site draft, preview, publish, export).
- Which mission workflow is canonical (the League is treated as the authority for League missions only; legacy records are untouched).
- Who runs import jobs and what scope each source covers.
- The venture launcher, billing normalization and native Swift and Android clients are not started: the owner's document leaves them to the owner's choices, and the native clients cannot be built in this environment.
