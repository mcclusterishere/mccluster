# McCluster dispatch layer

Status: **built, not live.** Code is in Core and the MCP edge; the storage SQL is pending
(`supabase/pending/20261124235900_ai_context_dispatch_v1.sql`) and needs the owner's approval to apply.
Until it is applied every dispatch tool answers `503 DISPATCH_NOT_APPLIED` and nothing is routed or run.

## What it is

A small conversational front end that Matthew talks to. It reads one message, decides what it is, and hands it to
an existing backend path. It is not a second backend: it reuses the capability catalog, the Core control tools,
the `ops_agent_jobs` queue the OVH runners claim, `public.control_approvals`, the resident McCluster turn and
`ai_context`.

```
owner (Grok Bot / Control / any MCP client)
  -> api.mccluster.org /v1/core/mcp   (owner session check, house org, actor stamped)
  -> Core tool broker: dispatch.turn  (core/src/tools/dispatch.mjs)
       1. context from Supabase: active ai_context workstreams + relevant durable memories
       2. classify: refusal patterns -> deterministic table -> small model (confidence threshold)
       3. gate from core/capabilities/catalog.json
       4. RECORD: ai_context.dispatch_turns + ai_context.decisions (+ control_approvals if gated), one transaction
       5. then exactly one of: answer | clarify | run | hold for approval | refuse
  <- reply + turn_id;  poll dispatch.get for the job / approval / answer
```

## The front-end model

`qwen3:4b-instruct-2507-q4_K_M` on the OVH Ollama adapter (`core/src/dispatch/classify.mjs`,
`DEFAULT_DISPATCH_MODEL`). It is the smallest chat model already configured in the harness: it is in
`MCCLUSTER_OLLAMA_EXTRA_MODELS` and `MCCLUSTER_OLLAMA_RESIDENT_MODELS` in
`core/systemd/mccluster-ollama-adapter.service` (kept loaded), and the PRIM3 news desk already runs on it. It is
called with `route: 'local'`, `think: false`, temperature 0 and a JSON schema whose intent enum is the routing
table, so it cannot name anything else. No new provider, key or paid route. Override with
`MCCLUSTER_DISPATCH_MODEL` (any model the adapter allowlists). Long answers are not written by this model: with a
`thread_id`, chat becomes a durable resident McCluster turn (`core.ai.turn.submit`, `qwen3:8b`).

## Routing

Routing table: `core/src/dispatch/routes.mjs`. In order:

1. **Refusals** (always win, the model cannot override): merge or deploy to production, outreach or any outside
   message, destructive data changes, payments, website edits and driving the browser. The reply says where that
   is done instead.
2. **Deterministic rule** at confidence ≥ 0.85 (`MCCLUSTER_DISPATCH_STRONG`): accepted, the model is not called.
3. **Model** at confidence ≥ 0.70 (`MCCLUSTER_DISPATCH_THRESHOLD`): accepted. Below it: **clarify** (one question,
   nothing runs).
4. **Model down**: a rule at ≥ 0.60 is accepted; anything weaker is answered conversationally (changes nothing).
5. A route still missing a required argument (repository, ref, track) becomes **clarify**. Repository, ref and
   track ids are only ever taken from the message text; a model-invented one is dropped.

| Intent | Core tool | Catalog gate today |
| --- | --- | --- |
| `status.resume` | `core.resume` | runs (read) |
| `workstream.list` | `core.workstream.list` | runs (read) |
| `research.web` | `core.research.web` | runs (read) |
| `repo.inspect` | `core.repo.inspect` | runs (read) |
| `objective.plan` | `core.objective.plan` -> `objective_plan` job | runs (write, approval none; plans only safe analysis jobs) |
| `lyrics.align` | `core.lyrics.align` -> `lyrics_align` job | runs (write, approval none) |
| `stems.separate` | `core.stems.separate` -> `stems_separate` job | runs (write, approval none) |
| `code.build` | `core.code.build` -> `code_patch` job | **held** (review-required) |
| `game.build` | `core.game.build` -> `game_studio_cycle` job | **held** (review-required) |
| `deploy.preview` | `core.deploy.preview` -> `preview_deploy` job | **held** (review-required) |
| `world.generate` | `core.world.generate` | **held** (spend, budget-gated) |

The gate is read from the catalog at call time (`core/src/dispatch/policy.mjs`): approval `none` with risk read or
write runs; any other approval value, or risk spend/deploy/destructive, is held. Never dispatched: `browser.act`
and `site.edit` (owner-only), outreach (`out_*`, `lead_rescore`), production merges and deploys.

## Approvals and audit

* Every message is recorded **before** anything runs: one `ai_context.dispatch_turns` row and one
  `ai_context.decisions` row (`metadata.ingress = 'dispatch'`; status `executed` for answered/run, `proposed` for
  held, `rejected` for refused). If that write fails nothing runs.
* A held route also writes a pending `public.control_approvals` row (capability `dispatch.execute`,
  `resource_type = 'dispatch_turn'`, the request hash, expires in 24 hours). It shows up in Control's approvals and
  in `core.resume` like every other approval.
* After Matthew approves it in Control, `dispatch.execute` starts it. The database claims the turn once, only if
  the approval is `approved`, unexpired and carries the same request hash; Core re-checks the routing table and
  the hash before calling the tool. Denied or expired closes the turn and rejects its decision.
* Only the house owner can dispatch: the edge's owner check, the actor it stamps (never from arguments), and the
  database's own `org_members` owner check. House organization only.
* Idempotent on `message_id`: a retry returns the first outcome and runs nothing again.

## Results back to the conversation

`dispatch.get {turn_id}` returns the turn with its live `ops_agent_jobs` row (status, output, last_error), its
approval and, for chat with a thread, the resident assistant message, plus a one-line `relay` to say back. Poll
it, like Control already polls `core.ai.turn.get`.

## Entry points

* **MCP** (Grok Bot, Claude, any MCP client signed in as Matthew): `POST https://api.mccluster.org/v1/core/mcp`,
  tools `dispatch.turn`, `dispatch.get`, `dispatch.execute`. `org_id` is overwritten with the house org by the edge.
  ```json
  {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"dispatch.turn",
   "arguments":{"org_id":"house","message_id":"<new uuid>","message":"plan the music catalogue audit"}}}
  ```
* **Control**: not wired into the UI yet. The Control chat can call the same three tools through its existing
  `callCoreTool` (`js/control-room-v2.js`), passing its current `thread_id` so chat answers stay in the thread.

## Files

* `core/src/dispatch/routes.mjs`, `classify.mjs`, `policy.mjs`, `dispatch.mjs`, `core/src/tools/dispatch.mjs`
* `core/capabilities/catalog.json` (`dispatch.turn`, `dispatch.get`, `dispatch.execute`, catalog `2026-11-24.1`)
* `workers/mccluster-mcp/src/mcp.js` (remote allowlist + house-org-only)
* `supabase/pending/20261124235900_ai_context_dispatch_v1.sql` (+ `.rollback.sql`),
  `supabase/tests/ai_context_dispatch.{stub,behaviour}.sql`, `.github/workflows/ai-context-dispatch-db.yml`
* Tests: `core/test/dispatch-layer.test.mjs` (`npm --prefix core run test:dispatch`)

## Going live (owner steps)

1. Review and merge the pull request (merging to `main` deploys the Worker and Core).
2. Apply `supabase/pending/20261124235900_ai_context_dispatch_v1.sql` with approval, per `supabase/pending/README.md`.
3. Confirm `qwen3:4b-instruct-2507-q4_K_M` is pulled on the OVH adapter (it is in its deploy pull list).
4. Connect the MCP endpoint in Grok Bot (or another client) as Matthew.

## Limits

* The front end routes one message at a time; it does not chain several capabilities (use `objective.plan`).
* The small model is a classifier with a short reply, not the thinker: deep answers go to the resident turn.
* Refusal patterns are deliberately broad; a false refusal costs a re-phrase, a false run would cost more.
