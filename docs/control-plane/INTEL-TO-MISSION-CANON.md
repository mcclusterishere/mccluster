# Intel → mission canon

Status: **applied in production 2026-10-17** to repair the Analytics intelligence projection. The collector remains separately gated.
Migration: `supabase/migrations/20261017030617_intel_mission_canon_v1.sql`
(rollback: `…_intel_mission_canon_v1.rollback.sql`). Behaviour test:
`supabase/tests/intel_mission_canon.behaviour.sql`, run by
`scripts/test-intel-canon-db.sh`. Companion: `HALO-INTEL-IMPLEMENTATION-MAP.md`.

One loop, one schema:

```
source snapshot ─▶ evidence ─▶ claim ─▶ briefing ─▶ decision ─▶ mission ─▶ outcome
 (ops_ingest_*)   (intel_)    (intel_)  (intel_)   (ai_context)  (action_)  (intel_)
        ▲                                                                      │
        └──────────── accepted outcome becomes evidence (kind mission_outcome) ┘
```

## 1. The candidates compared

| Model | Where | State | Strength | Why it is not the canon on its own |
|---|---|---|---|---|
| #408 `decision-intelligence/graph.js` | open PR, head `853ecdc` | code only | refuses to invent decision nodes; bounded graph | a projection, not storage |
| #414 `research_evidence_snapshots / research_claims / research_claim_evidence` | open PR, head `3d7eece` | pending SQL in the wrong folder (`supabase/migrations/pending/`, retired 2026-10-27; staged SQL lives only in `supabase/pending/`) | supports/contradicts/context; aggregate-only privacy flags | scoped to `research_projects`; no review history, briefing, decision or outcome |
| #416 `halo-evidence-graph.js` | open PR, head `98f1c0f` | code only | "no link without a source URL" | a projection, not storage |
| `decision_intelligence.*` | `20261011190000_…`, removed from `supabase/pending/` 2026-10-27 | never applied | org-scoped composite FKs; same stance vocabulary | private schema with **no grants at all**, so nothing (not even the Worker) can reach it without a new Edge Function; `sources` duplicates `ops_ingest_records`; no review, briefing or outcome |
| `ops_ingest_connectors / runs / records` | applied | 16 connectors, 36 records, 0 runs | registry, cursor checkpoint, run status, idempotent records, content hash, licence + retention policy | records are snapshots, not reviewed evidence |
| `ops_fact_claims` | applied | 0 rows | org-scoped machine facts | one predicate/value per record; no stance, no multi-evidence, no review |
| `eu_claims / eu_claim_evidence / eu_sources` | applied | 0 rows | publication-grade claims | bound to `eu_research_projects` and the Equity Uprise publishing pipeline; bibliographic sources only; members of a research project can read |
| `research_sources / research_artifacts` | applied | 0 rows | bibliography + artifacts | citations for papers, not operational evidence |
| `ai_context.decisions` | applied | 0 rows | canonical decision record; approver + time written by `context-decision` as the human | — (reused as is) |
| `action_missions / assignments / proofs` | applied | 37 missions, 0 proofs | real mission + proof review loop | no org_id; anon-readable at table level |

## 2. The chosen design and why

**Reuse what is applied and sound; add only the reviewed-intel layer that
none of them has.**

1. **Source registry, checkpoint, runs and snapshots reuse `ops_ingest_*`.**
   They are applied, org-scoped, idempotent (`unique (org_id, connector_id,
   idempotency_key)`), hash every record, carry `license_policy` and
   `retention_policy`, and already model `running/succeeded/partial/failed`.
   Migrating `seek_first_sources`/`seek_first_ingestion_runs` or applying
   `decision_intelligence.sources` would create a second registry.
2. **Decisions stay in `ai_context.decisions`.** Approver (`approved_by`),
   time (`approved_at`), rationale (`rationale_summary`) and status are
   already there and are written only by `context-decision`, which verifies
   the human and their owner/admin membership. The canon never copies those
   fields; it records **what the decision relied on** (`intel_decision_basis`)
   and reads state through one read-only function (`intel_decision_state`).
3. **Missions stay in `action_missions`; the link is a private table.**
   `intel_mission_decisions(mission_id → action_missions, decision_id →
   ai_context.decisions, objectives, scope, region_label, target_measures)`.
   A column on `action_missions` was rejected: that table is granted to
   `anon` at table level for public mission cards and has no `org_id`, so a
   private decision id would ride along on every public read.
4. **New `intel_*` tables for what nothing applied provides**: reviewable
   evidence, analytical claims with stance-bearing links and confidence,
   append-only review history, briefings with citations and freshness, and
   outcomes with proof links and measures. Stance vocabulary
   `supports | contradicts | context` matches #414, `decision_intelligence`
   and `eu_claim_evidence`.
5. **Public schema with RLS, not a private schema.** The Worker reaches
   Supabase through PostgREST with the service role (the repo pattern for
   `ops_*` and `action_*`); a private schema needs an Edge Function or an
   API-schema setting change. Browser roles still get no writes and no
   function execution.
6. **Every transition is one security-definer function**, so the approval
   check and the insert, the checkpoint and the rows, the review and its
   history each commit together.

Discarded: applying `decision_intelligence_v1` (unreachable, duplicates
sources), applying #414's tables (project-scoped fifth claim table), reusing
`eu_claims` (couples Halo intel to the Equity Uprise publishing pipeline and
its research-member read policy), extending `ops_fact_claims` (machine facts,
not reviewed claims).

## 3. Records and relations

| Record | Table | Key fields |
|---|---|---|
| Source | `ops_ingest_connectors` | `connector_key` (e.g. `usgs.earthquakes`), `license_policy {publisher, license, attribution, commercial_use, terms_url}`, `retention_policy {days}`, `cursor` (checkpoint), `last_ok_at`, `last_error` |
| Run | `ops_ingest_runs` | `status running/succeeded/partial/failed`, `records_seen/written/rejected`, `cursor_before/after`, `error`, `metadata.deduplicated` |
| Snapshot | `ops_ingest_records` | `external_id`, `idempotency_key`, `content_hash`, `source_ref {url, provider_id, retrieved_at}`, `observed_at`, `payload` |
| Evidence | `intel_evidence` | `kind source_record/mission_outcome/document`, FK to snapshot or outcome, publisher, URL, licence, attribution, `retrieved_at`, `content_sha256`, `lat/lon` (only `geo_source = source_published`), `review_status`, `visibility`, `retention_until` |
| Claim | `intel_claims` | statement, `subject_kind`, `purpose`, `status draft/under_review/supported/disputed/rejected/retracted`, `confidence`, `visibility` |
| Claim ↔ evidence | `intel_claim_evidence` | `stance supports/contradicts/context`, note, added_by |
| Review history | `intel_reviews` | subject, from → to, confidence, reviewer, note, time. Append-only (`update`/`delete` revoked even from `service_role`) |
| Briefing | `intel_briefings` + `intel_briefing_citations` | body, `drafting human/model_assisted`, author, `evidence_oldest_at/newest_at` (freshness, computed), ordered citations to claims and/or evidence |
| Decision | `ai_context.decisions` (existing) | approver, time, rationale, status, risk |
| Decision basis | `intel_decision_basis` | decision → exactly one of briefing / claim / evidence |
| Mission link | `intel_mission_decisions` | mission ← decision, objectives, scope, region, target measures, idempotency key |
| Outcome | `intel_outcomes` + `intel_outcome_proofs` | mission, decision, summary, `occurred_at`, `measures`, `status submitted/accepted/rejected`, reviewer; proofs → `action_proofs` |

Rules enforced in the database:

- a claim can be `supported` only with at least one **accepted** supporting evidence item;
- a briefing must cite at least one stored, non-rejected claim or evidence item in the same org;
- a mission can be created only from an `approved` decision of the same org; it is created as `draft` (publishing to members stays a separate admin act); repeat calls with the same idempotency key return the same mission;
- every proof on an outcome must belong to an assignment on that mission; an outcome can be `accepted` only with at least one `verified` proof (`action_proofs.status = 'verified'` is the real reviewed state);
- an accepted outcome becomes `intel_evidence(kind = mission_outcome)` and can be attached to the original claim with a stance, closing the loop;
- evidence or claims can leave `private` only once accepted / supported;
- coordinates are stored only as a pair the source published; `(0,0)` is refused and becomes "unknown"; nothing is geocoded or defaulted.

## 4. Tenancy, roles and RLS

| Role | Raw intel rows | Server functions | Projection |
|---|---|---|---|
| anon | none (no grants) | none | `public` audience via Worker `GET /v1/intel/geo` |
| authenticated member | none (RLS: owner/admin of the row's org only) | none | `members` audience via Worker |
| org owner/admin | `select` through RLS (`intel_is_org_admin(org_id)`) | through the Worker only | `owner` audience via Worker |
| service_role (Worker) | read/write; `intel_reviews` insert-only | execute | — |

Writes happen only through the Worker, which gates every `/v1/intel/*`
mutation with `requireHouseOwner` (McCluster house owner) and resolves the
org from `orgs.slug = 'mccluster'`; decision approval additionally passes the
owner's own bearer token to `context-decision`, which re-checks owner/admin
membership. Every Worker mutation also writes `control_audit` through
`lib/audit.js` (the existing ledger; no second audit table).

## 5. Public projection (the globe)

`intel_geo_projection(org, audience, since, until, cell_deg, time_bucket, k)`:

- counts only rows the audience may see (`public`: accepted + `visibility = public`; `members`: accepted + members/public; `owner`: everything not rejected);
- buckets = grid cell (`cell_deg` ∈ 1, 5, 10, 30) × time bucket (hour/day/week); window ≤ 92 days;
- **k-anonymity floor**: cells with fewer than `k` rows are suppressed and counted in `suppressed_records`/`suppressed_buckets`; `k` is never below 5 for members or the public (owner audience is exact);
- `located` vs `unknown_location` counts are always disclosed; unlocated rows are never placed;
- `cell_center` and `cell_bounds` describe the bucket, not any record. No IP addresses exist in this schema.

The same rules are the contract for any future people-adjacent layer (for
example analytics IP geolocation): aggregate to broad cells and time
buckets, suppress small groups, never show raw IPs, never invent
coordinates, disclose located vs unknown. Precise GPS stays opt-in and
separate.

### API contract for the World / Halo globe

`GET https://api.mccluster.org/v1/intel/geo?since=<ISO>&until=<ISO>&cell=<1|5|10|30>&bucket=<hour|day|week>`
(defaults: last 7 days, `cell=10`, `bucket=day`). Audience comes from the
caller: no token → `public`; signed-in member → `members`; house owner →
`owner`.

```json
{
  "ok": true,
  "schema": "mccluster-intel-geo/v1",
  "layer": { "key": "intel.evidence", "attribution": ["U.S. Geological Survey"] },
  "audience": "public",
  "k_threshold": 5, "cell_deg": 10, "time_bucket": "day",
  "since": "…", "until": "…",
  "totals": { "records": 0, "located": 0, "unknown_location": 0, "suppressed_records": 0, "suppressed_buckets": 0 },
  "buckets": [ { "cell": "g10:3:-12", "cell_center": { "lat": 35, "lon": -115 },
                 "cell_bounds": [-120, 30, -110, 40], "bucket_start": "…", "count": 7 } ],
  "generated_at": "…"
}
```

`503 {code: "intel_schema_not_ready"}` until the migration is applied. The
globe should draw buckets as cells (never as points), show
`located`/`unknown_location`, and show the attribution list.

## 6. Purpose limits (CRM and civic use)

- `intel_claims.subject_kind` has **no `person`** value; this schema cannot hold person-level subjects.
- `intel_claims.purpose` ∈ `public_interest_research | nonprofit_program | operations`. There is **no electoral lane**: election work stays separate from nonprofit activity and must not use this schema.
- No voter-level psychological profiling, sensitive-trait inference or covert persuasion targeting is in scope for this schema or its routes. CRM data (`out_*`) is not joined into intel tables; any future CRM link must be purpose-limited, consented and audited, and is a separate reviewed design.

## 7. Retention and deletion

- `intel_evidence.retention_until` defaults from the connector's `retention_policy.days` (365 if unset) at write time.
- `intel_prune_expired_evidence(org, limit)` deletes expired evidence that nothing cites; cited evidence is kept (FKs are `on delete restrict`), so a decision never loses its basis. Not scheduled by this migration.
- Snapshots in `ops_ingest_records` follow the connector's policy; sources whose terms forbid persistence (`persistence: transient/none` in the registry) are never collected.
- Review history and `control_audit` are not pruned by these functions.

## 8. Apply order (owner, after review)

1. Read this document, the migration and its rollback.
2. Run `PGHOST=… PGPORT=… PGUSER=… scripts/test-intel-canon-db.sh` against a scratch Postgres 16 (it builds the dependent tables, applies the canon, runs the behaviour test, applies the rollback, and re-applies the canon).
3. Apply `20261015210000_intel_mission_canon_v1.sql` with Supabase `apply_migration` under the name `intel_mission_canon_v1`, then promote it per `supabase/pending/README.md` (ledger, drift contract).
4. `20261011190000_decision_intelligence_evidence_v1.sql` was superseded and removed from `supabase/pending/` on 2026-10-27; never apply it from history.
5. Rollback: `20261015210000_intel_mission_canon_v1.rollback.sql` (drops only the canon's objects; see its data note).

## 9. Vertical slice (Worker `mccluster`, `src/intel/`)

Routes. Everything is owner-only (`requireHouseOwner`) except `geo`. Every mutation is audited in `control_audit`.

| Route | Does |
|---|---|
| `GET /v1/intel/health` | `schema_ready`, collector flag, stored totals, latest run, last successful run, failures (7 days), each reported separately |
| `POST /v1/intel/collect/usgs` | one collector run; `409 collector_disabled` while the flag is off |
| `GET /v1/intel/evidence?review_status=` | the evidence review queue |
| `POST /v1/intel/evidence/:id/review` | `{status: accepted|rejected, visibility?, note?}` |
| `POST /v1/intel/claims` | `{statement, subject_kind, purpose, evidence:[{evidence_id, stance, note?}]}` |
| `POST /v1/intel/claims/:id/review` | `{status, confidence?, visibility?, note?}` |
| `POST /v1/intel/briefings` | `{title, body, citations:[{claim_id?|evidence_id?, locator?}], drafting?}` |
| `POST /v1/intel/decisions` | proposes through `context-decision` with the owner's own token, then records the basis |
| `POST /v1/intel/decisions/:id/approve` | `{status: approved|rejected, note?}` through `context-decision` |
| `POST /v1/intel/decisions/:id/missions` | `{idempotency_key, title, description?, domain?, objectives?, scope?, region_label?, target_measures?}` creates a draft mission |
| `POST /v1/intel/missions/:id/outcomes` | `{idempotency_key, summary, occurred_at, measures?, proof_ids:[…]}` |
| `POST /v1/intel/outcomes/:id/review` | `{status, note?, claim_id?, stance?}`; an accepted outcome becomes evidence |
| `GET /v1/intel/lineage/claims/:id` | claim → evidence → briefings → decisions → missions → outcomes |
| `GET /v1/intel/geo` | the globe aggregate (§5) |

### The source: USGS earthquakes

- **Service:** USGS FDSN event web service (`earthquake.usgs.gov/fdsnws/event/1/query`).
- **Terms:** USGS-authored data are U.S. Government works in the public domain. USGS asks for the credit "U.S. Geological Survey". Commercial use and display are fine.
- **Bounds:** magnitude 2.5 and above, at most 500 events per run, oldest first. The first run looks back 24 hours. Every later run starts 60 minutes before the checkpoint, because USGS revises recent events.
- **Cadence:** the Worker's 5-minute cron. The database refuses a new run within 15 minutes of the last one, and refuses while another run is live (a 15-minute lease). That allows at most 96 requests a day.
- **Rate limits:** none published. The service errors above 20,000 results per query, far above the 500 requested.
- **Errors:** network failures, timeouts, non-2xx answers, redirects (`redirect: 'manual'`), invalid JSON and the wrong shape each produce a failed run with the reason, and the cursor does not move. A zero is recorded only after an explicit HTTP 204 or an empty FeatureCollection.
- **Idempotency:** each event is keyed `usgs:<id>:<updated>`. A revised event becomes a new snapshot; an unchanged one deduplicates.
- **Flag:** `INTEL_USGS_COLLECTOR_ENABLED` is `"false"` in `wrangler.toml`. While it is off, the cron makes no call of any kind.
