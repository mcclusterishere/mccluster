# Equity Uprise — Vertical Distribution + Riser Spec

> Status: **ACTIVE CONCEPTUAL DISTRIBUTION AUTHORITY — EXACT SUB-RISER GEOMETRY PENDING**
>
> Machine companion: `production/vertical-risers-core-v2.json`.
>
> **Not for construction.**

## Shared reservation

Core V2 currently reserves the principal MEP/service zone at approximately:

**X50–60 / Y66–72**

This reservation remains fixed unless a formal Core V2 revision is approved.

The exact internal partition of that reservation into individual electrical, data, plumbing, HVAC, fire and controls shafts is **not yet construction-resolved**.

## Distribution principle

The building will use a coordinated vertical service spine from B1 through Level 7.

Conceptual riser families:
- electrical normal power;
- emergency/UPS-backed power;
- telecom/data;
- BAS/controls/security;
- HVAC supply/return/exhaust;
- domestic water;
- sanitary/vent;
- storm drainage;
- fire protection.

## Floor-branch rule

At every served level, each required system may branch from the vertical spine through:
- corridor/service-ceiling distribution;
- dedicated support closet / local cabinet;
- concealed wall/ceiling routes;
- exposed technical routes where programmatically appropriate.

Branch routes may not obstruct:
- Stair A;
- Stair B;
- passenger elevator;
- freight/service elevator;
- required doors;
- primary circulation;
- the roof walking plane.

## B1 origin

B1 is the principal visible service origin/monitoring level for:
- electrical/emergency power;
- mechanical plant;
- telecom core;
- fire/water;
- flood/sump;
- building systems observation.

The digital twin uses B1 as the primary visible technical backbone unless later site/utility authority establishes another boundary.

## Roof termination

Level 7 may contain:
- HVAC/service terminations;
- roof drainage collection;
- screened equipment;
- lightning-protection concept;
- service access.

These must remain coordinated with protected stair arrivals, roof circulation, mobility reservation and passenger/service core assumptions.

## Exact-geometry gate

Before detailed riser geometry is added, a later implementation pass must:
1. allocate sub-riser envelopes inside or immediately coordinated with the shared reservation;
2. check clashes with the existing core;
3. create per-floor services addenda;
4. verify branch routes to representative endpoints;
5. preserve vertical continuity B1→Level 7.

No renderer may invent arbitrary pipes/ducts through floors before this coordination occurs.
