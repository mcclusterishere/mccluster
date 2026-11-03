# Continue the city: Jimmy's-location shoe store and factory

Owner direction captured 2026-11-03; prepared for the approximately 13:00 America/New_York resume (18:00 UTC on this date). **Add to the existing Claude build. Do not replace, restart, reset, or reduce the city, its features, or its wider production work.** This is a build brief and source audit, not a claim that the store or factory is already live. Branch publication is authorized for this handoff; merge and deployment remain separate approvals.

## Start here, then continue the existing work

Verified 16:16 UTC on 2026-11-03:
- Main: `f1150c2c72ef03348aacc960f1f18a45d643a2a3`, merged [#722](https://github.com/mcclusterishere/mccluster/pull/722). Latest city work records Claude session `session_01RNT2Ntug3BjoR26Qas8tbd`. This identifies history, not evidence that that session has received this file.
- [#729](https://github.com/mcclusterishere/mccluster/pull/729), `research/city-722-postmerge-core-handoff-20261103`: the existing review-only performance/Core handoff. Read [POST-MERGE-722-CORE-HANDOFF-2026-11-03.md](POST-MERGE-722-CORE-HANDOFF-2026-11-03.md). Keep all its benchmarking, geography, ordinary HQ B1, publication and live-runtime checks.
- `feat/bridgeport-civic-canon-20261103`: read its [CLAUDE-HANDOFF.md](https://github.com/mcclusterishere/mccluster/blob/feat/bridgeport-civic-canon-20261103/docs/fictional-city/CLAUDE-HANDOFF.md) and [EPISODE-PRODUCTION.md](https://github.com/mcclusterishere/mccluster/blob/feat/bridgeport-civic-canon-20261103/docs/fictional-city/EPISODE-PRODUCTION.md). It corrects government identities and private story premises, retains the new Elm Street Willy Whackers naming, and plans one episode authority, rigs, shot/audio tracks and Blender interchange. It predates #722's full runtime binding; do not repeat its now-stale statement that expansion lore is not instantiated.
- [#725](https://github.com/mcclusterishere/mccluster/pull/725), `feature/city-arcade-designer-kicks-foundation-20261103`, checked head `73e6831a5c3cd3ffbca63cdc852e3790f59b5d39`: separate 2D City Arcade / Sole Run sandbox. Velocity, Ghost, Gravity and Robbery prototype mechanics are not the researched 13-city collection. Inspect latest code/docs, not the stale public/no-owner-gate PR description.

Refresh all refs and PR states before editing. Use an isolated worktree and review unique diffs. Do not force-push, discard another agent's files, blanket-resolve the large manifest with ours/theirs, re-cherry-pick merged #720/#721/#722, or turn a separate prototype into a replacement for the playable city. Link this brief from the actual resumed task; repository presence alone does not prove an agent has read it.

## The requested addition

1. An actual enterable, three-dimensional shoe store **inside the existing game city**, at the Bridgeport location of Jimmy's. It is not a separate demo, a shop website, or a real-world purchase.
2. A premium, highly finished retail floor: a strong arrival view, illuminated individual shoe displays, quality materials, comfortable fitting/try-on seating, a clear checkout counter, and readable merchandise. Build reusable 3D models, not a flat image that merely suggests an interior.
3. A connected back-of-house and **industrial basement factory** for shoes, clothing and related production: cutting tables, sewing/assembly stations, sole presses, conveyors or transfer tables, textile rolls, storage racks, packing/dispatch and a visible service circulation route. These are authored game interiors; no knowledge of Jimmy's real private interior is asserted.
4. Upstairs means the retail level above the basement in this brief; do not invent an extra upper storey solely from that phrase. Keep floor IDs explicit, with retail/backroom and basement factory, and extend if later owner direction calls for it.
5. Player-controlled entrance, browsing, counter/inventory, rear-room access, descent, basement exploration, ascent and exit. Keep keyboard, touch and no-WebGL navigation. No paid external generation is authorized by this brief.
6. Preserve the rest of the city and build productization in parallel. The store is an addition to ongoing city, story, performance and cinematic production.

A working game name may be **Designer Kicks**, explicitly a new storefront adaptation of the existing series label, not a recovered historical boutique or the original cursed shoe's origin. No real retailer/Nike/Jordan endorsement, license, ownership or inventory feed is implied. Use original unbranded meshes while product/reference approvals are unresolved. Do not draw substitute corporate logos.

## Exact location evidence and a blocking integration seam

The retailer's [official site](https://jimmys1920.com/) gives **1000 Main Street, Bridgeport**. The state parcel register identifies **996 MAIN ST #1000**, parcel identifier `08070-929-1`, OBJECTID `339365`. It is at Main and Wall. Exact public source queries:

- [CT 2023 parcel 339365](https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_State_Parcel_Layer_2023/FeatureServer/0/query?f=geojson&objectIds=339365&outFields=OBJECTID%2CTown_Name%2CLocation%2CLink&outSR=4326)
- [CT_Buildings footprint 250914](https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/CT_Buildings/FeatureServer/0/query?f=geojson&objectIds=250914&outFields=*&outSR=4326)
- [State historic district amendment](https://portal.ct.gov/-/media/DECD/Historic-Preservation/06_About_SHPO/State-Review-Board/2022-Meetings/December-2/Bridgeport-North-and-South-HD-NR-Amendment_SRB.pdf), 996–1000 Main and photo 68, supports Main/Wall identification.

Parcel centroid WGS84 is longitude **−73.188889787733**, latitude **41.178156188008**. It lies inside CT_Buildings **250914**, which also merges adjoining building area. Treat Jimmy's as the western/northwestern parcel portion, not the whole source footprint. The newer footprint service uses ID 248818 with old ID 250914 in OBJECTID_1; keep the same source service and ID convention as existing city data.

**It is not one of the 16 currently retained Bridgeport footprints.** Current `BRIDGEPORT-GEOGRAPHY.md` projects the centroid to **X 118.1542, Z −37.0108**; full footprint bounds are X 106.0724…159.7082, Z −52.4889…−14.1446. That is south of the surveyed neighborhood and overlaps these already-authored placements:

- `hq-waterfront/thugged-out-apparel`: Thugged Out Apparel.
- `hq-waterfront/shop-01`: Bail Mary Bail Bonds.
- `hq-waterfront/shop-02`: Wing Stop Crying.

Do not overwrite them or label them vacant. All 21 expansion business parcels are claimed in lore even though geography retains generic “For lease” fallback labels. Those labels are not an ownership/availability registry. No verified for-sale system or sold/claim ledger was found in current city source. The owner's specific Jimmy's-location direction supersedes selecting an arbitrary for-sale parcel.

Before placing the storefront, reconcile the existing authored local frame with the georeferenced Connecticut region work. Prefer an explicit region/tile-source adapter that preserves WGS84 source geometry and existing authored-city positions, with a named transition/connection if needed. If an authored translation is used, record it separately from the true map coordinate and do not call the result survey-aligned. Never silently relocate the HQ or an occupied shop to make the address fit. Record and review this seam before production integration.

## Source and integration contract

- Read root `AGENTS.md`, `docs/fictional-city/AGENTS.md`, `ROBBERY-1S.md`, `BRIDGEPORT-GEOGRAPHY.md`, `EXPANSION.md`, and universe schema/registry.
- City lore/items once in `core/data/fictional-city/district.v1.json`; existing authored parcel geometry in `places.v1.json`; true regional geography via the existing `regions/connecticut-pilot.v1.json` and `planet/georeference.mjs` contract. Do not create a second backend, city or inventory source.
- `places.mjs → bindCity` binds expansion businesses to stable parcel IDs. `content.mjs` selects neighborhood places. `scene.mjs` owns the existing renderer; `bridgeport-geometry.mjs` owns neighborhood geometry; `spatial.mjs` owns movement/collision.
- `app.mjs → openBuilding/openShop/handleTarget` and `state.mjs → purchase` already provide game-credit purchases, receipts, caps, insufficient-funds handling and persistent inventory. Reuse them. No real checkout, Stripe path, monetary credit conversion, new sign-in, or security bypass.
- Core's `core/src/game-lore.mjs` currently recognizes original/expansion businesses, not retail attached directly to a neighborhood place. If that representation is chosen, extend the validator/reader deliberately and test reference integrity; do not add items that make Core reject the full manifest.
- Current interior API is `interiorWorld(garage, style)`, a single cutaway room; save stores `position.interior` with X/Z but no floor. A factory requires an explicit floor contract and migration/default for old saves. Avoid encoding a basement as a different business or silently inventing a new universe.
- Keep store layout, render meshes, collision fixtures and navigable floor transitions driven by one authored layout. Store basement is **not** Equity Uprise B1 and cannot borrow or modify HQ geometry.
- Use existing geometry kit/instancing. Load interior detail only when entering; unload/dispose it on exit. On phone, preserve circulation/interaction geometry while reducing distant shelf products, texture sizes and decorative detail.
- Every new published module/asset needs the actual Pages file list and publication verification. Export browser lore byte-identically through `tools/publish-fictional-city.mjs`.

## Collection and story guardrails

The intended collection is **Bridgeport plus twelve other Connecticut locations: thirteen total slots**. Keep the count configurable. The owner approved the following creative names and city assignments on November 3; these supersede the earlier unnamed-slot/proposed-name language. They are fictional collection labels, **not statistical claims that a city leads an offense category**, verified real-brand products, or licensed Jordan merchandise.

| City | Owner-approved collection name | Number |
| --- | --- | --- |
| Bridgeport | Robbery 1s | 1 |
| Waterbury | Burglary Twos | 2 |
| Hartford | Arson Threes | 3 |
| New Haven | Hami Fours | 4 |
| New Britain | Assault Fives | 5 |
| Manchester | Stolen Sixes | 6 |
| Orange | Larceny Sevens | 7 |
| Derby | GTA Eights | 8 |
| East Haven | Larceny Nines | 9 |
| Norwich | Home Invasion Tens | 10 |
| Hamden | Repo Elevens | 11 |
| Meriden | Burglary Twelves | 12 |
| Cromwell | Stolen Thirteens | 13 |

The number/name mapping is now owner creative direction; popularity rankings, colorways, physical models, abilities and mission design remain unverified or pending. Home invasion and repo are creative labels here, not asserted FBI reporting categories. Do not merge the four #725 sandbox prototype pairs into this roster or invent powers from the names.

The Robbery 1s → Bridgeport link is already story canon. The existing Robbery 1s Exchange remains a separate shop selling Clearly Labeled Replica 1s, Second Chance Laces and Unconfirmed, Issue One. Never move or duplicate the original cursed pair there or here. Preserve Dave → donation bin → Malik → Harold → altar, all 13 beats, ages, amounts and unresolved pastor reveal. Narrative scene count is unrelated to collection-slot count.

Collection slots may now show the approved city/name/number above, while retaining stable internal IDs and an explicit design/implementation-pending status. Do not add a price, purchase action, invented power or claimed statistical leadership merely because a name is approved. If sample merchandise is needed for the counter test, author plain unbranded cosmetic samples separately from the collection. Do not make a purchased sample the canonical pair or a new story wearer.

Use official comparable offense data and year/coverage/population denominators before ranking cities. Labor unemployment is not the same as employment rate. Missing or incomparable data stays unknown. Researched public city statistics are context for fictional design, not assertions about residents or allegations against a real business.

## Deliver in reviewable increments

1. **Reconcile / inventory:** exact refs, unique changes, government-canon correction, region placement decision, source evidence and a no-overwrite manifest diff.
2. **Store assembly:** native 3D retail, backroom and basement models plus one layout manifest; clearly distinguish authored interiors from public footprint evidence.
3. **Playable integration:** actual existing-city route and door, floors, collision, counter, save migration and mobile/no-WebGL controls. Retain existing stories, shops, transport, HQ and arcade.
4. **Collection wiring:** thirteen named slots with the approved roster above, with models/abilities/mission integration pending; insert reviewed research/design only after it exists. Keep this independent from the property/retail implementation.
5. **Verification:** publish exact source parity; Core validation; old saves; enter/re-enter/reload on each floor; touch/keyboard; insufficient funds/99-item caps; no original-pair transfer; no tenant replacement; original courts/streets/minor protections; 390px no-overflow; window/floor occlusion; memory after repeated entry; real-device profile and current city regression suites.
6. **Report:** full review artifact, exact commit/branch, screenshots of exterior/showroom/backroom/factory, measured tests/performance, remaining gaps, and handoff to the ongoing agent. No claim of finished/live work from a source commit alone.

The original #729 plan and existing cinematic production roadmap remain active alongside this addition.
