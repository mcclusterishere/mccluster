# PRIM3 asset pipeline: beta now, deep pass after beta

Owner direction, 2026-11-02: the whole-figure operator GLBs are "the quick rough draft". After the beta ships, do an in-depth pass: generate each loadout item as its own asset, print the character as a plain black mannequin, and assemble. Also give the owner a guided back-end studio to make assets and environments from photos without an engineer.

Status: **plan only**. Nothing here is built or spent yet. The reminder is tracked as a GitHub issue.

## Why the current figures look rough

The E/R/T GLBs (`assets/3d/prim3-operators/`) came from one front photo each through a single image-to-3D call (`fal-ai/hunyuan3d-v3/image-to-3d`, 40,000 faces, 67.5¢ each).

- **The back and sides are guessed.** Only a front view went in.
- **One mesh for everything.** Body, cloth and hard gear are fused. Small items like the recorder, radio or holster get only a few hundred triangles and a sliver of texture.
- **No skeleton.** The figures cannot walk, crouch or aim. The game only slides them across tiles. The procedural stand-ins can animate; the generated figures cannot.
- **Lighting is baked into the colours.**

## Deep pass (after beta)

1. **Mannequin base:** one rigged, faceless matte-black body with a standard skeleton, shared by every role. Put sockets at the chest, belt, hips, thighs, back, head and both hands. Rig it with an auto-rigger, or buy one clean licensed base rather than generating it.
2. **Soft goods per role:** shirt, trousers, gloves and boots, skinned to that skeleton. Generated hard items do not drape, so cloth is the one part that should be modelled on the base, not generated loose.
3. **Hard goods, one asset per numbered item.** Generate every item from LOADOUTS.md on its own: carrier, headset, recorder, radio, holster and sidearm, carbine, scoped rifle, entry tool, binoculars, pouches, knee pads, cyberdeck. Use image-to-3D from a crop of that item in the loadout flat-lay photo. Supply back and side views where they exist (`phenotypes/ASSET-REPLICATION-STANDARD.md`; the generator accepts them for +15¢). Shared items, such as the sidearm, radio and recorder, are made once and reused.
4. **Assembly:** a loadout becomes data. Each role lists items and the socket each one hangs on. A loadout change then edits data, not a mesh. That makes it easy to add profiles like "Recon without the rifle", which LOADOUTS.md says must be their own pair.
5. **Quality bar:**
   - every item checked against its photo;
   - no marks; marks may come only from the locked masters as decals;
   - texture size proportional to the item;
   - a phone triangle budget per figure;
   - walk, crouch, aim and death animations playing on the rig.

**Rough cost** at today's catalog prices: about 35–45 distinct items across E, R, T and H at roughly 52–82¢ each, about $20–35, plus a base body and rig. That is roughly 10× the beta, for figures that animate and can be swapped piece by piece.

## Guided back-end studio (owner self-serve)

This is a house-owner page in the Control desk: "make this, make that, make this environment".

1. **Choose what you're making:** character item, prop, building piece, or environment / backdrop.
2. **Add photos, guided:** the studio asks for front, back and sides, shows examples, and checks resolution. Photos go to Supabase Storage on the canonical plane.
3. **Describe it in plain words.** McCluster AI turns that into a clean generation request and warns about marks, logos and likenesses before anything runs.
4. **See the price first:** the studio shows the catalog cost and a budget cap, and you confirm. It reuses the existing media gateway (`/v1/media`, `model3d.generate`, `image.generate`) with its budgets, reservations and cost lineage. No new spend path.
5. **Review in 3D:** turntable and scale check against a 1.8 m mannequin, then approve, retry, or edit the request.
6. **Approve into the kit:** the asset gets slimmed for phones and lands in the builder's palette (a `prim3_assets` catalog next to `prim3_levels`), ready to drag into a level.

Environments ("make this environment") would use the same flow: a photo or a description becomes an HDR sky and lighting preset, or a building piece. Whole-level generation stays in the builder, where the engine checks a level is winnable.
