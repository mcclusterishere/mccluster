# F2 / F3 device-station repair

Status: schematic geometry verified, not visually approved or ready for physical installation. NOT FOR CONSTRUCTION.

## Design

The repair keeps all six existing computer identities and their six existing monitor identities. It binds them to already furnished perimeter staff desks instead of the stale public-room anchors:

| Host / monitor suffix | Exact station | Desk node suffix | Facing | Maker envelope reserved |
| --- | --- | --- | --- | --- |
| F2 WS01 / MON01-01 | F2-DESK-CHIOMA-OKEKE | ::desk_dual | west, yaw 270° | Framework Desktop |
| F2 WS02 / MON02-01 | F2-DESK-SARI-WULANDARI | ::desk_operator | west, yaw 270° | Framework Desktop |
| F3 WS01 / MON01-01 | F3-DESK-NUSRAT-RAHMAN | ::desk_dual | north, yaw 180° | System76 Thelio Major r5-n4 |
| F3 WS02 / MON02-01 | F3-DESK-ARJUN-MEHTA | ::desk_dual | north, yaw 180° | System76 Thelio Major r5-n4 |
| F3 WS03 / MON03-01 | F3-DESK-RAFAEL-COSTA | ::desk_operator | north, yaw 180° | System76 Thelio Major r5-n4 |
| F3 WS04 / MON04-01 | F3-DESK-MCCLUSTER-FELLOWSHIP | ::desk | north, yaw 180° | System76 Thelio Major r5-n4 |

Full exact asset IDs, support nodes, XY, yaw and station IDs are in `device-stations-f2-f3-v1.json`. Every support is the actual existing 29-inch desk top. No computer uses the central forum, Opportunity Exchange, listening/coffee tables, interview tables or a corridor. Sari remains on F2; Rafael remains on F3. No floor function, person, Core V2 coordinate or furniture position is changed.

On only those six bound desks, `size.monitors: 0` suppresses the embedded scenic monitor recipe and `size.keyboard: true` preserves its keyboard independently. These monitors are subgeometry inside each exact merged desk node, not independent GLB nodes. The desk node, chair, keyboard and other desk parts remain. Thandiwe's unbound F2 scenic monitors, Aya's F3 technical bench, and every canonical architectural display/check-in identity remain unchanged.

Manufacturer envelopes are width × height × depth: Framework 0.0968 × 0.2261 × 0.2055 m; current System76 Thelio Major r5-n4 0.254 × 0.440 × 0.384 m. The old wood Thelio is not used. Measured minimum tabletop-edge margins for the hosts are 9.494, 11.294, 6.4, 6.4, 8.2 and 4.6 inches respectively. All remain on the desktop, with separate keyboard/screen space and no loss of knee clearance. These margins are not manufacturer ventilation approval, a load-rating check or cable-clearance certification.

The source-backed manufacturer geometry uses bottom/support-plane Z=0. Its origin belongs directly on the support top. The legacy generic chassis instead uses +0.81 ft and the monitor uses +0.92 ft above that top. FFE is applied once: F2 13.5 ft, F3 27 ft. The support top is therefore world Z15.916667 ft on F2 and Z29.416667 ft on F3.

## Verification

- Context preflight passed before changes. Active F2/F3 Core V2 DXF/SVG and written floor/program/occupancy references were checked.
- Real Floor 2 builder: **15/15**; **48/48** object-inventory records modeled.
- Real Floor 3 builder: **15/15**; **63/63** object-inventory records modeled.
- Floor-scoped interior-consistency audit: **30/30**, including circulation, reach, keep-clear areas and physical furniture intersections.
- Persisted `test_device_stations_f2_f3.py`: **7/7** tests pass. Tests inspect actual transformed floor-mesh triangles and disconnected furniture components, all 12 legacy base envelopes, all six manufacturer envelopes, exact station/occupant bindings, chair-facing, keyboard retention, scoped scenic-monitor suppression, preserved public display nodes and cross-object envelope intersections.
- Additional staging check transformed the **actual 12 existing generic device assemblies** from the electronics GLB onto these authored supports. All 12 had **5/5 support samples** and matching origin/facing. This was a candidate-geometry check, not proof that the shared electronics generator had already consumed the fragment.
- Actual mesh inspection confirms each repaired desk's highest component is its keyboard at **29.48 inches AFF**; no scenic monitor remains inside those desk meshes.

Reproduce the persisted checks from the repository root (Python with numpy and trimesh; the interior audit also uses scipy):

```sh
python docs/design/equity-uprise-building/production/floor-02/build_equity_uprise_floor_02_v2.py
python docs/design/equity-uprise-building/production/floor-03/build_equity_uprise_floor_03_v2.py
python docs/design/equity-uprise-building/production/electronics/test_device_stations_f2_f3.py
```

For the floor-scoped existing audit without changing its shared report:

```sh
python - <<'PY'
import sys
sys.path.insert(0, 'docs/design/equity-uprise-building/production/interiors')
import audit_interior_consistency as a
summary = {}
for floor in ('F2', 'F3'):
    a.audit_floor(floor, *a.FLOORS[floor], summary)
failed = [check for check in a.checks if not check['passed']]
print(f'{len(a.checks) - len(failed)}/{len(a.checks)} checks passed')
assert not failed, failed
PY
```

## Integration and limits

The building-wide repair integrates these records into the canonical binding manifest/model catalog, regenerates the full electronics overlay and registries, reruns the integrated placement audit and refreshes the building index/state for PR #802. The fragment alone is not a runtime manifest replacement. The six manufacturer exteriors require their own source/geometry checks. No sponsor relationship, physical ownership, delivery or live connection is asserted.

Browser startup in this environment is blocked by the existing socket-permission failure. No browser review, screenshot acceptance or visual approval is claimed. All work remains review material for the existing PR, not a separate local-only deliverable or a production deployment.
