# Manufacturer computer exterior references

Status: **source-backed exterior review models**, checked 2026-11-11. These are
original, economical scene meshes with published dimensions and the extent
limits below. They are
not manufacturer CAD, approved digital twins, donated equipment, sponsor
agreements, commissioned installations or connected physical hosts. Architecture
remains schematic and **NOT FOR CONSTRUCTION**.

This catalog implements the named computer references without renaming generic
training boxes. It does not register equipment, create floor stations, move
furniture, change room functions or grant access to a real computer. Proposed
floor partnerships remain proposals. Existing workbench/server internals remain
separate generic training profiles; none becomes a validated representation of
these manufacturers' internals.

## Source files and API

- `production/electronics/manufacturer-model-references-v1.json`: exact identities,
  published envelopes, selected configuration, sources and uncertainties.
- `production/electronics/manufacturer_models.py`: deterministic named components.
- `production/electronics/test_manufacturer_models.py`: dimensional, geometry,
  provenance, semantic, determinism and GLB round-trip checks.

Call `build_manufacturer_model(exact_model_id)`. The result has:

- `components`: component-name → `trimesh.Trimesh`. `CHASSIS` is mandatory and
  includes the contact feet or integrated base; its bottom is Z=0.
- `envelope_ft`: **width, depth, height**, in feet, not the W/H/D order sometimes
  used in manufacturer literature.
- `bounds_ft`: `[[-width/2, -depth/2, 0], [width/2, depth/2, height]]`.
- `metadata`: the catalog entry plus frame, scope, uncertainty and individual
  visible-port features. Socket coordinates are explicitly schematic.

The ASUS ET900N profile is explicitly the published main-body reference, not a
verified installed envelope: unsized projecting handles and feet are omitted.

All meshes are Z-up, front toward **-Y**, centered on XY, with the whole support
datum at Z=0. Build a fresh instance or copy meshes before transforming. Apply
one rigid yaw/translation and one feet-to-metres conversion at the existing
consumer boundary. Do not center the chassis vertically or add another foot
height. Unknown model IDs fail closed instead of producing a branded generic box.

`CHASSIS` includes the published maximum extent even where the body is rounded.
Contact validation should use actual supporting feet/base, not require the empty
corners of a rounded envelope to touch a surface. Every detail remains within the
declared reference envelope. A case radius, vent pitch, panel thickness or port
location is a **schematic visual detail**, not a measured manufacturing dimension.

## Exact profiles and dimensional authority

Values below are millimetres, **W × D × H** in the model's upright/closed frame.

| Exact catalog ID | Manufacturer model | W × D × H | Basis and boundaries |
| --- | --- | --- | --- |
| `dell-pro-precision-9-t6-pw9t6260` | Dell Pro Precision 9 T6 PW9T6260 | 294.1 × 617.5 × 449.8 | Dell dimensions. Feet inclusion is not separately specified; feet stay inside the published total. Optional FlexBay/optical/SD fittings are not assumed. |
| `apple-mac-studio-m5-ultra` | Apple Mac Studio M5 Ultra | 197 × 197 × 95 | Apple complete enclosure, including integrated base. Two front and four rear Thunderbolt 5 sockets. |
| `framework-desktop-ryzen-ai-max-plus-pro-495-192gb` | Framework Desktop Ryzen AI Max+ PRO 495, 192 GB | 96.8 × 205.5 × 226.1 | Manufacturer sequence is 96.8 × 205.5 × 226.1 mm. Upright W/D/H mapping is inferred from product orientation because the sequence is unlabeled. Optional handle omitted. |
| `lenovo-thinkstation-px` | Lenovo ThinkStation PX | 220 × 575 × 440.4 | PSREF explicitly includes feet. Configurable front bays have covers; no particular GPU or second power supply is asserted. |
| `hp-z8-fury-g6i-standard-panel` | HP Z8 Fury G6i, standard side panel | 219.5 × 559 × 445.1 | QuickSpecs H/W/D normalized correctly. Rear handle excluded. The 253.5 mm MAX side-panel width is a different configuration. Premium front I/O selected explicitly. |
| `system76-thelio-major-r5-n4` | System76 Thelio Major, `thelio-major-r5-n4` | 254 × 384 × 440 | Current black enclosure, not the previous wood-front generation. Feet stay within total height. |
| `asus-expertcenter-pro-et900n-g3` | ASUS ExpertCenter Pro ET900N G3 | 232 × 584 × 565 | Published main-body reference; projecting handles/feet are omitted and complete installed height remains unverified. Exact ASUS OEM chassis for NVIDIA DGX Station architecture. There is no claim that all DGX Station OEM products share one chassis. Old DGX Station dimensions are not reused. |
| `asus-proart-p16-h7606wx-rtx5090-closed` | ASUS ProArt P16 H7606WX, RTX 5090, closed | 354.9 × 246.9 × 18.3 | Maximum of this variant's published 14.9–18.3 mm thickness range. Not the 17.3 mm maximum of another H7606 variant. Open height is unpublished and not invented. |

### Dell

- [Dimensions and weight](https://www.dell.com/support/manuals/ko-kr/dell-pro-precision-pw9t6260-desktop/dell-pro-precision-9-tower-t6-pw9t6260_ss/dimensions-and-weight?guid=guid-f43a3b02-c09f-4dca-81c0-ea46c84e7bca&lang=en-us)
- [Front view](https://www.dell.com/support/manuals/ko-kr/dell-pro-precision-pw9t6260-desktop/dell-pro-precision-9-tower-t6-pw9t6260_ss/front-view?guid=guid-f5f02dbd-200f-4e39-be89-9023a3bb99c9&lang=en-us)
- [Back view](https://www.dell.com/support/manuals/ko-kr/dell-pro-precision-pw9t6260-desktop/dell-pro-precision-9-tower-t6-pw9t6260_ss/back-view?guid=guid-915c70f8-510d-4e67-879e-3b2edd2ed7a0&lang=en-us)

Preserved cues: two rising-diagonal grille fields, a vertical I/O strip right of
center, upper-left horizontal handle/intake recess, dark rounded tower, silver
rear panel, high rear AC inlet, ventilated rear and covered expansion region.
Front two USB-A, two USB-C and audio are explicit. Rear USB-C is two 10 Gbps plus
one 20 Gbps on the manufacturer guide. GPU outputs are configuration-dependent
and are deliberately not fabricated.

### Apple

- [Mac Studio specifications](https://www.apple.com/mac-studio/specs/)

Preserved cues: compact rounded-square silver enclosure, dark integrated intake
base, two front USB-C sockets, SDXC and a separate unlit status point, broad rear
vent, four rear Thunderbolt 5 sockets, Ethernet, AC, two USB-A, HDMI, audio and
power button. The integrated base contributes to, not below, the 95 mm height.
No Apple logo or product lettering is drawn.

### Framework

- [Desktop specifications](https://frame.work/desktop?tab=specs)
- [Official Quick Start Guide and enclosure photographs](https://guides.frame.work/Guide/Framework+Desktop+DIY+Edition+Quick+Start+Guide/464)
- [Official open hardware repository](https://github.com/FrameworkComputer/Framework-Desktop)

Preserved cues: narrow upright tower, 21 blank front tiles, two configurable
front expansion-card slots in a silver lower plinth and a low rectangular power
button. Slots do not imply any fitted
card type. Rear HDMI, two DisplayPort, two USB4-C, two USB-A, Ethernet and audio
come from the specification. Rear placement and the two-column mesh pattern use
the official Max 300 family rear diagram; current 495 specifications confirm the
port inventory, but 495-specific physical positions are not independently
measured. No official CAD is imported, traced or redistributed.
If future work uses that CAD, its CC BY 4.0 attribution obligations must be met.

### Lenovo

- [ThinkStation PX PSREF, views on page 1 and dimensions on page 5](https://psref.lenovo.com/syspool/Sys/PDF/ThinkStation/ThinkStation_PX/ThinkStation_PX_Spec.pdf)

Preserved cues: black tower, narrow red perimeter on front and rear, broad
honeycomb field, right-of-center vertical I/O and adjacent storage-bay covers.
Front USB-C is data-only in this reference; it is not a fabricated display output.
Rear configurable graphics/expansion slots remain covers, not asserted GPU ports.

### HP

- [Z8 Fury G6i QuickSpecs](https://www8.hp.com/h20195/v2/GetDocument.aspx?docname=c09249982)
- [Product page](https://www.hp.com/us-en/workstations/z8-fury.html)

Preserved cues: rounded black tower, crossed diamond grille, top handle recess,
horizontal upper-middle I/O bar, covered bay below and tall side intake. The
**premium** front option has two USB-A, two USB-C and headset; the inspected
entry-I/O illustration's four USB-A configuration is not silently mixed into it.
Rear motherboard/GPU ports remain unmodeled pending a pinned configuration.

### System76

- [Thelio Major product page](https://system76.com/desktops/thelio-major)
- [Exact-generation exterior overview](https://system76.com/tech-docs/models/thelio-major-r5-n4/external-overview)
- [Exact-generation specifications](https://system76.com/tech-docs/models/thelio-major-r5-n4/specs)

Preserved cues: black rounded/glossy-look front, silver vertical I/O capsule high
on the right, two USB-A, audio, USB-C and power, small integrated-height feet,
left narrow chevron vent and right broad upper intake. Rear motherboard/GPU port
types are omitted instead of borrowed from a different generation.

### ASUS

- [ExpertCenter Pro ET900N G3 dimensions and ports](https://www.asus.com/us/displays-desktops/workstations/performance/expertcenter-pro-et900n-g3/)
- [ProArt P16 H7606 variant specifications](https://www.asus.com/laptops/for-creators/proart/proart-p16-h7606/techspec/)

The station represents the exact ASUS product, with DGX Station architecture as
metadata. The official dimension illustration measures the main box: its
projecting carrying handles and feet have no separately published dimensions and
are omitted rather than silently inflating or compressing the 565 mm reference.
The complete installed height remains unverified. Silver perimeter, diagonal
front grille, dark top/bottom recesses, vertical front I/O and silver circular-fan
rear treatment come from the official product images. Its documented rear ports include four USB-A, two 400 Gb QSFP, management
and 10 Gb Ethernet, micro-USB, mini DisplayPort and three audio connectors.

The ProArt is a closed Nano Black laptop. Side I/O and lid/base separation remain
visible, but there is no active panel, fabricated open dimension or DialPad drawn
on the closed lid. A portable roof demonstration is a concept only; this module
does not add a permanent L7 computer or imply weather resistance.

## Component and runtime boundaries

Stable semantics are used only where supported:

- `FRONT_IO` / `REAR_IO` / `SIDE_IO`: visible socket groups and power controls.
- `POWER_SUPPLY`: **external mains-inlet face only**, not an exposed PSU interior,
  replacement instruction, electrical rating or live power control.
- `POWER_INPUT`: the laptop's external DC input; no invented enclosed PSU.
- `NIC_PORT`: source-supported physical network sockets. Not present on the
  laptop, or where an exact rear motherboard configuration remains unverified.
- `DISPLAY_OUTPUTS`: only confirmed connector types. Its absence does not mean a
  configurable workstation cannot drive a display; it means this profile does
  not assert an unselected GPU's connector type.
- `STATUS_INDICATOR`: an unlit physical cue. Geometry does not imply an online
  host and has no emissive live state.

Decorative panels, grilles, covered bays and trim have separate stable names for
inspection. Perforations are simplified surface patterns, not meshed through-holes.
Every model is made from original primitives and face colors, with no copied
brand imagery, wordmark, logo, vendor mesh or product-image texture.

Do not use a semantic component name as authority to rewrite the existing cable
graph. Each real socket/connection mapping and physical allocation needs its own
verified binding. Existing simulated computer/monitor identities and permission
boundaries are not changed by selecting an exterior.

## Validation and integration gate

Run with the repository's trimesh/numpy environment:

```sh
python docs/design/equity-uprise-building/production/electronics/test_manufacturer_models.py
```

The focused tests cover all eight exact envelopes, component containment, Z=0
support, finite non-degenerate meshes, a 6,000-triangle/12-component ceiling per
model, independent repeat builds, prohibited truth claims, port semantics,
variant-specific exclusions, source metadata and GLB round trips. These checks
do not establish browser, phone, tabletop clearance, service clearance or visual
approval. Floor integration must separately apply the authored asset/support
bindings, regenerate the canonical electronics outputs and run combined
placement, screen, capability, circulation and actual viewer review gates.
