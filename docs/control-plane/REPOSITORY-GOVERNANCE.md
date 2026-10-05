# Repository Governance and Branch Lifecycle

**Canonical repository:** `mcclusterishere/mccluster`  
**Canonical development branch:** `main`  
**Production promotion ref:** `deploy/ovh-production`

This document defines repository hygiene around the architecture rules in
`CANONICAL-ARCHITECTURE.md`. Branch history is evidence; it is not a second
architecture authority.

## Invariants

1. Product work starts from current `main`.
2. Production code reaches OVH only from a commit contained in `main` and promoted through `deploy/ovh-production`.
3. A stale donor branch is mined for the smallest useful concept and then reimplemented on a fresh current-main branch.
4. Merged working branches are disposable.
5. Historical evidence is retained only when it is deliberately named as evidence: `archive/*`, `backup/*`, `checkpoint/*`, or a branch listed in `canonical-architecture.json.superseded_branches`.
6. Open PR branches are never garbage-collected.
7. Branch cleanup may delete a branch only when its current head is proven contained in `main` or exactly matches the head of a merged PR.

## Automated lifecycle

`.github/workflows/branch-gc.yml` enforces two cleanup paths:

- when a same-repository PR merges, its head branch is deleted unless it is explicitly retained evidence;
- weekly/manual sweeps remove branches that are no longer open work and are provably absorbed by `main`.

Manual runs default to dry-run. Scheduled sweeps execute the same conservative proof rules.

This workflow is a fallback for repository hygiene. The GitHub repository setting
**Automatically delete head branches** should also be enabled by an administrator.

## Required GitHub rules

These settings require repository-administration authority and are intentionally
not simulated in source code.

### `main`

Create an active branch ruleset that:

- requires a pull request before merge;
- requires the branch to be current with `main` before merge;
- blocks force pushes;
- blocks deletion;
- limits bypass to emergency administrators;
- requires the contract checks that define the current architecture boundary.

Current contract checks include:

- `architecture`
- `production-boundaries`
- `drift-contract`
- `contracts`
- `McCluster Core contracts`
- `Supabase migration reset`
- `Worker contracts`
- `Worker security boundaries`
- applicable analytics, social, communications, music, and Equity Uprise contract jobs.

When check names change, update the ruleset deliberately rather than weakening the gate.

### `deploy/ovh-production`

Create an active branch ruleset that:

- blocks deletion;
- blocks ordinary force pushes;
- restricts updates to the approved promotion path/emergency administrators;
- never permits a production target outside canonical `main`.

The source workflow `.github/workflows/promote-ovh-production.yml` independently
verifies that the target exists in `main`, validates Core, and prevents an
unintentional rollback. Branch protection is defense in depth, not a substitute
for that provenance check.

## Deployment-ref recovery

If `deploy/ovh-production` ever diverges from `main`:

1. stop routine promotions;
2. audit every deploy-only commit for functionality not represented on current `main`;
3. re-port any unique required behavior to a fresh branch from current `main`;
4. require the normal current-main contract suite to pass;
5. move `deploy/ovh-production` to the verified canonical commit using a force-with-lease;
6. verify the OVH self-reconciliation workflow converges to that exact SHA.

Do not merge the deployment branch back into `main` merely to make the graph look clean.

## Stale PR cleanup

For a heavily diverged PR:

- **harvest** if it still contains a unique useful capability;
- **close as absorbed/superseded** if current `main` already contains the value;
- **retain as evidence** only when the architecture manifest deliberately says so.

Never resolve hundreds of commits of drift by merging the old branch wholesale.

## Audit snapshot — 2026-10-05

Before this governance repair the repository had 390 branches, eight old open PRs,
no rulesets, and both `main` and `deploy/ovh-production` reported
`protected: false`. The deployment ref also contained a 14-commit fork from
September 27 while current `main` had advanced by roughly 1,500 commits.

The deploy-only resident-AI and machine-root behavior was verified to already
exist on current `main`, so the deployment ref was canonicalized to the exact
verified `main` SHA instead of merging the stale production history back into
the product branch.

Issue #132 remains open until GitHub reports active protection/rulesets for both
critical branches.
