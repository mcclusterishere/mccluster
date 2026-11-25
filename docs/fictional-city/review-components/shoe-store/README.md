# Jimmy's location: shoe showroom and factory review component

**Status: unplaced, additive model review. Not a playable shop or production integration.**

This is an original procedural 3D interior for the existing McCluster City renderer. It is not a separate game or replacement city. The owner's requested destination is a fictional storefront adaptation at Jimmy's, 1000 Main Street, Bridgeport. This model does not reproduce a surveyed interior or imply real-world ownership, vacancy, affiliation, or a real factory at that address.

## Review artifacts

- [Portable GLB](output/designer-kicks-retail-factory-review.glb): two named floors and three selectable glTF scenes (assembly, retail only, factory only), embedded geometry/materials, no external textures.
- [Retail mesh view](output/retail-model-review.png) and [factory mesh view](output/factory-model-review.png): deterministic CPU renders of the same procedural mesh assembly. These are **not browser screenshots**.
- [Layout and collision data](output/layout.v1.json), [structural validation report](output/validation.json).
- `layout.mjs` supplies authored fixtures, collision rectangles, standing points, thirteen owner-approved creative collection labels, and a reciprocal proximity-checked floor-transition adapter.
- `model.mjs` uses the city's existing `createGeometryKit().batch(...)` interface. It adds no runtime renderer, account, economy, map, or save writer.

The showroom has a bone/brass/ink finish, perimeter light strips, open display cases, fitting benches, checkout, rear stock and packing room. The basement has textile storage, cutting, sole presses, sewing, assembly, finishing, hanging garments, and dispatch. Both are authored 18 × 14 m game spaces. The factory floor is at −4.2 m in the GLB assembly. Original blockout sample shoes are unbranded and do not depict the cursed pair, finished collection designs, or licensed merchandise.

This is a usable low-poly geometry and collision foundation, **not the finished luxury art pass**. Architectural detail, final materials, final shoe/clothing models, storefront facade, doors, physically continuous stairs, signage, and lighting need further work. The marked stair landing invokes an explicit floor change; it is not a modeled traversable staircase. The default cutaway walls are a review choice, not a surveyed building shell.

## Why it is not placed yet

The verified parcel is CT parcel `339365`, location `996 MAIN ST #1000`; the existing CT Buildings service returns footprint `250914`, shared with neighboring premises. Preserve the Jimmy's parcel portion rather than claiming the whole footprint.

Applying the current city projection places that parcel near `[118.1542, -37.0108]`, overlapping authored Thugged Out Apparel, Bail Mary Bail Bonds, and Wing Stop Crying parcels. All 21 existing expansion business parcels are claimed. Do not relocate, rename, replace, or sell an occupied tenant to make room. No authoritative in-game sale/claim record for this destination was found. A geographic-region adapter and fictional ownership decision are needed before activation.

See the [published continuation brief](https://github.com/mcclusterishere/mccluster/blob/research/city-722-postmerge-core-handoff-20261103/docs/fictional-city/JIMMYS-STOREFRONT-CONTINUATION-2026-11-03.md) in [draft handoff PR #729](https://github.com/mcclusterishere/mccluster/pull/729). That brief carries the parcel sources, current integration seams, related ongoing branches, and preservation requirements. Re-read current `main` and current source authorities before integrating. Do not cherry-pick an older city wholesale.

## Integration contract

1. Resolve the geographic region and parcel adapter without changing existing IDs, coordinates, shops, Bridgeport story, Whip garage, or save keys. Do not infer that a real premises is for sale.
2. Add the storefront through the existing authoritative district and places sources, then regenerate exports. Do not edit generated data as authority.
3. Pass an existing geometry-kit batch into `buildStoreFloorModel(layout, floorId, { batch, detail })`. The caller owns batching, scene visibility, group cleanup, and kit lifetime. `mobile` removes decorations but keeps the same layout/collision.
4. Route movement and pathfinding to the selected floor's `surfaces` and `blockers`; keep the destination-specific street exit outside this component. Set the correct visible floor on load and transition.
5. Wire `transitionStoreFloor` to the existing position/save machinery with a backward-compatible optional floor. Old and malformed saves must fall back safely. Do not initialize a second inventory or balance.
6. Reuse the existing shop UI and fictional credits only after catalog, ownership and balance behavior are defined. Collection slots currently have `purchasable: false`, no price, no powers, no assigned real-brand model, and no crime-statistic claim.
7. Keep Robbery 1s Exchange and the original pair's Dave → donation bin → Malik → Harold → altar chain intact. The fitting samples are not that pair. The owner-approved labels are creative names; `Home Invasion` and `Repo` are not asserted FBI categories.
8. Add enter/exit, floor/load, near-portal, pathfinding, action reach, existing shop/inventory, disposal, owner-gate, phone input and regression tests before activation.

## Reproduction and checks

Reviewed against `main` commit `f1150c2c72ef03348aacc960f1f18a45d643a2a3` on 2026-11-03. No production source changed in this component patch.

```sh
node --test docs/fictional-city/review-components/shoe-store/layout.test.mjs \
  scripts/test/bridgeport-story.test.mjs \
  scripts/test/fictional-city-spatial.test.mjs
# 23/23 passed: 4 new component tests + 19 existing story/spatial tests.

# Use an already verified official Three.js r180 module directory.
# No dependency download, paid generation, or runtime change is performed here.
THREE180_DIR=/absolute/path/to/three-r180/build \
  node docs/fictional-city/review-components/shoe-store/export-model.mjs
node docs/fictional-city/review-components/shoe-store/validate-glb.mjs
# Optional review renders require numpy and Pillow in the local environment.
python docs/fictional-city/review-components/shoe-store/render-cpu.py
```

The exporter consumes the repo's existing geometry kit and requires exact Three revision 180. The CPU render source uses temporary `output/mesh-review.json` generated by the exporter; that bulky intermediate is intentionally not committed. The custom validator checks GLB headers, chunk and buffer bounds, finite positions/normals, valid triangle indices, embedded resources, two floors and the collection metadata. It is **not** the Khronos validator.

Current artifact: 252,784 bytes, 27 material batches, 3,848 triangles across both floors. SHA-256: `c2e70f99b12d984bb63c9f90eca4b53529251a24d8fc3960eab4f08317d83665`.

Browser launch failed before page load because Chromium could not create its process-singleton socket (`Operation not permitted`), including one approved escalation attempt. No browser visual QA, owner-gate QA, phone FPS, GLB import in Blender, Khronos validation, or full-repository tests are claimed. Complete those in a working development environment. Do not bypass the environment restriction.

No merge, deployment, purchase, live account/database change, or real-money transaction is part of this patch.

Packaging note: the first review commit used a new root directory and CI correctly rejected its deployment-strip parity. The component now lives under the existing non-published `docs/` tree; deployment workflows were not changed.
