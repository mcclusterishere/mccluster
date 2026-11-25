# Equity Uprise workstation repair: rendered evidence

**Scoped result: phone and desktop geometry visibility, support and framing pass.**
These are actual canonical WebGL captures, not illustrations or substitute models.
All files copied from the CI artifacts are byte-identical to the originals. Their
SHA-256 values are in [the evidence manifest](evidence-manifest.json).

- Rendered source commit: `c17c20bf3cb98210431e9ff76f22887a760c1e1d`.
- Rendered tree: `cd2d2e749384cd21d95b11c1fd04b6ae318e330a`.
- [Read-only CI run](https://github.com/mcclusterishere/mccluster/actions/runs/43130326243).
- Phone: **390 × 844**, **110/110 checks**, **33 captures**.
- Desktop: **1440 × 1000**, **110/110 checks**, **33 captures**.
- Renderer: pinned Three 0.180.0, Playwright 1.57.0 Chromium, software WebGL,
  canonical LOW quality and Day override. No production requests or credentials.

## What was reviewed

B1–L7 overviews, the seven floor-specific host examples and their eleven bound
monitor examples, whole stack, facade, initial loading, Plant/Room/normal
transitions and missing-workstation failure behavior. All eight overviews fit the
HUD-free viewport. Sampled hosts and monitors are visible and rest on their authored
support surfaces. Floor details, stack/facade visibility and explicit unavailable
state are preserved. Full geometry returns outside the labeled isolated-floor
7.5 ft AFF presentation cutaway. Geometry, source placements and pixel thresholds
were not modified to satisfy the captures.

The machine checks cover all **36 hosts and 62 monitors**, exact component identities,
world transforms, floor visibility and bounds. Close-ups sample one authored
station per occupied floor, not every workstation. These images complement the
separate **98/98 strict real-mesh support/origin/facing audit**, not replace it.

Both runs report zero unhandled page errors, unexpected HTTP failures and external
requests. The evidence retains software ReadPixels warnings, intentional missing
workstation 404 responses and request-cancellation records; no claim of a silent
browser log is made.

## Floor plans

| Floor | Desktop | Phone |
| --- | --- | --- |
| B1 | [Actual overview](desktop/1440-B1-overview.png) | [Actual overview](phone/390-B1-overview.png) |
| F1 | [Actual overview](desktop/1440-F1-overview.png) | [Actual overview](phone/390-F1-overview.png) |
| F2 | [Actual overview](desktop/1440-F2-overview.png) | [Actual overview](phone/390-F2-overview.png) |
| F3 | [Actual overview](desktop/1440-F3-overview.png) | [Actual overview](phone/390-F3-overview.png) |
| F4 | [Actual overview](desktop/1440-F4-overview.png) | [Actual overview](phone/390-F4-overview.png) |
| F5 | [Actual overview](desktop/1440-F5-overview.png) | [Actual overview](phone/390-F5-overview.png) |
| F6 | [Actual overview](desktop/1440-F6-overview.png) | [Actual overview](phone/390-F6-overview.png) |
| L7 | [Actual overview](desktop/1440-L7-overview.png) | [Actual overview](phone/390-L7-overview.png) |

## Maker-host examples

Every sponsor is an unconfirmed prospect; no physical hardware receipt or live
host connection is asserted. The meshes are source-backed partial exterior
proxies, not approved manufacturer CAD or complete replicas.

| Floor | Proposed model | Desktop | Phone |
| --- | --- | --- | --- |
| B1 | Lenovo ThinkStation PX | [Actual host](desktop/1440-B1-station.png) | [Actual host](phone/390-B1-station.png) |
| F1 | Dell Pro Precision 9 T6 PW9T6260 | [Actual host](desktop/1440-F1-station.png) | [Actual host](phone/390-F1-station.png) |
| F2 | Framework Desktop Ryzen AI Max+ PRO 495 | [Actual host](desktop/1440-F2-station.png) | [Actual host](phone/390-F2-station.png) |
| F3 | System76 Thelio Major r5-n4 | [Actual host](desktop/1440-F3-station.png) | [Actual host](phone/390-F3-station.png) |
| F4 | Apple Mac Studio M5 Ultra | [Actual host](desktop/1440-F4-station.png) | [Actual host](phone/390-F4-station.png) |
| F5 | HP Z8 Fury G6i | [Actual host](desktop/1440-F5-station.png) | [Actual host](phone/390-F5-station.png) |
| F6 | ASUS ExpertCenter Pro ET900N G3 | [Actual host](desktop/1440-F6-station.png) | [Actual host](phone/390-F6-station.png) |

All detailed captures and original reports: [desktop](desktop/) and [phone](phone/).

## Limits and remaining review

- LOW software rendering has visible aliasing/faceting. This accepts visibility,
  supported placement and framing, not final materials, photorealism or performance
  on a physical phone. Owner design approval remains separate.
- Initial B1 and missing-asset images can retain a neighbor-prefetch “Floor 1 ·
  loading detailed model…” status although B1 is correctly selected and rendered.
- Resizing a non-room view refits the overview, resetting a chosen angle or close-up.
  Room Mode preserves its pose. A later interaction-polish pass can improve this.
- B1's separate MDF/rack anchor mismatch, manufacturer installation/thermal/service
  requirements and full exterior/internal fidelity remain outside this repair.
- No merged code, deployed viewer, sponsorship agreement, commissioned physical
  device or real compute allocation is demonstrated by these screenshots.

See [the repair record](../../FLOOR-DEVICE-REPAIR-V1.md) and
[manufacturer source/uncertainty notes](../../MANUFACTURER-MODEL-REFERENCES.md).
