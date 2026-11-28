# Equity Fighter: the chat layer

Status (2026-11-28): **code complete for phases 1-2, not live.** Code is in `packages/equity-fighter`. The dispatch
layer it calls is merged to main (`core/src/dispatch`, `docs/control-plane/DISPATCH-LAYER.md`), but its SQL
(`supabase/pending/20261124235900_ai_context_dispatch_v1.sql`) and this layer's SQL
(`supabase/pending/20261125003000_equity_fighter_chat_v1.sql`) are both still pending: production has no
`ai_context.dispatch_turns` and no `ef_*` tables. Nothing is deployed and every platform is off by default.

What has to happen, in order, for it to be live (each step is the owner's):

1. Apply the dispatch SQL, then the Equity Fighter SQL (`supabase/pending/PROMOTION-ORDER.md`, section 21).
2. Write `/etc/mccluster/equity-fighter.env` on the OVH box (from `packages/equity-fighter/.env.example`) with
   `EQUITY_FIGHTER_ENABLED=true`, the house org and owner ids, the Supabase secret key, the Core broker token and
   signing key, and one platform (Telegram is the quickest: a @BotFather token and his numeric user id).
3. Run `sudo bash packages/equity-fighter/deploy/install-ovh.sh` there (below), publish `/webhooks/telegram` through
   Core's tunnel and call Telegram `setWebhook`.

## Three names, three layers

| Name | Layer | What it is | Where |
| --- | --- | --- | --- |
| **Equity Fighter** | Chat | Matthew talks to the harness from Slack and Telegram (WhatsApp Business and Discord behind flags). Verifies platform signatures, admits only the owner, sends each message to the dispatch layer, relays results. Owns no jobs, identity, routing or memory. | `packages/equity-fighter` |
| **Dispatch layer** | Front router | Small resident model (`qwen3:4b-instruct` on the OVH Ollama adapter) plus a deterministic routing table. Classifies, gates against the capability catalog, records `ai_context.dispatch_turns` + `ai_context.decisions` (+ `control_approvals`) before anything runs. | `core/src/dispatch`, PR #843 |
| **McCluster Core** | Execution | The tool broker, the 48 catalog capabilities and the job runners on OVH (`ops_agent_jobs`). | `core/` |
| **EquityNet** | Compute / network | Enrolled devices as workers: McCluster for Windows on Prime running Qwen through Ollama, signed receipt per job, pause / revoke. Formerly called "Equity Fighter" desktop. | `desktop/windows`, PR #824 (and #823 for the device-jobs contract) |

Equity Fighter calls the dispatch layer; the dispatch layer calls Core; Core places `ai.chat` work on EquityNet
nodes (owned compute first). Equity Fighter never talks to a device and never calls a runner directly.

## Flow of one message

```
Slack / Telegram webhook
  -> adapter: signature check (Slack signing secret, Telegram secret_token)          reject: 401, nothing stored
  -> ef_messages insert, unique (platform, external_msg_id)                          duplicate: stop
  -> owner check: EQUITY_FIGHTER_<P>_OWNER_IDS or a paired ef_identities row          stranger: no reply at all
  -> gateway commands: /help, /forget, go, /local
  -> agent loop (checkpointed to ef_steps): receive -> route -> record -> reply
       route = dispatch.turn {org_id, message_id = UUID(platform, event id), message}
  -> reply on the same platform; ef_runs keeps turn / job / approval ids
relay loop (every 20 s, or a cron trigger):
  -> resume runs a crash left at 'received' (completed steps are not re-run)
  -> dispatch.get for open runs: job done/failed, approval approved/denied/expired, resident answer
  -> compute.task.get for /local runs (EquityNet receipt id shown when the device returns one)
```

## Approval rules, enforced in code

Two layers, both in code; neither relaxes the catalog.

1. **The dispatch layer** (PR #843) applies `core/capabilities/catalog.json`: approval `none` with risk read/write
   runs; anything else (review-required, budget-gated, owner, owner-policy-gated) or risk spend/deploy/destructive is
   held as a pending `control_approvals` row; production merges/deploys, outreach and any outside message,
   destructive data changes, payments, website edits and browser driving are refused. Every turn is written to
   `ai_context.decisions` first.
2. **Equity Fighter's own policy** (`packages/equity-fighter/src/policy/approval-policy.ts`), deny by default, on
   every harness call the gateway makes:
   * the gateway may call exactly five tools: `dispatch.turn`, `dispatch.get`, `dispatch.execute`, `ai.chat`,
     `compute.task.get` (`ALLOWED_TOOLS`). `code.build`, `deploy.preview`, `site.edit` and the rest are unreachable
     except through `dispatch.turn`'s gate;
   * reads run (also unattended); approval-free writes run only with the owner present in the turn;
   * `dispatch.execute` (catalog approval `owner`) runs only when the owner typed `go` in this turn, and the database
     still refuses unless Control shows the approval approved, unexpired and for the same request hash;
   * review-required / budget-gated / owner-policy-gated, and risk spend / deploy / destructive, are denied here;
   * tainted (outside) content can only reach reads; unattended work cannot write.
   The class table is a snapshot of the catalog; `test/policy.test.ts` fails if they drift.

Approvals are decided in **Control**, never by a chat message. `go` only asks the harness to start what Control
already approved.

## Owner-only access and pairing

* No reply to anyone who is not the owner: answering a stranger is itself an outside message.
* Allowlist: `EQUITY_FIGHTER_SLACK_OWNER_IDS`, `EQUITY_FIGHTER_TELEGRAM_OWNER_IDS`, ...
* Pairing (OpenClaw's idea, rebuilt stricter): `npm run pair-code -- telegram <user id>` on a trusted machine with
  `EQUITY_FIGHTER_PAIRING_SECRET` prints a code bound to that one account; send `/pair <code>` from it once. Wrong
  code: silence. Revoke with `ef_identities.revoked_at` or `trust = 'blocked'` (a blocked account cannot re-pair).

## Memory and deletion

`ef_messages` holds chat text so the owner can see and delete it: `/forget` deletes every stored message for that
conversation. `ef_steps` checkpoints hold ids and harness outcomes, not text, so a forgotten message cannot be
resumed. Routing decisions stay in `ai_context.decisions` (the audit trail is not memory and is not deleted by
`/forget`). Long-term memory (profile blocks, episode search, facts) is spec phase 4 and not built.

## Platforms

| Platform | State | Official API | Notes |
| --- | --- | --- | --- |
| Slack | implemented | Events API + Web API `chat.postMessage` | DMs and @mentions; signing-secret check with 5 min replay window |
| Telegram | implemented | Bot API webhook with `secret_token` | private chats; groups only with `/ask`; bots cannot start chats, so Matthew writes first |
| WhatsApp | implemented, extra flag | Business Cloud API (Graph) only | `EQUITY_FIGHTER_WHATSAPP_CUSTOMER_SERVICE_ONLY=true` required: since Jan 15, 2026 Meta bars general-purpose AI assistants; 24 h service window; no WhatsApp Web clients |
| Discord | implemented, optional | Interactions endpoint (Ed25519), `/ask` | not in the spec's P0; off unless enabled |
| Microsoft Teams | stub | Bot Framework | needs Azure Bot registration + Microsoft JWT validation |
| Google Chat | stub | Chat app HTTP endpoint | needs Google JWT validation; Workspace only |
| Matrix | stub | client-server `/sync` | needs a persistent client, not a webhook |
| Signal | not offered | none official | unofficial clients only |
| iMessage | not offered | none public | Apple Messages for Business needs an approved provider |

Stubs refuse every request even if their env flag is set.

## Hosting (Matthew decides)

The gateway is a runtime-neutral `fetch(Request) -> Response` handler (Node 20+ or a Worker), so no new
infrastructure name is needed:

* **Recommended: mount in Worker `mccluster`** under `/v1/equity-fighter/webhooks/*` (spec path
  `workers/mccluster/src/equity-fighter/`), relay on a cron trigger. No new Worker, so no change to
  `docs/control-plane/canonical-architecture.json`. Not done in this PR because it changes the live Worker.
* **Or run beside Core on OVH** (loopback, published through Core's existing authenticated tunnel) with
  `EQUITY_FIGHTER_HARNESS_TRANSPORT=core` (the same signed machine hop `workers/mccluster-mcp` uses). This is the
  fastest path to a persistent bot because it changes nothing in the live Worker; see "Run it on OVH".
* `transport=edge` uses Matthew's Supabase session token against `https://api.mccluster.org/v1/core/mcp`. Session
  tokens expire (about an hour), so edge is for trials until a service-to-edge credential is agreed.

## Run it on OVH

`packages/equity-fighter/deploy/mccluster-equity-fighter.service` runs `dist/node.js` as `mccluster-core` on
`127.0.0.1:4790`, after the tool broker, with `EQUITY_FIGHTER_HARNESS_TRANSPORT=core` and
`CORE_BROKER_URL=http://127.0.0.1:4777` set in the unit and everything else (secrets included) in
`/etc/mccluster/equity-fighter.env`, which never enters Git. `Restart=always`; the relay loop (every 20 s) resumes
crashed runs and delivers finished jobs and approvals, so it keeps working while nobody is watching.

`packages/equity-fighter/deploy/install-ovh.sh` (root, owner-run) builds the package in a temporary directory,
installs `dist/` to `/opt/mccluster/equity-fighter` keeping the previous build, installs the unit and stops there
when the env file is missing. With the env file it enables and restarts the service, waits for `/health` and rolls
back to the previous build if it does not answer. It is deliberately **not** part of `scripts/deploy-ovh-core.sh`:
Core's deploy stays exactly as it is until the owner chooses to fold this in.

`GET /health` lists every reason the gateway is off (missing flag, id, key, platform credential) without printing
any value, so a misconfigured env file is visible in one request.

## What Matthew must provide

1. Approve the dispatch-layer SQL (#843) and this PR's SQL (`20261125003000_equity_fighter_chat_v1.sql`).
2. Hosting choice (above) and, for it, `SUPABASE_SECRET_KEY` and either the owner session (edge) or
   `CORE_BROKER_URL` / `CORE_BROKER_TOKEN` / `CORE_EDGE_SIGNING_KEY` (core).
3. `MCCLUSTER_ORG_ID` (house org) and `EQUITY_FIGHTER_OWNER_USER_ID` (his auth user id).
4. **Slack**: create a Slack app in his workspace; bot scopes `app_mentions:read`, `im:history`, `chat:write`;
   events `message.im`, `app_mention`; Request URL `https://<host>/webhooks/slack`. Supply `SLACK_BOT_TOKEN` (xoxb)
   and `SLACK_SIGNING_SECRET`, and his Slack member id for `EQUITY_FIGHTER_SLACK_OWNER_IDS`.
5. **Telegram**: create a bot with @BotFather, supply `TELEGRAM_BOT_TOKEN`, choose `TELEGRAM_WEBHOOK_SECRET`, call
   `setWebhook` with it; his numeric Telegram user id for `EQUITY_FIGHTER_TELEGRAM_OWNER_IDS` (or pair).
6. `EQUITY_FIGHTER_PAIRING_SECRET` (any 16+ character random string) if he wants pairing instead of id lists.
7. **WhatsApp** (only if he says yes): Meta Business verification, a WhatsApp Business Cloud API app,
   `WHATSAPP_PHONE_NUMBER_ID`, a system-user `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, a chosen
   `WHATSAPP_VERIFY_TOKEN`, and confirmation it is customer-service use.
8. Budget caps (spec phase 3) and confirmation of the dispatch front model (qwen3:4b-instruct by default).

## Spec mapping (Equity Fighter spec, Nov 24, 2026)

| Spec component | Spec path | This PR |
| --- | --- | --- |
| Channel adapters | `packages/equity-fighter/src/adapters/` | same |
| Gateway routes, pairing, idempotency | `workers/mccluster/src/equity-fighter/` | `packages/equity-fighter/src/gateway.ts`, `pairing.ts` (Worker mount later) |
| Agent loop, checkpoints | `core/src/equity-fighter/`, `ef_steps` | `packages/equity-fighter/src/agent/loop.ts`, `ef_steps` |
| Front router | dispatch-layer PR | `dispatch.turn/get/execute` via `src/harness/dispatch.ts` |
| Policy engine | `packages/equity-fighter/src/policy/` | same (`approval-policy.ts`) |
| Tool bridge | `packages/equity-fighter/src/tools/` | not built (phase 2 "act safely" next step; today the dispatch layer owns tool choice) |
| Memory service | `packages/equity-fighter/src/memory/` | not built (phase 4); `/forget` on `ef_messages` only |
| EquityNet client | `packages/equity-fighter/src/equitynet/` | `src/harness/equitynet.ts` (via Core `ai.chat`; receipt verification is phase 3) |
| Tables | `ef_channels`, `ef_identities`, `ef_conversations`, `ef_messages`, `ef_runs`, `ef_steps`, `ef_tool_calls`, `ef_approval_requests`, `ef_memories`, `ef_skills`, `ef_model_routes`, `ef_audit` | `ef_identities`, `ef_messages`, `ef_runs`, `ef_steps` only. Approvals reuse `control_approvals` + `ai_context.decisions`; the rest are later phases |
| Spec docs | `docs/equity-fighter/` | this file |

## Original code

Equity Fighter is written from scratch. OpenClaw (MIT) and Hermes Agent (MIT) were studied for architecture
only (channel plugins, DM pairing, approval modes); no code was copied, so no third-party notice is added.
