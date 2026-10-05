# Control Room — backend gaps

What the canonical Control Room (`control.html`) cannot do, and exactly what
would be needed to do it. This exists so the console can stay honest: where a
capability is missing the UI says so and names the gap, instead of showing a
control that quietly does nothing or a list that implies records exist.

Nothing in this document is a proposal to build a second backend, a parallel
record store, or a new control plane. Each item is the smallest contract that
would unblock a view already present in the locked navigation.

Last reconciled 2026-10-05 against `main` at `690bf7a`, the live Here database,
and the Control-100 operator-contract branch.

> **Current finish-line status.** Items **1, 2, 3, 5, 6, 7, 8 and 9 are resolved** by current main plus this Control-100 change set. Item **4 is UI-complete but backend-incomplete**: System · Observability now implements the retained-event contract, filters, trace/request identifiers, loading/error/empty states and the existing failure-ledger fallback, while `/v1/observability/events` remains to be provisioned. The post-sale objects in section 10 are also UI-complete/capability-gated while their canonical tables and Worker routes are future plumbing.

> **Items 1, 2, 3 and 6 — RESOLVED in code and production (2026-10-05).**
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

> Sections 1, 2, 3 and 6 below are retained as the historical gap definition that this implementation closed. The status block above is authoritative.

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

## 4. Logs and traces — no pipeline

**Blocked view:** System · Observability

**Current behaviour:** the view shows the failure ledger the canonical tables
already hold — failed `ops_agent_jobs` (with `last_error`, input, result and
run time), failed `media_jobs`, failed `social_publish_jobs` — plus any source
this console could not read. It states plainly that McCluster has no log or
trace pipeline.

**What is missing:** no log store, no trace ids, no request/span correlation.
Cloudflare Workers Logs and Logpush are not wired to anything the Worker
exposes, so the browser has nothing to read.

**Smallest contract that would unblock it**

- A bounded, owner-gated tail: `GET /v1/observability/events?since&limit`
  over a retained events table, returning `{ events, has_more }`.

This is deliberately *not* "expose raw Cloudflare logs to the browser": the
narrow contract is a retained, org-scoped event list.

---

## 5. Aggregate spend — RESOLVED with enforcement

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

The aggregate cap is now real. Production migration
`20261005063836_control_media_monthly_budget_v1` adds
`org_media_budgets`. Control reads and writes it through owner-gated
`GET|PUT /v1/media/budget`. When enabled, the existing
`enforce_media_job_spend_guard()` serializes paid FAL admission per
organization, sums current-month committed jobs, and refuses the next job when
its estimate would cross the configured monthly limit. No cap is enabled by
default; policy becomes active only when the owner saves one in
System · Resources. Changes are recorded in `control_audit`.

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

## 7. AI decision approve / reject — RESOLVED

**Status:** current main PR #353 adds the narrow status transition and Control
buttons. The transition is owner-gated, only accepts `approved|rejected`,
keeps decision text immutable, and records the actor/time on approval.

**Historical blocked view:** Home · Needs you → decision inspector

**Current behaviour:** decisions are now readable. `GET /v1/ai/decisions` lists
them, proposed ones surface on Home (high and critical risk called out
individually), and the inspector shows the record. A proposed decision cannot
be approved or rejected from the console, and the inspector says so.

**What is missing:** `ai_context.decisions` stores a `status`, but the only
write path is `POST /v1/ai/decisions`, which records a *new* decision. There is
no transition route, so the only supported way to change a position is to
record a superseding decision via `supersedes_id`.

**Smallest contract that would unblock it**

- `POST /v1/ai/decisions/{id}/status` `{ status, note }`, restricted to the
  same house-owner gate, writing `status`, `approved_by` and `approved_at`.

Deliberately a status transition rather than a general update: the decision
text itself is a record of what was proposed and should not be editable.

---

## 8. Canonical `ai_context.decisions` migration — RESOLVED

**Status:** production migration
`20261005063813_canonical_ai_context_decisions_v1` was captured from the live
schema and added to the canonical ledger. It records the actual private table
shape, including `approved_by`, `approved_at`, `source_message_ids`,
`metadata`, and `updated_at`, with direct browser-role table access revoked.

**Historical impact:** everything above that touches decisions.

The live table — the one `context-decision` writes and now reads — has columns
`title`, `decision`, `rationale_summary`, `risk_class`, `status`,
`proposed_by`, `source_conversation_id`, `source_message_ids`,
`supersedes_id`, `metadata`, `created_at`, and allows the status `superseded`.

The only `ai_context` migration that exists in git is on the branch
`chore/port-ai-context-migrations`, and it is a **stale draft**: it defines
`decisions` with `rationale`, `requires_approval`, `approved_by`,
`approved_at`, `executed_at` and `provenance`, and its status CHECK does not
allow `superseded`. It would not create the table the platform actually uses.

**What is needed:** capture the live `ai_context` schema from the database and
commit it, rather than applying the draft. This is the same class of drift
already recorded for the `ops_*` tables.

---

## 9. Publish retry / cancellation — RESOLVED

**Status:** cancellation was already live; this Control-100 change set adds
owner-only retry for a failed unpublished job. Retry clears stale provider
container/error/lease state and requeues a fresh attempt. Create · Schedule
now exposes Approve, Cancel or Retry according to the job's actual state.

**Historical blocked view:** Create · Schedule

**Current behaviour:** queuing a publish is real — `POST /v1/social/publish`
is wired from a ready variant and creates a `social_publish_jobs` row. A job
that has since failed can be read but not retried or cancelled.

**What is missing:** `social_publish_jobs` has no owner-facing transition
route. The runtime claims and advances jobs itself.

**Smallest contract that would unblock it**

- `POST /v1/social/publish/{id}/retry` (re-queue a failed job)
- `POST /v1/social/publish/{id}/cancel` (only from `queued`)

---

## 10. Post-sale operating graph — UI COMPLETE, plumbing staged

**Views:** Work · Relationships, Service Projects, Payments, Deliverables,
Renewals.

Control now treats these as first-class future objects rather than sending the
owner to another admin room. Each view has a stable Worker contract
(`/v1/work/{relationships|projects|payments|deliverables|renewals}`), full
navigation, loading/error/empty states, record table, inspector, create/edit
form, validation and POST/PATCH semantics. Until a route exists, Control says
`UI READY / backend pending` and disables mutation instead of inventing data.

The intended graph is now represented in one Control experience:

`Person ↔ Company ↔ Relationship ↔ Lead ↔ Task ↔ Booking/Order ↔ Project ↔ Payment/Deliverable ↔ Renewal`.

The remaining work is backend ontology and persistence for those five staged
objects; completing it should not require another Control redesign.

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
