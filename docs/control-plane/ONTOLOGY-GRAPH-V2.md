# Ontology graph v2: 4 → 22 object types

Status: **pending owner approval.** Nothing here is applied to production.

| Piece | Path |
|---|---|
| Forward SQL | `supabase/pending/20261125010000_ops_ontology_graph_v2.sql` |
| Rollback SQL | `supabase/pending/20261125010000_ops_ontology_graph_v2.rollback.sql` |
| Machine-readable contract | `core/ontology/graph-v2.json` |
| Contract test (Node) | `core/test/ontology-graph-v2.test.mjs` |
| Database tests | `supabase/tests/ops_ontology_graph_v2.{stub,behaviour,after-rollback}.sql` |
| CI | `.github/workflows/ops-ontology-graph-v2-db.yml` (PostgreSQL 16: stub → v1 → v2 twice → behaviour → rollback → re-apply) |

## What changes

The v1 ontology (`20260919053445_operational_ontology_v1`) materializes four object types:
`organization`, `objective`, `agent_job`, `application`, and one link type, `objective_has_job`.
v2 adds 18 object types and 29 link types. Every object comes from a table that already exists in
production, and every link comes from a foreign key (or a typed reference column) that already exists.
Nothing is inferred: no fuzzy matching, no model, no new edge that the source data does not state.

### Object types

| type_key | Display | Backing table | Scope |
|---|---|---|---|
| organization | Organization | `orgs` | v1 |
| objective | Objective | `ops_objectives` | v1 |
| agent_job | Agent job | `ops_agent_jobs` | v1 |
| application | Application | `platform_apps` | v1, house |
| company | Company | `out_companies` | org |
| contact | Contact | `out_contacts` | org |
| lead | Lead | `leads` | org, or house when `org_id` is null |
| client | Client relationship | `work_relationships` (client, prospect, partner, sponsor, vendor, collaborator) | org |
| engagement | Engagement | `engagements` | house |
| project | Project | `work_projects` | org |
| order | Order | `work_orders` | org |
| booking | Booking (event) | `work_bookings` | org |
| meeting | Meeting | `eu_meetings` | org |
| deliverable | Deliverable | `work_deliverables` | org |
| task | Task | `work_tasks` | org |
| payment | Payment | `work_payments` | org |
| renewal | Renewal | `work_renewals` | org |
| offering | Offering | `offerings` | house |
| campaign | Outreach campaign | `out_campaigns` | org |
| release | Release | `eu_releases` | org |
| track | Track | `eu_recordings` | org |
| approval | Approval | `control_approvals` | org |

House scope means the row has no `org_id` and belongs to the org with `slug = 'mccluster'`.

### Link types (source → target, from)

| link_key | From |
|---|---|
| contact_at_company | `out_contacts.company_id` |
| lead_at_company | `leads.company_id` |
| client_is_company / client_is_contact / client_from_lead | `work_relationships.company_id / contact_id / lead_id` |
| project_for_client / project_for_company / project_from_lead / project_from_order | `work_projects.relationship_id / company_id / lead_id / order_id` |
| order_for_company / order_from_lead | `work_orders.company_id / lead_id` |
| booking_for_company / booking_from_lead | `work_bookings.company_id / lead_id` |
| deliverable_of_project | `work_deliverables.project_id` |
| task_about_lead / _company / _order / _booking | `work_tasks.related_type + related_id` |
| payment_for_order / _for_project / _for_renewal / _from_company / _from_lead | `work_payments.*_id` |
| renewal_for_client / _for_project / _for_order / _for_company | `work_renewals.*_id` |
| renewal_of_offering | `work_renewals.source_table = 'offerings'`, `source_id` = offering id or slug (house only) |
| release_has_track | `eu_release_tracks` (carries `disc_no`, `track_no`) |

A reference whose target row does not exist (for example a `work_tasks.related_id` pointing at a deleted lead)
is counted as `unresolved` in the refresh result and no link is created.

## How it stays current

No trigger is added to any source table, so the ontology can never block a lead, payment or booking write.
Instead `private.ops_ontology_graph_v2_refresh(org|null)` reconciles in one pass:

* inserts new objects and links, updates only rows whose fields changed (version + 1), removes rows whose
  source is gone, and writes one `ops_ontology_lineage` row per change (`object.materialized`, `object.synced`,
  `object.source_deleted`, `link.materialized`, `link.synced`, `link.source_deleted`);
* only touches rows it created (`source_ref.materializer = 'ontology_graph_v2'`); v1 rows and links made by hand
  through `ops_ontology_apply_action_service` are never changed;
* keeps owner `_annotations` and `_tags` on every sync;
* is serialized with an advisory lock and is a no-op (no lineage) when nothing changed.

Entry points: `public.ops_ontology_graph_v2_refresh_service(p_org uuid)` (service_role only) and the private
function for an all-org run. The forward file runs one backfill at the end. **No schedule is created**; whether
to run it on a cron, after Core jobs, or on demand is an owner decision.

New nodes and edges show up in the existing connected-graph read (`private.ops_connected_nodes` /
`ops_connected_edges`) and in `core.ontology.schema / query / neighbors` with no Core change. In
`ops_connected_nodes` every v2 type is categorized `entity` (only `agent_job` is `event` there); changing that
view is a separate follow-up.

## Privacy

Properties carry operational fields only. Not copied: `leads.note`, `leads.gclid`, `out_contacts.unsub_token`,
campaign bodies and audience filters, every `note`/`notes`/`detail`, meeting join links, transcripts, agendas,
prep briefs and summaries, and approval request hashes. Contact names and emails are copied (service_role-only
tables, RLS forced) because duplicate matching needs them.

## Boundaries

* Duplicate-record matching (entity resolution) is a separate change. This file does not read or write
  `ops_entity_aliases`, `ops_entity_resolution_events` or `ops_fact_claims`; a matcher can link v2 objects
  through the existing `object_link` action or its own tables.
* Not mapped yet (candidates for v3): `creator_tracks` (user-owned, no org), `music_orders`/`l3_orders`/`print_orders`
  (reachable through `work_orders.source_table`), `comms_contacts`/`inbox_contacts`, `out_recipients` (high volume),
  `eu_events`, Stripe tables (`stripe_events`, `org_stripe_accounts`).

## To promote (owner approval required)

1. Re-run the guard columns against production read-only (the guard raises with the missing list and changes nothing).
2. Apply the forward file. It registers types for every org and runs one backfill.
3. Check `select public.ops_ontology_graph_v2_refresh_service('<house org id>')` returns all zeros on a second run.
4. Decide on a refresh schedule.
Rollback: the rollback file drops the functions and views and removes only materialized rows and unused v2 types.
