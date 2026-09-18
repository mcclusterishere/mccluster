# Infrastructure control

McCluster can now act on the infrastructure it runs on, not only report it.
One surface — `/v1/ops` on Worker `mccluster` — reaches the repositories,
the Cloudflare edge, the Supabase project, the OVH host, the public site and
every satellite on the registry, through one authorization contract and one
ledger.

This does not create a second backend, a second authority system, or a second
queue. It is the existing control authority (`control_capabilities`,
`control_role_capabilities`, `control_approvals`, `control_commands`,
migrations 0047 and 0066) extended with an infrastructure vocabulary and a
set of provider adapters.

## The shape of every call

```
POST /v1/ops/run
{
  "action": "site.deploy",
  "params": { "node_key": "matthew.mccluster.org" },
  "idempotency_key": "deploy-2026-09-16-a",
  "approval_id": "only for infra.mutate",
  "dry_run": false
}
```

Inside a run, in this order:

```
actor → policy → request hash → replay check → authorize → record → execute → finish
```

- **actor** — a member of the `mccluster` house org. Not merely an
  authenticated user of some application.
- **policy** — `public.ops_action_policy` must carry an enabled row for the
  action. A missing or disabled row stops it even though the Worker still
  ships the code.
- **request hash** — SHA-256 over the action, the resolved target and the
  parameters with keys sorted. This is what an approval binds to.
- **replay check** — an idempotency key already used by a finished command
  returns that command's outcome instead of running again.
- **authorize** — `control_authorize_service`. High-risk capabilities need an
  approved `control_approvals` row matching the exact hash, resource and
  capability.
- **record before execute** — the command row exists before the provider is
  touched, so an action that crashes mid-flight is still on the ledger.
- **finish** — outcome, result and error written back.

## The three rungs

| Capability | Risk | What sits on it |
| --- | --- | --- |
| `infra.read` | low | Every read: repository state, Worker deployments, DNS, advisories, migrations, logs, host monitoring, site probes, read-only SQL. |
| `infra.operate` | medium | Reversible change: dispatch a deploy, purge cache, create a branch, commit to a working branch, open a PR, re-run a job, snapshot the host, start the host, queue Core work, register an estate node. |
| `infra.mutate` | **high** | Consequential change: merge a PR, commit to a default branch, roll a Worker back, change DNS, apply writing SQL, reboot or stop the host, disable an estate node. |

`infra.mutate` is seeded `high`, and `control_authorize_service` refuses any
high-risk capability without an approval a house **owner** decided. So no
model, and no automation holding an owner's token, can reboot the host, move
a domain or merge to `main` on its own. That is `AGENTS.md`'s "humans retain
consequential authority" expressed as a code path.

Role grants: owner and admin hold all three rungs, staff and viewer hold
`infra.read` only, member holds none. Change that with a row in
`control_role_capabilities` — never with a deploy.

### Asking for permission

```
POST /v1/ops/approvals          { "action": "...", "params": {...}, "reason": "..." }
POST /v1/ops/approvals/{id}/decide  { "state": "approved" }
POST /v1/ops/run                { ..., "approval_id": "{id}" }
```

The request and the decision both run as the human whose token they carry —
the Worker forwards the caller's JWT rather than using its service key — and
`control_decide_approval` requires an owner. An agent cannot approve its own
work. Approvals expire (30 minutes by default) and cover one exact request.

## The estate

`public.ops_estate_nodes` is what the plane may act on. An action names a
`node_key`; a key that is absent or disabled fails closed. No action anywhere
in this surface accepts a free-text repository, hostname or zone, so the
house's tokens cannot be pointed at anything the owner never registered.

Seeded from `docs/control-plane/registry.json` plus the plane's own pieces.
`mcclusterishere/Here` is seeded **disabled**: the rule that it publishes
nothing is enforced by the data instead of by every agent remembering it.

Kinds: `repo`, `site`, `worker`, `database`, `host`, `zone`, `bucket`, `queue`.

Adding a satellite to the surface is `ops.estate.upsert`, not a code change.
A site becomes deployable by carrying a deploy binding:

```json
{ "deploy": { "repository": "owner/repo", "workflow": "deploy-pages.yml", "branch": "main" } }
```

## The routes

| Route | What it does |
| --- | --- |
| `GET /v1/ops` | The catalogue: every action, its rung, its schema, and whether its provider has credentials yet. |
| `GET /v1/ops/state` | The board: sites, host, database, edge, control repo, Core queue, in one call. Each panel fails alone. |
| `GET /v1/ops/estate` | The registered nodes. |
| `POST /v1/ops/run` | Run one action. |
| `GET /v1/ops/runs` | The command ledger. |
| `GET|POST /v1/ops/approvals` | List or request approvals. |
| `POST /v1/ops/approvals/{id}/decide` | Owner decides. |
| `POST /v1/ops/mcp` | The same catalogue as MCP tools, for any model. |

Every route requires house membership, including the catalogue: what the
backend can reach is itself operational information.

## Models get the same surface, not a wider one

`/v1/ops/mcp` exposes each action as an MCP tool and routes every call
through the same `runAction`. A model discovers `vps.reboot`, and still
cannot reboot anything: the call returns a refusal naming the approval it
needs and how to request one. Mutating tools advertise `idempotency_key`;
high-risk tools advertise `approval_id`. Commands run this way are recorded
with `actor_kind: 'model'`, so an audit can tell what the owner did from what
something acting on the owner's token did.

## Credentials

Set with `wrangler secret put`. Never committed. Each provider fails closed
and independently: an unset token means those actions report
`provider_not_configured` with the secrets they need, and everything else
keeps working.

| Secret | Reach | Scope it to |
| --- | --- | --- |
| `GITHUB_CONTROL_TOKEN` | repositories and Actions | A fine-grained token limited to the registry repositories. Contents read/write, pull requests read/write, Actions read/write. Nothing else — no admin, no secrets, no org scopes. |
| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | the edge | Workers Scripts read, Workers Routes read, Zone DNS edit, Cache Purge, and read for KV/R2/D1. Not account admin. |
| `SUPABASE_MANAGEMENT_TOKEN` | the project | A management API token for project `zmnhbrjyhxzhkxmhkexs`. |
| `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY`, `OVH_ENDPOINT` | the VPS | A consumer key restricted to `GET/POST /vps/*`. `OVH_ENDPOINT` defaults to `ovh-eu`. |

Optional: `CLOUDFLARE_WORKER_NAME`, `CLOUDFLARE_ZONE_NAME`,
`OVH_VPS_SERVICE_NAME` — defaults for the node a targeted action aims at when
no `node_key` is given.

Binding the host: run `vps.list` to see the OVH account, then
`ops.estate.upsert` with `{"kind":"host","node_key":"ovh-core","provider_ref":"<serviceName>"}`.

## Read-only means read-only

`supabase.sql.read` sits on `infra.read`, so a model can run it unattended.
That is only safe because the statement is checked before it is sent:
comments stripped, exactly one statement, a reading verb at the front, and no
write, privilege change or file-reading function anywhere in it. The
statement is then sent inside `set transaction read only`, so the database
refuses a write even if the guard were wrong.

Anything the guard rejects is not forbidden — it is `supabase.sql.apply`,
which is `infra.mutate` and needs an approval.

## What is deliberately absent

- **Deploying Worker code.** Worker source ships from `workers/mccluster`
  through `npx wrangler deploy` against a reviewed commit. A second,
  unreviewed path for the backend to replace its own running code would be
  exactly the competing backend `AGENTS.md` forbids. Rolling back to a
  version that was already reviewed and deployed is the recovery lever.
- **Deleting infrastructure.** No action deletes a repository, a bucket, a
  database, a DNS zone or a VPS. Termination is a panel action a human takes.
- **A second job queue.** `core.job.enqueue` writes to `ops_agent_jobs`,
  the queue Core already drains.
- **A second estate list.** `registry.json` seeds `ops_estate_nodes`; a test
  fails if they drift.

## The unattended reading

The Worker's five-minute cron takes the same readings and writes them to
`public.ops_infra_snapshots`: which sites answered, whether the host is
running, whether a forbidden Worker appeared on the Cloudflare account. That
path calls only the read halves of the adapters — there is no actor behind a
cron, and inventing one to satisfy an authorization check would weaken the
check for everybody.

## Tests

`workers/mccluster/test/ops-control-plane.test.mjs` holds the contract:
catalogue and handlers and seeded policy agree, every registry satellite is on
the estate, `Here` is disabled, the read-only guard refuses seventeen ways of
writing, a high-risk action without an approval never reaches the provider, an
unregistered repository is unreachable, the command is recorded before the
provider is called, and a replayed idempotency key does not reboot anything
twice.
