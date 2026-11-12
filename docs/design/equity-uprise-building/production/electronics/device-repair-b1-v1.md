# B1 device station reconciliation

Status: source repair and measured placement fit; **not visual approval, installation approval or a live hardware connection**. NOT FOR CONSTRUCTION.

## What changed

The four existing workstation IDs and eight existing monitor IDs now have explicit proposed station/support bindings in `device-stations-b1-v1.json`. No nearest-surface or hash fallback is used. The normal staffed B1 floor, every named occupant, all 35 furniture locations/dimensions/rotations, shared cores, hazardous-room permissions and live-control denial remain unchanged. Minh stays at the B1 hardware/firmware bench.

Only the four bound stations suppress their baked scenic monitor banks through `size.monitors: 0`. Their chairs/stools, worktops and desk keyboards remain; the firmware bench also opts into a keyboard. Nine scenic displays are superseded by eight canonical registered displays. The bench instrument display, pegboard, task light, vise and shelf remain. No canonical screen ID is removed. The lab training table, commons table, telecom, operations and guard workstations are not repurposed.

## Exact placements

Coordinates are floor-local feet, with support top above the B1 finished floor. The electronics front faces local −Y before cardinal yaw. Add the B1 −13.5 ft world elevation exactly once. The manufacturer's origin-to-base offset must replace the obsolete generic host offset during integration.

Each row uses host `B1-USER-WS-NN` and monitors `B1-USER-MON-NN-01` / `B1-USER-MON-NN-02`.

| NN | Existing support mesh | Top AFF ft | Host XY ft | Monitor 01 / 02 XY ft | Yaw |
| --- | --- | ---: | --- | --- | ---: |
| 01 | `B1-WORKSHOP-BENCH-01::workbench` | 3.0 | (4.0, 31.8) | (8.0, 31.35) / (10.0, 31.35) | 180° |
| 02 | `B1-DESK-HASSAN-RAZA::desk_operator` | 2.416666667 | (60.1, 45.45) | (56.64, 44.7) / (58.64, 44.7) | 180° |
| 03 | `B1-DESK-EMRE-YILDIZ::desk_dual` | 2.416666667 | (55.45, 48.6) | (54.8, 51.96) / (54.8, 50.04) | 90° |
| 04 | `B1-LAB-LIAISON-CONSOLE-JONAS-WEBER::desk_operator` | 2.416666667 | (21.5, 50.35) | (24.96, 51.1) / (22.96, 51.1) | 0° |

These are bindings to existing authored stations, not newly invented staff/hardware ownership assignments. The exact station ID is the support name before `::`. Shared desks face their existing seats. The firmware bench remains a technical bench, with its instruments and work area.

## Geometry evidence

Measured against the rebuilt real B1 GLB, converted from local metres to feet. Monitor component meshes were transformed from their existing canonical origins into these bindings. Host fit uses the proposed Lenovo ThinkStation PX complete outside envelope, **0.220 m W × 0.4404 m H including feet × 0.575 m D**, not the smaller generic tower. This envelope test is not a finished manufacturer-model test.

- B1 deterministic builder: **18/18 checks**, all **67/67 inventory records** represented; final floor **13,112 triangles / 269,688 bytes**.
- Tested B1 GLB SHA-256: `adaf020157ebe6aa0404d4192d14ee00fdf7d72f144c7506a566895ebd647a56`. Binding-file SHA-256: `ba780b0e723b6df0265128a7e93d9ae2e940736fc23d507dea6bcd13fba7857b`.
- B1 portion of `audit_interior_consistency.py`: **15/15 checks**, including clear core approaches, 36 in connecting route, 24 in reach to seats/work surfaces, program containment and furniture collision checks.
- All **12/12 device bases** contact their explicitly named support at all five triangle samples. The support height is the tabletop, not the merged desk/pegboard mesh's maximum bound.
- **0** intersections between different device components, including bezels and host envelopes. **0** intersections with the rebuilt floor's connected furniture/wall/equipment components under conservative component-AABB checks (touching tabletop contact excluded).
- Full 1.82 ft-wide bezel gaps: stations 01/02/04 **0.18 ft (2.16 in)** at 2.0 ft centres; station 03 **0.10 ft (1.2 in)** at 1.92 ft centres. The old 0.7 ft spacing is not retained.
- Host base-to-worktop-edge margins: 01 **0.156759 ft**, 02/04 **0.340092 ft**, 03 **0.139108 ft**. Monitor base margins are at least **0.313333 ft**. These prove geometric fit, not manufacturer ventilation, loading or installation compliance.
- Source comparison verifies unchanged furniture IDs, placements, sizes, rotations, zones, occupants, keep-clear polygons and FFE. All 12 expected canonical device IDs occur exactly once.

Rebuild with `production/basement-b1/build_equity_uprise_basement_b1_v2.py`, then run the interior and integrated device-placement audits after merging these bindings and the manufacturer models. The final integrated electronics overlay must be regenerated and rechecked; these measurements do not claim that the old overlay has already changed.

## Remaining boundaries

- MDF/rack equipment near **X45 / Y62.8** remains outside the Network/Telecom room. This separate reconciliation must include its routes and service bindings; this workstation repair does not move it.
- Rack/services/cable installation and real manufacturer ventilation, stability, desk loading and service access require their own review. No claim of a real sponsor, donated computer, logo approval, physical ownership or live device is made.
- Browser startup was reported blocked before page load by a socket permission restriction. No browser visual approval is claimed. Whole-building integration and visual review remain required.
