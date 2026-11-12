# Floor device repair v1

Status, 2026-11-12: **final regenerated all-floor geometry passes the strict/bound diagnostic gate; visual and installation review remain open**. Review material for the existing draft PR802, not a merge, deployment, physical installation or visual approval. NOT FOR CONSTRUCTION.

## What this repairs

The original combined-geometry audit found 98 unsupported workstation/monitor bases and 33 intersecting monitor-panel pairs. The furniture-only audit could not see those electronics defects. The repair gives every existing host and monitor an explicit station, support mesh, support height, XY and facing, rather than guessing a nearby surface.

There are still **36 workstation hosts and 62 monitors**, with the same canonical identities and connections. `production/electronics/device-placement-bindings-v1.json` plus its three declared source fragments resolve **98 bindings**. Published manufacturer reference exteriors are integrated for the 36 hosts. Monitor geometry remains the existing training design, not an asserted manufacturer display model.

Core V2, the 72 ft plate, vertical systems, floor elevations/functions, named staff floors, B1's normal staffed-floor status, controlled-room access and live-control denial remain intact. Helen stays on F6. No new enclosed floor or competing backend is introduced.

## Floor changes and proposed makers

| Floor | Existing hosts / monitors | Layout repair | Proposed reference |
| --- | --- | --- | --- |
| B1 Technical Operations | 4 / 8 | Reuse Minh's firmware bench and Hassan, Emre and Jonas stations; preserve all furniture placements. Remove only superseded scenic monitor parts and retain the bench instruments. | Lenovo ThinkStation PX |
| F1 Arrival / Intake | 4 / 4 | Retain exact reception/passport/intake support bindings. Deepen the intake credenza from 18 to 26 inches and shift it slightly south for the Dell envelope, keeping the consultation table clear. | Dell Pro Precision 9 T6 PW9T6260 |
| F2 Public Forum | 2 / 2 | Bind to Chioma and Sari's furnished desks. Keep the forum, workshop and listening areas for people; no staff or furniture movement. | Framework Desktop Ryzen AI Max+ PRO 495, 192 GB |
| F3 Fellowship + Network | 4 / 4 | Bind to Nusrat, Arjun, Rafael and McCluster's existing desks; retain Aya's bench, Opportunity Exchange and conversational interview rooms. | System76 Thelio Major r5-n4, current black enclosure |
| F4 Media + Culture | 8 / 16 | Keep Priya/Maren desks, use recording/edit worktops and add four deliberate production desks within brand/comms. Align inputs/seats/screens and ground the two edit speakers. Preserve the listening room, gallery and interview set. | Apple Mac Studio M5 Ultra |
| F5 Policy + Proof | 8 / 16 | Keep Oksana/Leila/Amira desks; widen five carrels to 54 inches for dual screens, with the sixth paper-only. Floor-standing towers occupy measured side bays, not centered knee space. | HP Z8 Fury G6i, standard side panel, premium front I/O |
| F6 Penthouse Command | 6 / 12 | Keep Helen/Li Wei/Marc workspaces; add three focused briefing-preparation desks. Command, strategy and partner-briefing tables remain free of host/dual-screen stations. | ASUS ExpertCenter Pro ET900N G3, NVIDIA DGX Station architecture |
| L7 open Roof / Mobility Portal | 0 / 0 | No permanent workstation or new building enclosure. | ASUS ProArt P16 H7606WX RTX 5090, closed portable prospect only |

These are **unconfirmed sponsorship prospects**, not agreements. Physical assets are **not received** and live connections **not connected**. No logo, supply commitment or ownership claim is introduced. Seven manufacturers are represented by eight product references; NVIDIA describes the F6 platform architecture, while ASUS identifies the selected enclosure.

## Fidelity and installation boundaries

`MANUFACTURER-MODEL-REFERENCES.md` and `production/electronics/manufacturer-model-references-v1.json` contain the product-specific sources, configurations and uncertainties. The scene models are **partial exterior proxies**: original economical geometry with published envelopes and selected recognizable details. They are not approved CAD, manufacturer meshes, complete replicas, validated internals or commissioned installations.

- ASUS ET900N dimensions cover its published main body only. Unsized projecting handles/feet are omitted; total installed height and full installation clearance remain unverified.
- HP's selected envelope excludes its rear handle. The wider MAX side panel is not silently substituted.
- Framework's upright width/depth/height mapping is inferred from product orientation; some rear placement uses the official chassis-family diagram rather than an independently measured 495 enclosure.
- Optional bays, cards and GPU outputs are not invented. Simplified socket positions do not authorize rewriting the real cable graph.
- The ProArt is a closed portable reference. Open dimensions, active screen state, outdoor operation and weather resistance are not asserted.
- Desk contact and geometric clearance do not prove load capacity, thermal/ventilation performance, acoustic suitability, electrical safety or service access.

## Scoped scenic replacement and viewer integration

Only the exact bound desk/bench scenic screens are suppressed. Independent keyboards remain. Existing canonical wall, gallery, archive and control surfaces stay in place.

F4 has two explicit replacements: `F4-RECORDING-MONITOR-01` maps to USER monitor pair 03; `F4-EDIT-DISPLAY-01` maps to pair 04. Only their old bezel/screen geometry and the exact obsolete edit display backer are removed. The F4 floor report records **66 modeled inventory IDs plus 2 replaced IDs**, instead of claiming absent meshes still exist. These capability identities remain in the source inventory and their mappings must remain discoverable.

`production/electronics/generated/equity-uprise-workstations-v1.glb` provides an authored workstation-only layer. `js/eu-screens/workstation-layer.mjs` is wired into building/floor views, the screen building app and PRIM3 integration, with floor isolation, duplicate-layer avoidance and explicit unavailable state. It does not generate replacement geometry, invent placement, advance boot state or connect a real host. Unknown monitor state stays dark; visible signal is labeled sandbox state. Late-loaded B1/F1 neighbors and the facade now inherit current floor/stack visibility instead of reappearing after isolation.

The read-only `equity-uprise-visual.yml` PR workflow captures actual canonical WebGL views at 390 and 1440 pixels using local assets and pinned browser/renderer packages. A test-only observer is appended only by its loopback server. It uses no credentials, production requests, deployment or branch writes, and does not promote unfinished viewers. PNGs, exact device counts, world bounds, asset hashes and failure logs are artifacts for review, not automatic aesthetic approval.

The first real phone/desktop captures exposed ceiling occlusion and camera framing failures despite correct component identities. The follow-up uses a labeled, reversible 7.5 ft AFF presentation cutaway for isolated B1–F6 views, preserves full architecture in room/stack/facade/infrastructure modes, and fits the real visible bounds to the HUD-free viewport using both horizontal and vertical field of view. Device views use actual authored seats and post-controls triangle sightlines, with individual host/monitor captures where a complete station cannot fit. No model geometry, placement, owner gate or pixel threshold is changed. Actual phone and desktop captures now pass the scoped geometry-visibility/framing review. All 66 original PNGs, both machine reports and source hashes are preserved in [the rendered evidence](references/device-repair-visual-v1/README.md). This is not final material-quality or owner design approval.

## Verification checkpoint

The following are measured source/geometry checkpoints, not visual acceptance:

- Regenerated floor reports: B1 **18/18**, F1 **19/19**, F2 **15/15**, F3 **15/15**, F4 **25/25**, F5 **24/24**, F6 **26/26**, L7 **15/15**. The final combined device audit records the actual floor/electronics source hashes.
- Re-run on 2026-11-12: manufacturer-profile tests **18/18**; F2/F3 station tests **7/7**; F4–F6 station tests **7/7**.
- The floor-specific reports record real-triangle support, separate component collision tests, retained keyboards/seats and preserved public functions. Upper-floor pairs have 0.18 ft bezel gaps; B1's narrow Emre station has a positive 0.10 ft gap.
- Final `production/interiors/device-placement-audit-v3.json`: **98/98 bindings passed**, **0 unresolved contacts**, **0 monitor-panel intersections**, with both `passed` and `bound_placement_passed` true. Exact support, manufacturer model, origin and facing pass against regenerated geometry. The intermediate Framework-origin mismatch was fixed by rebuilding, not exempted.
- Electronics checks **86/86** plus the independent verifier pass. The fabric retains **1,883 assets and 1,330 routed, port-complete connections**. Final full electronics GLB: **12,432,680 bytes**; dedicated workstation GLB: **1,066,788 bytes**.
- Interior checks **120/120**, combined building **46/46**, vertical circulation **44/44**, program coverage **466/466**, and hardware **67/67** pass.
- The full root suite after final regeneration passed **2,522 Node tests (4 skipped) and 7 Python tests**. The dedicated viewer suite passed **9/9**, including exact final-GLB component identities and world transforms. The same-export cleanup suite passed **16/16**; its proof preserves every node, primitive, populated metadata record and BIN byte while removing only allowed redundant optional fields.
- Local browser startup remains unavailable because of the existing socket-permission restriction. The first CI browser captures loaded all 98 device identities correctly, but exposed real framing/occlusion defects. The camera/cutaway follow-up passes 19 targeted tests with all generated floor inputs required. The subsequent CI run on `c17c20bf3cb98210431e9ff76f22887a760c1e1d` passed **110/110 checks at each width**. Review of all eight floor overviews, sampled host/monitor details and mode/failure captures found no blocking visibility/framing defect. Original evidence is preserved in the repository.

The final regenerated floors and electronics passed this diagnostic acceptance command:

```sh
python docs/design/equity-uprise-building/production/interiors/audit_device_placement.py --strict --require-bound --output docs/design/equity-uprise-building/production/interiors/device-placement-audit-v3.json
```

Both the report's placement result and all bound support/origin/facing checks pass against final source hashes. Repeat the gate after any relevant geometry change, together with the existing building, circulation, capability, screen/runtime and viewer-consumer tests. Publication/CI outcome is separate from these local checks.

## Remaining work

1. Complete the framing follow-up PR publication/CI checks. The post-regeneration root suite and final strict combined geometry gate have passed; this is not a merge or deployment claim.
2. Obtain owner design review and higher-quality/physical-device rendering review. The canonical LOW-quality phone/desktop geometry, support and framing review has passed; materials, fidelity and performance are separate. The evidence records the nonblocking prefetch-status and resize-reset issues.
3. Reconcile B1's separate MDF/rack anchor at about (45, 62.8) with the actual Network/Telecom room at X32–52 / Y22–34, including service/cable routing. Workstation repair does not resolve that mismatch.
4. Verify manufacturer installation/service requirements and improve visual fidelity where references remain incomplete. Procurement, sponsor outreach, asset receipt and physical compute allocation require separate real-world evidence and authorization.

Detailed reports: `production/electronics/device-repair-b1-v1.md`, `device-stations-f2-f3-repair-report-v1.md`, and `device-stations-f4-f6-repair-report-v1.md`. Original baseline and F1 pilot remain in `production/interiors/device-placement-audit-v1.json` and `device-placement-audit-v2.json` for traceability.
