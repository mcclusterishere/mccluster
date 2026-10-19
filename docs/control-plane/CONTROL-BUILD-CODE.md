# Control → Build → Code

Status: feature-flagged product slice for review (issue #523, phase A).
Flag: `CONTROL_BUILD_CODE_ENABLED` on Worker `mccluster`, **off by default**.
Nothing here deploys, merges, trains or spends. No new queue, table, identity,
approval store or Worker.

## What exists, traced on `main` at `ad78fb3`

```text
Control (control.html, js/control-room-v2.js, js/control-room/build-code.js)
  │  bearer M Account token · x-mccluster-trace-id · x-mccluster-org-id (hint only)
  ▼
Worker `mccluster`  workers/mccluster/src/ai/router.js  handleAiRequest
  │  1. authUser(token)                          → 401 when absent
  │  2. houseOrgId(env): orgs.slug='mccluster'   → the ONLY org this surface serves
  │  3. org_members(org, profile=user, role=owner) → 403 otherwise
  │  4. ?org_id / body.org_id ≠ house            → 403 (browser never chooses the org)
  ▼
workers/mccluster/src/ai/build-code.js  handleBuildCode
  │  GET  /v1/ai/build/code            contract: capability, allowlist, limits, flag state
  │  POST /v1/ai/build/code            flag → validate → dedupe by idempotency_key → insert
  │  GET  /v1/ai/build/code/:job_id    org-scoped readback → receipt state
  ▼
Supabase `ops_agent_jobs` (service role from the Worker; RLS blocks browsers)
  │  one row: job_type=code_patch, target_type=repository, target_id=<allowlisted repo>,
  │  input={task,title,allowed_paths,idempotency_key,capability:'code.build',…}
  ▼
OVH Core runner  core/src/runner.mjs → core/src/executors/code-patch.mjs
  │  allowlisted repo (MCCLUSTER_CODE_REPOS) · worktree off origin/main · OpenCode + local model
  │  refuses changes outside allowed_paths and SENSITIVE paths · commits · pushes `core/job-<id>`
  │  `gh pr create --draft` → output {branch, pushed, draft_pr, forbidden, agent_output_tail}
  ▼
GitHub draft PR  (human review; Core never merges)
```

The capability `code.build` (catalog, risk `write`, approval `review-required`,
binding `core.code.build`) is implemented in `core/src/tools/control.mjs` as
`enqueueJob({ jobType: 'code_patch', … })`. The edge route writes the identical
canonical row under the same owner gate the rest of `/v1/ai` uses, and records
`input.capability = 'code.build'` so the ledger says which contract queued it.
The signed Edge→Core MCP bridge (`/v1/core/mcp`, `CORE-MCP-BRIDGE.md`) remains
the path for remote agents; it is not required for Control to queue a build.

### Existing endpoints used, none invented

| Endpoint | Exists on main | Used by Build |
| --- | --- | --- |
| `GET /v1/ai` | yes | lists `build_code` beside the other owner endpoints |
| `POST /v1/ai/jobs` | yes | not used; it accepts any owner job type, Build is narrower on purpose |
| `GET /v1/ai/jobs/:id` | yes | same ledger read the receipt uses, Build filters to `code_patch` |
| `control_approvals` | yes (ontology v1) | read-only: a pending row for `code.build` + job id maps to `awaiting_approval` |
| `/v1/core/mcp` tools/call `code.build` | yes, needs broker secrets | not used by this slice |

## Authority

- Identity: verified bearer token → `authUser`. No cookie, header or body field substitutes.
- Organization: resolved server-side from `orgs.slug = 'mccluster'`. A browser-supplied `org_id` that differs is refused with 403; one that matches is redundant.
- Role: `org_members.role = 'owner'` on that org. `role`, `is_admin` and similar body fields are ignored.
- Repository: must match `owner/repo` and be in `MCCLUSTER_CODE_REPOS` (default `mcclusterishere/mccluster`), the same allowlist the Core executor enforces.
- Paths: plain prefixes only, no traversal, no absolute paths, and never a protected location. The protected list mirrors the executor's `SENSITIVE` rules (`.git`, workflows, actions, migrations, systemd, `.env`, SSH keys, credential/secret names). The executor remains the authority; the edge refuses early.
- Budget: priority 80, two attempts, McCluster-owned compute. The browser cannot raise either.

## Idempotency

The browser generates one UUID per build attempt and keeps it in
`localStorage` until the server acknowledges a job. The server looks up
`ops_agent_jobs` by `org_id + job_type + input->>idempotency_key` before
inserting. A replay returns the existing job with `replayed: true` and writes
nothing. A reload or lost network therefore cannot queue a second job.

## Receipt states

| State | Derived from |
| --- | --- |
| `queued` | row status `queued` |
| `running` | row status `running` |
| `awaiting_approval` | a pending `control_approvals` row for `code.build` naming the job (none is created today; mapped for when Core does) |
| `completed` | row status `done` |
| `failed` | row status `failed`, `last_error` shown |
| `cancelled` | row status `cancelled` / `skipped` |
| `unknown` | any other status, or the row is missing; nothing is inferred from time |
| `unavailable` | flag off; the route answers 503 and the form is disabled |

A draft PR URL in the row's output is shown as **reported, not verified**.
Phase B adds the independent GitHub read-back (PR number, head SHA) and only
then flips `verification.draft_pr_verified`.

## Rollback

Set `CONTROL_BUILD_CODE_ENABLED` to anything but `true` (or unset it). The
route answers `unavailable`, the form disables, queued rows stay in the ledger
and are still readable. Removing the module leaves Control unchanged: the view
falls back to "Build unavailable".

## Phase B prerequisites (not in this change)

1. The OVH node must be able to fetch the private repository (#510) and run `gh` with a scoped token.
2. Core runtime at the approved SHA, verified on `/health`.
3. One deliberately trivial allowlisted task, then independent read-back of the job completion and the draft PR head on GitHub.

## Release ledger

Filled in the PR description for the exact head: branch, touched files, test
commands and results, outstanding dependencies, flag status.
