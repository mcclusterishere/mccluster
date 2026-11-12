# F4–F6 workstation reconciliation

Status: implemented furniture and explicit station bindings; integrated electronics and browser review remain separate gates. NOT FOR CONSTRUCTION.

## Implemented

- **F4 Media + Culture:** eight existing hosts / sixteen existing monitors. Priya and Maren keep their named desks. The existing recording and editing worktops become coherent computer stations. Four modest production desks occupy the existing brand/comms work area, rather than the listening lounge, gallery or shared review table. The review group and mood board are retained and separated from those stations. Both formerly floating edit-suite speakers now sit on the real 29-inch worktop.
- **F5 Policy + Proof:** eight hosts / sixteen monitors. Oksana, Leila and Amira remain at their named desks. Five carrels widen from 36 to 54 inches, with keyboards and paired displays clear of the actual rear shelf. The sixth carrel remains a paper-reading position. The reading corner, archive and all meeting tables remain. Towers stand in under-desk side bays on the actual floor slab, not on keyboards or in centered knee space.
- **F6 Penthouse Command:** six hosts / twelve monitors. Helen remains in the director office, Li Wei and Marc Dubois retain their desks. Three focused briefing-preparation positions occupy the open south work area. No hosts or paired monitors occupy the six-seat command table, strategy table or partner-briefing table. Helen’s chair and keyboard now align with the L-desk working edge, and the office rug remains under guest seating, away from the floor-standing tower.

No Core V2 geometry, floor roles, recurring staff floors, roof access, permissions, live-control denial, or host/monitor identities changed. No sponsor agreement, physical ownership, live device or logo is implied.

## Exact binding and coordinate contract

`device-stations-f4-f6-v1.json` contains 66 explicit records: asset ID/type, floor, exact support mesh, station ID, measured support top AFF, authored XY and cardinal yaw. It also records station seats, keyboards, design reasons and measured clearances. There is no proximity or hash-derived station selection.

- Floor GLBs remain local metres. The electronics integration adds FFE once: F4 40.5 ft, F5 54 ft, F6 67.5 ft.
- Desktop tops are 29/12 ft AFF, except Helen’s L-desk at 2.5 ft.
- `floor_slab` is an exact, selected-floor mesh with measured top 0 ft AFF, used only for F5/F6 hosts.
- Electronics fronts point local −Y. Their yaw equals furniture yaw +180°, and every monitor pair is tested against the actual chair position.
- All 22 pairs have 2 ft center spacing and a **0.18 ft / 2.16 inch bezel gap**. No overlapping panels or shared host identity is used.

The envelope checks use Apple Mac Studio M5 Ultra 0.197×0.095×0.197 m, HP Z8 Fury G6i standard-side-panel envelope 0.2195×0.4451×0.559 m (rear handle excluded), and **ASUS ExpertCenter Pro ET900N G3** 0.232×0.565×0.584 m, based on NVIDIA DGX Station GB300 architecture. The ASUS machine is not mislabeled as an unspecified exact NVIDIA enclosure. For the ASUS machine these dimensions cover the published **main body only**: unsized projecting handles/feet are omitted, and total installed height remains unverified. F6 tests therefore establish body clearance, not complete physical installation clearance. Source-backed chassis generation and final origin Z offsets are integrated separately.

## Clearance evidence

All 66 bases have five contacts on their declared real-mesh top triangles: **330/330 samples**. Manufacturer host envelopes and conservative monitor envelopes have **zero intersections** with each other or any split furniture/architecture component in rebuilt F4/F5/F6 GLBs.

- The widened F5 carrels have a 4.3 ft interior width between side panels. A 3.82 ft paired-bezel span leaves 0.24 ft on each side. The monitors are forward of the existing rear shelf, not inside it.
- F5 carrel towers leave a centered knee-space width of about 2.38 ft. F6 ordinary desk side bays leave about 2.84 ft. These are geometric measurements, not accessibility certification.
- F5 towers have approximately 0.85 ft of vertical clearance below the desktops. The F6 ASUS main bodies have approximately 0.46 ft below ordinary desks and 0.52 ft below Helen’s main top, excluding unsized projecting handles/feet.
- Minimum host-to-chair component separation is F4 **1.56761 ft**, F5 **0.90869 ft**, F6 **0.83286 ft**. Minimum host-to-noncontact-desk-component separation is F4 **0.10417 ft**, F5 **0.15301 ft**, F6 **0.11942 ft**. These are conservative 3D component-AABB distances, not required ventilation gaps. Per-station values are in the manifest.
- Helen’s keyboard is at (65.1, 8.95), 0.6 ft behind the main working edge and 2.3 ft from her seat center. The editor keyboard is at (23, 9.25), 2.35 ft from the editor seat center.

Manufacturer ventilation, thermal, acoustic, electrical, structural and service-access requirements still need installation review. A geometry pass does not establish them.

## Exact scenic-screen supersession

- `F4-RECORDING-MONITOR-01::{bezel,screen}` → `F4-USER-MON-03-01` and `F4-USER-MON-03-02`.
- `F4-EDIT-DISPLAY-01::{bezel,screen}` and the exact `edit_display_backer` → `F4-USER-MON-04-01` and `F4-USER-MON-04-02`.
- Only scenic `_monitor` recipe components of the two F4 named desks, three F5 named desks, Helen’s L-desk and two F6 named desks are disabled with `monitors:0`. Their desk geometry and independent keyboards remain.
- F4’s recording/edit layout desks already had `monitors:0`; they now explicitly retain keyboards. New desks never create duplicate scenic screens. Carrels keep their privacy panels/shelves and receive keyboards without invented screen parts.
- All unrelated media walls, gallery/archive surfaces, room displays, interview monitor cart, Halo Globe, floor controls and roof-transition surfaces remain.

F4’s floor report now truthfully records **66 physically modeled inventory IDs and 2 explicitly replaced IDs**, with no unresolved inventory IDs. `inventory_records_replaced` carries the old-ID → registered-pair mapping. The authored inventory IDs remain for capability continuity. Viewer/screen-registry integration must consume the mapping so the two canonical capabilities stay discoverable without claiming nonexistent old display meshes.

## Verification and integration

Run the three official floor builders, then `production/electronics/test_device_stations_f4_f6.py` with the audit Python environment.

- Floor builders: **F4 25/25, F5 24/24, F6 26/26**.
- Focused real-GLB interior checks: **45/45**, including routes, doors, clear zones and phone budgets.
- Durable station tests: **7/7**, covering exact identities/staff, 330 support samples, component collisions, positive dual-screen gaps/facing, real keyboard geometry, exact scenic replacement and preserved meeting functions.
- `git diff --check` passed for the owned source changes.

Shared-kit dependencies are the independently controlled keyboard options for desk/carrel/L-desk and the exact concave L-desk footprint audit. The latter does not exempt collisions: it checks the main and return separately instead of incorrectly filling the chair’s empty knee space.

The parent integration owns the combined placement manifest, manufacturer chassis offsets, electronics regeneration, screen/capability mappings, viewer visibility, full cross-layer strict audit, index/state updates and PR publication. No git stage, commit, push, merge or deployment was performed by this worker.

Browser startup was blocked before page load by the existing socket permission restriction. **No browser or visual approval is claimed.**
