# Operator console — capability audit

Read from source at `b3e21de`, not inferred. Every endpoint below was located in
`workers/mccluster/src/**`. "Exposure" describes the frontend as it stood at that
commit.

Auth model throughout: Supabase session JWT in `Authorization: Bearer`. Three
tiers appear in the Worker — `none`, `user` (any authenticated Supabase user),
and `house-owner` (member of org `mccluster` with `role=owner`). The console
assumes house-owner and degrades honestly when a call returns 401/403.

## System / identity

| Capability | Endpoint | Was exposed | Missing interaction | Console surface |
| --- | --- | --- | --- | --- |
| Public health | `GET /health` | control.html lamp | — | System, shell health dot |
| Deploy fingerprint | `GET /healthz`, `GET /v1/health` | no | which commit is live | System → Edge |
| Route catalogue | `GET /v1` | no | what the API even offers | System → Surface |
| Operator identity | `GET /v1/me` | partial | — | Shell identity chip |
| House status + counts | `GET /v1/status` | control.html tiles | channels, harness rollup | Mission Control |
| App registry | `GET /v1/apps` | control.html doors | — | Sites & Clients |
| Fee quote | `GET /v1/fees/quote` | no | modelling a charge | Usage & Billing |

## Core / AI

| Capability | Endpoint | Was exposed | Missing interaction | Console surface |
| --- | --- | --- | --- | --- |
| Harness catalogue | `GET /v1/ai` | no | — | Core → Health |
| Job counts + health rollup | `GET /v1/ai/status` | no | queue depth at a glance | Mission Control, Core |
| System health detail | `GET /v1/ai/system-health` | no | reading the real rollup | Core → Health |
| Request health refresh | `POST /v1/ai/system-health` | no | **running host health on demand** | Core → Health action |
| Natural-language task | `POST /v1/ai/task` | no | **giving Core work** | Core → Composer |
| Explicit job enqueue | `POST /v1/ai/jobs` | no | typed job with input | Core → Composer (advanced) |
| Job detail | `GET /v1/ai/jobs/{id}` | no | **output, error, attempts** | Core → Job inspector |
| Context ingest | `POST /v1/ai/ingest` | no | — | Core → Context (documented, not wired) |
| Context retrieve | `POST /v1/ai/retrieve` | no | searching what Core knows | Core → Context |
| Decisions | `POST /v1/ai/decisions` | no | recording a decision | Core → Decisions |
| Remote MCP bridge | `GET /v1/core` | no | is the connector alive | System → Core bridge |

Job types accepted by `POST /v1/ai/jobs` (`OWNER_JOB_TYPES` in `ai/router.js`):
`local_analysis`, `repo_health`, `objective_reflection`, `portfolio_plan`,
`host_health`, `code_patch`, `game_studio_cycle`, `preview_deploy`.

## Communications

| Capability | Endpoint | Was exposed | Missing interaction | Console surface |
| --- | --- | --- | --- | --- |
| Transport info | `GET /v1/comms` | no | which transport is live | Communications header |
| Threads | `GET /v1/comms/threads` | inbox.html partial | queue filtering, ownership | Communications |
| Take over a thread | `POST /v1/comms/threads/{id}/takeover` | no | **human seizing an assistant thread** | Thread inspector |
| Release a thread | `POST /v1/comms/threads/{id}/release` | no | **handing back to the assistant** | Thread inspector |
| Send as operator | `POST /v1/comms/threads/{id}/send` | no | **replying** | Composer |
| Relay endpoints | `/v1/comms/relay/*` | n/a | device-facing, not operator | not surfaced (correct) |

## Media / Studio

| Capability | Endpoint | Was exposed | Missing interaction | Console surface |
| --- | --- | --- | --- | --- |
| Model registry | `GET /v1/media/models` | studio.html | filtering by capability | Studio → Models |
| Recommendation | `POST /v1/media/recommend` | no | **why this model** | Studio → Recommend |
| Generate | `POST /v1/media/generate` | studio.html | — | Studio |
| Bakeoff (2–5 models) | `POST /v1/media/bakeoff` | no | **comparing outputs** | Studio → Compare |
| Job detail + assets | `GET /v1/media/jobs/{id}` | studio.html poll | cost, lineage, provider result | Studio → Job inspector |

## Social

`GET|POST /v1/social/accounts`, `GET|POST /v1/social/campaigns`,
`POST /v1/social/variants/generate`, `POST /v1/social/publish`,
`POST /v1/social/posts`, `POST /v1/social/metrics`,
`GET|POST /v1/social/automations`. **No frontend at all.** Console surface:
Social → Accounts / Campaigns / Variants / Publishing / Automations.

## Platform

`GET /v1/platform/catalog`, `GET /v1/platform/plans`,
`GET|POST /v1/developer/consumers`, `/v1/mnet/*` (bootstrap, feed, profile,
posts, notifications), `/v1/compute/catalog|balance|estimate|run`.
**No operator frontend.** Console surface: Developer, Usage & Billing.

## Products

- **Whip** — `/api/auth/*`, `/api/operators/mine`, `/api/sales/leads`,
  `/api/identity/session|status`, `/api/offers`. whip.html is rider-facing.
  Console surface: Whip → Operators / Leads / Identity.
- **PRIM3** — `GET /v1/prim3`, `/v1/prim3/course`, `/v1/prim3/course/health`,
  `/v1/prim3/progress`. prim3.html is learner-facing. Console surface:
  PRIM3 → Curriculum / Course health.
- **Spatial (Seek First)** — `/v1/seek-first/*`, house-owner gated, plus the
  internal Cesium console at `/internal/seek-first` behind Cloudflare Access.
  Console surface: Spatial (links out to the existing globe; see compromises).

## What the audit changed about the plan

1. `GET /v1/comms/threads` is the only comms read. There is no per-thread
   message endpoint, so the conversation pane renders from the thread payload
   rather than a second fetch.
2. There is no unified activity/audit read endpoint. Activity is aggregated
   client-side from the reads that exist, and labelled as such.
3. `POST /v1/ai/system-health` is a real on-demand action and is the single most
   valuable unexposed button in the repo — it is wired to a visible control.
4. Several social and platform endpoints require an `org_id` the console must
   resolve first; where it cannot, the control is disabled with the reason
   rather than hidden.
