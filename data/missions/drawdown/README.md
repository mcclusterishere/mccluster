# Drawdown mission catalog (draft)

`missions.json` holds 125 draft missions, one for each solution in Project Drawdown's
Explorer except the 14 that Drawdown rates "Not Recommended". Deploy Clean Cooking also
keeps a mission from its openly licensed assessment record, although its Explorer page
was split into two newer solutions. `solutions-catalog.json` lists all 138 Explorer
solutions as published on 2026-11-17: name, link, sector, Drawdown's classification,
a short summary excerpt where the page has one, and the image credit.

**Status: draft, awaiting the owner's approval.** No mission here is in production. Four
pending files would write them, and each waits for the owner's approval of its exact SQL
(`supabase/pending/PROMOTION-ORDER.md`, section 10), each with its rollback:
`20261117100000_action_globe_join_scope_v1.sql` (joining no longer depends on pins),
`20261117100100_action_mission_details.sql` (the table for proof hints, safety lines and
credits), `20261117100200_action_mission_drawdown_import.sql` (these 125 missions as
drafts, with their details) and `20261117100300_action_mission_drawdown_publish.sql`
(draft to open). `tools/build-mission-import.mjs` generates the last two from
`missions.json`; rerun it after any change here (its `--check` fails when they drift).
Choosing where any mission appears on the globe is a separate owner decision.

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
  icons. Drawdown's name and logo are registered trademarks: the name appears only in
  credit lines, the logo nowhere, and nothing implies endorsement.

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
