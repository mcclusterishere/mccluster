# Remote MCP continuity

The Core MCP bridge shipped, Claude connected to it, and a later Worker
deployment removed it. Nothing failed loudly: the deploy was green, `/healthz`
was 200, and the only symptom was a `404` where a connector used to be.

This document is the contract that makes that specific outage impossible, and
the implementation for making the MCP surface independent of unrelated Worker work. See `MCP-RELEASE-2026-09-16.md` for the current verification and activation boundaries.

## What happened

| Fact | Evidence |
| --- | --- |
| `main` never carried the bridge | `workers/mccluster/src/entry.js` on `main` has no `core/mcp.js` import and no `/v1/core/mcp` route |
| The bridge lived only on a feature branch | `selfhost/sovereign-media-fabric-v1` carried `src/core/mcp.js`, `src/core/oauth-resource.js`, the routes and `CORE_BROKER_URL` |
| Any Worker change redeploys production | `.github/workflows/deploy-mccluster-worker.yml` triggers on `workers/mccluster/**` |
| So a routine media/social/site change overwrote an MCP-capable Worker | a build from `main` has no MCP route to serve |
| `CORE_BROKER_URL` was missing from canonical vars | `wrangler deploy` uploads `[vars]`; without it the route fails closed at 503 |

A `404` is the worst possible symptom here. It tells an MCP client the server
does not exist, so the client stops. A `401` with an OAuth challenge tells it
where to authenticate, so it recovers by itself. **Every check in this document
treats "404 on `/v1/core/mcp`" as the outage signature.**

## The guarantees now in source

### Pre-deploy: the surface cannot leave the tree

`workers/mccluster/test/core-mcp-continuity.test.mjs` fails on any source tree
that has lost the MCP or OAuth surface, and the deploy workflow runs it
**before** the deploy step. It pins:

- the `handleCoreMcp` / `coreOAuthChallenge` / `coreOAuthMetadataResponse` imports
- the `/v1/core/mcp`, `/v1/core` and `/.well-known/oauth-protected-resource` routes
- the 401-returns-an-OAuth-challenge path, by name
- protocol `2025-11-25`, asserted against a live `initialize` call
- the house-owner gate, HMAC signing headers and replay nonce
- the remote allowlist, including `core.resume` and `media.job.get`
- raw provider-tool filtering (`restrictToolList`)
- `CORE_BROKER_URL` present in `[vars]`, and the two credentials absent from it
- that the workflow order is guard → upload → promote → verify
- that a failed verification rolls production back
- that `DEPLOY_SHA` is stamped on the uploaded version

Verified by deliberately reintroducing the regression: stripping the imports and
routes from `entry.js` fails 3 of the 15 guard tests. Restoring passes 15/15.

### Post-deploy: the surface is actually being served

`scripts/mcp-contract-check.mjs` runs against the live edge and fails the
deployment on any of:

1. `GET /.well-known/oauth-protected-resource` is not 200 with an authorization server
2. `POST initialize` is not 200, or does not negotiate `2025-11-25`
3. unauthenticated `POST tools/list` is **404**, or is not 401 with a `Bearer ... resource_metadata=` challenge
4. `/healthz` `deployment_sha` is not an exact 40-character SHA — `unknown` fails

Check 4 matters more than it looks. The workflow stamps `DEPLOY_SHA` on the
uploaded version, so **production reporting `unknown` cannot be attributed to an exact source
commit**. Provider deployment history is required to determine which path last
deployed it. See *Making GitHub Actions
the only deploy path* below; until that is applied, check 4 is the tripwire.

## Implemented: isolated MCP transport (activation pending)

The root cause is coupling: the MCP surface rides in the same Worker as media,
social, site and platform routes, so unrelated work can evict it. The guard
above closes the hole; separation removes it.

**Target.** A second Worker, `mccluster-mcp`, serving `mcp.mccluster.org`, whose
source is `workers/mccluster-mcp` and whose deploy workflow triggers only on
that path. Media and site deployments then cannot touch it, because they do not
build it.

This does **not** violate the one-Worker rule in `AGENTS.md`. That rule exists to
stop a second *control plane* — a parallel backend with its own auth, data and
orchestration. `mccluster-mcp` is a transport edge for the same Core, the same
Supabase authority and the same capability catalog. It owns no state. The
forbidden name remains `mccluster-core`.

**Migration, in order:**

1. Merge the tested continuity change; until then the bridge is implemented on the release branch, not on `main`.
2. The extraction now lives in `workers/mccluster-mcp`, with its own configuration, tests, and path-filtered deployment workflow. The old module paths re-export the shared implementation.
3. Point `mcp.mccluster.org` at it. Run both surfaces in parallel.
4. Keep `api.mccluster.org/v1/core/mcp` as a compatibility route that proxies to
   the new service, so no connected client has to be reconfigured.
5. Retire the compatibility route only once no client uses it — and the
   OAuth `resource` value must be migrated deliberately, because it is the
   identifier clients have already authorized against.

## The transport stays stateless

No conversational or job state may live only in an MCP transport session.

Every call carries what it needs; anything durable is in Supabase. A dropped
connection, a redeploy, or a client reconnecting from a different machine must
lose nothing but the socket. This is what allows the compatibility proxy above
to exist at all, and what makes the rehydration call below sufficient.

Concretely: `initialize` establishes no server-side session, `tools/list` is
derived from the catalog on each call, and `tools/call` results are recorded as
McCluster jobs — not held in transport memory.

## `core.resume` — rehydration after context loss

A model's context window is not durable state. When it rolls, the session
should ask the system what it was doing rather than re-derive it or ask the
owner.

`core.resume` (capability `core.resume`, risk `read`, approval `none`, exposed
on the remote allowlist) returns in one call:

- `sources` and `degraded_sources` — per-source health, read first
- workspace identity — org, control repository, edge, Supabase project ref
- runtime — Core commit, deploy ref, deployed-at, host, worker id
- catalog — catalog version, capability and binding counts
- work — active jobs, **stale running jobs reported separately**, queued jobs, recent failures, objectives
- pending approvals — what a human owes the system
- health — system contract version and recent signals
- a `next_step_hint` leading with approvals, then stale leases, then failures

Three deliberate choices.

It is **read-only**: a session that has just lost its memory is the worst
possible moment to take an action.

**Unavailable is never empty.** Each source reports `ok`, `missing`,
`unavailable`, `invalid` or `partial`, and an unavailable collection is `null`
— never `[]`. An earlier cut degraded a failed read to an empty array, so an
unreadable approvals table rendered as "zero approvals pending", which is the
most dangerous possible lie to tell a session about to act. `next_step_hint`
leads with *"Approval state unavailable — do not assume nothing is pending"*
whenever that read fails.

That guarantee only holds if the inner reads do not swallow their own
failures first, which is a separate bug class and was present:

- `ops_signals` was caught into `[]`, so a broken signal feed read as "the
  system has raised nothing" — inside the section whose job is to report
  health. Health now carries `health.sources.system_contract` and
  `health.sources.signals` independently, so one can be `ok` while the other
  is `unavailable`, and the section rolls up to `partial`.
- the deploy manifest collapsed missing, unreadable and corrupt into one
  `null`. A corrupt manifest is a broken host; an absent one is a host that
  has never deployed. They are now `invalid` and `missing` respectively.
- the capability catalog had the same collapse and is fixed the same way.
- a PostgREST `200` carrying an object where rows were expected was read as
  zero rows. That is `INVALID_SOURCE_SHAPE` — a changed view or a singular
  representation means the query no longer does what this code thinks, and
  reporting emptiness turns "the schema moved under us" into "there is
  nothing here".

A genuinely empty result is still `[]` with status `ok`, and stays
distinguishable from every one of the above.

**Neither the lease nor the queue query is time-windowed.** Both failures are
old by definition. The live queue holds two `objective_reflection` jobs
`running` since 13 September, and six jobs — `stakeholder_map`,
`lead_rescore`, `campaign_optimizer`, `exposure_scan`, `crm_reconcile`,
`objective_discovery` — queued at a single instant on 6 September that no Core
executor claims. A 24-hour window hid all eight. Queue age is measured from
`run_after` when set, so work deliberately scheduled for later is reported as
`scheduled_jobs`, not as a stuck backlog.

## Production runbook

Source work is complete and pushed; the following needs Cloudflare and VPS
access that this session does not have.

**1. Merge and let the guarded workflow deploy.**
Open a PR from `claude/core-mcp-continuity` to `main`. On merge the workflow
runs the continuity guard, records the serving version, uploads and promotes the
new one, then verifies. If the bridge is missing the guard stops it before
Cloudflare; if the live surface does not answer, it rolls back automatically.

**2. Set the two Worker secrets** (never vars, never committed):

```
cd workers/mccluster
npx wrangler@4.131.1 secret put CORE_BROKER_TOKEN
npx wrangler@4.131.1 secret put CORE_EDGE_SIGNING_KEY
```

`CORE_BROKER_URL` is already in `[vars]`. Until both secrets exist the route
fails closed at 503 rather than serving an unauthenticated bridge — deploying
ahead of the tunnel is safe.

**3. Set the matching Core-side values** in `/etc/mccluster/core.env` on the
VPS — `CORE_BROKER_TOKEN` identical to the Worker's, `CORE_EDGE_SIGNING_KEY`
identical to the Worker's — then restart the broker:

```
sudo systemctl restart mccluster-core-tool-broker.service
sudo systemctl status  mccluster-core-tool-broker.service --no-pager
```

Note the unit is `mccluster-core-tool-broker.service`. `core/README.md` calls it
`mccluster-tool-broker.service` in four places; that name does not exist.

**4. Verify the contract by hand:**

```
node scripts/mcp-contract-check.mjs --base https://api.mccluster.org
```

**5. Fix the reconcile deploy.** `scripts/mccluster-vps-reconcile.sh` now passes
`"${CHECKOUT}" "${TARGET_SHA}"`. Until this ships to the host, autonomous
self-reconciliation has been failing on argument validation on every run since
the SHA guard landed.

## Staged deploy and automatic rollback

`wrangler deploy` promotes in one step, so a post-deploy check can only tell
you production is already broken. Wrangler 4.131.1 — the version this workflow
pins — supports versioned deploys, verified against the installed CLI rather
than assumed:

```
wrangler versions upload  [--tag] [--message] [--var]
wrangler versions deploy  [<version-id>@<pct>..] [--version-tag] [--yes]
wrangler deployments list [--json]
```

The workflow now runs:

1. **record** the currently serving version (`deployments list --json`) as the
   rollback target;
2. **upload** the new version with `--tag $GITHUB_SHA` and the `DEPLOY_SHA` /
   `DEPLOY_REF` vars — built and stored, serving nobody;
3. **promote** it with `versions deploy --version-tag $GITHUB_SHA@100`, which
   resolves the exact build by tag rather than scraping a version id out of
   stdout;
4. **verify** the fingerprint, the MCP contract and the capability flags;
5. **roll back** to the recorded version if any verification failed, before the
   job reports failure.

So a build that fails its contract is in production for the length of one check,
not until somebody wakes up. If the serving deployment cannot be read and validated, promotion is refused.
The pinned Wrangler lists deployments oldest first, so the release selects the
newest by timestamp, preserves split traffic, uses a unique run-specific upload
tag, rejects intervening external promotions, and verifies the restored allocation.

## Making GitHub Actions the only deploy path

**Do not apply this yet — it changes Cloudflare production settings.**

The handoff reports two deployment paths: Cloudflare Workers Builds and the
GitHub workflow. The GitHub workflow is visible in the repository; the current
Workers Builds configuration still needs provider verification. Production
reports `deployment_sha: "unknown"`, which proves missing provenance but does
not identify the deployer. Any path without the continuity guards can bypass
the guarantees described here.

**A caveat that must be settled before step 2.** `wrangler versions upload`
and `versions deploy` publish *code*. They are not a complete
trigger-management path: routes, custom domains, cron triggers and other
Worker settings require a separate reconciliation path. The handoff identifies
Workers Builds as their current manager, but that ownership still needs live
verification. Disabling it before proving that GitHub Actions reconciles those
settings could break routing even if the code deployment succeeds.

So: **do not mutate production triggers in this patch, and do not disable
Workers Builds until a separate, guarded trigger reconciliation path exists.**
The release now includes `scripts/worker-triggers.py` and a manual review/apply
workflow. Capture the complete live inventory, make routes, domains, crons,
workers.dev and preview exposure explicit in Wrangler, review the plan digest,
and apply only that fresh plan. Missing settings or unreadable inventory fail
closed. This session lacks Cloudflare credentials, so the API Worker config is
not guessed and Workers Builds remains unchanged.

Exact steps to collapse to one path, once that prerequisite is met:

1. Confirm which path last deployed: compare the Worker's `modified_on`
   (Cloudflare API) against the GitHub workflow's last successful run. A
   `deployment_sha` of `unknown` proves missing provenance. It does not identify
   the deployer by itself; provider logs are needed to attribute the deployment.
2. Only after the trigger reconciliation path above exists and has been
   proven: in the Cloudflare dashboard, **Workers & Pages → mccluster →
   Settings → Build**, disconnect the connected Git repository (or set the
   build to non-production / disable automatic deployments to keep previews).
3. Confirm `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist in the
   GitHub `production` environment — the workflow already fails closed without
   them.
4. Push a trivial change under `workers/mccluster/` and confirm the workflow
   runs guard → upload → promote → verify, and that `/healthz` reports that
   exact SHA.
5. Once `/healthz` reports a real 40-character SHA, the contract check's fourth
   assertion becomes a permanent tripwire against the old path returning.

Until step 2 happens, treat every guarantee here as conditional on which path
deployed the running Worker.

## Sovereign preview: reconciled in the release branch

The Vercel dependency is removed from the preview executor, control-tool
availability and catalog. `previewDeploy` pins the fetched Git commit, publishes
static assets atomically, excludes private files, enforces quotas and TTLs, and
returns an owned preview URL. Repeated delivery of the same durable job is
idempotent.

The loopback file gateway rejects symlinks (including parent directories),
path traversal, invalid expiry metadata, expired previews, and unsupported
methods. It has no Core credential environment. Browser previews use a sandbox
CSP without same-origin privilege, and cannot register service workers.

Projects with an npm build script run through a root-installed systemd template
under a separate dynamic user. Its filesystem exposes the disposable worktree
and runtime binaries only; Core keeps `NoNewPrivileges`. The narrow Polkit rule
allows Core to start only hexadecimal build-instance names. A committed npm
lockfile is required, dependency lifecycle scripts are disabled, and no Vercel
credentials or fallback exist. Dynamic application servers are unsupported:
the publication contract requires static `index.html` output with relative or
preview-prefix-aware asset URLs.

`MCCLUSTER_PREVIEW_ENABLED=1` and an HTTPS public base are explicit activation
requirements. The gateway, tunnel and restricted build service must be verified
on OVH before enabling the capability. Local tests prove static publication and
HTTP serving; they do not prove the production systemd/Polkit environment.

## What is still open

- Confirm Cloudflare deployment history and trigger ownership, then establish
  one guarded deployment path. The running Worker currently has no SHA evidence.
- `main` is unprotected; the guards here are only as strong as the requirement
  that CI runs. A required-status-check ruleset on `main` is the other half.
- The isolated transport and preview code are built and locally tested; provider activation and authenticated production acceptance remain pending.
