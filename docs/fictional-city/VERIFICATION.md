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

Baseline: main `d4361152` (before), this branch with lore PR #720 merged (after). Plan, contract and counts:
[`EXPANSION.md`](EXPANSION.md). Local verification only; release evidence comes from the normal Pages workflow.

| Scope | Result |
| --- | --- |
| Root JavaScript suite | 1,554 passed, 0 failed, 3 existing skips |
| Places contract, lore binding, chunks, save v2, tactical frame, #711 mapping, reserved area | `fictional-city-places.test.mjs` 16 tests |
| B1 traversal on the HQ level (street → Stair B → B1 → Stair A → Floor 1) | `fictional-city-hq-b1.test.mjs` 2 tests |
| B1 mission outages → building screens MISSION session | `equity-uprise-mission-screens.test.mjs` 2 tests |
| Publication (places, chunk index, every chunk; #717 checks kept) | `fictional-city-publication.test.mjs` passes |
| Browser walkthrough | 74 checks passed (`scripts/e2e/fictional-city.e2e.mjs`) |
| Building context audit / repo sources / program coverage | PASS / 2,294 of 2,294 / 466 of 466 |

The browser walkthrough adds: a real v1 save migrated intact; all eight original businesses entered and left; all
27 established people opened; insufficient credits refused at a counter; the garage globe kiosk; the footbridge
walked on foot; the HQ doorway and prefetch on approach; a walk from Civic Center into Northside across a chunk
edge; far chunks unloading; a wharf business interior; the sea wall stopping a body; the HQ overlook; a failed
chunk download falling back to massing and recovering; a lore bribe paid, persisted and refused when short; no
paid interaction on a minor; owner/member/guest gating; 390/768/1440 px with no horizontal overflow.

### Render measurements (headless Chromium, SwiftShader software WebGL, DPR 1; not a physical device)

| View | Draw calls | Triangles | Active chunks | JS heap |
| --- | ---: | ---: | ---: | ---: |
| Before, opening, 390 / 768 / 1440 | 64 / 71 / 79 | 23,364 / 23,978 / 24,216 | — | 10.0 / 11.2 / 10.6 MB |
| After, opening, 390 / 768 / 1440 | 69 / 81 / 90 | 37,324 / 39,314 / 39,564 | 8 | 21.7 / 21.7 / 12.7 MB |
| After, island (1280) | 101 | 43,126 | 12 | 16.1 MB |
| After, Civic Center (1280) | 93 | 40,368 | 8 | 18.2 MB |
| After, Northside (1280) | 58 | 33,708 | 12 | 18.2 MB |
| After, Workshop Wharf (1280) | 67 | 34,004 | 8 | 18.2 MB |
| After, HQ Waterfront (1280) | 37 | 31,268 | 9 | 17.1 MB |

Triangles rise mainly because 73 people now share the instanced body batches. Initial city data: lore 430 KB
(PR #720), places 32 KB, chunk index 7 KB; the 32 chunks total 26 KB and load only near the player. Heap figures
are single samples from `performance.memory`; long-session memory, frame rate and thermal behaviour on phones
remain unmeasured.
