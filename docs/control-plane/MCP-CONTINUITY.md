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
- that the workflow runs the guard before deploying and the contract check after

Verified by deliberately reintroducing the regression: stripping the imports and
routes from `entry.js` fails 3 of the 13 guard tests. Restoring passes 13/13.

### Post-deploy: the surface is actually being served

`scripts/mcp-contract-check.mjs` runs against the live edge and fails the
deployment on any of:

1. `GET /.well-known/oauth-protected-resource` is not 200 with an authorization server
2. `POST initialize` is not 200, or does not negotiate `2025-11-25`
3. unauthenticated `POST tools/list` is **404**, or is not 401 with a `Bearer ... resource_metadata=` challenge
4. `/healthz` `deployment_sha` is not an exact 40-character SHA — `unknown` fails

Check 4 matters more than it looks. The deploy workflow already stamps
`--var DEPLOY_SHA:${GITHUB_SHA}`, so **production currently reporting `unknown`
proves this workflow is not what deployed it** — Cloudflare Workers Builds is,
and that path stamps nothing and verifies nothing. Two deploy paths, and the
authoritative one has no contract. Collapsing to one is the outstanding
decision; until then, check 4 is the tripwire.

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

- workspace identity — org, control repository, edge, Supabase project ref
- runtime — Core commit, deploy ref, deployed-at, host, worker id
- catalog — catalog version, capability and binding counts
- work — active jobs, **stale running jobs reported separately**, queued jobs, recent failures, objectives
- pending approvals — what a human owes the system
- health — system contract version and recent signals
- a `next_step_hint` leading with approvals, then stale leases, then failures

Two deliberate choices. It is **read-only**: a session that has just lost its
memory is the worst possible moment to take an action. And stale `running` jobs
are reported in their own bucket rather than folded into active work, because a
lease held by a dead worker looks exactly like progress — the live queue
currently has two `objective_reflection` jobs `running` since 13 September for
precisely that reason.

## Production runbook

Source work is complete and pushed; the following needs Cloudflare and VPS
access that this session does not have.

**1. Merge and let the guarded workflow deploy.**
Open a PR from `claude/core-mcp-continuity` to `main`. On merge, the workflow
runs the continuity guard, deploys, then runs the contract check. If the bridge
is missing or the live surface does not answer, the deploy fails loudly.

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

## What is still open

- Two Cloudflare deploy paths with different credential states. Workers Builds
  is currently authoritative and stamps no SHA. One should be canonical.
- `main` is unprotected; the guards here are only as strong as the requirement
  that CI runs. A required-status-check ruleset on `main` is the other half.
- The `mccluster-mcp` extraction above is designed, not built.
