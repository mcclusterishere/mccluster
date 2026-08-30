# Site 0 model state — 2026-08-19

## Correction to the first version of this file

An earlier draft of this document said the interior work was *"drawings,
not geometry"* and that no interior model existed. **That was wrong.**

It was wrong because I looked at the working tree, found only the v02
handoff, and stopped. The real interior master — 127 named nodes, seven
levels, every room — was in **git history**: committed as a blob, then
dropped out of the tree by the chunking scheme described below. It was
never deleted; it just stopped being checked out, and nothing in the tree
pointed at it.

The lesson, recorded because it will happen again: *"it isn't in the
repo"* and *"it isn't in `git ls-files`"* are different statements. The
search that found it was one line:

```
git rev-list --objects --all | grep -iE '\.(glb|gltf|obj|fbx)$'
```

---

## What the interior master actually is

`PRIM3_Site0_Master_Facility_v03.glb` — **127 nodes, 126 meshes.** A real,
fully named facility, and good work:

| | |
| --- | --- |
| Levels | B5, B4, B3, B2, B1, L1, L2, L3, L4 |
| Rooms | 6 research wings, 4 high bays, command cores, sustainment, medical/food, 2 habitats, transfer halls, tunnels |
| Cores | 4 × stair + passenger lift + freight lift (A–D) |
| Heavy mobility | V1/V2 shafts with lift platforms at **every** stop B3→L2; R1/R2 armoured ramps at every level pair |
| PRIME | B3 deployment hall, staging apron, blast portal, P1 external lift, surface escape ramp, offsite marshalling |
| Canyon | floor, transfer deck, transit gallery, observation bridge, L1 through-road with north and south gates, L2 staging deck and drone pad |

Compare `PRIM3_Site0_Claude_Handoff_v02.glb` — 40 nodes of schematic
massing — and the difference is the whole interior.

---

## The two things that were wrong with it

Both measured off the file, not inferred.

### 1. No floor had a void — not even L1 and L2

Every one of the eight floor plates was a plain **eight-vertex box**:

```
L3_FLIGHT_DECK                            1 prim,  8 verts
L2_BUSINESS_AVIATION_FLOOR                1 prim,  8 verts
L1_GROUND_DEFENSE_FLOOR                   1 prim,  8 verts
B1..B5                                    1 prim,  8 verts each
```

The owner's note was that **only L1 and L2 are supposed to have the middle
carved out**. In the file, *nothing* was carved out. The V1 and V2 lift
platforms had a stop at every level with no shaft to travel through, and
the two-storey room at the heart of the building did not exist.

### 2. The forbidden PRIME spur was still in the file

`AGENTS.md`, the README and the canonical contract all name these as
rejected geometry that must never be recreated:

```
L3_PRIME_ELEVATED_DEPARTURE_SPUR
L3_PRIME_SPUR_SUPPORT_00 .. _05
```

All seven were present. The **v03 manifest already claimed** 120 nodes and
a removed spur; the v03 GLB had 127 nodes and every spur node. The
manifest described the intention and the file never caught up.

---

## What was done — `v04`

`tools/carve_l1_l2_void.py`, committed and self-verifying.

**The hole is x ±0.220, z ±0.110**, and that number is measured, not
chosen. The V1 and V2 heavy-lift platforms occupy exactly
`x -0.220..-0.040` and `x 0.040..0.220`, `z -0.110..0.110`, at **every**
stop from B3 to L2. The hole is the envelope those platforms already need
in order to move at all.

It checks out against the roof above and the rooms beside it:

- the L3 retractable transfer aperture leaves an inner opening of
  **x ±0.263, z ±0.133** — larger, which is the correct relationship:
  what passes through the roof must fit through the floors below;
- the four L1 corner rooms all begin at **|x| = 0.220** — the void touches
  them and does not eat them. No room lost its floor.

Nothing falls through, because at each level the lift platform *is* the
floor when it is parked there.

Each carved plate became a four-box ring — west and east strips full
depth, north and south strips filling the gap between them, so no two
boxes overlap and the ring has no doubled interior faces. 32 verts, 144
indices, keeping the plate's own vertex colour.

The seven forbidden spur nodes were removed and every node index that
moved was repaired.

### The section test

The contract asks for one check: cut north-south through the centre;
there must be exactly one two-level open volume, at L1–L2. Run against
both files:

| Level | v03 centre | **v04 centre** | v04 at x=0.50 |
| --- | --- | --- | --- |
| L3 | floor | floor | floor |
| **L2** | floor | **OPEN** | floor |
| **L1** | floor | **OPEN** | floor |
| B1 | floor | floor | floor |
| B2 | floor | floor | floor |
| B3 | floor | floor | floor |
| B4 | floor | floor | floor |
| B5 | floor | floor | floor |

Exactly one two-level opening, and every plate still solid at its edges.

### Result

| | v03 | v04 |
| --- | --- | --- |
| nodes | 127 | **120** |
| forbidden spur nodes | 7 | **0** |
| plates with a void | 0 | **2 (L1, L2)** |
| bytes | 91,316 | 95,068 |

120 nodes is what the manifest claimed all along.

---

## SETTLED — the repo master wins, and the Kimi build was reprogrammed to it

An earlier version of this section ended *"one has to win. Nothing downstream
should be built until that is settled."* The owner settled it:

> "We're going with the repo master on everything here."

So the Kimi build kept its geometry and lost its programme.
`_unfinished/site0-game/tools/reprogram_to_master.py` renamed all **183
nodes** to this directory's vocabulary — **not one vertex moved**. The
B-level programme is now the master's:

| Level | programme (master) |
| --- | --- |
| B1 | open tech research |
| B2 | industrial production |
| B3 | PRIME command & sustainment |
| B4 | deep transit logistics |
| B5 | global coordination & resilience |

87 of the 183 names are **coined** — the master had no counterpart for them,
because it is 120 nodes of massing and the Kimi build has the rooms. Coined
names are flagged as such in `site0_node_mapping.json`, so it stays obvious
later which names came from the master and which are ours.

That leaves the two files with different jobs rather than a conflict:

| | |
| --- | --- |
| `PRIM3_Site0_Master_Facility_v04.glb` | **the contract** — 120 nodes, the canonical programme, what the manifests and plans are written against |
| `_unfinished/site0-game/game/assets/prim3_site0_master.glb` | **the build** — 183 nodes, the same programme, with the rooms, walls, road, lift pads and stairs in it |

Both satisfy the floor rule: only L1 and L2 open at the centre.

## The exterior — settled too

`PRIM3+site+zero+perfect+model.zip` is fitted **around** the interior, never
booleaned into it. Measured, the interior needed no moving: only the north
and south aprons fall outside the shell, and an apron is outdoor pavement.
The shell is translated +0.0448 in Z and scaled 1.004 in X and Z so the
building sits inside the skin with 0.77 m of clearance rather than flush
with it.

The shell is fitted to the interior and not the reverse because the playable
build hard-codes its lift shafts and mission waypoints in **model
coordinates**; moving the geometry would leave every lift opening onto empty
air. See `_unfinished/site0-game/tools/fit_shell_to_interior.py`.

## The shell starts at L1 — recorded 2026-08-20

The owner's instruction: *"the exterior shell, the perfect GLB, is only
starting at level 1. So all the other levels will be under the GLB below
level 1."*

The model already satisfied it; the contract had never said it, and it is now
`AGENTS.md` → *The exterior shell starts at L1*, with
`tools/check_shell_datum.py` to enforce it.

Two things the check turned up that were worth knowing:

- **The two models put the origin in different places.** The playable build has
  L1's base at y = 0; the v04 master has it at y = +0.130, with the origin
  sitting inside B1. Both are correct — the datum is the bottom of L1, not the
  number zero — and a checker that assumes zero calls v04 broken. Mine did, on
  its first run, and the model was fine.
- **The checklist in `AGENTS.md` could not be passed as written.** It named
  v03, which v04 superseded on 2026-08-19, and asked for a manifest digest that
  no longer applied. Corrected, with the two rules the contract states and the
  list had never asked for added as items 9 and 10.

## Still open

- **The v04 master and the build have not been merged.** They agree on
  programme now, not on node count — 120 against 183. Nothing forces them
  to merge, but a change made in one does not reach the other.
- **Materials.** The master has none — geometry carries vertex colours
  only. Fine for massing and collision, not for a rendered game.
- **Doors, stairs, fixtures.** Nothing is furnished, and in the build most
  rooms are not volumes at all — measured at `SCALE=273`, the six L1 rooms
  are **0.10 m** plates and every B1–B5 room is **0.82 m**. They are floor
  finish. Only the L2 rooms (2.73 m) and the enclosure rings (4.91 m) have
  any height to them.
- **The egress stairs do not work as stairs.** Ten 2.9 × 3.7 m blocks,
  6.13 m tall, B5 up to L1 — you cannot climb one, so vertical movement is
  the lifts (E/Q on a pad) and nothing else.
