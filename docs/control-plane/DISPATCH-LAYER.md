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
5. A route still missing a required argument (the catalog's `inputSchema.required`) becomes **clarify**.
   Repository, ref, UUIDs, meeting links and quoted text are only ever taken from the message text; a
   model-invented one is dropped. The model never supplies booleans (e.g. `transcription_authorized`).
6. A caller may pass `intent` (a route id) and `args` (structured arguments) with the message. That skips
   classification only: refusals still run first, and the gate is exactly the same.

### Coverage

Every capability in `core/capabilities/catalog.json` and every job type in `core/src/runner.mjs` has a route or a
named exclusion with a reason. `core/test/dispatch-coverage.test.mjs` fails if one is added without that decision.

* **Catalog capabilities (48 OVH, plus the 3 `dispatch.*` tools): 46 of 48 routed.** One route per capability,
  id = capability id; risk, approval and required arguments are read from the catalog entry. Calls go through the
  broker's capability registry (the same resolve/bind/fallback path as an MCP `tools/call`).
  Excluded: `browser.act` (owner-only, drives the owner's browser inside a resident turn) and `site.edit` (public
  website, owner-only in Control); the `dispatch.*` trio never routes into itself.
* **Runner job types (31 types across 29 executor files): 24 of 29 executor files reachable.**
  * 14 direct job routes, intent `job.<job_type>`, enqueued with the existing `enqueueJob` on `ops_agent_jobs`:
    `host_health`, `ai_diagnostics`, `repo_health`, `local_analysis`, `game_build_plan` (run); `portfolio_plan`,
    `objective_reflection`, `objective_synthesis`, `game_playtest`, `weather_region_snapshot`,
    `world_news_pairing` (held, review-required); `prim3_agent_news`, `character_post`, `actor_news_comment`
    (held, owner-policy-gated: they post publicly).
  * 8 through a capability: `code_patch` (code.build), `objective_plan`, `game_studio_cycle` (game.build),
    `preview_deploy` (deploy.preview), `lyrics_align`, `stems_separate`, `meeting_delegate_dispatch` and
    `meeting_delegate_collect` (meeting.delegate.*); `resident_ai_turn` through the answer path.
  * 8 excluded: `lead_rescore` (outreach), `sms_assistant_turn` (outside message, needs an inbound SMS),
    `actor_live_comment` (started by the database with a receipt), and the game studio continuations
    `game_media_collect`, `game_owner_decision`, `game_implementation_collect`, `game_branch_smoke`,
    `game_release_decision` (they need a cycle's own state or approval packet; reached through game.build).
  * Executor files not reachable from chat: `lead-rescore`, `sms-assistant-turn`, `actor-live-comment`,
    `game-branch-smoke`, `game-release-decision`. `host-health-collect` is a helper of `host-health`.

### Gates today (60 routes)

* **Run (31)**: core.resume, workstream.list/checkpoint, system.health, media.models.search,
  media.model.recommend, media.job.get, research.web, repo.inspect, game.lore.read, ai.chat, compute.task.get,
  objective.plan, ontology.schema/query/neighbors, ingest.connectors/records, entity.aliases, facts.query,
  meeting.delegate.status/transcript/session.get/chat.read, lyrics.align, stems.separate, job.host_health,
  job.ai_diagnostics, job.repo_health, job.local_analysis, job.game_build_plan.
* **Held for owner approval (29)**: every paid generator (media/image/video/audio/model3d/world.generate, spend
  budget-gated), code.build, game.build, deploy.preview, ontology.action.apply, ingest writes, entity.resolve,
  facts.claim, meeting.delegate.schedule/join/cancel/chat.send/speak, and the 9 gated job routes above.

The gate is read from the catalog at call time (`core/src/dispatch/policy.mjs`): approval `none` with risk read or
write runs; any other approval value, or risk spend/deploy/destructive, is held; a capability that is not
active, or not exposed to `mcp`/`agent`, is refused. Never dispatched: `browser.act` and `site.edit`
(owner-only), outreach (`out_*`, `lead_rescore`), production merges and deploys.

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
* Tests: `core/test/dispatch-layer.test.mjs`, `core/test/dispatch-coverage.test.mjs` (`npm --prefix core run test:dispatch`)

## Going live (owner steps)

1. Review and merge the pull request (merging to `main` deploys the Worker and Core).
2. Apply `supabase/pending/20261124235900_ai_context_dispatch_v1.sql` with approval, per `supabase/pending/README.md`.
3. Confirm `qwen3:4b-instruct-2507-q4_K_M` is pulled on the OVH adapter (it is in its deploy pull list).
4. Connect the MCP endpoint in Grok Bot (or another client) as Matthew.

## Limits

* The front end routes one message at a time; it does not chain several capabilities (use `objective.plan`).
* The small model is a classifier with a short reply, not the thinker: deep answers go to the resident turn.
* Refusal patterns are deliberately broad; a false refusal costs a re-phrase, a false run would cost more.
