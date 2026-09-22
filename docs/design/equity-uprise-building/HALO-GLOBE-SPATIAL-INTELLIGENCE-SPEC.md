# Equity Uprise Floor 6 — Halo Globe / Spatial Intelligence Integration Spec

> Status: **CANONICAL PROGRAM / INTERACTION AUTHORITY — CORE V2**
>
> Scope: the Hitman's Halo / Seek First instrument inside **Floor 6 — Penthouse Command**.
>
> This document does not replace `FLOOR-06-PENTHOUSE-COMMAND-360-SPEC.md`, `FLOOR-06-SCHEMATIC-PLAN-BASIS.md`, `BUILDING-CORE-V2-SPEC.md`, or the shared McCluster spatial-intelligence contracts.

## 1. Architectural role

Floor 6 gains one major shared-platform instrument:

**HALO GLOBE / SPATIAL INTELLIGENCE**

It is a restrained, slowly rotating globe suspended within the Penthouse Command zone. It is not a new room, floor, department, tactical surveillance wall, or independent backend.

The architectural reading is:

- **Institutional Command Wall** — what Equity Uprise is doing.
- **Command Table** — what the institution is deciding.
- **Halo Globe** — what is happening in the world around those decisions.

Hitman's Halo remains a separate application/runtime. Equity Uprise consumes a permissioned spatial-intelligence projection from the canonical McCluster control plane.

## 2. System authority

Canonical control/data plane:
- `mcclusterishere/mccluster`;
- Worker `mccluster` at `api.mccluster.org`;
- shared Supabase data plane;
- Seek First entitlement/provenance contracts;
- McCluster Core for the owner-hosted Halo runtime.

Client/runtime:
- `mcclusterishere/hitmans-halo`.

The building never becomes the spatial data source of truth.

## 3. Core V2 placement reservation

Conceptual globe envelope:
- plan center: **(55, 12) ft**;
- sphere radius: **2.25 ft**;
- sphere diameter: **4.5 ft**;
- center height: **8.25 ft AFF**;
- bottom of visible sphere: **6.0 ft AFF**;
- top of visible sphere: **10.5 ft AFF**;
- route key: `halo_spatial_intelligence`.

The globe is an **overhead/suspended visual instrument**. Its plan footprint is a coordination envelope, not occupied floor furniture.

It may not:
- move the command table;
- intrude into the passenger-elevator approach;
- reduce required circulation;
- obstruct either stair;
- intrude into the west service core;
- obstruct the north support corridor;
- cover the 360 camera datum;
- create a new structural/core condition.

Final mounting, structure, power, AV, heat and maintenance access require professional design if this becomes a real building element.

## 4. Visibility vs authority

The globe exists visually for every visitor. Account state changes **what it may reveal**, not whether the globe exists.

### Public / guest
- globe visible and slowly rotating;
- sanitized, public-display-approved layers only;
- read-only;
- no private stakeholder graph;
- no owner health/configuration data;
- no provider credentials;
- no internal audit, approval or operational controls.

### Member / fellow / partner
- public layers plus role-approved read-only layers;
- no write authority merely because a layer is visible.

### Staff / editor
- authorized institutional read layers according to role;
- consequential actions remain separately gated.

### House owner / admin
- full authorized Halo/Seek First view;
- may enter the protected operational Halo surface;
- write/ingest/control actions remain subject to the canonical authorization, entitlement, approval, provenance and audit rules.

**Layer entitlement and action authority are separate dimensions.**

## 5. Data licensing / entitlement rule

Seek First source entitlements remain authoritative.

A source may appear in a public Equity Uprise projection only when its effective entitlement permits public display and its provider terms permit the proposed use.

No Equity Uprise UI may:
- convert INTERNAL/RESTRICTED data into public data;
- treat possession of a key as permission;
- bypass source-class lane restrictions;
- expose credentials;
- expose raw owner-only configuration;
- claim completeness when a source is delayed, modeled or unavailable.

## 6. Public projection boundary

The public Equity Uprise globe must **not** call owner-only `/v1/seek-first/*` data routes directly.

Canonical pattern:
- owner/admin plane remains protected;
- Equity Uprise receives a separate sanitized read-only projection contract;
- public projection exposes only display-safe layer metadata and explicitly approved display payloads;
- privileged Halo control remains behind owner authentication.

The projection must fail closed if entitlement/visibility cannot be determined.

## 7. Interaction states

Required Floor 6 states:

1. **halo_ambient**
   - slow rotation;
   - minimal labels;
   - public-safe world context.

2. **halo_public**
   - sanitized public layer selector;
   - read-only inspection.

3. **halo_member**
   - authenticated role-scoped read layers.

4. **halo_staff**
   - authorized institutional read layers.

5. **halo_owner**
   - protected handoff to the real Halo/Seek First operational console.

The building scene itself never receives provider secrets or owner tokens.

## 8. Initial layer semantics

The globe may visually represent categories already supported by Halo/Seek First, subject to entitlement and availability, including:
- public infrastructure;
- environmental/hazard context;
- aircraft/space context;
- public cameras/catalog context;
- public policy/geographic context;
- Equity Uprise initiatives and published proof where a spatial representation exists.

A layer shown in the building must disclose uncertainty/modeling when the underlying source does.

## 9. Branding / tone

The Halo Globe is an instrument inside Equity Uprise, not replacement branding.

- Equity Uprise remains the Floor 6 identity.
- Do not put HM/Hitman branding across the room.
- Do not convert the floor into a military command center.
- Do not create a giant tactical surveillance wall.
- Keep the globe visually restrained enough that NOW / PAST WORK / JOIN remains legible.

## 10. Validation requirements

The Core V2 validators must verify:
- `halo-spatial-intelligence` is a canonical capability;
- Floor 6 claims the capability;
- Floor 6 contains exactly one canonical Halo Globe instrument;
- its route key resolves;
- its public route is read-only;
- owner operations remain explicitly protected;
- the sphere envelope does not overlap fixed core geometry;
- generated plan references include the Halo Globe label/symbol;
- generated 3D includes a spherical Halo object;
- no change is made to the shared vertical core.
