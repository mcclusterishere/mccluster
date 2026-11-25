# Deployment controls: proposal for owner approval

Status: **partially implemented**, 2026-10-31. The owner authorized the five-step productization release. Pages, Edge Functions, and OVH promotion now require exact-commit CI unconditionally. Reconciliation CI runs on main and its six checks join the four existing deployment checks. The Cloudflare cutover and GitHub administration controls below still need verification. Historical proposal follows.

Original status: **proposal**, 2026-10-28. Source-side pinning and the gated paths are
in this repository; every production behaviour change below waits for an
owner action and is marked **OWNER**. Nothing here was changed in Cloudflare,
GitHub settings, OVH or Supabase.

Owner finding: *"Cloudflare still deploys through unpinned `npx wrangler deploy`
without waiting for CI. Adding checks isn't enough if production bypasses
them. Pin tooling and propose the required deployment controls."*

Machine-readable gate: `deploy-gate.json`. Enforcement test:
`scripts/test/deploy-controls.test.mjs` (runs in the always-on `contracts` job
and in `production-boundaries`).

## 1. Every production deploy path today

| Surface | Trigger | What runs | Waits for CI? | Credentials |
| --- | --- | --- | --- | --- |
| **Worker `mccluster`** (`api.mccluster.org`, `mccluster.org`, `humanuprise.com`) | **Cloudflare Workers Builds** (Git integration) on every push to `main` whose diff touches the watch path `workers/mccluster/**` | Root dir `workers/mccluster`, dependency install, `[build] command` (`scripts/worker-build-provenance.mjs`), dashboard deploy command `npx wrangler deploy` | **No.** Builds start on push, in parallel with GitHub Actions. Live evidence 2026-10-28: `api.mccluster.org/v1/health` serves `deployment_sha 092fb1cc…` with `deployment_ref "HEAD"`, the Workers Builds signature (the GitHub path stamps `DEPLOY_REF`). | Cloudflare-managed build token (dashboard) |
| Worker `mccluster`, observer | `deploy-mccluster-worker.yml` → `verify-git-deploy` on push to `main` (paths) | Source tests, then polls `/v1/health` until Cloudflare serves the SHA, live MCP contract, capability flags | Observes after the fact; cannot stop a deploy | none |
| Worker `mccluster`, manual fallback | `deploy-mccluster-worker.yml` → `deploy` on `workflow_dispatch` from `main` | Staged `versions upload` → `versions deploy` → verify → automatic rollback | Before this PR: its own source tests only | `production` Environment: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| **Worker `mccluster-mcp`** (`mcp.mccluster.org`) | `deploy-mccluster-mcp.yml`, `workflow_dispatch` only (bootstrap or guarded update) | Tests, dry run, staged upload/promote, live contract, rollback | Before this PR: its own tests only | `production` Environment: Cloudflare token/account; bootstrap also Supabase service role, Core broker token and edge signing key |
| Worker routes/domains/crons | `reconcile-worker-triggers.yml`, `workflow_dispatch`, plan or apply with a reviewed digest | `scripts/worker-triggers.py` → `wrangler triggers deploy` | Human-reviewed digest | `production` Environment: Cloudflare token |
| **GitHub Pages** (`matthew.mccluster.org`) | `deploy-pages.yml` on **every push to `main`** (no path filter) and dispatch | Sitemap, `__STAMP__`, Site 0, Equity Uprise GLB builds, strip internals, **`git push --force` to `gh-pages`**; `verify-live` reports after | **No.** Publishes in parallel with CI | `GITHUB_TOKEN` with `contents: write` |
| Cloudflare Pages `mccluster-web` (staged, not live) | Manual on a controlled release runner | `scripts/deploy-cloudflare-pages.sh` with `WRANGLER_BIN` | Manual; GitHub Actions never uploads (`CLOUDFLARE-PAGES-DIRECT-UPLOAD.md`) | Pages-scoped Cloudflare token on the runner |
| **OVH McCluster Core** | `promote-ovh-production.yml` (dispatch, `PROMOTE_OVH`) moves `deploy/ovh-production` to a SHA in `main` after `core` check/test; the VPS timer `mccluster-vps-reconcile.sh` pulls it; `deploy-ovh-core.yml` verifies on push to the ref | Rollback-safe `scripts/deploy-ovh-core.sh` on the host | Requires the SHA be in `main` and passes Core's own tests; **does not require the SHA's CI to be green** | `GITHUB_TOKEN contents: write` for the ref; the VPS fetches anonymously |
| OVH Core, break-glass | `deploy-ovh-core.yml` dispatch (`DEPLOY_OVH`), `bootstrap-ovh-*.yml` | SSH + rsync of an exact `main` commit | Core tests only | `ovh-production` Environment: `OVH_SSH_KEY`, `OVH_KNOWN_HOSTS`, host/user/port |
| **Supabase migrations + Edge Functions** | **Supabase GitHub integration** (dashboard) on push to `main` | Applies `supabase/migrations`, deploys functions | **No** | Supabase-managed |
| Supabase Edge Functions, fallback | `supabase-functions-deploy.yml` on push to `main` (paths) and dispatch | Waits for the integration's verdict, then `supabase functions deploy` (CLI pinned 2.117.0) and proves each live | Waits for the integration, **not for CI** | `SUPABASE_ACCESS_TOKEN` (repository secret) |

Repository state read on 2026-10-28: `main`, `deploy/ovh-production` and
`gh-pages` all report `protected: false`; the repository has **no rulesets**
and **no tags** (issue #132 still open). `deploy/ovh-production` is at
`da5a44ad`, an ancestor of `main`.

## 2. The gap

A commit reaches production on three independent rails (Cloudflare Workers
Builds, GitHub Pages, the Supabase integration) at the moment it lands on
`main`, while the checks that judge it are still running. Nothing requires a
pull request, so a direct push to `main` reaches all three without any check
at all. A red CI run afterwards only reports that production already serves a
commit that failed. OVH is better (manual promotion of a commit in `main`),
but the promotion does not look at that commit's CI either.

Before this PR the tooling was also mutable: `wrangler` was not in
`workers/mccluster/package.json`, so Workers Builds' `npx wrangler deploy`
resolved whatever the registry served; Workers Builds used its floating
default Node; the GitHub paths downloaded `wrangler@4.131.1` with
`npx --yes` at deploy time instead of the lockfile, and ran Node `'22'`
(floating minor); the GitHub Pages build ran on the runner image's Node.

## 3. Fixed in source by this PR (no setting needed)

1. **Wrangler pinned in the lockfile.** `wrangler` `4.131.1` is an exact
   `devDependency` of `workers/mccluster`, with integrity in
   `package-lock.json`. Workers Builds uses the Wrangler in `package.json`, so
   Cloudflare's own `npx wrangler deploy` now runs this locked version.
2. **Every workflow runs the locked binary.** `npm ci` first, then
   `npx --no-install wrangler` (Worker) or
   `npm exec --prefix ../mccluster --no -- wrangler` (MCP transport, CI
   compile, workerd contract). `scripts/worker-triggers.py` does the same.
   `--no-install`/`--no` fail instead of downloading.
3. **Node pinned once.** `workers/mccluster/.node-version` = `24.22.1`, the
   Workers Builds default production was already building with, so this
   freezes rather than changes Cloudflare's build. Workers Builds reads the
   file from the root directory; every deploy-path workflow
   (`deploy-mccluster-worker`, `deploy-mccluster-mcp`, `deploy-pages`,
   `mcp-continuity-ci`, `reconcile-worker-triggers`,
   `supabase-functions-deploy`) uses `node-version-file` on it.
4. **Actions pinned by SHA**: already true for every workflow; now also
   asserted by the test.
5. **The manual Worker and MCP deploys wait for green CI** on their exact SHA
   (`scripts/require-green-ci.mjs` with `deploy-gate.json`). These are already
   human-dispatched paths, so this tightens them without touching the
   automatic rails.
6. **The Cloudflare Git observer reports the gap.** `verify-git-deploy` now
   ends by requiring the gate checks green on the SHA Cloudflare is serving:
   the run goes red when production is serving a commit CI failed.
7. **Regression test.** `scripts/test/deploy-controls.test.mjs` fails if
   Wrangler stops being an exact locked pin, if any workflow or deploy script
   names `wrangler@…` or runs an `npx` that may download, if a deploy path
   floats Node, if an action is not SHA-pinned, if a gate check would not run
   on every `main` push, or if the gated paths lose their wiring.

### The CI gate

`deploy-gate.json` names the checks a deploy waits for **on the exact commit
it ships**: `architecture`, `contracts`, `scan`, `smoke`. They are the checks
that run on every push to `main` with no path filter, so the gate can never
wait on a check that will not run. `require-green-ci.mjs` polls the commit's
check runs (newest run per name decides), passes only when all are
`success`, fails on any other conclusion, and fails at the timeout (45 min)
when any is missing.

## 4. Built but inert until the owner opts in

| Switch (repository variable) | Effect when set | Why it is off |
| --- | --- | --- |
| `WORKER_DEPLOY_MODE=github-gated` | `deploy-mccluster-worker.yml` deploys Worker `mccluster` itself on `workflow_run` of **MCP Continuity and Preview** succeeding on a `main` push, only if that SHA is still the tip of `main`, only after every gate check is green, through the `production` Environment, with the existing staged upload → promote → verify → automatic rollback. The Cloudflare Git observer stands down. | Requires Cloudflare Workers Builds auto-deploy to be off first, or both would deploy. |
| `DEPLOY_REQUIRE_GREEN_CI=true` | `deploy-pages.yml` publishes `gh-pages` and `supabase-functions-deploy.yml` deploys functions only after the gate checks are green on the exact SHA. | Changes when the public site and functions publish (later by the CI duration, never on red). Owner's call. |

## 5. Controls for owner approval

Each item says where the setting lives. All are **OWNER** actions: this
session has no administration access and did not change any of them.

### A. Ruleset on `main` (issue #132) — OWNER

GitHub → `mcclusterishere/mccluster` → Settings → Rules → Rulesets → New
branch ruleset.

- Name `main`; Enforcement **Active**; Target: Include default branch.
- Bypass list: repository admin only, mode "For pull requests only" (keeps an
  emergency path visible in PR history).
- Restrict deletions; Block force pushes.
- Require a pull request before merging (0 approvals is acceptable for a
  solo owner; the value is that checks run before the merge commit exists).
- Require status checks to pass; Require branches to be up to date. Add the
  checks that run on **every** pull request into `main`:
  `architecture`, `contracts`, `scan`, `smoke`,
  `Validate authority, program, plans, and building`, `Worker contracts`,
  `McCluster Core contracts`, `Supabase migration reset`,
  `Equity Uprise Edge Function contracts`,
  `Admin evidence and pending SQL contracts`,
  `Equity Uprise RLS wall and offline function contracts`.
  Do **not** add path-filtered checks (`production-boundaries`,
  `drift-contract`, `Worker security boundaries`, analytics, music,
  communications): a required check that does not run on a PR blocks it
  forever. Making those always-on is a follow-up in source.

### B. Ruleset on `deploy/ovh-production` — OWNER

Same page, new branch ruleset targeting `refs/heads/deploy/ovh-production`:
Restrict deletions; Block force pushes; Restrict updates with bypass for
the GitHub Actions app (so `promote-ovh-production.yml` can move it) and the
admin. Enable **Require status checks** with the same always-on list as A so
the ref cannot point at a commit CI has not passed. Note that
`promote-ovh-production.yml` with `allow_rollback=true` uses
`--force-with-lease`; with force pushes blocked, a rollback becomes a
forward promotion of the older green SHA by an admin bypass.

### C. Disconnect Cloudflare Git auto-deploy for `mccluster`, gate through GitHub — OWNER

Order matters; do it in one sitting.

1. Cloudflare dashboard → Workers & Pages → `mccluster` → Settings → Build.
   Either **Disconnect** the repository, or (keeps build logs and version
   previews) change **Deploy command** from `npx wrangler deploy` to
   `npx --no-install wrangler versions upload`, which builds and stores a
   version per commit without serving it.
2. GitHub → Settings → Secrets and variables → Actions → Variables → New
   repository variable `WORKER_DEPLOY_MODE` = `github-gated`.
3. GitHub → Settings → Environments → `production`: confirm
   `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit for the account) and
   `CLOUDFLARE_ACCOUNT_ID` exist.
4. Merge any small Worker change; watch `deploy-mccluster-worker.yml` run on
   `workflow_run`, wait for the gate, upload, promote and verify.

Rollback of C: delete the variable and restore the dashboard deploy command.

Note: in gated mode the workflow deploys every CI-green tip of `main`, not only
commits that touch the Worker (it re-uploads unchanged code with a new
provenance stamp). That is harmless, but with D's required reviewer each
merge asks for one approval; narrowing it to Worker-touching commits is a
small follow-up.

If the owner keeps Workers Builds deploying instead, the minimum is: set the
dashboard **Deploy command** to `npx --no-install wrangler deploy` (fail
rather than download), and accept that production does not wait for CI.
Cloudflare has no "build only after GitHub checks pass" setting for Workers
Builds; the gated workflow is the way to get that.

### D. GitHub Environments with required reviewers — OWNER

Settings → Environments:

- `production` (used by both Worker deploys and trigger reconciliation):
  Required reviewers = the owner; Deployment branches and tags = **Selected
  branches: `main`**; optional wait timer 0. With C enabled, each gated Worker
  deploy then pauses for one approval after CI is green.
- `ovh-production` (break-glass SSH and bootstraps): Required reviewers = the
  owner; Deployment branches = `main`.
- New `pages` and `supabase` Environments are optional; adding
  `environment:` to `deploy-pages.yml` / `supabase-functions-deploy.yml` is a
  one-line source change once the owner wants approvals there too.

### E. OVH promotion only from a green SHA — source change on approval

`promote-ovh-production.yml` already requires the SHA be in `main` and pass
Core's tests. Proposal: add
`node scripts/require-green-ci.mjs --sha "$TARGET_SHA"` (with
`checks: read`) before the push. Not done in this PR because it changes the
behaviour of a live promotion path; it is a two-line change on approval. Rule
B gives the same guarantee from the settings side.

### F. Supabase integration — OWNER

Supabase dashboard → project `zmnhbrjyhxzhkxmhkexs` → Project Settings →
Integrations → GitHub. The integration deploys on push to `main` without
waiting for CI. Options: keep it (rule A then ensures only PR-checked commits
reach `main`), or turn off **Deploy to production** and let the CLI workflow,
gated by `DEPLOY_REQUIRE_GREEN_CI=true`, deploy functions. Migrations would
then need a gated `supabase db push` workflow, which is not built here.

### G. Rollback by tag — OWNER approves, source follows

Today there are no tags. Proposal:

- After each verified production deploy, tag the exact SHA
  `prod/worker/<UTC timestamp>` (and `prod/ovh/…`, `prod/pages/…`). The tag
  push needs `contents: write` in the deploy job; protect `prod/*` with a tag
  ruleset (Settings → Rules → Rulesets → New tag ruleset: restrict deletions
  and updates, bypass GitHub Actions).
- Worker rollback: `wrangler versions deploy <version-id>@100` from the
  `deployments list` record (already automatic on a failed verification), or
  re-dispatch `deploy-mccluster-worker.yml` from the tag's SHA once `main`
  is reverted.
- OVH rollback: `promote-ovh-production.yml` with the tagged SHA and
  `allow_rollback=true`.
- Pages rollback: revert on `main` (Pages republishes) or force `gh-pages` to
  the previous publish commit.

## 6. Remaining gaps not fixed here

- `deploy-pages.yml` installs `numpy scipy trimesh` without versions; pinning
  them changes the generated GLBs and needs its own reviewed change.
- OVH Core builds with the host's Node (`core/package.json` engines `>=20`);
  pinning it belongs in the host bootstrap.
- `docs/control-plane/MCP-CONTINUITY.md` and `MCP-RELEASE-2026-09-16.md` show
  operator commands with `npx wrangler@4.131.1`; they are manual, version-pinned
  and historical, and are left as written.
