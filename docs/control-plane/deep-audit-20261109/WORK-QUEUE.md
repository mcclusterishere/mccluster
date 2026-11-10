# Work queue for the deep-audit branch

Branch `claude/new-session-83ken5` (draft PR 793). This file is the resume point: anyone, or any later session, can read it and continue. It is updated in the same push as the work it describes. "Done" means source and tests on this branch; nothing here is merged, applied to a database or deployed.

## How the remaining work is run

1. One item at a time is finished and pushed. A slice goes onto the branch as soon as its own tests and the three suites pass on the combined tree (Worker, Core, root), with the source validator.
2. Work happens in small steps that each end in a commit. A restart of the machine loses at most the step in flight.
3. Reviews follow as fix commits. Finished work is not held back waiting for them.
4. At most three small jobs run at once (the machine ran out of memory at higher load).
5. Never push another branch, never merge, never apply SQL, never deploy, never touch the OVH host.

## Queue

| # | Item | State | Next step |
| --- | --- | --- | --- |
| 1 | Member mission "Write a song for a healthier world" (League) | In progress in a side worktree. Wire contract frozen; media module written; SQL rewrite has its first checkpoint (schema, helpers, owner command). | Member command, seal and consents in SQL; owner-control SQL and native concurrency tests; Worker owner and member routes; end-to-end journey on real SQL and real Worker code; member page `action/league.html`; Control League tab. Push each stage when green. |
| 2 | Third C5 gap (crash and operator recovery) | On the branch. Authorization and reservation reviews done; every major and minor finding fixed with tests. SQL-rollout and regression reviews were cut off by a usage limit. | Optional: four extra tests for mutation survivors the reservation review listed; write the audit row before saving assets on a late success. |
| 3 | OVH evidence hardening and runbook | On the branch. SSH-script review done and every finding fixed with tests (`activate` undoes a failed switch; pinned host key compared by bytes; proofs independent of the caller's directory and environment; `status` counts only cycles since the current activation; exit codes documented). The receipts and workflow/runbook reviews were cut off by a usage limit. | Optional: rerun those two reviews. Every host step stays the owner's. |
| 4 | Buyer download retry | On the branch. Three edge cases known. | Treat a 4xx without the function's reason as unknown; honest key lifetime and wording; keep the key where a new tab finds it. The purchased-version title fix stays a separate patch (merging it deploys the function). |
| 5 | Native concurrency proofs for module policy and intake | Run from scratch scripts on PostgreSQL 16 (104 and 33 assertions). | Commit them as repository tests, runnable on PostgreSQL 16 and 17. |
| 6 | Core follow-ups | Open. | Executors stop before the next provider side effect when the lease is lost; uniqueness for daily digest windows. |
| 7 | Findings that live on other PR heads (758, 760, 789, 787, 734, 782, 792, and the A7 decision) | Verified patch series exist for 758 and 760; 789 half done; the rest not started. | Finish each lane and add the patch series under `docs/control-plane/deep-audit-20261109/patches/` with a README. This branch cannot push to those PRs. |
| 8 | Reusable product: composed candidate and a small installation core | Candidate passes its own 352 tests locally; one review finding open (native PostgreSQL 17 acceptance). No push permission for that repository. | Repair the candidate; build the installation core first (fresh ownership, two unrelated installs, isolation, backup and restore) with one small task; deliver as a git bundle. |
| 9 | Close-out | Open. | Trace the 27 findings and the owner's P0 to P9 list to their state; refresh the capability matrix and the PR description; confirm CI on the final head. |

## Owner decisions that do not block the queue

- Split PR 793 into separate pull requests, or keep one.
- First installed task for the product (default: one neutral site draft, preview, publish, export).
- Which mission workflow is canonical (the League is treated as the authority for League missions only; legacy records are untouched).
- Who runs import jobs and what scope each source covers.
- The venture launcher, billing normalization and native Swift and Android clients are not started: the owner's document leaves them to the owner's choices, and the native clients cannot be built in this environment.
