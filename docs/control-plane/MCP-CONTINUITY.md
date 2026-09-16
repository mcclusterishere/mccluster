# Remote MCP continuity

The Core MCP bridge shipped, Claude connected to it, and a later Worker
deployment removed it. Nothing failed loudly: the deploy was green, `/healthz`
was 200, and the only symptom was a `404` where a connector used to be.

This document is the contract that makes that specific outage impossible, and
the plan for making the MCP surface independent of unrelated Worker work.

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
uploaded version, so **production currently reporting `unknown` proves this
workflow is not what deployed it** — Cloudflare Workers Builds is, and that path
stamps nothing, guards nothing and cannot roll back. See *Making GitHub Actions
the only deploy path* below; until that is applied, check 4 is the tripwire.

## Next: `mcp.mccluster.org` as its own edge service

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

1. Ship the bridge on `main` behind the guards in this document (done here).
2. Extract `src/core/**` into `workers/mccluster-mcp` with its own wrangler
   config and its own deploy workflow, path-filtered to that directory.
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

**Unavailable is never empty.** Each source reports `ok` or `unavailable`, and
an unavailable collection is `null` — never `[]`. An earlier cut degraded a
failed read to an empty array, so an unreadable approvals table rendered as
"zero approvals pending", which is the most dangerous possible lie to tell a
session about to act. `next_step_hint` now leads with *"Approval state
unavailable — do not assume nothing is pending"* whenever that read fails.

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
not until somebody wakes up. If no previous version was recorded the workflow
emits an explicit `::error::` with the manual rollback command rather than
pretending it recovered.

## Making GitHub Actions the only deploy path

**Do not apply this yet — it changes Cloudflare production settings.**

Two paths currently deploy this Worker. Cloudflare Workers Builds is wired to
the repository and deploys on push; the GitHub workflow deploys on push too.
Workers Builds stamps no `DEPLOY_SHA`, runs no continuity guard, runs no
contract check and has no rollback — which is why production reports
`deployment_sha: "unknown"`. Every guarantee in this document is bypassed when
that path wins.

**A caveat that must be settled before step 2.** `wrangler versions upload`
and `versions deploy` publish *code*. They are not a complete
trigger-management path: routes, custom domains, cron triggers and other
Worker settings are currently being applied by Workers Builds, which is the
only system applying them today. Disabling it without first proving GitHub
Actions reconciles those settings would swap a code-continuity problem for a
routing-continuity one — the same class of outage in a different layer.

So: **do not mutate production triggers in this patch, and do not disable
Workers Builds until a separate, guarded trigger reconciliation path exists.**
That work is its own change, after MCP continuity is restored: enumerate the
live routes, domains and crons from the Cloudflare API, express them in
`wrangler.toml`, verify a dry-run reconciles to exactly the live set, and only
then take the other path away.

Exact steps to collapse to one path, once that prerequisite is met:

1. Confirm which path last deployed: compare the Worker's `modified_on`
   (Cloudflare API) against the GitHub workflow's last successful run. A
   `deployment_sha` of `unknown` on `/healthz` is itself proof Workers Builds
   deployed it.
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

## Sovereign preview: a deliberate temporary regression

This branch is cut from `main`, which still carries the old Vercel-gated
`deploy.preview` (`PREVIEW_CONFIGURED = Boolean(process.env.VERCEL_TOKEN)`).
The self-hosted preview gateway that replaces it lives on
`selfhost/sovereign-media-fabric-v1` and was **not** ported here, to keep this
branch narrowly about MCP continuity.

That is a temporary inheritance, not a decision. **Vercel is not being
reintroduced as a dependency.** The self-hosted preview implementation —
`core/src/preview-gateway.mjs`, `core/src/executors/preview-deploy.mjs`, the
`mccluster-preview-gateway.service` unit and the catalog binding that flips
`deploy.preview` economics from `external/free` to `owned/compute` — must be
reconciled onto `main` immediately after MCP continuity is restored. Until then
`deploy.preview` simply stays unavailable on hosts without `VERCEL_TOKEN`,
which is the correct failure mode: unavailable, not silently billed.

## What is still open

- Two Cloudflare deploy paths with different credential states. Workers Builds
  is currently authoritative and stamps no SHA. One should be canonical.
- `main` is unprotected; the guards here are only as strong as the requirement
  that CI runs. A required-status-check ruleset on `main` is the other half.
- The `mccluster-mcp` extraction above is designed, not built.
