# Claude handoff — Bridgeport integration and episode production

Status checked **2026-11-03**. This document supersedes the earlier report that the implementation could not be found.

## Start from the implementation that exists

Repository: **mcclusterishere/mccluster**.

| Reference | Verified state |
| --- | --- |
| Original uploaded implementation | `4bde79d215536f41ccf6c9c972fb4c2c2adc6c3c` |
| PR #721 | Merged at 14:39:21 UTC; resulting commit `e947b4fef47a6ade4aee104e857703d315cfd4d9` |
| PR #720 | Merged at 14:47:53 UTC; resulting commit `49b9f3bf6b9c410f3590c7cc6e12a28a02732afc` |
| Base inspected for this follow-up | `fe0354617623d46880af2e2bef6281e266a99756` |
| New review branch | `feat/bridgeport-civic-canon-20261103` |

PR #723 subsequently added the Connecticut region/georeference pilot at `fe035461`; its files are preserved by this branch. Its commit leaves scene/publication wiring pending. None of this follow-up's 12 files changed between `49b9f3bf` and `fe035461`.

The former `feat/bridgeport-robbery-ones-20261103` branch was deleted after integration. Its commit and the merged implementation remain accessible. **Do not re-cherry-pick it or rebuild from the README.** The present session did not perform either main merge.

Fetch the new review branch and review its diff from the inspected base. Keep any parallel agent work in its own branch/worktree, compare unique changes and reconcile intentionally. Do not reset another agent's work or resolve the full manifest with a blanket “ours/theirs.”

This follow-up is authorized for branch publication only. Hold further main merges and deployments for Matthew's review.

## Existing city contract

The playable city already contains:

- `fictional-city.html?entry=bridgeport`, the Enter the story action and Harbor & Uprise / Bridgeport map switch.
- **16 unchanged CT footprint polygons**, 18 places, nine story premises, seven authored cutaway interiors and two open yards.
- **13 encounters across seven acts, containing 35 narrative paragraphs**, plus ten story-cast records. Later scenes remain hidden; completed scenes can be reread.
- Walking or convenience travel, exterior donation-bin custody, saved progression and the complete no-WebGL map/story route.
- The original eight businesses, 24 adult staff, three garage characters, island, portal targets and save key.
- Migration of old saves without changing credits, inventory or Whip reader position.

Source is `core/data/fictional-city/district.v1.json`. `tools/publish-fictional-city.mjs` derives the browser data; do not hand-author a second copy.

## Naming and government corrections

Matthew's current rule is definitive: **retain actual street names, city names, official geography and government entities/buildings/functions. Change non-government businesses/premises and story people.**

Main, Middle, Fairfield, Golden Hill, Broad and Elm stay. Preserve government offices and roles; the choice of real incumbent versus fictional officeholder is unresolved casting, not permission to invent or assign an incumbent.

This branch restores the two real Superior Court identities at 172 Golden Hill Street and 1061 Main Street. Ashline's story identity moves onto existing private footprint 250867; no sourced polygon moves. The two authored yards move off Parking Authority and federal postal land onto checked private parcels. Government landmarks appear in the map directory and are protected against casual renaming by validation.

Read `BRIDGEPORT-GEOGRAPHY.md` and the minimized `geography/bridgeport-government-classification.json`. Ownership screening is based on footprint-center parcel matches, with independent official court corroboration. It is not a complete audit of government tenants in privately owned buildings.

The gang is **Elm Street Willy Whackers**: the existing Mr. GREAT/Harold crew based at the authored Night Shift Club near Elm Street. This is new owner naming direction. Preserve existing cast, ages, events, money amounts, shoe custody and unresolved ending.

## Story source

The recovered source is **Designer Kicks.docx**, modified **2026-02-03**, internally titled **Episode 1: THE ROBBERY 1s (Working Title)**. Matthew has its connected Drive link. The older January pilot is a different version and must not replace this cast.

The 35 concise game paragraphs already exist. The full source screenplay is not in the repository. Obtain it through the approved private source and create approved dialogue/line IDs for performance work. Keep raw private source URLs and full private documents out of public Git.

## #720 is already integrated

The current schema has `schemaRevision: 2`. Playable `neighborhoods` remains distinct from `expansionNeighborhoods`. The latter accompanies 31 parcels, 21 businesses, 49 people, ten families and 24 goods. The existing runtime does not yet instantiate that expansion lore.

Preserve those additions. Before geographic binding, reconcile government proposals **Municipal High No. 9** and **Precinct Zero** with the clarified identity rule. Verify actual ownership/use for any proposed school or hospital. School of Hard Knocks is authored as private; St. Copay's has a private-equity story backstory, but that does not establish the status of any real parcel. Also reconcile invented neighborhood labels with official geography. Do not automatically attach fictional misconduct to real officials.

## Agent assignments

1. **City agent:** review this correction, preserve shared IDs and geometry, bind remaining expansion lore only after geographic/public-use review, and finish browser/device verification.
2. **Story/character agent:** obtain the approved full script, prepare line IDs and timing, cast sheets, wardrobe, approved voices and canonical prop continuity.
3. **Cinematic agent:** implement the reusable episode timeline, rigged actor performances, cameras and Blender export on the existing city assets. Read `EPISODE-PRODUCTION.md`. Start with one 45–60 second two-character scene.

The learning migration is a separate existing database task. This handoff does not verify database availability or authorize unrelated migration work.

## Verification

The focused story/spatial suites passed **20/20 locally after the relocations**. The final full Node run was interrupted by loss of the terminal environment and has no recorded completion.

After reconstruction on the merged base, the **20 focused test bodies passed again in an in-memory V8 runner** using the actual runtime code with virtual file and assertion adapters. All 18 entrances, 13 ordered scene routes and return to the island were checked. Exact footprint parity, old saves, protected court identities and preserved #720 data passed.

Run the normal Node publication/city/owner-gate/Core suites from the README and a real WebGL pass on this review branch. The in-memory result does not replace those gates. The full episode player, rigs, dialogue audio, Blender exporter and photoreal production are planned, not delivered by this branch.
