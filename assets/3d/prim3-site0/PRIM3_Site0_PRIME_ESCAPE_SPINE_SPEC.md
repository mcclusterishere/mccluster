# PRIM3 Site 0 — PRIME External Heavy-Deployment / Escape Spine

Status: **CANONICAL design-development supplement — corrected 2026-08-14**

## Core rule

B3 PRIME has two independent heavy-asset routes:

1. **B3 → P1 external heavy lift → FLUSH L3 flight deck**
2. **B3 → straight SOUTH external escape ramp → grade beyond perimeter → offsite surface strip**

The two routes share the B3 Prime heavy-deployment hall but are otherwise independent.

## B3 Prime heavy-deployment hall

The command/resident program remains protected. Heavy movement is contained in a segregated fire/blast/access-controlled zone on the SOUTH operational edge with:

- aircraft/tank/heavy-equipment staging;
- tow positioning;
- inspection / rapid service;
- blast-rated portal to the surface escape ramp;
- controlled connection to P1;
- protected personnel observation/service access separated from the heavy lane.

## P1 — PRIME external heavy lift

P1 is separate from V1/V2.

- Location: outside the SOUTH structural shell.
- Stops: **B3 and L3 only**.
- Concept platform: approximately **40 m × 24 m**.
- Concept clear vertical envelope: approximately **9 m**.
- Use: aircraft under tow, tanks, heavy machinery, large robots and construction/agricultural equipment.
- P1 is not life-safety egress.

### Correct L3 arrival

P1 behaves like an aircraft-carrier deck elevator. The L3 platform rises until its surface is **flush with the SOUTH edge of the flight deck**.

The route is:

`P1 L3 platform → L3_PRIME_FLUSH_DECK_TRANSITION → L3_PRIME_EXTERNAL_LIFT_APRON / isolated merge lane → normal L3 deck`

There is no separate elevated road from the lift to the roof because the lift **is already aligned to the roof/deck datum**.

### Rejected design — forbidden

The earlier SOUTH elevated roof spur was a design error. Do not recreate:

- `L3_PRIME_ELEVATED_DEPARTURE_SPUR`
- `L3_PRIME_SPUR_SUPPORT_00` through `L3_PRIME_SPUR_SUPPORT_05`
- any renamed bridge, viaduct, elevated ramp or support-pier chain serving the same purpose.

## Direct surface escape ramp

The second route starts at the B3 SOUTH blast portal and stays independent from the roof/P1 system.

Concept targets:

- clear width: **45 m**
- clear height: **10 m**
- maximum grade: **5%**
- no mandatory gatehouse crossing
- aircraft movement: tow / low-speed taxi
- takeoff: exterior surface strip only

The ramp reaches grade beyond the primary gated compound, then continues to `PRIME_OFFSITE_SURFACE_ESCAPE_STRIP` and `PRIME_OFFSITE_MARSHALLING_APRON`.

It **does not reconnect to L3**.

## Canonical gameplay nodes

- `B3_PRIME_HEAVY_DEPLOYMENT_HALL`
- `B3_PRIME_HEAVY_STAGING_APRON`
- `B3_PRIME_SOUTH_BLAST_PORTAL`
- `P1_PRIME_EXTERNAL_HEAVY_LIFT_SHAFT`
- `P1_B3_HEAVY_LIFT_PLATFORM`
- `P1_L3_HEAVY_LIFT_PLATFORM`
- `L3_PRIME_EXTERNAL_LIFT_APRON`
- `L3_PRIME_EMERGENCY_MERGE_LANE`
- `L3_PRIME_FLUSH_DECK_TRANSITION`
- `PRIME_DIRECT_SURFACE_ESCAPE_RAMP`
- `PRIME_ESCAPE_RAMP_WALL_W`
- `PRIME_ESCAPE_RAMP_WALL_E`
- `PRIME_PERIMETER_BYPASS_PORTAL`
- `PRIME_OFFSITE_SURFACE_ESCAPE_STRIP`
- `PRIME_OFFSITE_MARSHALLING_APRON`

## Relationship to the Mobility Canyon

R1/R2 and V1/V2 provide routine/surge internal transfer. P1 and the direct SOUTH surface ramp remain independent restricted PRIME routes. None of these heavy routes count as required life-safety egress.
