# PRIM3 Site 0 — 3D Master Asset Handoff

This directory is the canonical handoff point for PRIM3 Site 0 / Ground Zero.

## Current canonical production master

`PRIM3_Site0_Master_Facility_v04.glb` — 120 nodes, committed directly.

Verification:

`PRIM3_Site0_Master_Facility_v04_manifest.json`

v04 is v03 with two things fixed: the central void cut into **L1 and L2
only**, and the forbidden PRIME roof spur actually removed (v03 still
contained all seven of its nodes while its manifest claimed otherwise).
See `MODEL_STATE_2026-08-19.md` for the measurements and the section test,
and `tools/carve_l1_l2_void.py` for how it was done.

`PRIM3_Site0_Master_Facility_v03.glb` is kept beside it as the pre-carve
reference. The chunked-payload assembler that used to produce it was
broken and has been retired — see `tools/README.md`.

Agents must read `AGENTS.md` and `PRIM3_Site0_CANONICAL_ARCHITECTURE_v03.json` before changing Site 0.

## Canonical massing

Site 0 is one wide oblong building, approximately **1268 m east-west × 824 m north-south** conceptually. The long axis runs east-west across the facade and L3 flight deck. The rejected v02 north-south elongation remains historical only.

## Central Mobility Canyon

The master preserves:

- centered V1/V2 aircraft/heavy lifts with B3/B2/B1/L1/L2/L3 stops;
- R1/R2 tank-capable ramps B3↔B2↔B1↔L1↔L2;
- the L1 NORTH-SOUTH through-road;
- the L2 business drone pad and retractable L3/sky slot.

See `PRIM3_Site0_VERTICAL_MOBILITY_CANYON_SPEC.md`.

## PRIME heavy deployment — corrected P1 geometry

B3 intentionally contains a segregated PRIME heavy-deployment hall.

Two independent PRIME routes exist:

1. **P1 external B3↔L3 heavy lift** — outside the SOUTH shell, B3/L3 stops only.
2. **Direct SOUTH B3 surface escape ramp** — B3 to grade beyond the primary perimeter and the offsite strip.

### P1 is flush with L3

At L3 the P1 platform rises **flush with the SOUTH edge of the flight deck**, like a carrier deck elevator. Equipment rolls/tows directly from the lift into the L3 apron/merge lane and normal deck circulation.

**There is no elevated L3 departure bridge/spur.**

The old `L3_PRIME_ELEVATED_DEPARTURE_SPUR` and `L3_PRIME_SPUR_SUPPORT_*` geometry is rejected and removed. Future agents must not recreate the same geometry under different names.

### Independent surface route

The B3 surface escape ramp remains a separate route to grade beyond the gate perimeter. It does not connect back to the roof.

See:

- `PRIM3_Site0_PRIME_ESCAPE_SPINE_SPEC.md`
- `PRIM3_Site0_Prime_Escape_Spine_v02.obj`
- `PRIM3_Site0_Prime_Escape_Spine_v02_manifest.json`
- `plans/PRIM3_Site0_L3_PRIME_DEPLOYMENT_PLAN.svg`
- `plans/PRIM3_Site0_PRIME_ESCAPE_SPINE_SECTION.svg`

## Vertical program

- **L4** — Island Superstructure / Executive Penthouse / Flight Control.
- **L3** — Flight / Landing-Launch Deck; EAST-WEST runway; centered V1/V2 aperture; EAST command island; flush P1 deck elevator interface.
- **L2** — Business Administration + Aviation Support & Aerial Security.
- **L1** — Ground Defense / Enforcement / Coexistence + Surface Interconnector.
- **B1** — Open Technology Research Vault.
- **B2** — Industrial Production & Advanced Fabrication.
- **B3** — Prime Command & Sustainment + Heavy Deployment (Restricted).
- **B4** — Deep Transit / Interfacility Logistics.
- **B5** — Global Coordination / Resilience Node.

## Asset rules

- Base environment stays empty: no baked people, aircraft, vehicles, robots, terrain, desert or sky.
- Keep levels, island, ramps, lifts, road, apertures and cores separately named/editable.
- Keep P1, `L3_PRIME_FLUSH_DECK_TRANSITION`, Prime surface ramp and offsite strip separate gameplay nodes.
- Never restore the elevated L3 PRIME spur/support-pier design.
- Do not destructive-boolean the whole facility into one mesh.
- Any heavy-transfer-routing change must update the canonical contract, master manifest, relevant plans/specs and Site 0 `AGENTS.md` in the same change.

## Status

`PRIM3_Site0_Master_Facility_v03.glb` is the canonical integrated production master. v02 assets are not authoritative.
