# Equity Uprise — Server Lab (B1 MDF rack, hands-on 3D)

> Status: **V1 IMPLEMENTED — SANDBOX TRAINING LAB**. SIMULATION only; `execution_target` SANDBOX; `live_control_allowed` false.
> Not construction documentation. Generic, unbranded hardware only (no vendor names, marks or logos on any part).

## Owner direction

Owner, 2026-11-03: *"I want to make the building an actual test environment for shit like servers. So people can go there, like, in 3D and walk around and click on a server rack and look at the inner components that make up a server, identify them, rebuild the server, troubleshoot it like it's a real server, like levels of this shit. That building is supposed to be that real."* Also: *"Everybody's welcome to B1."*

## What a learner does

Page: `equity-uprise-server-lab-3d.html` (owner-gated like the rest of the PRIM3 learning system: `js/owner-only.mjs` asks `GET https://api.mccluster.org/v1/status` with the session; nothing of the lab loads until the server says yes).

| Level | Lab | Tier | What happens |
| --- | --- | --- | --- |
| Explore | — | — | Walk (tap the floor, WASD) or orbit to MDF rack 01. Tap any unit for its card (U position, registry asset). Slide the lab server out on its rails, open the lid, tap any component for its card: real dimensions, connector, hot-swap, rules, and how it fails. Exploded view; rear view. |
| L1 Identify | IT-LAB-041 | FOUNDATION | 18 timed prompts: 6 rack units, 12 server components. Alternates "name the highlighted part" (4 choices) and "find and tap it" in 3D (any instance of the kind counts). Hints are recorded by the assessment. |
| L2 Rebuild | IT-LAB-042 | TECHNICIAN | Stripped 2U chassis plus a parts kit with distractors (16 GB RDIMM, DDR4 UDIMM, NVMe drive, 1400 W PSU). ESD strap first; CPU pin-1 alignment; heatsink torque in label order; DIMMs in the board's channel order (A, E, C, G…), slot 1 before slot 2, identical modules, both CPUs balanced; drives in bays 0–3; riser 1 before the RAID card (x8 slot R1-S2); controller cabled to backplane A; OCP NIC; matched PSUs; PSU1→PDU A, PSU2→PDU B; NIC port 1→core switch 1 SFP+-IN-03, port 2→core switch 2 SFP+-IN-03 (the canonical Step 4B connections `CABLE::STEP4A::00017/18/41/42`); management port to VLAN-MGMT; lid closed. Each wrong move is refused with the reason and counted. |
| L3 Bring-up | IT-LAB-043 | ADMIN | Power on, read the POST capture (CPUs, memory), reach the management controller out-of-band (not over the production bond), read the SEL, build the data array to a requirement (4 × 1.92 TB, ≥ 5.0 TB usable, survive one failure → RAID 5, 5.76 TB; the learner states the usable capacity), verify both 10 Gb/s links at the rear. |
| L4 Troubleshoot | IT-LAB-044…051 | ADVANCED / EXPERT | A fault is injected into the sandbox clone of `B1-SRV-HYP-01-I001`. The ticket, LEDs (health, PSU, drive, NIC, fan, DIMM fault LED), SEL, POST capture and host report are the evidence. Diagnose (multi-select), open a service window where needed, fix the right part (tap it in 3D or pick it), verify. Faults: failed DIMM (uncorrectable ECC, 224 of 256 GB), degraded RAID member (bay 2), PSU2 failure (redundancy lost), fan 3 failure (thermal throttle), NIC port 1 link down (DAC), CMOS battery (clock drift → TLS/sign-in errors, NTP), firmware baseline mismatch (update order BMC → BIOS → RAID → NIC after draining VMs), and an Expert multi-fault incident (PSU + RAID: restore power redundancy before starting the rebuild). |

Safety is part of the score: a DIMM/CMOS/CPU replace on a powered host is a major violation; pulling a healthy member from a degraded RAID 5 or the last healthy PSU is critical and blocks a positive automated signal.

## Authority and files

| File | Role |
| --- | --- |
| `production/electronics/server-lab-hardware-v1.json` | Hardware authority: 42U EIA-310 rack (482.6 mm panels, 450 mm opening, 465.1 mm hole spacing, 44.45 mm/U, 600 × 1200 × 2000 mm), elevation mapped to registry assets of `B1-TELECOM-RACKS-01-I001` (fibre and copper panels, both core switches, edge router, HA firewalls, CPE, NVR, backup, NAS, three virtualization hosts, rack UPS, four 0U PDUs on A/B and rack-UPS feeds), a training-only 1U bench server; 1U and 2U generic two-socket server layouts; the component catalog (chassis, board, CPU/LGA socket, heatsink, DDR5 RDIMM, CRPS-class PSU, fans, 2.5-inch SAS/SATA/U.2 bays, backplane, tri-mode RAID controller, risers, OCP 3.0 NIC, BMC + dedicated management port, TPM 2.0, CR2032, front panel, M.2 boot module, cords and DAC) with real dimensions, rules and failure modes (front panel, component LED, POST, SEL, beep/code, OS symptoms, fix, verify); the L2 kit; the L3 RAID requirement; curriculum objective references. |
| `production/lab-runtime/equity-uprise-server-lab-runtime.mjs` | Runtime: `expandServerModel` (every component as a data box the page draws and the validators reason over), `validateMemoryPopulation`, `raidCapacity` / `evaluateRaidChoice`, `RebuildState`, POST/SEL synthesis, `symptomState`, `ServerLabExercise` (L1–L3), `createServerTroubleshootScenario` (L4 on the Step 3 `GuidedScenarioRunner`), `serverSafetyCheck`, `mdfElectronicsSubset`. |
| `production/lab-runtime/server-lab-scenario-pack-v1.json` | L4 scenarios in the Step 3 pack schema; observations rendered from the hardware failure modes. |
| `production/lab-runtime/verify_server_lab_v1.mjs` | Verifier (in Core V2 CI): rack and catalog schema, no brands, every U accounted for, registry anchors, component boxes inside the chassis and non-overlapping, population rules, RAID math, rebuild validator, catalog IT-LAB-041..051, L1–L3 under the Step 6 assessment, L4 fault → symptom → fix → verify determinism (twice, plus subset-vs-full-fabric equivalence), safety boundary. |
| `production/electronics/build_equity_uprise_electronics_v1.py` | Catalog: IT-LAB-041..051 appended to the Step 4A ladder (51 labs). |
| `production/lab-runtime/equity-uprise-electronics-sandbox.mjs` (1.2.0) | Seven server hardware faults bound to the canonical host: host degraded with a fault-specific condition; NIC fault takes `CABLE::STEP4A::00017` down; CMOS drift reaches the hosted `LOGIC-SVC-NTP`. |
| `equity-uprise-server-lab-3d.html`, `css/server-lab.css`, `js/server-lab/scene.mjs`, `js/server-lab/app.mjs`, `js/owner-only.mjs` | The page (three.js 0.180 via the jsDelivr import map). The runtime and data load from `equity-uprise-preview/`, published by `deploy-pages.yml`. `?level=L1..L4&lab=IT-LAB-0xx` deep-links; `?fx=lite` drops shadows and reflections for weak devices and CI browsers. |
| `scripts/test/server-lab.test.mjs`, `scripts/e2e/server-lab.e2e.mjs` | Page contract (gate, publication, mobile rules, no brands) and the browser run through L1–L4 at 390 px and desktop. |

## Placement

The rack sits on the Step 4B electronics manifest's MDF data-rack anchor (B1, (45, 62.8) ft, `physical_routing.floor_support_points_ft.data_rack`) and mirrors `B1-TELECOM-RACKS-01-I001`. **Authority gap, recorded not fixed:** the detailed B1 builder draws the Network / Telecom Core enclosure at X32–52 / Y22–34 with its four racks at Y26. This lab moves no building geometry; the B1 owner reconciles the two. The page shows the MDF room around the rack row, not the whole stacked building.

## Integration and boundaries

- Every level is bound to its catalog record through `createElectronicsBoundSessionFromCatalogLab`, so the session evidence carries the canonical sandbox state; L4 faults change the canonical host asset.
- Scoring is the Step 6 `AssessedExercise`: action ledger, hints, safety violations, timing, SHA-256 provenance, `Demonstrated` ceiling, no automated Verified / Applied / Mentor.
- Exam-objective references (CompTIA A+ Core 1 hardware, Server+ SK0-005, Network+ physical layer, Security+ hardware security) name what is practised; `credential_is_not_competency`.
- The browser loads a B1 MDF subset of the electronics fabric (76 assets); the verifier proves faults change identical IDs on the subset and the full fabric.

## Game Hub entry (recommendation)

`data/game-hub/modules.json` lives on `claude/whole-platform-20261102`, not main. When that lands, add to the `prim3-security` module's `games` (or a new "IT hardware" module):

```json
{ "id": "equity-uprise-server-lab", "kind": "link", "title": "Server Lab", "tag": "Lab", "href": "equity-uprise-server-lab-3d.html", "gate": "owner",
  "blurb": "Walk to the B1 MDF rack, open a server, identify every part, rebuild it, bring it up and fix injected hardware faults." }
```

## Next

- Componentized rack devices (switch port faces, patch panel jacks) are still schematic; promote them through the Step 4C archetype contract.
- A 1U rebuild variant and NAS/backup-appliance labs (IT-LAB-022/023/024 tie-ins) on the same runtime.
- Reconcile the MDF location between the B1 builder and the electronics manifest; then the lab can be entered from the stacked building viewer.
