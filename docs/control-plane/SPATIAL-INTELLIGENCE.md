# McCluster Spatial Intelligence

## Status

Implemented on the canonical Worker. See "What is live" below for the exact
surface, and `SEEK-FIRST-CLOUDFLARE-HANDOFF.md` for the remaining owner actions
(API keys, Cloudflare Access, and the production migration).

This is **Seek First**, McCluster's native spatial-intelligence backend: a data-fusion layer that turns many public and licensed geospatial sources into one longitudinal, provenance-tracked store. It is not a second backend.

Canonical McCluster law still applies:

- the only control-plane Worker is `mccluster`;
- the API remains `https://api.mccluster.org`;
- the shared Supabase project remains the data plane;
- `HereTenantAgent` stays exported;
- Whip, Equity Uprise, PRIM3, HERE/client products, policy tooling, and future satellites consume the same control plane.

## Design approach

No third-party application code is imported into this backend. Many external
data sources are represented as adapters, normalized into common
spatial/temporal records, and exposed through one API — implemented
independently against each provider's current, live API.

No blanket license covers every third-party feed a data-fusion viewer can
visualize. Every source must retain its own provenance, terms, entitlement
lane, and redistribution rules.

## What is live

### The one public route

`GET /v1/seek-first/health` is the only route that answers without authentication,
and it says whether the subsystem is up and nothing else. Which providers
hold credentials is a map of where the keys are, so that inventory sits
behind the house-owner check with everything else.

### Authenticated API (McCluster house owner)

Read surface:

| Route | What it answers |
| --- | --- |
| `GET /v1/seek-first/readiness` | schema state, adapter capabilities, which bindings are still missing |
| `GET /v1/seek-first/sources?lane=` | the source catalogue with an entitlement decision per source |
| `GET /v1/seek-first/entitlements?lane=` | what this org may do with each source on that lane |
| `GET /v1/seek-first/capabilities` | the route table and the lane vocabulary |
| `GET /v1/seek-first/viewer/config` | runtime configuration for the internal console |
| `GET /v1/seek-first/entities` | stored entities, filterable by source and type |
| `GET /v1/seek-first/entities/:id` | one entity's current state |
| `GET /v1/seek-first/entities/:id/history` | its revisions and its observation series |
| `GET /v1/seek-first/nearby` | entities within a radius |
| `GET /v1/seek-first/bbox` | entities in a bounding box |
| `GET /v1/seek-first/events/nearby` | events within a radius |
| `GET /v1/seek-first/timeline` | revisions, events and observations for a place and a window |
| `GET /v1/seek-first/projects` / `GET /v1/seek-first/layers` | project and layer definitions |
| `GET /v1/seek-first/ingestion-runs` | what ran, what it wrote, what failed |
| `GET /v1/seek-first/live/ais` | the Durable Object's AIS cache (`bbox`, `limit`) |

Write surface:

| Route | What it does |
| --- | --- |
| `POST /v1/seek-first/fetch/:source` | broker a provider call; persists unless `persist: false` |
| `POST /v1/seek-first/ingest/:source` | broker and persist, returning the ingestion run |
| `POST /v1/seek-first/live/ais/restart` | recycle the AIS socket |

Both write routes accept `lane` (default `INTERNAL`); the entitlement
firewall below decides whether that lane may consume that source.

### Internal console

`GET /internal/seek-first` on `api.mccluster.org`. Operations surface only: not
linked from any public page, `noindex`, `X-Frame-Options: DENY`,
`Cache-Control: private, no-store`, and a CSP with no wildcards. It holds no
data and no credential of its own — everything it draws comes back from
`/v1/seek-first/*` behind the house-owner check.

The globe boots from OpenStreetMap imagery and an ellipsoid, so it renders
with no paid credential at all. Google Photorealistic 3D Tiles and Cesium ion
terrain are added afterwards when their keys exist, each timed out and each
falling back to the open stack. Every boot step is bounded and reported; a
fatal error shows a diagnostic with Retry and Continue rather than a spinner.

## The entitlement firewall

`workers/mccluster/src/seek-first/entitlements.js`.

A CONSUMER declares the lane it is asking on behalf of. A SOURCE declares the
licence class it was obtained under. The pair decides access:

| Source class | Consumable by |
| --- | --- |
| `PUBLIC_OPEN` | every lane |
| `ACADEMIC` | `ACADEMIC`, `INTERNAL` |
| `NONPROFIT` | `NONPROFIT`, `INTERNAL` |
| `COMMERCIAL` | `COMMERCIAL`, `INTERNAL` |
| `INTERNAL` / `RESTRICTED` | `INTERNAL` |

So a commercial Whip build asking for Planet's education-and-research imagery
is refused with `entitlement_lane_denied`, even though the same owner holds
both accounts. `INTERNAL` reads every lane precisely because it is the one
consumer that never redistributes.

A row in `public.seek_first_source_entitlements` narrows or widens the default for
one org and can carry an expiry. It can withdraw a permission; it cannot
invent one the registry does not allow — a row claiming `persistence_allowed`
on a source whose policy is `none` still stores nothing.

## Retention

Three policies, set per source in the registry and enforced in `store.js`:

- `persistent` — normalized records may be retained in PostGIS.
- `transient` — brokered and returned, never archived (TomTom, OpenSky, AIS,
  Nominatim, GDELT, CCTV catalogues, Mapbox).
- `none` — provider content is never written at all (Google Maps, Cesium ion).

AIS is cached only in the Durable Object, bounded by row count and a one-hour
TTL, and never lands in PostGIS.

## History

`seek_first_entities` holds current state and is upserted by `external_id`, so on its
own an April "wooded parcel" would be silently overwritten by a July "building
footprint" — losing exactly the change that matters.

`seek_first_entity_revisions` (migration `20260909040000`) records each real change
via an `AFTER INSERT OR UPDATE` trigger. A re-ingest that finds the world
unchanged updates `last_seen_at` and writes no revision, so the history stays
a record of events rather than a record of how often the collector ran.

`seek_first_timeline(...)` merges revisions, events and observations for a place and
a time window, returning provenance with every row.

## Database boundary

Every `seek_first_*` table has RLS enabled, is revoked from `anon` and
`authenticated`, and is granted only to `service_role`. The spatial RPCs are
`security invoker` and executable only by `service_role`. Browsers never reach
these tables; the canonical Worker authorizes first and calls as the service
role, which is what makes the retention and entitlement rules enforceable
rather than advisory.

## Source adapter contract

Every adapter will do five things:

1. **authorize** using a server-side Worker binding when required;
2. **fetch** raw provider data without leaking credentials;
3. **normalize** provider-specific payloads into McCluster entities, observations, events, and relationships;
4. **attach provenance and entitlement metadata** to every normalized record;
5. **archive observations instead of overwriting history** so the system becomes longitudinal.

Initial source metadata lives in `workers/mccluster/src/seek-first/source-registry.js`.

## Eligibility firewall

A credential is not just a key. It carries a permitted-use lane.

Bootstrap lanes include:

- `OPEN`
- `SCSU_RESEARCH`
- `MCCLUSTER_NONPROFIT`
- `COMMERCIAL`
- `COMMERCIAL_OR_NONPROFIT`
- `VIEWER`

`public.seek_first_source_entitlements` carries the explicit rights metadata that
narrows these lanes per org:

- source class;
- entity/account that owns the entitlement;
- commercial use allowed;
- public display allowed;
- redistribution allowed;
- derived use allowed;
- attribution required;
- retention restrictions;
- effective and expiration dates.

A commercial satellite such as Whip must never receive an academic-only
dataset merely because the same person controls both projects. That rule is
enforced in `seek-first/entitlements.js`, not merely documented here — see "The
entitlement firewall" above.

## Spatial data model

Migrations `20260909034000`, `20260909034100` and `20260909040000` create:

- `seek_first_sources`
- `seek_first_source_entitlements`
- `seek_first_layers`
- `seek_first_entities`
- `seek_first_observations`
- `seek_first_events`
- `seek_first_relationships`
- `seek_first_projects`
- `seek_first_project_entities`
- `seek_first_ingestion_runs`
- `seek_first_derived_metrics`
- `seek_first_alert_rules`
- `seek_first_alerts`

plus `seek_first_entity_revisions`. PostGIS lives in the `extensions` schema; spatial
columns are SRID 4326 with GiST indexes.

Every one of these tables has RLS enabled and is revoked from `anon` and
`authenticated`; only `service_role` holds privileges, and the canonical Worker
authorizes before it calls as that role. Verified by replaying the migrations
against PostgreSQL 16 with PostGIS: after deliberately re-granting the old
permissive Supabase defaults, re-running the migration closed the boundary
again and both browser roles were refused the tables and the RPCs.

## Why observations are append-only history

`seek_first_entities` describes the canonical thing. `seek_first_observations` describes what a source said about that thing at a point in time.

That distinction allows McCluster to answer questions such as:

- What physically changed around a proposed data center over 90 days?
- Which permits preceded visible land clearing?
- How did congestion change before and after a facility opened?
- Which census, environmental, infrastructure, and funding facts were true when a policy decision was made?

The data asset is the history, not the globe renderer.

## Product consumers

### Policy / Equity Uprise

Parcels, zoning, permits, Census, EPA, EIA, broadband, federal spending, grants, satellite change, transportation, and derived impact metrics.

### Whip Equipped

Privacy-preserving aggregated mobility observations, road hazards, traffic, routing, vehicle availability, charging/parking, fleet operations, and transportation-policy outputs. Do not expose individual rider histories as public intelligence.

### CRM / outreach

Organizations and facilities can share stable entity IDs with contacts, communications, opportunities, awards, jurisdictions, and geographic footprints.

### Faith / facilities

Private digital-twin and asset observations can use the same entity/event model while remaining access controlled.

### PRIM3 / Site 0

3D and world data can consume spatial APIs without making the renderer or game repository the source of truth.

## Credential handling

Never commit API keys to GitHub.

The registry names expected Worker environment bindings only. `/v1/seek-first/sources`
reports whether a binding is configured, never its value, and requires the
house owner.

Two credentials are different in kind: `GOOGLE_MAPS_API_KEY` and
`CESIUM_ION_TOKEN` are browser-side credentials that the globe cannot use
unless the browser holds them. They are released only through
`GET /v1/seek-first/viewer/config`, only to a verified house owner. Restrict the
Google key by HTTP referrer and use a scoped read-only ion token. Every other
binding is server-side only and never leaves the Worker.

When credentials arrive, add them through the Cloudflare secret/environment configuration for the canonical `mccluster` Worker and assign their entitlement lane in the data plane.

## Database rollout

The migrations are written and replay cleanly, but they have NOT been applied
to production Supabase from this branch. Reconcile the production migration
lineage first, then apply them through the repository's real Supabase workflow
and run the advisor checks.

Until then the Worker degrades honestly rather than failing: `/v1/seek-first/health`
reports `mode: adapter-ready`, provider brokering through
`POST /v1/seek-first/fetch/:source` works, and only the routes that read stored data
return `spatial_schema_not_ready`.
