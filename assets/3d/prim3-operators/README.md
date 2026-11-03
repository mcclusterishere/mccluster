# PRIM3 operator models (tactics preview)

`js/prim3-tactics/board3d.mjs` draws every unit as a procedural, articulated mannequin in the Prim3 canon wear. When a GLB for a role is listed in `manifest.json`, that model replaces the mannequin for the role. Nothing else changes: rules, taps and hidden information stay with the engine.

| Key | Who | Canon source in `mcclusterishere/Prim3` (`main`) |
|---|---|---|
| `E`, `R`, `T` | The squad. Cohort-02 Trainee in Wear-01 Company Black (the owner said 2026-11-02 that starting characters can be mannequins) | `assets/canon/brands/mccluster-corp/corporate-fits-identity/MCC-CFI-01-authority-black-v01.jpg` (left panel: full-body mannequin) |
| `H` | A known hostile. Defense / SOI-01 security officer: shirt, ultra-thin vest, body camera, one holstered sidearm, cyberdeck; no helmet, no long gun | `assets/canon/brands/mccluster-corp/security-officer-identity/MCC-SOI-01-authority-black-v01.jpg` (left panel) |

**Field operator looks:** the dressed mannequin and labeled loadout for each operator live in one place, Prim3 [`phenotypes/operators/LOADOUTS.md`](https://github.com/mcclusterishere/Prim3/blob/design/operator-loadouts-20261102/phenotypes/operators/LOADOUTS.md) (branch `design/operator-loadouts-20261102` until merged). As of 2026-11-02:
- **Entry (FO-E-AE):** photographed; owner-supplied.
- **Recon (FO-R-SO):** photographed; Codex, Prim3 PR #17.
- **Technical:** not photographed yet.

Use the mannequin photograph as the image-to-3D reference for that role. Prime −1 (`assets/canon/characters/prime-negative-one/`) is protected: never generate, trace or approximate the M helmet.

## Marks

The canon sheets carry McCluster marks (the M, Dual Sight, Two States). Image-to-3D would bake an approximation of them into a texture. The canon rule is: *omit a mark rather than approximate it*. So:

- generate from references with the marks omitted;
- if the marks are wanted on the model later, apply them as decals from the locked SVG masters in Prim3 `assets/canon/brands/mccluster-corp/marks/`, scaled whole, never redrawn.

The procedural mannequins draw no marks.

## Generating a model

1. Use McCluster's own path: the `model3d.generate` capability (Worker `mccluster` media gateway, fal provider, `FAL_KEY` held as a Worker secret). Set a `budget_cents` cap on every call.
2. Give it one single-view reference per run (front, back, side A, side B per `phenotypes/ASSET-REPLICATION-STANDARD.md` when they exist; until then the full-body mannequin panel). Output format: GLB.
3. Check the result:
   - height 175–185 cm, Y up, facing +Z;
   - feet at the origin;
   - one mesh; under about 30k triangles for phones;
   - no marks baked in.
4. Save it here as `E.glb` / `R.glb` / `T.glb` / `H.glb` and list it in `manifest.json`, for example `"models": { "H": "H.glb" }`.
5. Run `scripts/e2e/prim3-tactics-hints.e2e.mjs` with `THREE_DIR` set. It must stay green.

Status (2026-11-02): no GLB has been generated. This session could not reach the McCluster Core connector ("Authentication required"), so no fal spend has happened.
