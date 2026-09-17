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

---

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

## 5. Aggregate spend — only per-job cost exists

**Blocked view:** System · Resources

**Current behaviour:** the console shows `compute/balance` fields where the
backend returns them, and per-job `estimated_cost_cents` / `actual_cost_cents`
on media jobs (the latter reconciled by `GET /v1/media/jobs/{id}`). It shows
no totals, no burn rate and no provider COGS, because none are exposed.

**What is missing:** no rollup endpoint. The data largely exists in
`media_jobs` and the compute ledger, but there is no route that aggregates it,
and the browser cannot aggregate what it cannot page through.

**Smallest contract that would unblock it**

- `GET /v1/compute/usage?from&to&group_by=provider|capability|day`
  → `{ rows: [{ key, jobs, estimated_cost_cents, actual_cost_cents }], total }`.

Until that exists the console will not display a spend figure it computed
itself, because a number an operator reads as "what McCluster spent" must come
from the system that settled it.

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

**What is needed:** capture the live `ai_context` schema from the database and
commit it, rather than applying the draft. This is the same class of drift
already recorded for the `ops_*` tables.

---

## 9. Publish jobs cannot be retried or cancelled

**Blocked view:** Create · Schedule

**Current behaviour:** queuing a publish is real — `POST /v1/social/publish`
is wired from a ready variant and creates a `social_publish_jobs` row. A job
that has since failed can be read but not retried or cancelled.

**What is missing:** `social_publish_jobs` has no owner-facing transition
route. The runtime claims and advances jobs itself.

**Smallest contract that would unblock it**

- `POST /v1/social/publish/{id}/retry` (re-queue a failed job)
- `POST /v1/social/publish/{id}/cancel` (only from `queued`)

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
