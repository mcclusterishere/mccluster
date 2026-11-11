# McCluster City — first district verification

Date: 2026-11-03. Baseline: main `3cb77f056a75ed771f619a18f8bfbc242b3f087c`.
This records local source and browser verification. It is not evidence that a production account,
Worker release or OVH runtime has already accepted the new revision.

## Authored source

The canonical manifest is `core/data/fictional-city/district.v1.json`.

SHA-256: `7d2434d3ebf4c6b0d7d61710724945e00da76a73713cfbf58a801cf307f23ae9`.

It contains eight businesses, 24 new adult residents, three established garage characters,
24 collectible items and four existing destination routes. Each of the 27 people has three
six-line conversation topics: 81 topics and 486 authored exchanges, plus greetings and farewells.
`LORE.md` preserves all biographies and conversations. Newly authored material and recovered
owner concepts have separate provenance in the manifest.

The derived static district is byte-identical to the Core source. The separate story export has
13 complete screenplay entries, including the optional Jet Pass chapter. Before-song dialogue,
music-video treatment and after-song dialogue remain separate; Tears Won't Fall precedes Salvage
Title. Road Years recollections remain available at the same desk.

## Verification results

| Scope | Result |
| --- | --- |
| Root JavaScript suite | 1,461 passed, 0 failed, 3 existing skipped |
| Root Python suite | 7 passed |
| City state, manifest, collisions, Core client and publisher | 12 passed; included in root count |
| Additional scene spatial tests | 6 passed; included in root count |
| Core syntax and full Core suite | Passed; 428 tests passed |
| Signature, owner bridge and MCP continuity | 55 passed |
| Game Hub and owner-gate regression suite | 45 passed; included in root count |
| Full host browser walkthrough | 41 checks passed |
| Patch whitespace | `git diff --check` passed |

The browser walkthrough uses actual Three.js 0.180.0 and the authored data. Explicit local account
and API fixtures exercise owner, member and guest behavior; no production account is accessed.
Both 390px and 1280px widths have equal document scroll/client widths. Checks cover:

- Denial before template/game/data loading for members and guests.
- Exact-hash matching through the real Core reader and expected MCP response envelope.
- All 27 resident identities, nine enterable businesses including the garage, and geometry budget.
- Keyboard walking and actual Chromium touch events on the direction control; browser pinch zoom.
- Garage entry/exit, interior restoration after reload, and authored NPC topic rendering.
- Discovery, purchase deductions, inventory and receipt persistence, with no real checkout request.
- Complete story chapter access, existing HQ/globe destination links, and a delayed screenplay
  failure that cannot overwrite a newly opened resident conversation.
- No uncaught browser errors.

The separate scene exercise additionally covers bridge/island approach, water rejection, all
three garage crew, proximity interaction, camera occlusion and twelve interior rebuilds.

## Render measurements

Chromium 131.0.6778.0, headless SwiftShader software WebGL; device pixel ratio 1. The scene-only
measurements below use the canonical manifest. All staff bodies share three animated instance
batches, with per-person colour values.

| Viewport | Opening draw calls | Opening triangles | Tea draw calls | Garage draw calls | HQ draw calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1280 × 900 | 73 | 24,026 | 22 | 29 | 60 |
| 390 × 844 | 55 | 23,034 | 21 | 27 | 56 |

These are measured scene counts, not a physical-device performance guarantee. Short software-rendered
samples varied; sustained phone/tablet FPS, thermal behavior and long-duration memory use remain
unmeasured. The scene caps rendering pixel ratio at 1.5 and disposes replaced interior resources.

## Screenshots

These are rendered captures, not concept art. The host screenshots show the owner fixture. The
island image is from the scene-only fixture and illustrates the simplified landmark, not the full
canonical architectural model. Viewport captures are used because this Chromium build's full-page
WebGL capture can leave offscreen compositor regions unpainted; actual scrolling was checked.

![District on desktop](evidence/street-desktop.png)

![District on phone](evidence/street-phone.png)

![Whip Equipped garage with crew and transport kiosk](evidence/garage-desktop.png)

![Simplified HQ island and footbridge](evidence/island-scene.png)

Machine-readable host results: [host-results.json](evidence/host-results.json).

## Release verification

Use the normal PR, exact-main CI, Pages and existing Worker release gates. Promote the same green
main SHA through `deploy/ovh-production`; require the observed Core `/health` deployment SHA to
match before describing the running server as current. An authenticated `game.lore.read` manifest
response must report the exact SHA-256 above before claiming the live browser-to-Core connection.
The browser retains the identical static fiction whenever the deployed Core version differs.

Current implementation limits: the connected situations are authored conversations, not persistent
multi-stage quests. Inventory does not equip clothing or spawn a functional purchased vehicle.
Driving, traffic, combat, recorded NPC performances and filmed song transitions are future work.

## City expansion around the HQ — 2026-11-03

Baseline: main `d4361152` (before). After: PR #722 merged with main at `fe035461` (#720 lore, #721 Bridgeport,
#723 Connecticut data). Plan, contract and counts: [`EXPANSION.md`](EXPANSION.md). Local verification only;
release evidence comes from the normal Pages workflow.

| Scope | Result |
| --- | --- |
| Root JavaScript suite | 1,580 passed, 0 failed, 3 existing skips |
| Python / Core | 7 passed / 430 passed |
| Places contract, lore binding, chunks, save v2 (incl. #721 arcs), tactical frame, #711 mapping, reserved area | `fictional-city-places.test.mjs` |
| B1 traversal on the HQ level (street → Stair B → B1 → Stair A → Floor 1) | `fictional-city-hq-b1.test.mjs` |
| B1 mission outages → building screens MISSION session | `equity-uprise-mission-screens.test.mjs` |
| Bridgeport story route (#721) | `bridgeport-story.test.mjs` unchanged and passing |
| Publication (places, chunk index, every chunk; #717 checks kept) | `fictional-city-publication.test.mjs` |
| Browser walkthrough | 81 checks passed (`scripts/e2e/fictional-city.e2e.mjs`) |
| Building context audit / repo sources / program coverage | PASS / 2,294 of 2,294 / 466 of 466 |

The browser walkthrough covers: a real v1 save migrated intact; all eight original businesses entered and left;
all 27 established people opened; all 76 people, the original and Bridgeport places, 33 parcels and the 13
Bridgeport story stops instantiated; insufficient credits refused; the garage globe kiosk; the footbridge walked;
the HQ doorway and prefetch on approach; a walk from Civic Center into the north-west homes across a chunk edge;
far chunks unloading; a wharf business interior; the sea wall; the HQ overlook on a phone; a failed chunk download
falling back and recovering; a lore bribe paid, persisted and refused when short; no paid interaction on a minor;
the no-WebGL path (whole-city map, a new business, the Bridgeport map and story route); owner/member/guest gating;
390/768/1440 px with no horizontal overflow; and no uncaught browser errors.

### Render measurements (headless Chromium, SwiftShader software WebGL, DPR 1; not a physical device)

| View | Draw calls | Triangles | Active chunks | JS heap |
| --- | ---: | ---: | ---: | ---: |
| Before (main `d4361152`), opening 390 / 768 / 1440 | 64 / 71 / 79 | 23,364 / 23,978 / 24,216 | — | 10.0 / 11.2 / 10.6 MB |
| After, opening 390 / 768 / 1440 | 78 / 90 / 101 | 114,092 / 116,082 / 116,572 | 8 | 16.1 / 16.1 / 17.1 MB |
| After, island (1280) | 107 | 118,982 | 12 | 20.5 MB |
| After, Civic Center (1280) | 97 | 112,848 | 8 | 15.2 MB |
| After, north-west homes (1280) | 60 | 36,612 | 12 | 14.3 MB |
| After, west wharf (1280) | 69 | 36,908 | 8 | 14.3 MB |
| After, east waterfront (1280) | 45 | 104,744 | 9 | 23.1 MB |

Most of the triangle growth near the original block is the Bridgeport neighbourhood's resident geometry (#721 alone
measures about 100k at the opening view); the streamed neighbourhoods add about 14k there, and 73 people share
the instanced body batches. Software rendering runs the full city at about 2–3 fps (main alone: about 3 fps), so
the e2e allows for slow frames; phone frame rate, long-session memory and thermals remain unmeasured. City data
fetched at start: lore 548 KB, places 32 KB, chunk index 7 KB; the 32 chunks total 26 KB and load near the player.
