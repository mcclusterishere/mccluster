# Control Room — backend gaps

What the canonical Control Room (`control.html`) cannot do, and exactly what
would be needed to do it. This exists so the console can stay honest: where a
capability is missing the UI says so and names the gap, instead of showing a
control that quietly does nothing or a list that implies records exist.

Nothing in this document is a proposal to build a second backend, a parallel
record store, or a new control plane. Each item is the smallest contract that
would unblock a view already present in the locked navigation.

Last reconciled against `origin/main` at `b3e21de`, Worker source
`workers/mccluster/src`.


> **Items 1–9 — RESOLVED in code and/or production (2026-10-05).**
> `workers/mccluster/src/work.js` adds the canonical Work routes
> (`GET|POST /v1/work/{companies|tasks|orders|bookings}`,
> `PATCH /v1/work/{kind}/{id}`, `POST /v1/work/leads`,
> `PATCH /v1/work/leads/{id}` to link a company). Each is membership-checked
> (staff may run tasks; leads, companies, orders and bookings are owner work),
> pinned to the caller's `org_id`, and written to `control_audit`. The tables
> come from `supabase/migrations/20261005044012_control_work_records_v1.sql`
> (`leads.company_id`, `work_tasks`, `work_orders`, `work_bookings`; RLS on,
> no browser mutation grants for the Work stores). **Companies are the existing `out_companies`** — the
> table the intake and outreach functions already write with service-role authority — so there is one
> company universe; the migration removes direct browser company mutations so the owner-only Worker gate is authoritative; leads, orders and bookings link to it, and Control's
> company records share the same canonical universe. Control's "+ New" opens the
> native form in `js/control-room/work-records.js`; the legacy CRM creator is
> no longer the way in. Production also has
> `20261005044112_control_work_fk_indexes_v1` covering order/booking foreign keys.
> A `503 work_not_provisioned` response now indicates deployment/schema drift, not an expected pending state.
> Product fulfilment tables (`print_orders`, `shake_orders`, `music_orders`,
> `l3_orders`, `rental_bookings`) stay authoritative for their products; a
> Work order may point at one via `source_table`/`source_id`.

---

> Sections 1–9 below are retained as the historical gap definition that the current implementation closed. The status blocks are authoritative.

> **Decision resolution (items 7–8):** PR #353 added owner-only approve/reject transitions through `POST /v1/ai/decisions/{id}/status`, with the private `context-decision` function re-checking membership and fencing transitions to `proposed`. Production migration `20261005063813_canonical_ai_context_decisions_v1` captures the live private decision schema, including `approved_by`, `approved_at`, and `updated_at`.
>
> **Post-sale business graph — RESOLVED in code and production (2026-10-05).**
> Production migrations `20261005075808_control_post_sale_work_v1` (+ `_rls_v1`,
> `_grants_v1`, `_indexes_v1`, and `20261005075956_control_work_task_related_types_v2`)
> add `work_relationships`, `work_projects`, `work_deliverables`,
> `work_renewals` and `work_payments`: forced RLS, no browser grants,
> service-role only. They are written through the same audited
> `/v1/work/{kind}` routes and link to the canonical records instead of
> copying them: companies are `out_companies`, people are `leads` and
> `out_contacts` (read-only via `GET /v1/work/contacts`), orders are
> `work_orders`. `GET /v1/work/history?company_id|relationship_id|lead_id|project_id`
> assembles one client's linked records and audit trail as a timeline with
> billed / paid / provider-verified totals. Control · Work has Relationships,
> Projects, Deliverables, Payments and Renewals views with create, inline
> state, deliverable approval (stamped with who and when) and History.
>
> Still staged, and labelled so in Control:
> - **Payment verification.** `work_payments.verification` is
>   `owner_recorded` unless a Stripe/Square reconciler sets
>   `provider_verified`; no request can set it. The reconciler is not built.
>   `public.payments` is Whip's tenant ledger and is not used.
> - **Client-facing approval.** Deliverable approval is the owner's; a client
>   portal that lets the client approve is not built.
> - **Entitlement linkage.** `music_entitlements` / `l3_entitlements` stay
>   product-scoped; renewals can point at `site_accounts`,
>   `api_subscriptions` or `offerings` via `source_table` / `source_id`.
> - **Client-owned social connections** already live per tenant org in
>   `social_accounts` / `org_channels` and show in Create · Channels for the
>   active workspace.

> **Aggregate media allowance (item 5):** production migration `20261005063836_control_media_monthly_budget_v1` added `org_media_budgets` and extended the existing table-boundary media spend guard. Control System → Resources now reads and updates the owner-only allowance through `/v1/media/budget`; enabling a cap requires a concrete monthly limit and mutations are written to `control_audit`.

## 1. Companies — no domain model

**Blocked view:** Work · Companies

**Current behaviour:** the view groups leads by a `company` field. No lead
carries one, so the view renders a stated gap rather than rows.

**What is missing:** there is no `companies` table, no company id on `leads`,
and no `/v1/...` route. A company today is a string on a lead at best.

**Smallest contract that would unblock it**

- `companies` table: `id`, `org_id`, `name`, `domain`, `created_at`.
- `leads.company_id uuid references companies(id)` (nullable).
- `GET /v1/crm/companies?limit&offset&q` → `{ companies, total }`.

Until the relationship exists, grouping by a free-text name would invent an
entity that the database does not model, so the console does not do it.

---

## 2. Tasks — derived, not stored

**Blocked view:** Work · Tasks

**Current behaviour:** the view derives "next actions" from leads that have
not closed and from failed Core jobs. Nothing can be created, assigned,
completed or reordered, and the view says so.

**What is missing:** no `tasks` table and no task route. `ops_agent_jobs` is
the autonomous execution queue, not a human task list, and must not be
overloaded into one.

**Smallest contract that would unblock it**

- `tasks` table: `id`, `org_id`, `title`, `state` (`open|doing|done`),
  `assignee`, `due_at`, `related_type`, `related_id`, `created_at`.
- `GET /v1/work/tasks`, `POST /v1/work/tasks`, `PATCH /v1/work/tasks/{id}`.

---

## 3. Orders and Bookings — lead lanes, not records

**Blocked views:** Work · Orders, Work · Bookings

**Current behaviour:** both are leads routed to a lane by `campaign`
(`print-shop` / `merch-shop` → orders, others → bookings). There is no
fulfilment state, amount, line item, or scheduled slot, and the views say so.

**What is missing:** no `orders` / `bookings` tables. Payment exists elsewhere
(Stripe Connect surfaces under `/v1/connect/...`), but nothing links a paid
amount to a lead as an order record.

**Smallest contract that would unblock it**

- `orders`: `id`, `org_id`, `lead_id`, `state`, `amount_cents`, `currency`,
  `items jsonb`, `placed_at`.
- `bookings`: `id`, `org_id`, `lead_id`, `state`, `starts_at`, `ends_at`,
  `location`.
- `GET /v1/work/orders`, `GET /v1/work/bookings`.

---

## 4. Logs and traces — RESOLVED

**Status:** resolved by the retained Control observability pipeline.

- Production migration `20261005071308_control_observability_events_v1`
  provides the durable org-scoped event store with trace/request IDs, route,
  method, status, duration, actor and bounded detail.
- Browser roles have no direct access; the table has forced RLS and is mediated
  by the Worker.
- Control sends its current workspace as `x-mccluster-org-id`, but the trace
  writer independently resolves the bearer token and verifies membership
  before retaining an event. A spoofed workspace header cannot write into
  another organization's stream.
- API responses expose `x-mccluster-trace-id` and
  `x-mccluster-request-id` for correlation.
- `GET /v1/observability/events?org_id&since&limit&trace_id&level` is
  owner-gated and bounded to 200 rows plus a lookahead row.
- System · Observability auto-loads the retained 24-hour tail and keeps the
  canonical failure/audit ledger underneath as supporting context.
- Request bodies, authorization material and raw credentials are not retained.
- Production migration `20261005074135_control_observability_events_v2` makes
  the store the one canonical event contract: event names, span ids,
  `occurred_at`, outcome and provenance (`source`), bounded detail, request /
  resource / name / retention indexes, and uniqueness for request rows only so
  domain and Core events can share a request's trace.
- Domain events (`recordEvent`) run under the request trace: every audited
  mutation (which also stamps its trace into `control_audit.detail.trace`),
  paid media reservation / submission / provider webhook (rejoined through
  `media_jobs.routing.trace_id`), AI decision and approval transitions, and the
  scheduled publish queue.
- Core writes the same contract (`core/src/observability.mjs`): job outcomes,
  resident-AI research lookups and inference, broker capability dispatch.
- The read route adds cursor pagination and `request_id`, `resource_type` +
  `resource_id`, `event_kind`, `source`, `event_name` filters. Retention is
  14 days (info) / 90 days (warn, error), pruned hourly by the Worker cron.
- Control lists every event kind, opens any trace or record as a timeline, and
  links failed jobs, media jobs, publish jobs and ledger entries into it.
- Full contract, including the OTel / Logpush mapping:
  `docs/control-plane/OBSERVABILITY.md`.

---

## 5. Aggregate spend — RESOLVED for media

**Status:** closed by `GET /v1/media/usage`.

Every control on media spend is per job — the table-boundary trigger refuses a
paid job without a budget and a preflight estimate — but nothing aggregated, so
many individually-approved jobs could drain a funded provider account with no
route able to say so.

`GET /v1/media/usage?from&to&group_by=day|provider|capability|model` aggregates
the existing `media_cost_events` ledger via `public.media_usage_rollup`. It
reports settled actuals, reservations still in flight, and a `committed_cents`
figure (settled actuals plus unreleased reservations) — the number that answers
"how much of the funded balance is gone or spoken for". It reads the ledger and
computes no figure of its own. System · Resources shows it, labelled settled
versus in flight.

**Status:** resolved. `public.org_media_budgets` stores the owner-configured
monthly allowance, and `enforce_media_job_spend_guard()` now locks the budget
row and refuses a paid FAL job whose estimated cost would push current-month
committed spend over the enabled cap. Browser roles have no direct table
access; Control uses the owner-gated Worker route `GET|PATCH /v1/media/budget`.

---

## 6. Creating Work records — no canonical write route

**Blocked action:** Work · "+ New"

**Current behaviour:** the action states that no canonical create route exists
and points at the legacy CRM creator. Lead *stage* changes do persist, via a
direct PostgREST `PATCH` on `leads`.

**What is missing:** `leads` are written by the site's own capture forms and by
the communications relay. There is no owner-facing `POST` route for creating a
lead, and inventing one in the browser would create a record the rest of the
platform does not know how to attribute.

**Smallest contract that would unblock it**

- `POST /v1/work/leads` `{ name, email, phone, want, source }` → `{ lead }`,
  reusing the existing owner gate and writing the same `source`/`campaign`
  provenance the capture forms set.

---

## 7. Decisions cannot be approved or rejected

**Blocked view:** Home · Needs you → decision inspector

**Current behaviour:** decisions are now readable. `GET /v1/ai/decisions` lists
them, proposed ones surface on Home (high and critical risk called out
individually), and the inspector shows the record. A proposed decision cannot
be approved or rejected from the console, and the inspector says so.

**Status:** resolved by PR #353. `POST /v1/ai/decisions/{id}/status`
accepts only `approved` or `rejected`, is house-owner gated at the Worker,
is re-authorized by the private context function, and only transitions rows
still in `proposed`. It records the actor/time and preserves decision text as
immutable history.

---

## 8. `ai_context.decisions` has no accurate migration

**Affects:** everything above that touches decisions.

The live table — the one `context-decision` writes and now reads — has columns
`title`, `decision`, `rationale_summary`, `risk_class`, `status`,
`proposed_by`, `source_conversation_id`, `source_message_ids`,
`supersedes_id`, `metadata`, `created_at`, and allows the status `superseded`.

The only `ai_context` migration that exists in git is on the branch
`chore/port-ai-context-migrations`, and it is a **stale draft**: it defines
`decisions` with `rationale`, `requires_approval`, `approved_by`,
`approved_at`, `executed_at` and `provenance`, and its status CHECK does not
allow `superseded`. It would not create the table the platform actually uses.

**Status:** resolved. Production migration
`20261005063813_canonical_ai_context_decisions_v1` is the exact recorded
production statement set and is reconciled into the canonical migration
directory and production ledger. It defines the live columns and preserves the
private access posture (RLS enabled; no direct anon/authenticated/service-role
table grants).

---

## 9. Publish recovery — RESOLVED

**Status:** resolved. Create · Schedule exposes owner-safe recovery over the
canonical `social_publish_jobs` state machine.

- `POST /v1/social/publish/{id}/retry` only accepts failed, unpublished jobs.
- A usable existing Meta creation container resumes in `processing`; an
  explicitly expired/errored container is cleared and restarted from `queued`.
- Retry resets the attempt budget, clears stale lease/error state, restores the
  linked content item to `publishing`, and writes `social_publish.retried`
  to `control_audit`.
- Existing `POST /v1/social/publish/{id}/cancel` stays fenced to
  draft/queued jobs before Meta has a creation container.
- Control only renders Retry/Cancel when those transitions are actually safe,
  and surfaces failed transition responses instead of pretending they worked.

---

## Notes on what is *not* a gap

- **Conversation transcripts.** `GET /v1/comms/threads/{id}/messages` was added
  for the operator inbox because `comms_messages` is revoked from
  `authenticated` and granted only to `service_role`. It is owner gated, org
  scoped, and pages backwards with a keyset cursor.
- **Media generation.** The full lifecycle is available:
  `POST /v1/media/generate`, `POST /v1/media/bakeoff`, and
  `GET /v1/media/jobs/{id}` which refreshes provider status, stores produced
  assets and reconciles actual cost.
- **Lead search.** PostgREST supports server-side `ilike` search and exact
  counts, so lead search covers the whole table rather than the loaded page.
- **Reading decisions.** `GET /v1/ai/decisions` was added as a method on the
  route that already records them. It reuses the existing house-owner gate,
  forwards the caller's own token so the edge function still applies its
  owner/admin check, and pages with a keyset cursor. It is not a new namespace,
  and deliberately not a general record-read adapter: only two record types
  need Worker mediation at all (`comms_messages`, revoked from `authenticated`;
  and `ai_context.decisions`, in a schema PostgREST does not expose), and each
  has its own narrow route.
