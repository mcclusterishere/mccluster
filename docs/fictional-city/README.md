# McCluster City — commercial district

This is the first playable district of the owner's fictional city: eight businesses, 24 newly
authored adult neighbors, and a Whip Equipped garage occupied by McCluster, Majid and Gunny.
It is a Bridgeport-inspired harbor setting, not a geographic reconstruction.

## Open and play

Open **Explore McCluster City** in the existing Game Hub, or go to `fictional-city.html`, with the house owner's existing account. The shared owner gate must
receive a fresh server yes before loading the game. Walk with WASD/arrow keys, the on-screen
direction controls, or a tap on the street. Drag to turn the camera; use the + / − / reset buttons
or scroll to change zoom.
Approach a person or door and press E, tap Interact, or tap the person/building to approach it.

Every shop has an enterable cutaway interior. Counters expose the shop's fictional goods.
Dialogue panels offer three authored conversation topics per new resident and a personal history.
The directory provides the same interactions for keyboard users and devices unable to render WebGL.
The district map can move the player to a known doorway. That is a convenience travel action,
not a claim of a simulated vehicle-driving system.

The pocket starts with 250 city credits. Purchases create local inventory and receipts, with
insufficient-funds and quantity limits. This is a single-player game balance, not money, rewards,
crypto, a real checkout, or a tamper-proof online economy.

## Spatial program

**The city (2026-11-03 expansion).** The original block now sits in a larger harbor city built around
the Equity Uprise HQ island: Civic Center to the west, the HQ Waterfront to the east and along the east
wharf, Northside's homes and public school to the north, and Workshop Wharf on the west wharf. Two
wharf walks and two piers face the island across the bay; the footbridge is still the only way over.
The plan, the placement contract, lore binding, streaming and before/after counts are in
[`EXPANSION.md`](EXPANSION.md).

The first block has two facing rows on Harbor Boulevard, a garage behind the north row, a south
harbor promenade, a footbridge and a small island:

| North row | South row |
| --- | --- |
| GAURANFUCKING TEA | Hitman Gear |
| Hordash | Real Camera Men |
| Mike Hawk campaign office | Pressure TV Network |
| Robbery 1s Exchange | Baddies on Wheels |

The island's Equity Uprise landmark uses the canonical 72 ft square footprint and +81 ft roof
walking-plane datum, expressed in metres. It has six enclosed floors and an open roof. It is a
deliberately simplified exterior for this district; it is not a new architectural authority or
the complete detailed building. Its ground-floor handoff opens the existing HQ emergency exercise in the canonical tactical
runtime, which loads the detailed building geometry and has its own controls. The complete HQ keeps its own floor geometry, rooms, access rules and presentation.

The surrounding shops are original procedural meshes. Repeated buildings' components, trees,
lamps, paving and character parts use instanced geometry. The scene caps pixel ratio at 1.5 and
keeps the HQ's detailed floor assets out of initial district load. Resource cleanup disposes
owned textures, materials, geometries and listeners. These choices follow Three.js's documented
[instancing](https://archive.threejs.org/docs/api/en/objects/InstancedMesh.html) and
[resource-disposal](https://threejs.org/manual/pages/how-to-dispose-of-objects.html) contracts;
the actual runtime uses the existing house convention of Three 0.180.0.

Collision checks cover buildings, indoor counters/garage props, water and the union of land,
bridge and island. Tap walking uses bounded A* paths. NPCs follow authored sidewalk patrols.
These are scripted recurring residents, not autonomous generative agents. Vehicles are set dressing;
driving, traffic, combat and full-body voice performances are later systems. The expanded city streams render detail in 64 m chunks (see `EXPANSION.md`).

## Existing systems reused

| Existing authority or runtime | City use |
| --- | --- |
| `js/owner-only.mjs` | Same server-verified private preview gate and session rechecks |
| `js/mcc-auth.js` | Existing owner session for optional authenticated Core reads |
| `js/tabbar.js` | Existing house navigation; no replacement bottom bar |
| `docs/universe/universe-registry.json` | New independent exploration universe, entrance IDs and route handoffs |
| `docs/music/whip-equipped/` | Complete screenplay and Road Years exported as a read-only garage story desk |
| `prim3-transit.html?level=equity-uprise-hq` | Existing HQ emergency exercise with detailed canonical geometry |
| `action-globe.html?explore=1&halo=1` | Existing owner transportation/Halo globe |
| `prim3-world.html` | Existing private PRIM3 world |
| `album.html?album=whip-equipped` | Existing listening surface |
| Core capability catalog + owner MCP bridge | Read-only `game.lore.read` on the existing OVH service |

The archived `_unfinished/uprise-world/` is preserved. No tactical vendored module, Site 0
geometry, building floor program, homepage or real-company registry is replaced.

## Canon and source provenance

The owner asked to recover their historical fake brands. The October 19 media-universe manifest
records earlier project names as `prior_user_project_or_idea` but the proposal as
`proposal_only` / `proposed_not_provisioned`. That establishes the name/history, not an
operating company or connected social account. Each district brand records that distinction.

The tea alias and abrasive guarantee, cursed Robbery 1s concept, Real Camera Men pricing satire,
Hitman Gear, media identities and current Hordash/Mike Hawk directions are retained. New shop
premises, employee names, origins and exact dialogue are identified as current fictional authorship.
The district does not represent a complete recovery of every idea in the owner's life; additional
recovered concepts can be added with provenance. `LORE.md` is the readable companion.

Whip's garage is a pre-finale free-roam hub. It preserves the established three-person cast without
inventing biographical origins. Alana is not a permanent post-ending pedestrian. The screenplay
still ends Dealer Plates → Tears Won't Fall → Salvage Title; its legitimate-business/criminal-cousin
double perspective remains intact. The screenplay reader displays the full written material and
2T/T/2T targets; it does not pretend that scenes have been filmed, voiced, or timed as a game cut.

## One lore source, two delivery surfaces

The sole authored district source is:

`core/data/fictional-city/district.v1.json`

OVH's existing release system installs `core/`, so the lore arrives with the same release,
rollback and drift contract as Core. The public static site removes backend sources before
publication. `tools/publish-fictional-city.mjs` explicitly exports only the public-safe district
JSON byte-for-byte to `data/fictional-city/district.v1.json`, plus a generated screenplay reader.
Derived browser files are ignored by Git and regenerated during Pages publication.

The current Core capability accepts bounded universe/section/entity selectors and returns revision
and exact source SHA256. Existing owner authentication and edge-to-Core signing remain unchanged.
No prompt, provider URL, filesystem path, inference request, purchase or private memory query is
accepted by this capability.

The browser makes an optional owner-authenticated revision/hash check. Only a Core release matching
the exact static bytes can supply resident records. Offline/unavailable/older Core falls back to the
same authored static fiction. A changed owner session invalidates in-flight responses.

**Audience and confidentiality are separate:** the playable preview uses the owner gate, while this
authored fictional dataset is public-safe source. A static HTML gate does not encrypt static assets.
Raw private chats, private source access URLs and `ai_context` are not published.

## Files and maintenance

- Host and presentation: `fictional-city.html`, `css/fictional-city.css`
- Scene and movement: `js/fictional-city/scene.mjs`, `geometry.mjs`, `spatial.mjs`
- Dialogue, shops, story desk and navigation: `js/fictional-city/app.mjs`
- Local save and game-credit rules: `js/fictional-city/state.mjs`
- Authenticated lore read-through: `js/fictional-city/core-link.mjs`
- Core reader: `core/src/game-lore.mjs`
- Capability binding: `core/capabilities/catalog.json`, `core/src/tools/control.mjs`
- Deliberate existing bridge exposure: `workers/mccluster-mcp/src/mcp.js`
- Static export: `tools/publish-fictional-city.mjs`, `.github/workflows/deploy-pages.yml`
- City geography (authority): `core/data/fictional-city/places.v1.json`
- Places resolver and lore binding: `js/fictional-city/places.mjs`
- Render chunks (derived, streamed): `js/fictional-city/chunks.mjs` → `data/fictional-city/chunks/`
- PRIM3 boards from the same places: `js/fictional-city/tactical.mjs`; #711 converter mapping:
  `tools/prim3-city/places-adapter.mjs`

State is stored under `here.universe.mccluster-fictional-city.state`. It includes position/interior,
visited shops, met residents, inventory, receipts and last-read story chapter. Corrupt/old saves are
sanitized. It is device-local; cloud synchronization is not claimed. Browser Back re-enters through
the owner check and restores city state rather than reviving a disposed WebGL context.

## Local checks and release

Run:

```sh
node tools/publish-fictional-city.mjs
node --test scripts/test/fictional-city*.test.mjs scripts/test/equity-uprise-mission-screens.test.mjs
node --test scripts/test/owner-only.test.mjs scripts/test/publish-strip-parity.test.mjs
npm --prefix core run check
npm --prefix core test
```

The browser suite `scripts/e2e/fictional-city.e2e.mjs` uses real Three 0.180, local source content,
and explicit owner/member/guest and Core fixtures. It tests phone and desktop widths, movement,
enter/exit, dialogue, purchases, persistence, the story desk and route handoffs. It never contacts
a production account. Point `THREE180_DIR` at exact cached `three.module.js` and `three.core.js`,
`CHROMIUM_PATH` at Chromium, and use the installed Playwright runtime.

Release through the normal main PR/check gates. Pages exports the game; the existing Worker release
adds the semantic capability to its owner-only bridge; Core is promoted at an exact green main SHA
through `deploy/ovh-production`. A successful source merge or ref promotion alone is not live-host
verification. Record the serving deployment SHA and manifest hash before calling OVH current.
