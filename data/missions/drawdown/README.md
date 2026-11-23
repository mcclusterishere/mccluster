# Drawdown mission catalog (draft)

`missions.json` holds 125 draft missions, one for each solution in Project Drawdown's
Explorer except the 14 that Drawdown rates "Not Recommended". Deploy Clean Cooking also
keeps a mission from its openly licensed assessment record, although its Explorer page
was split into two newer solutions. `solutions-catalog.json` lists all 138 Explorer
solutions as published on 2026-11-17: name, link, sector, Drawdown's classification,
a short summary excerpt where the page has one, and the image credit.

**Status: in production as drafts; the publish waits for the deploy window.** Four steps
write them (`supabase/pending/PROMOTION-ORDER.md`, section 10), each with its rollback. The
first three are applied in production, with the owner's approval: the join scope on
2026-11-17 (joining no longer depends on pins), as
`supabase/migrations/20261117222809_action_globe_join_scope_v1.sql`; the table for proof
hints, safety lines and credits on 2026-11-18, as
`supabase/migrations/20261118021521_action_mission_details.sql`; and the import of these 125
missions as drafts with their details, in seven parts applied in order on 2026-11-18, as
`supabase/migrations/20261118034753_action_mission_drawdown_import_01.sql` to
`supabase/migrations/20261118035654_action_mission_drawdown_import_07.sql`. Production holds
them as 125 draft missions with 125 details rows (the operator's read at 03:58 UTC on
2026-11-18, recorded in
`docs/control-plane/evidence/releases-2026-11-18/LEDGER-376-APPLIED-VERIFICATION.md`); drafts
change nothing a visitor sees. The fourth step,
`supabase/pending/20261117100300_action_mission_drawdown_publish.sql` (draft to open, which
shows all 125 on the live site at once), is not applied: the owner decided it runs in the
deploy window, after the new feed ships. `tools/build-mission-import.mjs` generated the parts,
their rollback and the publish from `missions.json`, and its `--check` fails when they drift
from it. The parts are applied, so this file must not change: the parts in production must
stay the committed files byte for byte, and a later change to a mission is a new migration,
never a regenerated part. Choosing where any mission appears on the globe is a separate owner
decision.

## Where the content comes from

- **Mission wording is original.** Titles, descriptions, proof hints and safety lines
  were written for this site; no Drawdown prose is used in them.
- **Openly licensed research.** 43 missions cite a Project Drawdown solution assessment
  published on Zenodo (community `pdexplorer`) under CC BY 4.0. Each such mission's
  `credit_line` names the creators, the record title, the DOI and the license link,
  and says the mission wording is adapted and original, as that license requires.
- **Drawdown's website text, with permission.** 87 missions carry `about`: a short
  excerpt (60 words or fewer, verbatim) of the solution summary on drawdown.org. The
  owner states (2026-11-17) that Project Drawdown gave explicit permission to use its
  material with credit; keep the written permission on file. If that permission is
  ever withdrawn or does not cover a use, remove `about` and `about_credit` and change
  those credit lines to "Solution listed in Project Drawdown's Explorer (URL)."
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
2. Show `about` only as a quotation, with `about_credit` directly beneath it. Thirteen
   excerpts speak in Drawdown's voice ("we define..."), so they must read as a quote.
3. Show `credit_line` in full in the mission's detail view, and on a feed card a compact
   source line that opens it. CC BY 4.0, section 3(a)(2), allows the attribution in any
   reasonable manner, such as a link to where it is given in full.
4. Proof rules for every mission: use your own words, images and clips, or ones you
   have the right to use; no one else's face, name, address, account number or
   recording without their stated agreement; keep map attribution visible; never show
   your own home's location or when it is empty.
5. Project Drawdown's source page in the World (`js/world-source-profile.js`;
   `docs/control-plane/WORLD-MISSION-SOURCES.md`) groups the open missions of this catalog by
   each mission's `sector` here, through the derived `data/missions/drawdown-areas.json` (slug
   to area, no mission text; `node tools/build-mission-areas.mjs --check`), because this
   folder stays out of the published site. A row there shows the mission's own title, field,
   difficulty and points (from 700 px also a line of its own description); `about` appears
   only inside the mission's dialog, as rule 2 says, and Drawdown's classification appears
   nowhere.

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
