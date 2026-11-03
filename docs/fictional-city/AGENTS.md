# McCluster fictional city — implementation and canon

The owner authorized this private playable district on November 3, 2026: recovered joke brands,
eight active businesses, three new adult staff per business, a Whip Equipped garage, and an Equity
Uprise island. This is a new exploration universe, not a revival of the shelved Uprise World.

The same day's Bridgeport expansion adds `neighborhoods` and `storyArcs` in that one source.
Read `ROBBERY-1S.md` and `BRIDGEPORT-GEOGRAPHY.md` before changing its story or geography.
Preserve the original eight commercial businesses, 24 adult staff, three garage characters,
existing coordinates and save key. Neighborhood story cast and places are separate collections;
Malik and Kiara retain their source ages and are not inserted into the adult staff roster.
All 16 selected CT footprint polygons remain present. Building heights, doors, interiors,
tenant names and the two connecting walks are authored adaptations, not surveyed attributes.
Retain CT source metadata and visible OpenStreetMap attribution for derived road geometry.

## Source authority

- Author city fiction once in `core/data/fictional-city/district.v1.json`.
- `tools/publish-fictional-city.mjs` derives the browser copy and the screenplay reader.
- Existing Whip canon remains in `docs/music/WHIP-EQUIPPED-STORY.md` and its accompanying current
  screenplay/manifest. The garage is a pre-finale free-roam context. It does not resurrect Alana
  after the plane ending, alter Mr. Lock Changer's dual perspective, or move Salvage before Tears.
- Brand provenance distinguishes recovered owner concepts, proposal-only operations, current owner
  direction, and newly authored storefronts/people/dialogue. Countries are NPC biographies, not
  retroactively established origins of the tea brand. Private source URLs and raw chats stay out of Git.
- `data/brands.json` remains the real company map. Fictional shops are not incorporated subsidiaries.

## Runtime

- Host: `fictional-city.html`. Script loading uses the existing server-checked owner gate.
- Engine: `js/fictional-city/`; original lightweight Three.js scene, separate from other engines.
- State: `here.universe.mccluster-fictional-city.state`, local to this device. Game credits have no
  cash value and are not a secure payment ledger. No real goods, adult services or financial donations
  are purchased by this experience.
- Portals are data. Existing target routes enforce their own permissions. Never turn on the archived
  Uprise experience or modify Site 0 geometry to satisfy a city request.
- Schema revision 2 (2026-11-03) adds the wider city's lore beside the v1 arrays: `expansionNeighborhoods`,
  `parcels`, `expansionBusinesses`, `expansionNpcs`, `families`, `expansionItems`. These records carry
  parcel IDs and route anchors, never coordinates; the spatial layer binds them. Expansion students
  are minors (`minor: true`): no sexual content, injury, purchases or bribes involving them. The
  satire targets posers, the rich school and corrupt institutions, never Black people or public-school
  kids, and uses no phonetic dialect.
- All 24 v1 residents are adults. Humor is in the businesses, interactions, wordplay
  and unreliable pitches. Do not substitute a fake racial accent for character writing.
- Preserve the existing shared navigation and private audience. Static authored fiction is public-safe
  source, not confidential account data; the browser gate does not make static assets secret.
- Optional Core reads use the current authenticated MCP bridge and require exact manifest hash parity.
  Private ai_context and resident conversations never enter this fictional dataset.

## Geometry

The eight shops and garage are original procedural game assets. The island HQ is explicitly a
simplified exterior representation derived from the canonical 72 ft square / 81 ft roof datum,
with six enclosed occupied floors and an open roof. Its doorway opens the existing HQ tactical emergency exercise, with the detailed canonical
building geometry and its own controls. This is not an alternative building-authority package. Read the building's local contract
before changing its geometry, program, entrances, floors, signs or canonical viewers.

The wider city's geography has its own authority, `core/data/fictional-city/places.v1.json`
(see `EXPANSION.md`): land, streets, neighbourhoods, parcels, entrances, anchors, landmarks and
chunk IDs. Lore and geography are joined only by stable IDs; never put coordinates in the lore
file or names/people in the places file. The original block's coordinates are frozen (mirrored as
`legacyParcels` and tested). Keep the frames distinct: city metres Y-up, HQ GLBs metres Z-up, HQ
cells 12 ft, PRIM3 tiles 3.54 m; never resize the HQ. Render chunks are derived by the publisher;
collision is always resident. Every new published file needs a path in `deploy-pages.yml` and the
publication test.

## Verification

Check manifest references, 3-per-business / 24-new-resident counts, walkable approaches, patrol
routes, item prices and state restoration. Exercise keyboard and touch controls, enter/exit,
dialogue topics, purchases, insufficient funds, story-reader order, owner/non-owner gating, and
390 px overflow, v1→v2 save migration, chunk load/unload/failure, B1 traversal through the HQ
doorway's level, and that minors never offer a paid interaction. Report measured render metrics with the test environment; never infer real-device
frame rates from a software-rendered browser. New actors/shops should preserve the one-source export.

For Bridgeport, run `scripts/test/bridgeport-story.test.mjs` plus city spatial/publication tests.
Validate old-save migration, ordered scene progression, all story-stop walking routes, footprint
parity with public source evidence, and exterior-only donation-bin custody. Later scene titles
and cast outcomes must remain hidden until reached. Do not turn narrative completion into a
shoe power, money payout, new canonical wearer, or explanation of the pastor's unresolved reveal.
