# PRIM3 White Industrial — Starter Asset Kit

24 original procedural 3D assets for the PRIM3 level builder. Every `.glb` is
self-contained glTF 2.0 with indexed geometry, flat normals, PBR materials, and
no external texture or library dependencies. These are a modular starter kit,
not a claim that the earlier cinematic concept art has been reproduced exactly.

## Use

- Load `catalog.json`; its `assets` array is the editor's asset palette.
- Load `asset.model` relative to this folder for the actual GLB mesh.
- Each asset uses **+Y up**, **+X right**, and **+Z depth**, in game units.
- Each model's origin is at the **bottom center** of its measured bounds.
- `width`, `depth`, `height`, and `bounds` are measured geometry dimensions.
  Small decorative trim can extend beyond the size in the friendly model name.
- `footprint` gives the nominal snapped placement/collision width and depth;
  decorative rails, trim and tree canopies do not enlarge that footprint.
  `surfaceHeight` is the walkable roof/deck height, separate from the top of
  parapets, railings, antennas and rooftop equipment. The main roof heights are
  warehouse 8, tower 12, container 4, bridge 0.3, and catwalk 4 game units.
- In the included Black Signal adapter, a signed 2D gameplay coordinate
  `(x, y)` maps to 3D `(x, elevation, y)`. Other engines may reverse Z to match
  their north direction; apply that conversion consistently to models and paths.
- `parts` supplies approximately equivalent box, cylinder, and sphere
  descriptors for the existing primitive renderer or a simplified fallback.
  The descriptor fields are `shape, x, y, z, w, h, d, color, r, material`;
  `r` is `[X, Y, Z]` Euler rotation in radians, with XYZ rotation order.
- `walkable`, `blocksMovement`, and `cover` are authoring defaults, not a full
  collision or movement solver. Roofs can be walkable while the building volume
  blocks ground movement. Traversal metadata indicates intended surface heights
  and stair/ladder rise; gameplay must support those links explicitly.
- Spawn and extraction meshes are authoring markers. Their game behavior comes
  from the level's metadata, rather than from displaying a mesh.

## Palette

Manufactured surfaces use white, ivory, porcelain and restrained gray seams.
Natural soil, grass, foliage, bark, water and stone retain natural colors.
The relay has a small cyan status display. Trees and rocks are intentionally
faceted lightweight geometry. Water uses a solid teal PBR material and subtle
ripple geometry; it is not an animated fluid shader.

## Regenerate and validate

```sh
python3 generate_assets.py
```

The generator uses only the Python standard library. It overwrites its own
`models/*.glb`, `catalog.json`, and `validation.json` deterministically. Validation
checks GLB header and chunk lengths, buffer alignment and bounds, index ranges,
finite position/normal components, and triangle counts.

The kit contains **12,104 triangles across all 24 models** and **744,528 bytes of
GLB data**. Each model uses one primitive per material, typically 1–6 draw calls.
No rigging, animation, navmesh, lightmaps, texture atlases, or collision-engine
objects are embedded. These should be added at the runtime integration layer as
the game needs them.
