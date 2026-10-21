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

## Idempotency: exactly once, enforced by the ledger

- **Atomic boundary.** The job `id` is derived from `(organization, idempotency_key)`
  (`deterministicJobId`: SHA-256, formatted as a version-8 UUID). The
  `ops_agent_jobs` primary key therefore refuses a second row for the same key.
  Two concurrent submissions cannot both insert; the loser receives the
  unique-violation (`409` / `23505`), reads the winner back and answers with
  the same job. The pre-insert lookup is only a fast path for retries.
- **Payload binding.** `input.request_fingerprint` is the SHA-256 of
  `{repository, task, title, allowed_paths}`. A request that reuses a key with a
  different fingerprint is refused with `409 idempotency_conflict` and the
  existing job id; it never replays someone else's objective.
- **Lost acknowledgment.** The browser writes the pending attempt (key and the
  exact payload, scoped to the signed-in user) to `localStorage` **before** the
  POST. If the response is lost or the page reloads, the module resubmits that
  exact key and payload; the server replays the queued job or confirms nothing
  was queued. The pending record is cleared only when a job is acknowledged or
  the owner starts a new build.
- No migration, index, lock or extra table is needed for any of this.

## Receipt states

| State | Derived from |
| --- | --- |
| `queued` | row status `queued` |
| `running` | row status `running` |
| `awaiting_approval` | a pending `control_approvals` row for `code.build` naming the job (none is created today; mapped for when Core does) |
| `approval_source` | `ok` (the approvals ledger answered; an absent row is a verified absence), `unavailable` (read failed, non-2xx or malformed: nothing about approvals is known, `approval_state` is `unknown` and the UI says so), `not_checked` |
| `completed` | row status `done` |
| `failed` | row status `failed`, `last_error` shown |
| `cancelled` | row status `cancelled` / `skipped` |
| `unknown` | any other status, or the row is missing; nothing is inferred from time |
| `unavailable` | flag off; the route answers 503 and the form is disabled |

A draft PR URL in the row's output is shown as **reported, not verified**.
Phase B adds the independent GitHub read-back (PR number, head SHA) and only
then flips `verification.draft_pr_verified`.

## What the flag does and does not do

`CONTROL_BUILD_CODE_ENABLED` gates **this route and screen only**. It does not
cancel jobs already queued, and it does not gate the existing owner-only
`POST /v1/ai/jobs`, whose accepted job types include `code_patch`. It is not a
universal code-execution kill switch; the contract payload and the screen say
so. A common execution gate across both entry points is a follow-up.

## Submission path and consolidation

This route writes the canonical row directly with the Worker's service role,
under the owner gate. It does not invoke the `core.code.build` binding over the
Edge→Core bridge. `review-required` means a human reviews the draft PR after
the run; no pre-execution approval record gates a queued job today. A static
drift test asserts the edge row shape matches what `core/src/tools/control.mjs`
writes. The long-term single authorized submission path is one shared contract
module consumed by both Core and the edge; until then any change to either
writer must update the drift test.

## Rollback

Set `CONTROL_BUILD_CODE_ENABLED` to anything but `true` (or unset it). The
route answers `unavailable`, the form disables, queued rows stay in the ledger
and are still readable. Removing the module leaves Control unchanged: the view
falls back to "Build unavailable".

## Phase B prerequisites (not in this change)

1. The OVH node must be able to fetch the private repository (#510) and run `gh` with a scoped token.
2. Core runtime at the approved SHA, verified on `/health`.
3. Evidence of the runner's OS-level boundary for the code agent: dedicated OS user, filesystem limited to the worktree, no outbound network except the configured model endpoint and the push, no credentials readable by the agent. A worktree plus the post-hoc changed-file policy is not that boundary.
4. The first live task uses an explicit, bounded `allowed_paths`; an empty scope (whole repository minus protected paths) is not acceptable for the first run.
5. One deliberately trivial allowlisted task, then independent read-back of the job completion and the draft PR head and checks on GitHub.

## Release ledger

Filled in the PR description for the exact head: branch, touched files, test
commands and results, outstanding dependencies, flag status.
