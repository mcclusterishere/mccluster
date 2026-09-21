# Equity Uprise Floor 1 — V1 → V2 Preservation Map

> Status: **ACTIVE HYBRID-REBUILD IMPLEMENTATION MAP**
>
> Companion machine inventory: `production/floor-01/floor-01-object-inventory.json`.

## Target

Do not redesign the liked Floor 1 away.

The hybrid must read visually as an upgraded descendant of the original V1 interior while obeying the corrected Core V2 building chassis and current Equity Uprise program.

**Preserve the feeling. Correct the physics. Add the research.**

## Historical sources used

- V1 deterministic Floor 1 generator: commit `59af7f6386ee69edc023927971ea5918fffa6acc`.
- V1 interactive interior viewer: commit `752c70444e12f44abdeacdd19697f7db88937d44`.
- Historical whole-building stack: commits `c674e07…`, `ef3fd47…`, `7ea4584…`.
- Current Core V2 Floor 1 scaffold: `production/floor-01/build_equity_uprise_floor_01_v2.py`.

## Exact preservation decisions

| V1 element | Decision | Core V2 / hybrid treatment |
| --- | --- | --- |
| Dark premium lobby atmosphere | **PRESERVE** | Use as the primary visual baseline; do not fall back to debug-gray massing. |
| Honed/polished medium-gray floor | **PRESERVE + REFINE** | Keep material family; add realistic roughness/reflection variation. |
| Charcoal mineral walls | **PRESERVE + REFINE** | Keep dark shell; improve edge/trim/detail resolution. |
| Gunmetal core/frames | **PRESERVE + REFINE** | Apply consistently to vestibule, elevator/core trim, doors and hardware. |
| Clear glazed south vestibule | **PRESERVE** | Keep composition; use current public-door/site authority. |
| Centered reception composition | **PRESERVE** | Retain as primary visual anchor at current V2 coordinates. |
| Dark stone reception desk | **PRESERVE + UPGRADE** | Replace block mass with believable desk/casework while preserving footprint and accessible counter. |
| Reception feature wall | **PRESERVE + EXPAND** | Becomes the Journey Wall architecture, not a generic dashboard pasted on a wall. |
| Restrained red reveal | **PRESERVE** | Continue as navigation/state accent only. |
| Left lounge composition | **PRESERVE** | Sofa + two chairs + round wood table + rug + plant remain the core composition. |
| Charcoal upholstery | **PRESERVE + DETAIL** | Upgrade primitive boxes to believable upholstered forms. |
| Warm wood accents | **PRESERVE** | Use on lounge table, intake table, Passport work surfaces and selected casework. |
| Intake consultation room | **PRESERVE + EXPAND** | Keep table/chair/privacy feel; add secure document surface and private display. |
| Directory near passenger elevator | **PRESERVE + UPGRADE** | Keep circulation relationship; turn it into real Next Action / Building Directory terminal. |
| Warm reception lighting | **PRESERVE** | Restore focal pool and material readability. |
| Softer lounge lighting | **PRESERVE** | Restore warm human-scale lighting hierarchy. |
| Fog/depth in viewer | **PRESERVE AS PRESENTATION BEHAVIOR** | Keep subtle atmospheric depth; do not obscure geometry. |
| Named human-scale camera views | **PRESERVE + EXPAND** | Lobby, Reception, Elevator, Lounge, Intake plus Passport and Journey Wall. |
| Removable ceiling / cutaway | **PRESERVE** | Keep as inspection mode in the real 3D viewer. |
| V1 west Stair B at X0–12 | **REPLACE** | Use Core V2 Stair B X8–18 / Y54–72. |
| Missing/incorrect west service core | **REPLACE / ADD** | Use Core V2 service/freight elevator X0–8 / Y60–72. |
| Simplified V1 stair treads | **REPLACE** | Use actual Core V2 dogleg/U-shaped flights + landings + B1/F2 continuity. |
| Old support-band partitions | **RECONCILE** | Follow current support-room bounds; preserve visual language, not obsolete room geometry. |
| Empty central work area | **EXPAND** | Build the Development Passport Studio with worktables, task chairs, kiosks and document station. |
| Basic feature wall | **EXPAND** | Journey Wall gets integrated displays + progression architecture + emergency override behavior. |
| Simple reception function | **EXPAND** | Concierge/security/check-in/building-status role without exposing private operational data. |
| No explicit life-safety fixtures | **ADD** | Model AED, first aid, extinguishers, egress maps, two-way communication and B1 direction controls. |
| Primitive support rooms | **UPGRADE** | Add restroom fixtures, operations panel, IT rack and janitor/service storage. |

## Furniture / equipment baseline

The canonical hybrid inventory now contains **67 stable object records** covering:
- entrance/arrival;
- Orientation Lounge;
- Intake / Verification Consultation;
- Development Passport Studio;
- Journey Wall;
- Reception / Concierge / Security;
- Next Action / Directory;
- passenger + freight interfaces;
- B1 direction controls;
- life-safety equipment;
- restrooms/support rooms;
- architectural lighting.

The machine-readable source is:
`production/floor-01/floor-01-object-inventory.json`

## Modeling quality target

The current 189-mesh scaffold proves geometry. It is not the aesthetic target.

The next builder pass should:
- consume stable inventory IDs;
- replace furniture primitives with intentional furniture forms;
- give doors/frames/casework believable thickness and hardware;
- restore V1 lighting hierarchy and visual depth;
- add ceiling detail without blocking cutaway mode;
- keep clear public circulation;
- visually distinguish public, private, staff/service and restricted B1 interfaces;
- remain deterministic and stack-ready.

## Viewer target

The viewer must support:
- orbit / zoom;
- Lobby view;
- Reception / Journey Wall view;
- Passenger Elevator / Directory view;
- Orientation Lounge view;
- Intake view;
- Passport Studio view;
- top cutaway;
- ceiling hide/show;
- whole-building handoff once the floor is approved.

## Do not preserve

Never restore these just because they appeared in V1:
- old Stair B location;
- any geometry that occupies the freight/service shaft;
- non-continuous stair logic;
- geometry that breaks B1 or Floor 2 stacking;
- stale room identities;
- old authority paths.

## Next implementation step

Update the Floor 1 3D builder so **inventory IDs drive object creation** wherever practical, then visually rebuild the high-value V1 elements first:

1. reception + Journey Wall;
2. Orientation Lounge;
3. intake room;
4. Passport Studio;
5. entrance/atrium;
6. directory/elevator interfaces;
7. support/life-safety detail;
8. ceiling/lighting/camera polish.

After that, review the real GLB before touching Floor 2.
