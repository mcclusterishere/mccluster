# Equity Uprise Building — Screens and Screen Apps

> Status: **V1 IMPLEMENTED** (2026-11-03). Owner direction, 2026-11-03: "make the interior more interactive to deep
> levels where you can have a whole html page on your phone by clicking a screen with the option to go back into the
> building when you're done, with a terminal type shit."

Every display surface in the building opens a full, phone-first app. The building stays the authority for where a
screen is; the Lab Runtime stays the authority for what the sandbox does. This layer adds no geometry, moves nothing
and controls nothing live.

## 1. Screen registry (data)

- Generator: `production/screens/build_screen_registry_v1.mjs` (deterministic; `--check` verifies freshness).
- Authority copy: `production/screens/equity-uprise-screen-registry-v1.json`.
- Published mirror (docs/ is not published): `screens/data/screen-registry-v1.json`, byte-identical.
- Sources read: the asset registry (ids, `center_ft`), the B1 and F1–L7 object inventories, the committed B1 GLB
  (B1 inventory objects carry no plan placement), the Core V2 floor programs and B1 program (rooms), the
  electronics manifest (IDF rack support point), `workplace-occupancy-v1.json`, the distributed scenario pack +
  learner tickets + IT lab catalog (TRAINING seeds) and `data/seo/domain-architecture.json` (roof destinations).

Each screen: `screen_id` (`SCR-<asset_id>`), `floor`, `room`, `asset_id`, `inventory_id`, `mesh_node_prefix`
(matches the floor GLB's `<ID>::screen` nodes), `kind`, `app {id, page, variant}`, `network_asset_id` + `host`
(what the app talks to: workstation, AV decoder, switch, server), `position` (feet, frame `core-v2-local-ft`, with
its `source`), `approach` (eye/look points in front of it), `modes`, `access`.

Placement sources, in order: inventory `bounds_ft`, B1 GLB node bounds, asset-registry `center_ft`, inventory
`center_ft`, the manifest's IDF rack point, program-zone centroid. Every record names the one it used. B1 MDF
devices carry placeholder fabric coordinates (`placement_authority: unknown`), so their consoles sit on the modelled
`B1-TELECOM-RACKS-01` bays, stacked by rack unit.

Access: B1 is open and normal (owner, 2026-11-03; consistent with the workplace canon that B1 is a staffed floor).
Every screen is `control_target: SANDBOX`, `live_control_allowed: false`. The platform is owner-gated for now.

## 2. Apps (`screens/*.html`, `js/eu-screens/apps/*.mjs`)

| App | Opens from | What it is |
| --- | --- | --- |
| terminal | workstation monitors (B1–F3, F6), B1 NOC console, MDF/IDF rack consoles, BMCs, rack UPS cards, BAS lab console | self-built terminal emulator over the sandboxed shell |
| kiosk | F1 reception, F2/F3 member check-in, F1 directory, Passport kiosks | check-in flow, directory, Passport stamps |
| noc | B1 digital-twin wall, incident/route wall, occupancy board, route console; F6 NOW / PAST WORK / JOIN | building health from the sandbox graph |
| vms | B1 NVR, F1 reception security interface | camera wall (rendered schematic feeds), recorder |
| studio | Floor 4 surfaces, edit/recording displays, floor control, F4 monitors | REC, meters, faders, scenes, signal path |
| evidence | Floor 5 surfaces, archive search, navigator, publication/source displays, F5 monitors | session evidence (SHA-256), case files, export |
| departures | F6 roof transition, L7 display/beacon/return/restricted/portal | data-driven departure board (routing contract §4, §9) |
| wall | remaining program surfaces (F1, F2, F3, F6 rooms) | the surface's program and live floor state |

Shell (`js/eu-screens/shell.mjs`, `net.mjs`, `man.mjs`): bash, IOS-style switch, BMC and UPS contexts; `ping`,
`traceroute`, `nslookup`/`dig`/`host`, `ip addr|route|link`, `ifconfig`, `dhclient`, `systemctl`, `journalctl`,
`ipmitool sel|sensor|chassis`, `raid`, `ups`, `camera`/`vms`, `bacnet`, `cable test|reseat|replace`, `ssh`,
`show interfaces status|interface|vlan|power inline|ip igmp snooping|mls qos|logging|lldp|running-config`,
`configure terminal`, `interface`, `shutdown`, `switchport access|voice vlan`, `power inline`, `ip igmp snooping`,
`mls qos`, `ticket`, `status`, `alarms`, `reset`, `lab start|inject`, `man`, history and Tab completion. The
addressing plan (`10.<vlan>.<level>.<n>`) and hostnames are a deterministic teaching plan, not an as-built schedule.

## 3. Enter / return contract (`js/eu-screens/contract.mjs`, `enter.mjs`)

Enter: `screens/<app>.html?screen=<SCR-id>&mode=<WORKPLACE|TRAINING|MISSION>&return=<token>`; the token is
base64url JSON `{v, href, floor, room, mode, pose{pos,target}, screen, src}` with three.js world metres. `href` is
same-origin only. Before leaving, the building rewrites its own history entry to `#eu-return=<token>`, so the app's
**Building** button (history back when it came from the building, else the URL), the browser back button and a
reload all land on the same floor, pose and mode. Sessions persist per mode in sessionStorage (try/catch, memory
fallback).

Integration hook for the canonical viewer and the PRIM3 game: `createScreenHooks({THREE, camera, controls,
registry, getMode, getFloor, src})` → `bindFloor(level, root)`, `addProxies(level, parent)`, `pickAt(event, el)`,
`open(screen)`, `restore(returnPoint)`; `consumeReturn()`; and `openScreenById(registry, id, {pose, floor, mode,
src: "game"})` for hosts without THREE. Demo: `screens/building.html` (owner-gated, noindex). The viewer itself is
not modified here.

## 4. Modes

- **WORKPLACE**: the canonical baseline; read-only; can never persist a fault.
- **TRAINING**: one floor-native ticket per floor from the distributed scenario pack, fixable from a console;
  fixes record SANDBOX evidence (automation ceiling Demonstrated).
- **MISSION** (PRIM3): outages handed in by the game (`state.setMissionFaults`), e.g. the registry's
  `mission_presets[<floor>]` "blind the floor" (PoE pulled from every camera on it). Never visible in WORKPLACE.
- `reset` clears only the current mode.

## 5. Verification

- `node docs/design/equity-uprise-building/production/screens/build_screen_registry_v1.mjs --check`
- `node --test scripts/test/eu-screens.test.mjs` (registry ↔ asset ids, contract round trip and refusals, shell
  determinism, every floor's ticket fixed from a console, mode isolation, page gates and phone-first CSS)
- `node scripts/e2e/eu-screens.e2e.mjs [outDir]` (Playwright, 390 px and 1440 px)
