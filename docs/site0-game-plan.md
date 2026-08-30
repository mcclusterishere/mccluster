# Site 0 as a game — what exists, what does not, and where Seele fits

Written 2026-08-20, after the owner subscribed to [Seele AI](https://www.seeles.ai/).
Every number here was measured off the files, not estimated.

## The short answer

**Yes for the hard part, no for the dressing.**

The hard part of a 3D game is a correct, navigable, coherent world. That
exists: nine levels, 183 named volumes on one canonical programme, verified
walkable, with working vertical circulation and a mission that completes. It is
playable at `/site0/` today.

What does not exist is everything you put *on* that world. Both models carry
**zero materials and zero textures** — the geometry is vertex-coloured boxes.
There are no props, no characters, no animation, no sound design. That is not a
small gap, but it is the gap a generative asset tool is actually good at, and
Seele exports GLTF, which drops straight into the build that already runs.

## What exists, measured

### Geometry

| file | nodes | meshes | verts | materials | textures |
| --- | --- | --- | --- | --- | --- |
| `PRIM3_Site0_Master_Facility_v04.glb` | 120 | 126 | 1,056 | **0** | **0** |
| `prim3_site0_master.glb` *(the playable one)* | 183 | 183 | 11,272 | **0** | **0** |
| `PRIM3+site+zero+perfect+model.glb` *(the shell)* | 1 | 1 | **1,024,579** | 0 | 0 |
| `PRIM3_Site0_Prime_Escape_Spine_v02.obj` | — | — | — | — | — |

The shell is the exception that proves the point: it is a beautiful skin with a
million vertices and nothing named inside it. The interior is the opposite —
every volume named and placed, and nothing on its surfaces.

**The shell now ships** (17 MB, re-encoded losslessly — see
`_unfinished/site0-game/README.md`), which makes the materials gap the most
visible thing about the build rather than a footnote. It has `POSITION` and
`NORMAL` and nothing else: no `COLOR_0`, no UVs, no materials, no textures. It
renders flat grey because flat grey is all the data there is. That makes it the
best first target for a Seele pass — one mesh, one surface, and it is the first
thing anyone sees.

### Photoreal worlds

Two Gaussian-splat captures, now held locally rather than on a share link:

| | splats | size |
| --- | --- | --- |
| L3 flight deck | 1,920,000 | 29.5 MB |
| B3 PRIME command | 4,320,000 | 66.6 MB |

These are the only photoreal material in the project. Seven levels have none.

### Media already in the repo

| | count | size |
| --- | --- | --- |
| audio | 18 tracks | 64 MB |
| video | 43 files | 48 MB |
| images | 1,552 files | 127 MB |

A full album's worth of music is the thing most games this size do not have.

### Design authority

`_unfinished/site0-game/index.html` is an interactive design bible: the
nine-level stack, 25 L1 programme zones, interior concepts, and a stated
material and lighting doctrine. When a generator needs a prompt, that document
is the prompt — it is the difference between "make a sci-fi hangar" and a
brief that produces something belonging to *this* building.

## What is missing

Ordered by how much each one changes the experience.

1. **Materials.** Zero, on everything. Every surface is a flat vertex colour.
   This is the single biggest visual gap and the cheapest to close.
2. **Props and furniture.** Measured, most "rooms" are floor plates — the six
   L1 rooms are 0.10 m tall and every B1–B5 room is 0.82 m. They are coloured
   zones on a slab. Nothing stands in them.
3. **Characters and animation.** None of either. There is no one in the
   building and nothing moves except the player and the lifts.
4. **Sound design.** The music exists; the room tone, footsteps, lift motors
   and door mechanisms do not.
5. **A reason to be there.** The current mission is a route test — approach,
   transit, exit. Fine as a proof the world works, not a game.

## Where Seele fits, concretely

Seele's stated outputs are games, images, video, 3D assets in FBX/GLTF/OBJ,
code, audio and animation, exporting to Unity 6, Three.js and WebGL. Matched
against the list above:

| gap | fit | note |
| --- | --- | --- |
| materials | **strong** | GLTF in, GLTF out; the build already loads GLTF |
| props / furniture | **strong** | per-room prompts straight out of the design bible |
| characters | **strong** | but rigging and retargeting is where these tools usually disappoint — treat it as unproven until one walks |
| animation | **unproven** | verify on a single character before planning around it |
| sound design | **partial** | music is already done and better than generated; SFX is the gap |
| the game itself | **do not** | there is already a working three.js build with correct collision, derived lift stops and verified floor coverage. Regenerating it from a prompt would throw away everything that was measured into it |

That last row is the one to be firm about. The temptation with a
text-to-game tool is to describe the building and let it build one. The
building already exists, correctly, and it took real work to make it walkable.
**Feed Seele the gaps, not the whole thing.**

## What cannot be done from here

- **There is no Seele API access in this environment**, and no credentials for
  the account — nor should there be. The workflow is: generate in Seele, export
  GLTF, drop it in the repo, and it gets wired up here.
- **The $50 tier's contents are not stated on the pricing page.** What is on the
  site is a free tier, "Pro plans" with faster generation and larger storage,
  and commercial-use rights requiring an active Pro plan. Check inside the
  account what the plan actually includes before planning credits around it.

## "Turn the whole site into a playable experience"

Worth separating two things.

**A playable room inside the site** — done and live at
**<https://matthew.mccluster.org/site0/>**, reachable from
`hitman-facility.html`, whose nine-level selector hands the chosen level
straight to the game. All nine deep-links verified landing on real floor:

```
?level=L4 -> L4  y  94.8  no lift serves this level
?level=L3 -> L3  y  76.3  lift A
?level=L2 -> L2  y  15.9  lift C
?level=L1 -> L1  y   1.9  lift C
?level=B1 -> B1  y -10.3  lift C
?level=B2 -> B2  y -22.3  lift C
?level=B3 -> B3  y -34.3  lift C
?level=B4 -> B4  y -45.5  lift C
?level=B5 -> B5  y -58.4  lift C
```

**The whole site as a game** — possible, and mostly a bad trade. The site is a
résumé, a record, a store and a services page; those exist to be read and
acted on quickly. Wrapping them in a 3D shell puts a loading screen and a
control scheme between a visitor and the thing they came for. The version that
works is the one already started: a real playable room, linked from the page
that describes it, with the rest of the house staying fast.

The interesting middle is making *more rooms* playable rather than making the
house 3D — the splat worlds for L3 and B3 are already a second one waiting to
be finished.

## Suggested order

1. **Materials on the playable model.** One pass, biggest visible change,
   no new geometry, no risk to anything measured.
2. **Props for two levels** — L1 and B3, the two with the most work behind
   them. Prove the pipeline on those before spreading it.
3. **A character that walks.** One. Do not plan around generated animation
   until one is running in this build.
4. **SFX pass.** Footsteps by surface, lift motors, room tone.
5. **Then** talk about what the game *is*.

Nothing in steps 1–4 touches geometry, so the shell stays exactly as it is.
