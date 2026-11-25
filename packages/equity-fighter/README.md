# @mccluster/equity-fighter

Equity Fighter is McCluster's **chat layer**: Matthew talks to the McCluster AI Harness from Slack and Telegram
(WhatsApp Business Cloud API and Discord behind flags). It is a stateless gateway: it verifies the platform
signature, admits only the owner, hands the message to the harness **dispatch layer** (`dispatch.turn`), and relays
the answer, the job result or the approval state back. It owns no jobs, identity, routing or memory.

Architecture, approval rules, platforms, hosting and the list of keys Matthew must supply:
[`docs/control-plane/EQUITY-FIGHTER.md`](../../docs/control-plane/EQUITY-FIGHTER.md).
Not to be confused with **EquityNet** (the device/compute layer, `desktop/windows`, PR #824).

## Layout

| Path | What |
| --- | --- |
| `src/adapters/` | Slack, Telegram, WhatsApp Cloud API, Discord; `planned.ts` stubs (Teams, Google Chat, Matrix, Signal, iMessage) |
| `src/gateway.ts` | webhook routing, owner-only access, commands, checkpointed dispatch loop, relay |
| `src/agent/loop.ts` | small step loop with save-and-resume checkpoints (`ef_steps`) |
| `src/policy/approval-policy.ts` | deny-by-default approval policy on every harness call |
| `src/harness/mcp-client.ts` | MCP client: edge (`api.mccluster.org/v1/core/mcp`) or core (signed broker hop) |
| `src/harness/dispatch.ts` | `dispatch.turn` / `dispatch.get` / `dispatch.execute` |
| `src/harness/equitynet.ts` | `/local` questions to owned compute through Core `ai.chat` |
| `src/harness/store.ts` | Supabase `ef_*` tables (pending SQL) |
| `src/pairing.ts`, `scripts/pair-code.mjs` | owner-only pairing codes |
| `src/node.ts` | Node runner (HTTP listener + relay interval) |

## Commands in chat

* anything: routed by the dispatch layer
* `go`: start what you approved in Control
* `/local <question>`: answer on your own compute (EquityNet)
* `/forget`: delete stored messages for this conversation
* `/help`

## Develop

```
cd packages/equity-fighter
npm ci
npm run typecheck
npm test
```

Every platform is off by default. Copy `.env.example` to `.env` only on a trusted host; never commit real values.
