# Handoff — Equity Uprise HQ Interior Rebuild v2 (Blender set, Floors 1–7)

Paste the prompt below into the next agent session.

---

You are picking up the Equity Uprise HQ Interior Rebuild v2: an editable Blender set for Floors 1–7. Repo:
`mcclusterishere/mccluster`, branch **`claude/equity-uprise-hq-rebuild-zoz1v7`** (pushed). Work folder:
`docs/design/equity-uprise-building/production/hq-interior-v2/`. Before any edit, read the root `AGENTS.md`,
`docs/design/equity-uprise-building/AGENTS.md` (and run its context audit), `REFERENCE-AUTHORITY.md`, then this folder's
`README.md`. This is a Blender set build only: no website, Worker or database changes. Never draw a logo. Never open the
canonical GLBs or any existing `.blend` for writing; save rebuilds to new paths.

**Owner's brief:** rebuild the F1–F7 interiors in a new editable Blender project on Prime (the owner's Windows HP).
Use the seven approved GPT Image boards for furniture, materials, equipment, lighting and mood, and the seven north-up
SVG overlays plus `asset-map.csv` (52 anchors) for placement. Where an image drifts, the plan wins. Requirements:

- Keep the elevator core aligned, including the F6 arrival. B1 stays the crew hub. F6 is Executive Command, with
  Matthew's suite beside the one suspended Halo Globe (no pedestal). L7 is the open roof/mobility portal.
- Use per-floor collections: Shell, ArchFinishes, Furniture, Equipment, Lighting, Cameras. Instance repeated assets.
- Keep the Arrival & Intake coat rack, the Media + Culture rooms and the Policy + Proof archives.
- The PRIM2 screen and the Halo Globe are separate interactive objects, each with its own named interaction anchor.
  McCluster office branding appears on F6 only.
- Deliver the `.blend`, an asset inventory keyed to the overlays, a top-down and an eye-level render per floor, and
  before/after views for F1 and F6. Report every inferred dimension or placement.

**Approved pack:** on Prime at `C:\Users\Mattm\Documents\Equity Uprise Show\HQ Blender Studio\References\HQ Interior Concept v2`.
It is also on branch `docs/equity-uprise-hq-interior-concepts`
([draft PR #871](https://github.com/mcclusterishere/mccluster/pull/871)), folder
`docs/design/equity-uprise-building/references/hq-interior-concept-v2`. All 17 files match its `SHA256SUMS.txt`.
The CSV, the proxy script and the 7 SVGs are also copied, with hashes, into `hq-interior-v2/source/`.

**Done and pushed:**

- `EU_HQ_Interiors_v2.blend` (Blender 4.2 format, self-contained).
- Scripts: `build_hq_interior_v2.py`, `eu_hq_kit.py`, `hq_interior_v2_layout.py`, `verify_hq_interior_v2.py`,
  `render_hq_interior_v2.py`, `compose_review_sheets.py`.
- `hq-interior-v2-verification.json`: 81/81 checks pass in a fresh Blender process (v2.1).
- **v2.1 merge** (`hq_interior_v2_merge.py`): the existing v3 interior layer, the restored builder objects and the
  device layer are back (219/286 v3 pieces kept, 67 superseded with reasons, 79/86 F1–F6 devices). See the README's
  v2.1 section before changing any placement: do NOT redraw what already exists; enhance it.
- `hq-interior-v2-asset-inventory.csv` and `EU_HQ_Interiors_v2-build-report.json`.
- `PROJECT-STATE.md`, `MASTER-INDEX.md` and `BUILDING-FILE-INDEX.json` updated. The context audit, repo-source gate
  (3,099/3,099) and program-coverage gate pass.

**How it was built:** in a cloud container, CPU only, with the `bpy` 4.2.0 module. Prime was NOT connected; no file on
Prime has been read or written yet. The owner asked to move the work to Prime. Prime's Remote Control lists `mccluster`,
`Equity Uprise App` and `System32`, but none of them is served to cloud sessions (reason not given; most likely the
Windows Claude app needs updating). `System32` should be removed from that list.

**Open tasks, in order:**

0. **Upgrade, don't replace.** Done for 131 pieces (README → "Meshes upgraded in place"). Remaining v3 meshes (task
   chairs, files, carrels, F4 set gear, rugs) can be upgraded the same way once a better kit master exists.
1. **Review renders.** If the cloud session committed `renders/` (29 JPEGs: `F0X_TOP/EYE/BOARD`, `F06_HALO_SUITE`,
   `F01_ENTRY`, `BEFORE_F01_*`, `BEFORE_F06_*`) plus `renders/compare/`, review them. If it did not, they were lost with
   the container: re-render with `render_hq_interior_v2.py`, then run `compose_review_sheets.py`.
2. **Rebuild and render on Prime**, with local Blender and its GPU, from the pack already on Prime. Save to a NEW path
   in the Show project, for example `...\HQ Blender Studio\EU_HQ_Interiors_v2.blend`. Keep the existing HQ files intact.
   The commands are in `README.md` → "Where it was built":
   - generate the gitignored F1–F6 GLBs with the official floor builders
   - run `build_hq_interior_v2.py --repo . --pack <pack> --out <new .blend>`
   - run `verify_hq_interior_v2.py` (expect 81/81)
   - run `render_hq_interior_v2.py --samples 64` or more; set `cycles.device = GPU` if available
3. **Compare and report.** Compare the renders against the boards (`renders/compare/*_board_vs_rebuild.jpg`) and report
   honestly where they match and where they don't.
4. **Owner decisions still open:**
   - McCluster office artwork for the empty slot `F06_BRAND_SLOT_mccluster-office`.
   - The Halo underside sits at 6.0 ft AFF, below door headroom.
   - The two L7 deviations: 7.4 moved out of `F7-MECH-UNIT-01`; 7.5 is realised by the existing `F7-MECH-UNIT-02`.
   - Visual approval of the inferred board dressing (all `S…` tags in the inventory).
   - Resolved: the three F6 preparation desks now sit next to Helen's office (east wall), with their chairs and devices.
   - v2.1: staff named at both an anchored station and their existing desk — replace, or second work point?
   - The `get-it-back` music-video scene on Prime uses the canonical Floor 6 Core v2 model, not this set; keep them separate.

**Gotchas already solved; keep them:**

- In background mode the glTF importer links objects to the scene root. The build relinks them into their source
  collection.
- Later imports reset earlier objects' transforms, so the axis fix (−90° about X) and the FFE lift are baked into mesh data.
- The builder GLBs carry colour only as a `Color` vertex attribute. The build adds the material
  `SRC_BuilderVertexColour` to display it.
- `Collection.hide_render` was not honoured in the renders, so the render script hides objects one by one.
- Workbench rendering needs EGL, which headless Linux lacks; use Cycles.
- `verify_*` rasterises at 6 in cells with a float epsilon; 3 ft doors are checked at the 30 in tier.

Commit to the branch above. Do not push to `main` and do not open a PR unless the owner asks. End commits with the
repository's co-author/session trailer convention.
