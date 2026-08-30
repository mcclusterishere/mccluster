# PRIM3 Site 0 / Ground Zero — Agent Contract

This file governs **all work under `assets/3d/prim3-site0/`** and any code, gameplay, rendering, architecture, plans, collision, streaming, or level logic that represents HITMAN PRIM3 SITE 0 / Ground Zero.

## Mandatory read order

Before changing Site 0, read completely:

1. `PRIM3_Site0_CANONICAL_ARCHITECTURE_v03.json`
2. `PRIM3_Site0_Master_Facility_v04_manifest.json`
2b. `MODEL_STATE_2026-08-19.md` — what the master actually contains, measured
3. `PRIM3_Site0_PRIME_ESCAPE_SPINE_SPEC.md`
4. `PRIM3_Site0_VERTICAL_MOBILITY_CANYON_SPEC.md`
5. `README.md`
6. Any affected level plan/manifest.

Canonical production geometry:

`PRIM3_Site0_Master_Facility_v04.glb`

Do not substitute the rejected v02 handoff, do not use v03 (it carries the
forbidden spur and has no floor voids), and do not infer geometry from
screenshots or renderings when the v04 master exists.

## The master is committed directly

The GLB is a 95 KB file in this directory. Read it; do not rebuild it.

The chunked base64 assembler that used to produce v03 was broken —
its chunks were replaced without updating its pinned hash, and the payload
stopped being a valid gzip stream. It has been retired; see
`tools/README.md` for what happened and why the binary is committed
plainly now.

The regenerated file must match the SHA-256 and byte length recorded in `PRIM3_Site0_Master_Facility_v03_manifest.json`.

## Immutable massing unless the canonical contract changes in the same commit

- Nine explorable levels: `L4`, `L3`, `L2`, `L1`, `B1`, `B2`, `B3`, `B4`, `B5`.
- `+Y` up, `+X` east, `+Z` north/formal front.
- Conceptual footprint ≈ **1268 m east-west × 824 m north-south**.
- Long axis is EAST-WEST.
- L1 is at grade; B1–B5 below; L2–L4 above.
- L4 is a compact EAST/right island on L3.
- Base asset stays empty: no baked people, aircraft, vehicles, robots, terrain, desert, sky, furniture, or movable equipment.

## Central Mobility Canyon — canonical

Preserve:

- centered `V1_HEAVY_TRANSFER_SHAFT` and `V2_HEAVY_TRANSFER_SHAFT`;
- V1/V2 controlled heavy-lift stops at B3/B2/B1/L1/L2/L3;
- `R1_ARMORED_DRIVE_RAMP_*` and `R2_ARMORED_DRIVE_RAMP_*` from B3 through B2/B1/L1 to L2;
- `L1_NORTH_SOUTH_THROUGH_ROAD`;
- `L2_BUSINESS_DRONE_LAUNCH_PAD` and its clear retractable L2/L3 slot;
- independent protected A–D stair/passenger/freight cores.

Required life-safety egress never depends on V1/V2/R1/R2/P1 or vehicle/aircraft routes.

### Floor plates — ONLY L1 AND L2 ARE OPEN

The canyon touching a level does **not** mean the level is open to it.

- **Open plates (central void): L1, L2 only.** One two-level room at the
  heart of the building — the L1 through-road and the L2 drone pad read
  as one connected volume.
- **Solid plates: B3, B2, B1, L3.** Regular continuous floors. The canyon
  passes through them as *bounded shafts* — the V1/V2 cores, the R1/R2
  ramp runs, the stair/egress cores, the service risers — each sized to
  the equipment moving through it, each with its own floor edge.

**FORBIDDEN on B3, B2, B1 and L3:** central atrium, light well, mezzanine
cut, or open canyon edge. L3 is the flight deck and stays a mostly
uninterrupted carrier surface; its only apertures are the V1/V2 transfer
aperture and the P1 flush-deck platform.

Section the model north-south through the centre. There must be exactly
one two-level open volume, at L1–L2. Daylight from B3 to L3 means the
plates are wrong.

*Added 2026-08-19: an interior rebuild read the canyon as a full-height
hole and cut the middle out of all six plates. The contract had never
said otherwise. It does now.*

### The exterior shell starts at L1 — everything below it is underground

`PRIM3+site+zero+perfect+model.zip` is the canonical exterior. **Its own floor
is the L1 datum.** It is the part of the building that stands above grade, and
it is the only exterior there is; nothing else may be modelled as one.

**Its floor, not the bottom of its bounding box.** The Tripo model carries a
plinth below its floor, so the two are 2.52 m apart:

```
  shell floor   median  2.52 m above the base of its own bounding box
  shell deck    median 70.23 m
  clear height         67.71 m
```

Aligning bounding boxes therefore puts L1's floor 2.52 m **below** the shell's
floor, which puts the player's eye — 1.86 m standing on the L1 road — under it.
That shipped, and the owner's report was exactly right: *"L1 is under the
perfect glb. It seems like level 1 is underground it shouldn't be."*
`tools/measure_shell_floor.py` finds the floor by sampling columns through the
mesh and taking the median of the lowest surface; the fit uses that.

**The datum is the bottom of L1, not the number zero.** Files put the origin in
different places and both are correct:

```
  playable build   L1 base at y  0.000     grade is the origin
  v04 master       L1 base at y +0.130     the origin sits inside B1
```

So the rule is relational. A check that assumes `y = 0` reports v04 as broken
when it is not — `tools/check_shell_datum.py` did exactly that on its first
run, and the model was fine. **Never "fix" a model by translating it to put
grade at zero.** Read the datum from L1 and measure against that.

**B1 through B5 are below the shell, not inside it.** They are underground.
They have no exterior, they are not visible from outside the building, and a
skin that reached down to enclose them would be describing a building that
does not exist.

Measured on the fitted shell and the current interior, at `SCALE=273`:

```
  perfect shell        0.0 m  ..  +128.9 m       base exactly on the L1 datum
  L4                 +74.3 m  ..  +120.6 m       inside
  L3                 +69.9 m  ..   +76.4 m       inside
  L2                 +13.7 m  ..   +36.3 m       inside
  L1                  -0.0 m  ..   +14.2 m       inside
  B1                 -13.1 m  ..    -7.1 m       under
  B2                 -25.1 m  ..   -19.1 m       under
  B3                 -37.1 m  ..    +0.0 m       under, touching the datum
  B4                 -49.1 m  ..   -43.1 m       under
  B5                 -61.2 m  ..   -55.1 m       under
```

B3 is the one that reaches the datum, and it is meant to: `B3_R1/R2` are the
armoured ramps, and a ramp out of B3 arrives at L1 grade. It touches y = 0
and does not cross it.

Consequences, so this is not re-derived later:

- **Y is a translation, never a scale.** The shell is lowered so its floor sits
  on L1; it is never stretched or squashed to make levels line up. The offset
  is measured, not chosen.
- **Known and unfixed: the interior is 3.3% taller than the shell's clear
  height.** L1 floor to L3 deck is 69.90 m against the shell's 67.71 m, so with
  the floors aligned our L3 deck plate sits about 2.2 m above the shell's deck.
  Closing that needs either a 3.3% vertical squash of the interior — which
  moves every level height and the lift stop table — or a 3.3% stretch of the
  perfect model. Neither has been done. Do not do either without asking.
- **`tools/check_shell_datum.py` enforces it.** It reads the datum from L1,
  reports every B-level node against it, checks a fitted shell's base sits on
  it, and exits non-zero naming the offenders. Verified against a deliberately
  broken model, not just a good one.
- **Containment is checked above ground only.** A verification that asks
  whether B4 is inside the shell is asking the wrong question and will fail
  on a correct model.
- **Nothing breaks the skin, the aprons included.** An earlier version of this
  said the north and south aprons belonged outside because pavement goes
  outside. That was inference, and the owner overruled it: *"everything should
  fit INSIDE the perfect glb."* Six nodes were out — the two aprons by 19–25 m
  in Z, three B2 high bays by 5.5 m and the B4 transfer hall by 35.5 m in X —
  and every one of them was **smaller** than the envelope, just in the wrong
  place. `tools/fit_inside_shell.py` moves them the minimum distance in X and Z
  and never resizes anything; it writes a node translation and changes no
  vertex data.
- **"Inside" here means inside the envelope, not inside the cavity.** The
  shell's hollow interior is a good deal smaller than its bounding box at low
  levels — at 15 m it is roughly x ±122, z −64..+95 against an envelope of
  x ±131, z −122..+147. Satisfying the cavity would mean resizing the building,
  not nudging six nodes. Recorded as a limit, not silently met.

*Added 2026-08-20, on the owner's instruction: "the perfect GLB is only
starting at level 1, so all the other levels will be under the GLB below
level 1." The model already satisfied it; the contract had never said it.*

## PRIME B3 heavy-deployment system — DO NOT REVERT

B3 is:

**PRIME COMMAND & SUSTAINMENT + HEAVY DEPLOYMENT (RESTRICTED)**

Mandatory PRIME geometry:

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

### P1 / L3 hard rule

P1 is an **external SOUTH-side B3↔L3 aircraft/heavy lift** with no intermediate openings. At L3:

**the P1 platform rises flush with the SOUTH flight-deck edge and becomes part of the usable deck surface.**

Movement is:

`B3 heavy hall → P1 → flush L3 transition → isolated merge/staging lane → normal L3 deck circulation`

There is **no elevated roof connector**.

The following old geometry is rejected and must never return:

- `L3_PRIME_ELEVATED_DEPARTURE_SPUR`
- `L3_PRIME_SPUR_SUPPORT_00`
- `L3_PRIME_SPUR_SUPPORT_01`
- `L3_PRIME_SPUR_SUPPORT_02`
- `L3_PRIME_SPUR_SUPPORT_03`
- `L3_PRIME_SPUR_SUPPORT_04`
- `L3_PRIME_SPUR_SUPPORT_05`

Do not replace those names with a renamed bridge/viaduct that creates the same bad geometry.

## Independent B3 surface escape route

B3 also has a separate straight SOUTH heavy route:

`B3 → armored SOUTH portal → external incline → grade beyond primary perimeter → offsite strip`

This route is independent of P1 and **does not reconnect to L3 or the roof**. Aircraft on the incline are under tow/low-speed taxi; takeoff occurs only on the exterior surface strip.

## Geometry/editability rules

- Preserve separately named level, shaft, lift, ramp, portal, apron, road, aperture and core nodes.
- Do not destructive-boolean the facility into one monolithic mesh.
- Keep detailed/high-fidelity masters separate from web/game LOD derivatives.
- Do not silently move/delete/merge/rotate/rescale canonical transport nodes.
- Any change to massing, level function, Prime routing, or vertical transport must update the canonical JSON, this file, the production manifest, the relevant specs and plans in the same commit.

## Agent handoff verification

Before finishing Site 0 geometry work verify:

1. `PRIM3_Site0_Master_Facility_v04.glb` opens. **v04 is current**; v03 is kept
   for history and is not the contract.
2. Nine-level order is intact.
3. L1 remains at grade — **y = 0 is the datum the exterior shell stands on**.
4. V1/V2, R1/R2 and L1 through-road remain intact.
5. B3 Prime heavy deployment remains intact.
6. P1 terminates flush with L3.
7. `L3_PRIME_ELEVATED_DEPARTURE_SPUR` and every `L3_PRIME_SPUR_SUPPORT_*` node
   are absent.
8. The independent B3-to-grade beyond-perimeter route remains intact.
9. Only L1 and L2 are open at the centre. Section north-south: exactly one
   two-level open volume.
10. **Every B level sits entirely below y = 0**, except the B3 armoured ramps,
    which reach the datum and do not cross it. A B level poking above y = 0 is
    a level poking out through the ground.
11. The master SHA-256 and byte length match
    `PRIM3_Site0_Master_Facility_v04_manifest.json`
    (`9b2a5508…`, 95,068 bytes — verified 2026-08-20).

*Corrected 2026-08-20: items 1 and 11 named v03, which v04 superseded on
2026-08-19, so the list could not be passed as written. Items 9 and 10 were the
two rules the contract states and the checklist never asked for.*
