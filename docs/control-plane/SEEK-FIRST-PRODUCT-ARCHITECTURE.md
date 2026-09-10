# Seek First Product Architecture

**Status:** control-plane authority  
**Backend:** existing `mccluster` Worker  
**Viewer satellite:** `mcclusterishere/Seek-First`

## Decision

God's Eye View / Seek First is a **viewer and product surface**, not a second McCluster backend.

```text
Seek First viewer
   -> canonical McCluster authentication
   -> /v1/seek-first/* on Worker mccluster
   -> entitlement/licensing firewall
   -> provider adapters / Durable Objects / queues
   -> Supabase spatial persistence where allowed
   -> optional subordinate compute/ingest nodes
```

No satellite may become an alternate source of truth for user identity, entitlements, provider secrets, persisted McCluster spatial state or cross-product licensing decisions.

## Current canonical API

Current `workers/mccluster/src/seek-first/index.js` exposes the control surface needed by the richer viewer, including:

- health/readiness;
- source catalog;
- entitlement catalog;
- viewer configuration;
- provider fetch/ingest;
- live AIS snapshots/restart;
- entity queries;
- bbox/nearby/event queries;
- timeline;
- entity history;
- projects/layers;
- ingestion-run history.

The viewer should adapt to these contracts rather than reproducing the upstream Vite proxy routes in production.

## Owner access

Owner/admin access is independent of PRIM3 campaign completion.

For the current private console, the McCluster house-owner check plus Cloudflare Access may gate the surface.

Future normal-player GEV access may add the PRIM3 `ASCENDED` entitlement without weakening owner/admin authorization.

## Entitlement lanes

The current Seek First backend already separates source classes and consumer lanes. Preserve that architecture.

Key principle:

> eligibility affects what McCluster may consume under a given product lane; eligibility must not become a skeleton key that makes restricted/academic/nonprofit data commercial by association.

Examples:
- public/open source -> broadly reusable subject to source terms;
- academic source -> academic/internal research lane only unless provider separately licenses broader use;
- nonprofit source -> nonprofit/internal lane only unless provider separately licenses broader use;
- commercial source -> commercial/internal according to paid/provider terms;
- internal/restricted -> owner/control-plane only unless explicitly granted.

## Browser credentials

Some rendering providers require browser-visible public/restricted tokens. The backend may return only those deliberately browser-consumable tokens to authenticated clients and only with the strongest provider-side origin/API/asset restrictions supported.

All secret provider credentials remain server-side.

## Optional compute nodes

A VM/container may be introduced when a workload is unsuitable for Worker execution, for example:
- long-running feed connection not adequately handled by Durable Objects;
- heavy media transformation;
- CPU-intensive geospatial preprocessing;
- bulk ETL;
- model inference requiring dedicated hardware;
- cache/materialization jobs whose economics favor a persistent process.

Such a node is a **subordinate worker**:

```text
canonical control plane
   -> signed job / authenticated service request
   -> compute node
   -> normalized result
   -> canonical persistence/entitlement decision
```

It does not own end-user sessions or the provider entitlement policy.

## `grok/spatial-plane` salvage decision

The stale branch is not mergeable wholesale. Its valuable architectural ideas include:
- application identity derived from authentication rather than caller-supplied labels;
- capabilities mapped to product identities;
- sanitized public plane vs authenticated internal plane;
- explicit distinction between fetch and ingest;
- prevention of owner status from automatically widening a commercial satellite's license lane.

Reimplement any missing pieces against current `/v1/seek-first` contracts after tests prove a gap. Do not restore the old `/v1/geo` namespace.

## Viewer modernization contract

`mcclusterishere/Seek-First` may aggressively diverge from upstream in presentation/performance while preserving a clear adapter boundary.

Preferred client modules:
- `platform/mccluster-api` — canonical transport;
- `platform/session` — McCluster auth handoff/session;
- `platform/source-catalog` — backend-driven layer availability;
- `render/*` — Cesium/WebGL only;
- `state/*` — local view/selection state only;
- `intel/*` — provenance/confidence/freshness presentation;
- `agent/*` — bounded UI tools; never direct provider-secret access.

## Production invariants

1. One identity plane.
2. One entitlement/licensing firewall.
3. One canonical spatial persistence plane.
4. Secret-bearing provider calls originate from controlled backend services.
5. Viewer failure never mutates entitlement state.
6. Provider failure degrades a layer rather than failing the whole product.
7. Every persisted observation records source/provenance and terms-appropriate metadata.
8. Cost-bearing operations can be attributed to a user/org/source/lane.
9. Owner/admin access is auditable.
10. Future PRIM3 player entitlement is additive, not a replacement for backend authentication.
