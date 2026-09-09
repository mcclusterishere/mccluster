# McCluster Spatial Intelligence

## Status

Bootstrap branch: `feature/gev-spatial-intelligence`

This is the McCluster-native backend adaptation of the data-fusion ideas demonstrated by **God's Eye View** (`bilawalsidhu/gods-eye-view`). It is not a second backend and it is not a blind copy of the upstream application.

Canonical McCluster law still applies:

- the only control-plane Worker is `mccluster`;
- the API remains `https://api.mccluster.org`;
- the shared Supabase project remains the data plane;
- `HereTenantAgent` stays exported;
- Whip, Equity Uprise, PRIM3, HERE/client products, policy tooling, and future satellites consume the same control plane.

## Upstream relationship

Upstream reference: https://github.com/bilawalsidhu/gods-eye-view

The initial backend bootstrap imports **no upstream application code**. It reimplements the useful architectural idea independently: multiple external data sources are represented as adapters, normalized into common spatial/temporal records, and exposed through one API.

The upstream repository's code license does not grant McCluster blanket rights to every third-party feed the upstream project can visualize. Every source must retain its own provenance, terms, entitlement lane, and redistribution rules.

## API namespace

Spatial intelligence lives under:

- `GET /v1/geo`
- `GET /v1/geo/health`
- `GET /v1/geo/sources`

Planned after the database schema is generated and verified:

- `GET /v1/geo/layers`
- `GET /v1/geo/entities`
- `GET /v1/geo/entities/:id`
- `GET /v1/geo/entities/:id/history`
- `GET /v1/geo/events`
- `GET /v1/geo/features`
- `GET /v1/geo/nearby`
- `GET /v1/geo/projects/:id`
- `POST /v1/geo/query`
- `POST /v1/geo/analyze`

## Source adapter contract

Every adapter will do five things:

1. **authorize** using a server-side Worker binding when required;
2. **fetch** raw provider data without leaking credentials;
3. **normalize** provider-specific payloads into McCluster entities, observations, events, and relationships;
4. **attach provenance and entitlement metadata** to every normalized record;
5. **archive observations instead of overwriting history** so the system becomes longitudinal.

Initial source metadata lives in `workers/mccluster/src/geo/source-registry.js`.

## Eligibility firewall

A credential is not just a key. It carries a permitted-use lane.

Bootstrap lanes include:

- `OPEN`
- `SCSU_RESEARCH`
- `MCCLUSTER_NONPROFIT`
- `COMMERCIAL`
- `COMMERCIAL_OR_NONPROFIT`
- `VIEWER`

The database layer will expand this into explicit rights metadata such as:

- source class;
- entity/account that owns the entitlement;
- commercial use allowed;
- public display allowed;
- redistribution allowed;
- derived use allowed;
- attribution required;
- retention restrictions;
- effective and expiration dates.

A commercial satellite such as Whip must never receive an academic-only dataset merely because the same person controls both projects.

## Planned spatial data model

The first durable schema should support:

- `geo_sources`
- `geo_source_entitlements`
- `geo_layers`
- `geo_entities`
- `geo_observations`
- `geo_events`
- `geo_relationships`
- `geo_projects`
- `geo_project_entities`
- `geo_ingestion_runs`
- `geo_derived_metrics`
- `geo_alert_rules`
- `geo_alerts`

PostGIS should be enabled in the existing Supabase project and spatial columns should use SRID 4326 with GiST indexes where appropriate.

All tables in an exposed schema must have RLS enabled. Raw/restricted spatial records should be server-mediated through the canonical Worker rather than made anonymously readable by default.

## Why observations are append-only history

`geo_entities` describes the canonical thing. `geo_observations` describes what a source said about that thing at a point in time.

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

The registry names expected Worker environment bindings only. `/v1/geo/sources` may report whether a binding is configured, but must never return its value.

When credentials arrive, add them through the Cloudflare secret/environment configuration for the canonical `mccluster` Worker and assign their entitlement lane in the data plane.

## Database rollout

Do not invent a migration filename or mutate production casually. Generate the spatial schema through the repository's real Supabase migration workflow, review the diff, run security/advisor checks, then apply it deliberately.

The API bootstrap can ship before the schema because it only exposes source/readiness metadata. Data-bearing routes stay disabled until the schema and RLS model are verified.
