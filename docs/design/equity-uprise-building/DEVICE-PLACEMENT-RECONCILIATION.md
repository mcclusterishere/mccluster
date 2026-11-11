# Device placement and proposed manufacturer floors

Status: **ACTIVE REPAIR / audit checkpoint, not completed remodeling or visual approval**.
Baseline: main `8e631683b6960fee283ea923c22b1d72cfd09495`.
The 72-foot Core V2 plate, vertical systems, floor functions, room boundaries,
recurring staff stations and permission boundaries remain authoritative.
Not for construction. No sponsor agreement, supplied device or live connection exists by this proposal.

## Reproduced defect, not another replacement building

The v3 furnished floor models and componentized electronics are separate layers.
The existing interior-consistency audit loads the furnished floors but never the
electronics GLB. Passing that audit does not validate combined device placement.

The electronics generator currently chooses a work-area anchor and adds a
round-robin offset. It does not bind the result to a particular furniture surface,
height, orientation or mount. The furniture kit separately embeds decorative
monitors. Consequently, promoting every visible desk prop into a real computer
would invent extra devices and duplicate screens.

The new cross-layer audit reads the real generated GLBs, converts floor-local
metres to absolute feet, and compares each workstation chassis and monitor stand
with upward-facing floor/furniture triangles at five base samples. It separately
checks the actual axis-aligned display panels for intersection. The report retains
source hashes and exact asset/node IDs; no inferred contact becomes an approved mount.

Baseline evidence:

| Level | Existing hosts | Existing monitors | Intersecting monitor pairs | Unresolved support contacts |
| --- | ---: | ---: | ---: | ---: |
| B1 | 4 | 8 | 11 | 12 |
| F1 | 4 | 4 | 0 | 8 |
| F2 | 2 | 2 | 0 | 4 |
| F3 | 4 | 4 | 0 | 8 |
| F4 | 8 | 16 | 8 | 24 |
| F5 | 8 | 16 | 8 | 24 |
| F6 | 6 | 12 | 6 | 18 |
| L7 | 0 | 0 | 0 | 0 |
| Total | 36 | 62 | 33 | 98 |

These are model diagnostics, not a count of 98 independently visible defects in
every runtime view. Layers can be hidden. No browser/physical-device acceptance
is inferred from this analysis.

- A generated stand base bottoms at 3.33 feet AFF. A normal 29-inch desktop is
  2.4167 feet AFF, leaving 10.96 inches of air wherever that desk is actually below it.
- Dual monitor origins are 0.7 feet apart. Their 1.72-foot display panels overlap
  by 1.02 feet; their 1.82-foot bezels overlap by 1.12 feet.
- Some anchors now point into empty space, a chair or a coffee-table zone after
  the v3 furniture redesign, not a work surface.
- Reception is a separate case: the generated stand penetrates the 3.28–3.46-foot
  worktop instead of resting on its upper surface.
- The already documented B1 MDF mismatch remains: the telecom room is X32–52 /
  Y22–34; the electronics MDF anchor is around (45, 62.8). That is a separate
  room/rack/cabling reconciliation, not cured by moving workstation displays.

## Proposed floor partners and reference models

These are **unconfirmed prospects and research references**, not installed assets,
confirmed sponsors or manufacturer-approved digital twins. A flagship reference
is not a claim that every station needs that configuration. Borrowed/donated
hardware availability, exact SKU, dimensions, port layout, serviceability and
artwork permissions must be verified before its model is promoted.

| Level and preserved purpose | Proposed lead maker / model | Appropriate showcase |
| --- | --- | --- |
| B1: Technical Operations / Infrastructure / Hands-On Lab | [Lenovo ThinkStation PX](https://www.lenovo.com/us/en/thinkstations/) | Supervised technical workstation and isolated infrastructure exercises, separate from live plant and rack controls. |
| F1: Arrival / Orientation / Intake | [Dell Pro Precision 9 T6 PW9T6260](https://www.dell.com/en-us/shop/workstation/spd/dellproprecision9t6pw9t6260) | One reception/service demonstration host and public onboarding stations with separate private sessions, rather than a lobby full of towers. |
| F2: Public Forum | [Framework Desktop Ryzen AI Max+ PRO 495](https://frame.work/desktop) | Quiet workshop/cohort computing and repairability demonstrations at the existing workshop/operator stations. Preserve the human forum and listening circle. |
| F3: Fellowship + Network | [System76 Thelio Major](https://system76.com/desktops/thelio-major) | Linux/software fellowship and field-operations work at established desks, with interview rooms kept conversational. |
| F4: Media + Culture | [Apple Mac Studio M5 Ultra](https://www.apple.com/mac-studio/) | Editing/audio-production hero station. Model the actual compact enclosure and ports, not a generic tower labeled Apple. |
| F5: Policy + Proof | [HP Z8 Fury G6i](https://www.hp.com/us-en/workstations/z8-fury.html) | Evidence/data workstation and research demonstrations, preserving paper/archive areas and quiet review rooms. |
| F6: Penthouse Command | [NVIDIA DGX Station](https://www.nvidia.com/en-us/products/workstations/dgx-station/) | Sanitized analysis demonstrations and an explicitly isolated proposed compute host. No access to protected Halo or operational data is implied. |
| L7: Roof / Mobility Portal | [ASUS ProArt P16 H7606](https://www.asus.com/laptops/for-creators/proart/proart-p16-h7606/techspec/) | Portable field/media demonstration only. No permanent outdoor desktop, invented enclosed seventh floor or weatherproofing claim. |

Other makers may supply secondary demonstration bays or later rotations; eight
lead prospects do not exhaust the research. Manufacturer labels and sponsorship
state belong in data, not hard-coded geometry or invented logo artwork.

## Corrective floor-plan sequence

1. Preserve the existing room functions and v3 furniture inventory. Keep forum,
   lounge, interview, gallery, archive and command tables usable by people.
2. Reconcile each existing computer identity with exactly one intended station.
   Bind host, monitors, keyboard, seat, support surface and cable endpoints before
   replacing any scenic screen. No proximity or string-hash fallback may fabricate
   a binding. Do not delete a canonical capability to make a picture cleaner.
3. Use named workspaces as fixed anchors, not an excuse to move staff between
   floors. Separate guest-facing screens from private staff-facing displays.
4. For every bound station, use a measured support plane, correct orientation,
   sufficient monitor spacing, a supported host location, service clearance and
   a routed cable path. Retire only the exact scenic geometry superseded by it.
5. Replace the generic chassis with a source-backed manufacturer profile only
   after verified outer dimensions and reference images/manuals exist. Separate
   exterior visual fidelity from unknown internals and unsupported service actions.
6. Reconcile B1 rack location against the actual telecom room and services routing
   before attaching a physical host to that rack or claiming correct cable lengths.
7. Validate each floor, then the combined stack, using the existing geometry,
   circulation, capability and runtime suites plus the new cross-layer audit.
   Run real desktop and phone/tablet visual review. A green unit test is not visual approval.

## Real-device boundary

Keep distinct records for proposed product, scene instance, received physical
asset and environment allocation. A future physical asset may have several
isolated allocations, each with explicit CPU/RAM/storage/GPU limits, owner,
access policy, image/version, heartbeat and revocation. Allocation is not a new
identity/auth/backend: reuse the McCluster control plane and asset IDs.

The renderer cannot create or authorize a real connection. Unassigned, donated,
commissioned, online and unavailable must be distinct states. No credentials,
private addresses or serial numbers belong in a public model catalog. A device
must never be shown as live merely because its simulated screen is illuminated.

## Reproduction

Build detailed B1 and Floors 1–7 with the existing deterministic builders, then:

```sh
python docs/design/equity-uprise-building/production/interiors/test_device_placement.py
python docs/design/equity-uprise-building/production/interiors/audit_device_placement.py
python docs/design/equity-uprise-building/production/interiors/audit_device_placement.py --strict
```

The baseline strict command **must exit 1** with unresolved defects. Report mode
only records diagnostics and does not call the geometry approved. Building CI
uploads a fresh diagnostic and emits a warning while remodeling proceeds.
Existing acceptance gates are unchanged; this is not a waiver or a replacement
for their checks. The strict command is the additional placement acceptance gate
for the repair. The committed JSON is an exact-source baseline, not a current
as-built or proof that later modifications were tested.
