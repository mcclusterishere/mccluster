# Observability — the canonical event contract

McCluster has one observability store: `public.control_observability_events`
in Supabase `zmnhbrjyhxzhkxmhkexs`. Control reads it through one route. Every
producer — the Worker, Core, and any future OpenTelemetry or Logpush
ingestion — writes the same row shape. There is no second log database, no
browser access to raw Cloudflare logs, and `fabric_events` is not used for
this: it is the cross-node delivery bus, and every insert there seeds
replication work.

Migrations: `20261005071308_control_observability_events_v1` (store, forced
RLS, service-role only) and `20261005074135_control_observability_events_v2`
(event names, spans, provenance, outcomes, bounds, retention indexes).

## Row contract

| Field | Meaning |
|---|---|
| `id` | Monotonic identity; the tie-breaker for pagination. |
| `org_id` | Tenant. Required. A request row is written only after the caller is verified as a member; every other producer pins the org it already authorized. |
| `occurred_at` / `created_at` | When it happened / when it was stored. |
| `level` | `info`, `warn`, `error`. |
| `outcome` | `ok`, `error`, `refused`, `retry`, `pending`, `cancelled`. |
| `event_kind` | `request`, `domain`, `job`, `dependency`, `capability`, `scheduled`, `incident`. |
| `event_name` | Dotted lowercase name: `http.request`, `work.task.create`, `media.generation.submitted`, `core.job.resident_ai_turn.completed`. |
| `source` | Provenance: `worker`, `core`, `supabase`, `provider`, `browser`, `otel`, `logpush`. |
| `service` / `route` / `method` / `status_code` | Who handled it and how. Core uses `route` for the operation, e.g. `core:job:resident_ai_turn`. |
| `trace_id` / `request_id` / `span_id` / `parent_span_id` | Correlation. 128-bit ids in UUID form, so W3C/OTel trace ids map one to one. |
| `actor_user_id` | The verified human, when there is one. |
| `resource_type` / `resource_id` | The record the event is about: `media_job`, `social_publish_job`, `ops_agent_job`, `ops_ai_thread`, `ai_context.decision`, `work_task`, … |
| `duration_ms` | Latency where relevant. |
| `message` / `detail` | Summary and structured metadata. `detail` is capped at 16 KB in the database (8 KB by producers). |

Never stored: request or response bodies, prompts, model outputs, capability
arguments, bearer tokens, credentials.

## Producers

**Worker requests** (`workers/mccluster/src/lib/observability.js`,
`observeControlRequest`). Control sends `x-mccluster-org-id` and
`x-mccluster-trace-id`. The org header is never trusted alone: the row is
written only after the bearer token resolves to a user who is a member of
that org. Mutations, failures (4xx/5xx) and reads slower than 1 s are kept;
fast successful reads are Control polling itself and are not. Every response
carries `x-mccluster-trace-id` and `x-mccluster-request-id`.

**Worker domain events** (`recordEvent`). They run under the request's trace
(AsyncLocalStorage), point at the request span as parent, and are written in
the same batch. At most 25 per request; drops are counted on the request row.

- Every audited mutation: `recordAudit` stamps `{trace: {trace_id, request_id}}`
  into the `control_audit` row's detail and emits an event named after the
  audit event. That covers Work, leads, publish approve/cancel/retry and
  budget changes.
- Paid media: `media.generation.reserved`, `.submitted`, `.submit_failed`.
  The trace id is stored in `media_jobs.routing.trace_id`, so the fal webhook's
  `.completed` / `.failed` rejoin the original trace.
- AI: `ai.decision.approved|rejected` with the private function's response
  status, and `ai.approval.decided`.
- Scheduled work: the publish queue (`social.publish.<state>|retry|failed`)
  and cost reconciliation run under their own trace (`observeScheduled`).

**Core** (`core/src/observability.mjs`, `emitCoreEvent`). Writes with the
Core service key; never throws, 5 s write timeout.

- Every job: `core.job.<type>.completed|retry|failed`, traced by
  `job.input.trace_id` when supplied, otherwise the job id. Control's
  "Open job trace" uses the same rule.
- Resident AI: `ai.research.lookup` (provider, result count, outcome) and
  `ai.inference.completed|failed` (model, queue wait).
- Broker capability dispatch: `core.capability.<id>`, pinned to
  `MCCLUSTER_ORG_ID`; honours an incoming `x-mccluster-trace-id`. Arguments and
  results are not recorded.

## Reading

`GET /v1/observability/events` — owner only, org-scoped.

| Parameter | |
|---|---|
| `org_id` | Required. |
| `limit` | 1–200 (default 100). |
| `since` | Default: last 24 h for the tail; the full 90-day window for a drilldown. |
| `cursor` | Opaque; from `next_cursor`. Keyset on `(created_at, id)`. |
| `trace_id`, `request_id` | Drill into one trace or request. |
| `resource_type` + `resource_id` | Every event about one record. |
| `level`, `event_kind`, `source`, `event_name` | Filters. |

Response: `{ events, has_more, next_cursor, since, retention_days }`.

## Retention

The Worker cron prunes hourly: `info` after 14 days, `warn` and `error`
after 90 (`pruneObservabilityEvents`).

## Control

System · Observability lists all event kinds with level, kind, window and
text filters and "Load older". Any event, trace or record opens a timeline of
everything sharing it. The canonical failure and audit ledger stays below as
context, and each failed Core job, media job, publish job and audit entry has
"Open trace" / "Events for this record" in its inspector.

## Future ingestion (OTel / Logpush)

Feed the same table with `source = 'otel'` or `'logpush'`, through a
service-role ingestion path that pins `org_id` from a verified mapping (never
from the payload alone):

- OTel span → one row. `trace_id` is the 32-hex trace id rendered as a UUID;
  `span_id`/`parent_span_id` are the 64-bit ids zero-padded into UUID form;
  `event_name` is the span name; `duration_ms` comes from the start/end
  times; `outcome` from the status code; attributes go into a bounded
  `detail`.
- Workers Logpush record → `source='logpush'`, `event_kind='request'`,
  `request_id` from the Ray ID mapping. Only fields already allowed above are
  kept.
