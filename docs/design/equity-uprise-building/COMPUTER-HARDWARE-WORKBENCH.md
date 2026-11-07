# Physical computer workbench — review implementation

Status: **DRAFT / source implemented, not a production deployment claim**. Baseline: `d436115289cbed922d92adff78e08b4ad7d276b8` (server lab #714). No floor plan, building geometry, city work, production data or access role is changed.

## Entry and scope

`/screens/terminal.html?tab=hardware&mode=TRAINING` opens Hardware in the existing owner-gated screen application. A `computer=<canonical asset id>` selects equipment. Every supported computer's existing screen can enter the workbench and return through the existing pose/return contract. Studio and Evidence workstation screens also expose Inspect computer. Game Hub has separate entries for the original Server Lab and the new Computer Workbench.

The catalog is derived from the existing registry and typed connections at load time: **36 workstations + six server/storage appliances = 42 computers**. B1 has four workstations and all six servers; F1/F2/F3/F4/F5/F6 have 4/2/4/8/8/6 workstations. There is no invented L7 workstation. Every computer has a matching screen binding; no fixed four-device truncation remains in the terminal's floor device list.

This is coverage of **registered computers**, not every object that resembles a desk in a GLB. Furnishing-only v3 props are not silently promoted into compute assets. All 42 source equipment locations still have `placement_authority: unknown`. The B1 MDF room/rack coordinate conflict remains open. The workbench uses a separate bench-local millimetre frame and never moves the rack, a room, or a building prop.

## Model authority

- `production/lab-runtime/computer-hardware-profile-v1.json`: explicitly authored generic workstation training profile, 300 × 240 × 380 mm service chassis, 32 GB baseline, CPU/cooler, memory, M.2 SSD, enclosed PSU, fan, RTC battery and TPM.
- `equity-uprise-computer-hardware.mjs`: catalog, deterministic state transitions, compatibility and service guards, console adapter, evidence.
- `equity-uprise-computer-view.mjs`: physical part envelopes, keyboard/monitor, rear ports/cables, inspection/exploded views and component picking. Uses the site's existing vendored Three.js; no new renderer dependency or generated brand mark.
- `equity-uprise-computer-workbench.mjs`: accessible screen-app view. HTML controls remain available when WebGL is unavailable.
- Servers reuse **`expandServerModel` and `SRV-2U-GEN` from #714**. The three virtualization hosts retain that existing training geometry. Using those internals for NAS/backup/NVR is an illustrative training reference, not proof of those appliances' installed boards, firmware or storage layouts. The original #714 RAID5/5.76 TB exercise is unchanged; do not transplant its array into every appliance.

Reference envelopes and rules are not vendor procurement, as-built, commissioning, construction or certification authority. No sealed PSU enclosure can be opened. Actual hardware requires its own service manual and qualified safety procedures.

## Behavior and shared state

The existing `ScreenSandbox.session` holds per-mode `hardware` state. There is no new auth, backend, queue, live-control endpoint or cloud save. WORKPLACE is read-only and strips saved hardware faults; TRAINING and MISSION are isolated. State survives navigation in this browser tab. Device reset does not erase its event ledger; global sandbox reset resets hardware in that mode. Events are bounded to 200 and exports state that they are **unassessed**, not a credential or tamper-proof mastery record.

Boot progresses OFF → POST → FIRMWARE → BOOTLOADER → LOGIN → DESKTOP through explicit steps. Only fixed sandbox personas can sign in; no real credentials are requested. Missing CPU/cooler or usable memory blocks POST; missing SSD blocks boot. A bad DIMM reduces memory; a failed fan is reported as discrete degradation, not a thermodynamic prediction. No actual Linux VM, instruction-set emulator, native kernel, arbitrary code execution, electrical solver or temperature/RPM measurements are provided.

Physical power/data/display changes use the **exact connection IDs, endpoint ports and recorded peers**. Workstations lose networking when unplugged without pretending their local OS stopped. Display loss is independent of network availability. Two-feed servers retain power with one healthy feed; losing both also removes modeled BMC standby power. BMC network wiring remains an explicit abstraction, not a fabricated independent management circuit.

Hardware state overlays the existing electronics graph without mutating the registry or clearing independent lab faults. Terminals and dependent logical services see host outages. The existing allowlisted shell is wrapped, not replaced: local display/login readiness and BMC power/status/sensors follow hardware; network diagnostics remain on the canonical graph. A repair/reset cannot clear an unrelated canonical fault. Screen apps on a powered-off/locked/disconnected-display workstation do not pretend the desktop is usable.

Cold-service mutations require shutdown, **every** AC cord disconnected, cover open and simulated ESD bond. Wrong kits, unknown parts, occupied slots and wrong cable peers fail with reasons. Violations enter the event ledger; no certification/grade is awarded. #714 retains the specialized hot-swap, rebuild and L1–L4 assessment system rather than being replaced by this general-purpose workbench.

## Privacy and release

Screen apps now delegate to the existing hardened `owner-only.mjs` rather than retaining a second stale owner gate. Server permissions remain authoritative. Browser gates are not secrecy protection for shipped static source/assets. No role, RLS or production authorization is expanded.

Publish copies the new modules/profile through the existing `deploy-pages.yml` preview-assets stage. Release static files together. The blocked #707 learning backend is not a dependency for this browser-only milestone, and no schema is applied.

## Validation

`node --test scripts/test/eu-screens.test.mjs scripts/test/server-lab.test.mjs scripts/test/owner-only.test.mjs scripts/test/game-hub.test.mjs`: **138 passed, zero failed/skipped**. This includes **67 new hardware checks**, covering all 42 computers and shared graph/shell behavior.

The unchanged server-lab verifier passes **1,531 checks**. Python source tests pass **7/7**. The complete root run under local Node 22.16 with `--experimental-strip-types` has 1,585 passes, three skips, and one failure: the unchanged Stripe replay test launches a child with its own environment that drops `NODE_OPTIONS`, so this older Node cannot import the existing TypeScript dependency. Running that child with stripping enabled refuses the hosted DB with the expected exit code before any connection. No Stripe code was changed to make this pass.

Local Chromium cannot navigate even to the isolated project server (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). **No local browser or visual pass is claimed.** The read-only Site smoke CI now runs `verify_computer_workbench_browser.mjs` through the existing server-lab test entrypoint with `EQUIPMENT_BROWSER_QA=1`, using sealed owner fixtures, the actual local Three renderer, 390/1440 viewports, servicing/boot/link checks and screenshot artifacts. Inspect the exact PR-head results and images before release; unit tests are not visual acceptance.

## Explainers

Capture frame exports the real rendered equipment. Export explainer shot plan produces an asset/profile/state-bound 30-second Higgsfield storyboard. See `HIGGSFIELD-EQUIPMENT-EXPLAINERS.md`. No provider request, credits, uploads or paid job are performed by export.

## Remaining work

Resolve equipment-to-furniture identity and the B1 placement conflict before replacing all in-building scenic computer meshes. Add real vendor profiles only from approved measurements/manuals. Add shared durable assessment only through the existing learning backend. VM-backed desktops, circuit/thermal solvers, and completed Higgsfield renders are separate milestones and are not claimed here.
