# Drawdown mission catalog

`missions.json` holds the frozen original definitions of 125 draft missions, one for each solution in Project Drawdown's
Explorer except the 14 that Drawdown rates "Not Recommended". Deploy Clean Cooking also
keeps a mission from its openly licensed assessment record, although its Explorer page
was split into two newer solutions. `solutions-catalog.json` lists all 138 Explorer
solutions as published on 2026-11-17: name, link, sector, Drawdown's classification,
a short summary excerpt where the page has one, and the image credit.

**Status: all 125 missions are open in production, with zero website quotations.** The release
steps are recorded in `supabase/pending/PROMOTION-ORDER.md`, section 10, with their recovery files.
The initial preparation was applied in production with the owner's approval: the join scope on
2026-11-17 (joining no longer depends on pins), as
`supabase/migrations/20261117222809_action_globe_join_scope_v1.sql`; the table for proof
hints, safety lines and credits on 2026-11-18, as
`supabase/migrations/20261118021521_action_mission_details.sql`; and the import of these 125
missions as drafts with their details, in seven parts applied in order on 2026-11-18, as
`supabase/migrations/20261118034753_action_mission_drawdown_import_01.sql` to
`supabase/migrations/20261118035654_action_mission_drawdown_import_07.sql`. The initial import
created 125 draft missions with 125 details rows (the operator's read at 03:58 UTC on
2026-11-18, recorded in
`docs/control-plane/evidence/releases-2026-11-18/LEDGER-376-APPLIED-VERIFICATION.md`). On 2026-11-20,
`supabase/migrations/20261120061538_action_mission_drawdown_credit_fallback.sql` removed the
unverified website excerpts and permission claims. It was followed by
`supabase/migrations/20261120061714_action_mission_drawdown_publish.sql`, which opened all 125
missions after the new feed shipped. Verification found 125 open missions, zero website quotations
or quotation credits, and all 43 assessment citations intact.

`tools/build-mission-import.mjs` reproduces the import parts, their recovery files and the
publication from `missions.json`; its `--check` fails on drift. A normal build only writes the
recovery files and never rewrites or recreates an applied import or publication. The historical
catalog and all applied SQL remain byte for byte unchanged; any later mission edit needs a new
migration. Choosing where any mission appears on the globe is a separate owner decision.

## Where the content comes from

- **Mission wording is original.** Titles, descriptions, proof hints and safety lines
  were written for this site; no Drawdown prose is used in them.
- **Openly licensed research.** 43 missions cite a Project Drawdown solution assessment
  published on Zenodo (community `pdexplorer`) under CC BY 4.0. Each such mission's
  `credit_line` names the creators, the record title, the DOI and the license link,
  and says the mission wording is adapted and original, as that license requires.
- **Website excerpts are excluded from publication.** Permission evidence was not verified on 2026-11-20.
  The frozen import contains all 87 website excerpts and historical permission claims; those claims are not
  evidence of permission. The applied correction in `publication-policy.json` removes `about` and `about_credit`
  and changes each affected credit prefix to "Solution listed in Project Drawdown's Explorer (URL)."
  It preserves original mission wording and all 43 assessment citations, including creators, record titles,
  DOI, licence links and adaptation notices. Forty of the quoted rows also cite CC BY research: that licence
  covers the separate assessment spreadsheet, not the website quotation. `missions.json` and the seven applied
  import migrations remain frozen historical input; the correction is a new forward data migration.
- **No images.** Every Explorer solution photo is credited to a stock agency, a
  photographer or another organization, or carries no credit. Drawdown's permission
  cannot cover third-party photographs, so none is used. Missions use the feed's own
  icons.
- **The name and the logo.** Drawdown's name and logo are registered trademarks. The logo
  appears nowhere, and nothing implies endorsement. The name appears in credit lines and,
  since the owner's request of 2026-11-19 for a profile of Project Drawdown on this site
  (built as a source page that McCluster Corp makes and Project Drawdown does not run: a
  default adopted pending Matthew's confirmation, including that the written permission
  covers it), as the heading of that page and on its door in each Drawdown mission's
  dialog, only to identify the source. Any other place for the name needs a new dated
  amendment. *(2026-11-19: this supersedes "the name appears only in credit lines" of
  2026-11-17, for that page and its door only.)*

## How to display a mission

1. Show the mission's own title and description.
2. The publication correction leaves `about` and `about_credit` null for all 125 missions. Do not republish
   the archived excerpts or their historical permission claims. Any future authorised quotation must carry
   its attribution directly beneath it and require a separately reviewed migration.
3. Show `credit_line` in full in the mission's detail view, and on a feed card a compact
   source line that opens it. CC BY 4.0, section 3(a)(2), allows the attribution in any
   reasonable manner, such as a link to where it is given in full.
4. Proof rules for every mission: use your own words, images and clips, or ones you
   have the right to use; no one else's face, name, address, account number or
   recording without their stated agreement; keep map attribution visible; never show
   your own home's location or when it is empty.

## Review

An independent review on 2026-11-17 checked every mission for safety, consent and
privacy, civic conduct, accuracy, fit, allowed values and credit. 83 passed as
written, 42 were revised (proofs that could reveal a home or when it is empty,
children in proofs or at school events, names in screenshots of officials' replies
or permit records, the publication of public comments, three accuracy fixes and
posting permission for flyers), and none was dropped. All database values match the
production check constraints on `public.action_missions`.

Recheck the 37 missions written from the solution name alone (Explorer pages marked
"coming soon" or "under revision") when Drawdown publishes those pages. Zenodo lists one
creator of the Improve Annual Cropping record as "Toensme, Eric"; it is kept as listed.

## Publication correction, 2026-11-20

The correction was applied as `20261120061538_action_mission_drawdown_credit_fallback`, with stored statement
MD5 `6081a2fc43f0dc2dfe6ff56a17f5fe38`. The following publication was applied as
`20261120061714_action_mission_drawdown_publish`, with stored statement MD5 `9d5e9f4e9178bf52fac4255453787798`.
The promoted files match those stored bytes, including their historical pre-application headers.
Run `node tools/build-drawdown-credit-fallback.mjs --check` to reproduce the exact correction and its two
recovery files from the frozen catalog; `publication-policy.json` names the applied forward file.
The 125 original missions, their proof hints and safety notes stay unchanged. The 38 rows without website
excerpts stay unchanged; only the other 87 details rows lose the quotation and permission claim. The source
page stays draft until legitimate permission evidence supports its existing Show attestation.

Recovery is separate from publication: first return every Drawdown mission to draft, then apply both bounded
recovery files. They refuse while any of the 125 missions is public and refuse unexpected credit/source
changes. Restoring historical data does not establish permission or authorise later republication.

## Permission attestation, 2026-11-23

Matthew wrote on 2026-11-23, in the working session: "I confirm drawdown's permission for the quotes on their page. That
was a conversation that was had in person." It is recorded here as his attestation, in his words. The permission he
describes was given in conversation, in person; no letter or other document is kept in this repository.

It changes nothing yet. The 125 missions stay as published on 2026-11-20, with no website quotation; `missions.json`,
`publication-policy.json` (the 2026-11-20 review, `permission_evidence` `not_verified`) and every applied migration are
unchanged. Two separate next steps follow, each its own reviewed change with its own approval:

1. **Restoring the 87 quotations** that the credit correction removed (PR #819,
   `20261120061538_action_mission_drawdown_credit_fallback`): a new, separately reviewed forward migration, each quotation
   with its attribution directly beneath it ("How to display a mission", item 2). Not a rerun of the historical import, and
   not the recovery files, which refuse while the missions are public.
2. **Finishing Project Drawdown's source page**: the pending `supabase/pending/20261119140000_mission_catalog_sources_v1.sql`
   on Matthew's approval of its exact text, then Preview and Show in Control, whose confirmation keeps only the date he gives
   (`docs/control-plane/WORLD-MISSION-SOURCES.md`).
