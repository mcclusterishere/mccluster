# Mission sources: Project Drawdown's source page in the World

Record of the work that answers the owner's request of 2026-11-19 for a profile of Project Drawdown on this site. Written
2026-11-19. **Nothing here is live.** The public site serves `main` `fc1986ec`; the 125 Drawdown missions are drafts in
production until the deploy window's step 9 (`docs/control-plane/WORLD-RELEASE-20261118.md`); the SQL below is pending and
applied nowhere but disposable local databases. Every decision below is a **default adopted pending Matthew's
confirmation**, never his decision, until he confirms it.

The owner's words (2026-11-19) are in `docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md`, "Owner request, 2026-11-19".
The owner handles any message to Project Drawdown outside this repository; no agent of this work sends, drafts, schedules or
records one.

## What it is, and what it is not

**A public source page that McCluster Corp makes and keeps, not an account.** No one signs in as Project Drawdown, it posts
nothing, and nothing implies that it endorses, runs, pays for or sponsors this platform.

- **The page** (the World's half, B2, implemented in `70b11591565a`; browser proof still pending): a sheet over
  the World at `?source=project-drawdown`, or a door at the foot of each Drawdown mission's dialog. The name in type; the role
  line "Missions written by McCluster Corp from Project Drawdown’s climate solutions."; the trust note "Made by McCluster Corp,
  which runs this platform. Project Drawdown does not run or pay for this page and has not endorsed this platform." with About
  this page and Ask for a change; "501(c)(3) nonprofit"; the site's own nine areas of missions, every mission opening the
  World's own mission dialog with its quotation, full credit and Join; the credit, "No Project Drawdown logo or image is
  used.", the trademark line, the citation Project Drawdown asks for, and three secondary links in new tabs (the attribution CC
  BY 4.0 and its FAQ require).
- **Type only.** No logo, Drawdown image, monogram, avatar, badge or "Verified". No login, member, follow, message, claim,
  billing or tenant. No Drawdown labels (Highly Recommended, Worthwhile, Keep Watching).
- **Owner controls first** (this half, B1): an owner-only Worker route and a Control Room card (Preview, Show, Hide, Edit
  words, History). Every change goes through one SQL function that re-checks the house owner and writes a `control_audit` row
  in the same transaction. No browser role gains a write.
- **Inert until** Matthew approves the pending SQL's exact text, it is applied after release steps 9 and 11, he confirms
  outside this repository that the written permission covers the page, and he presses Show. Until then there is no door
  anywhere, and, with the World's half in, `?source=project-drawdown` says "That page is not available." on the feed's status
  line.
- **Not built:** an account, a claim flow, a feed tab, a World search group, a share card, JSON-LD, anything on `/company` or
  `index.html`, any message to Project Drawdown.

## Decisions D1 to D14 (map 00, section 8), each a default adopted pending Matthew's confirmation

| # | Default adopted pending Matthew's confirmation | Applied |
|---|---|---|
| D1 | The public word for Project Drawdown's role is **Source**; the role line names the writer | Kicker "Mission source"; role line "Missions written by McCluster Corp from Project Drawdown’s climate solutions." (data, owner-editable). Sponsor, partner, funder, endorse, official, verified, recommend, account and follow words and the others of `js/mission-source-words.js` are refused in the data (SQL) and in code (tests). |
| D2 | A public organization profile: no login, members, billing, tenant or claim flow | A page of public reads. About: "It is not Project Drawdown’s account: no one signs in as Project Drawdown, and nothing here is posted by it." |
| D3 | Amend `data/missions/drawdown/README.md` for a page headed by the name, with a supersession note; keep "logo nowhere" and "nothing implies endorsement"; test both | The README's own bullet, dated 2026-11-19, names only the page heading and its door; any other place needs a new dated amendment. `scripts/test/mission-sources-records.test.mjs` holds the text; the World's tests hold the behaviour. |
| D4 | One approval set of pending SQL, applied after step 9 and its record, on Matthew's approval of its exact text; code inert until the row exists | One file pair (below); it refuses (55000) before the publish; the page draws nothing until a shown row answers. |
| D5 | The trust line near the heading; the maker is McCluster Corp, never the platform's brand | "Made by McCluster Corp, which runs this platform": "this platform", because the World is served on Matthew's property too (`docs/control-plane/DOMAINS-AND-ENTITIES.md`). |
| D6 | A catalog-keyed link: no foreign key onto the 125 missions, no campaign | `public.mission_catalog_sources (catalog primary key, organization_id)`. |
| D7 | The door outside the mission's credit; a query key other than `org`; no tab, menu room, `/company` door or `index.html` | The door at the foot of the mission dialog; `?source=<slug>`. A tab card and a World search group are phase 2. |
| D8 | A dialog inside `main.mn` | `#mnSourceDialog` after the mission dialog. |
| D9 | The two existing organization rows (`authenticity-network`, `equity-uprise`) are never shown | Only an organization named by a shown link row is ever drawn. |
| D10 | `data/missions/drawdown/` out of the published export (strip line, stage allowlist and parity test together); a small derived slug-to-area map | `scripts/stage-cloudflare-pages.mjs` refuses the folder, `deploy-pages.yml` strips it, `scripts/test/publish-strip-parity.test.mjs` holds the two together. The files stay public in the source repository. `data/missions/drawdown-areas.json` (slug to area, no mission text) is the World's half. |
| D11 | The `20261002173558` record drift is its own records change; any proof stub carries production's checks | The stub carries production's `network_organizations_name_check` and `network_organizations_slug_check`; the drift itself stays out of this work. |
| D12 | Facts: the name, "501(c)(3) nonprofit", the mailing address with its label, sourced and dated 2026-11-19, `nonprofit`; no founding year or corporate form; the requested citation once | Under the trust note only "501(c)(3) nonprofit"; the mailing address in About with its label, source and date. |
| D13 | Omit Drawdown's per-solution labels; label the nine groups as this site's | No label anywhere; "Grouped by this site". |
| D14 | `verification_state` `'unverified'` | Inserted unverified; the page never reads or shows a verification state. |

Choices beyond D1 to D14, each a default adopted pending Matthew's confirmation:

1. **Owner controls through an owner-only Worker route**, `/v1/mission-sources`: the house-owner check, two SECURITY DEFINER
   functions executable by `service_role` only, `control_audit` in the same transaction. An authorization addition for the
   house owner: it ships only with his approval of the pull request and of the SQL.
2. **No admin clause in the read policy**: `using (state = 'shown')`; the owner previews through the route.
3. **Show needs the owner's recorded confirmation**: the SQL refuses Show unless the request carries `permission_confirmed:
   true` and the date he confirmed, outside this repository, that the written permission covers the page; the audit row keeps
   that date only.
4. **The door at the foot of the mission dialog**, after Join: a late door moves nothing above it.
5. **No figures under the name**: "All missions 125" in the index carries the count.
6. **The restrictive authenticity-check policy is not staged** (Matthew's call, below).

## The data and the approval set

- `supabase/pending/20261119140000_mission_catalog_sources_v1.sql` (migration name `mission_catalog_sources_v1`) and
  `supabase/pending/20261119140000_mission_catalog_sources_v1.rollback.sql` (`mission_catalog_sources_v1_rollback`). One
  transaction each, a 5 s lock bound, safe to run twice. **Not applied. Owner approval required.** Order and procedure:
  `supabase/pending/PROMOTION-ORDER.md`, the "Mission catalog sources" section.
- **Inserting the organization row publishes it**: `network_organizations` is readable by anyone, so approving the file
  approves its words: slug `project-drawdown`; name `Project Drawdown`; type `nonprofit`; description "Credited source of the
  mission catalog drawdown in McCluster Corp's World. This record is kept by McCluster Corp; Project Drawdown does not run it.
  Project Drawdown is a 501(c)(3) nonprofit (drawdown.org/about, read 2026-11-19)."; website `https://drawdown.org/`;
  `verification_state` `unverified`; `created_by` null.
- `public.mission_catalog_sources`: catalog `drawdown` (the primary key, matching `action_mission_details.catalog`), the
  organization (foreign key, `on delete restrict`), state `draft` | `shown` | `hidden`, an integer revision, the role line,
  up to six facts (`{label, value, source}`, an https source) and the date they were read, `shown_at`. Every check is named; the
  words check is exactly `pgPattern()` of `js/mission-source-words.js`. The first row: draft, revision 1, the role line and
  three facts read 2026-11-19 (Organization: 501(c)(3) nonprofit; Mailing address: St. Paul, Minnesota; What it publishes:
  Assessments of climate solutions, in the Drawdown Explorer).
- **Who reads and writes it.** `anon` and `authenticated` hold SELECT and read only a shown row; no API role writes the table
  and `service_role` holds no table privilege. `mission_catalog_source_owner_state(p_actor)` (drafts, organization, open
  missions, the last 20 audit records; never `created_by`) and `mission_catalog_source_command(...)` (show, hide, edit;
  42501 for anyone but the house owner; MCS01 not found, MCS02 moved, MCS03 key reused; a replayed key returns the receipt) are
  SECURITY DEFINER with an empty `search_path` and executable by `service_role` only.
- **Refusals.** The forward file refuses (55000, nothing changed) without its tables, before any Drawdown mission is open (the
  publish first), and when a `project-drawdown` organization exists that is not the row it writes. The rollback refuses
  (55000, nothing changed) while that organization differs from the forward file's row or anything names it (an authenticity
  check, a group, a campaign, a member); otherwise it drops the two functions and the table and deletes the row, keeping the
  `control_audit` rows and touching no mission. A refused rollback leaves Hide, which still takes the page down for every new
  visit.

## The owner controls

- **Route** (`workers/mccluster/src/mission-sources.js`, two lines in `workers/mccluster/src/index.js`): `GET
  /v1/mission-sources` answers `{ ok, store, sources, history }` (`store` is `applied`, `not_applied` while the functions do not
  exist, or `unavailable`); `POST /v1/mission-sources/commands` takes exactly `command`, `catalog`, `expected_revision` (an
  integer), `key` (a UUID), `reason` (1 to 500 characters on one line) and an optional `payload` (Show: the dated confirmation;
  Hide: nothing; Edit: a role line, facts and their read date). Anything else is 422 before any store call. The verified house
  owner first (401 and 403 pass through; anything else 503 `authorization_unavailable`); the actor is that user, never a body
  field. Store answers map to fixed sentences; no database text reaches a body; a lost or unreadable answer is 503
  `storage_unavailable`, an unknown outcome.
- **Control Room card** (Control, System, Equity Uprise ops, Missions & fellows, the chip "Mission sources";
  `js/control-room/mission-sources.js`, `css/control-mission-sources.css`): one row per source. Draft: Preview, Show; Shown:
  Preview, Hide, Edit words; Hidden: Preview, Show, Edit words. Every command carries a fresh key, the revision that was read
  and a reason ("Why (kept in the audit record; house members can read it)"): the house's staff and viewers can read
  `control_audit`. Show opens the confirmation (the checkbox, "Confirmed on", "The record keeps only this date; the letter
  stays with you.") and stays unavailable until both and a reason are given. Edit words checks the shared deny list and the
  shapes before sending; the database still decides. A refusal says why and changed nothing. An unknown outcome is read back
  by its key: found is "Recorded."; absent offers Send again with the same key and body, which the store records at most once;
  nothing is resent by itself. Preview opens `/mnet.html?source=<slug>&preview=1` on the Control Room's own origin in a new
  tab. A non-owner sees only "Only the house owner can change a mission source."
- **Not a button** (each a reviewed SQL change): the organization's own record, a second catalog, verification, withdrawing
  the page (the rollback), removing Project Drawdown's quotations (the README's fallback "If that permission is ever
  withdrawn"), and a licensor's or creator's request to remove attribution items (CC BY 4.0, section 3(a)(3)).

## What stays gated

No agent does these: applying the SQL (Matthew's approval of the exact text, after steps 9 and 11); confirming the written
permission's scope and pressing Show (the page's publication); the authorization addition (route and functions, with the
pull request); merging, deploying, dispatching; phase 2; any message to Project Drawdown; the two existing organization rows
(D9); verification (stays unverified, D14); the `20261002173558` record drift (D11).

For Matthew to confirm or decide:

1. D1 to D14 as adopted, and the six choices above.
2. The written permission: where it is kept, and whether it covers (a) a page headed by Project Drawdown's name on McCluster
   Corp's platform, which also sells sponsorships, (b) the 87 quotations there, (c) the citation. Until then the README's
   amendment stays marked pending and Show stays refused by the card's own confirmation.
3. "McCluster Corp, which runs this platform" as the maker, and "this platform" in the page's words.
4. A restrictive insert policy on `authenticity_checks`, so no member can name a source's organization in a check (a member
   can today, which would make the rollback refuse). Not staged; it needs a SECURITY DEFINER helper, because members can read
   only shown sources.
5. A plainer corrections door on `/company` (a neutral anchor on its footer), optional.
6. Whether to stage now, unapplied, the withdrawal of the 87 quotations and a template for an attribution removal.
7. Whether to replace `data/missions/drawdown/solutions-catalog.json` in the current tree with a copy without excerpts or
   image addresses (D10 removes it from the published site only; git history keeps it).
8. The slug-to-area map in place of no grouping (D10), and the facts' words and date (D12).
9. Phase 2: a card in the Equity Uprise tab, a "Sources" group in the World search, a share card, a second catalog.

Found on the way, not changed here: production's policy "members read organization membership" on
`network_organization_members` reads its own table (the repository's text in
`supabase/migrations/20261002173558_action_network_organizations_authenticity_v1.sql`, whose reset hash equals production's
2026-11-18 snapshot), so in a production-shaped database any member's read of `network_organization_members`, and of
`authenticity_checks` (whose read policy reads it), fails with 42P17 (infinite recursion). A member's insert of an
authenticity check without a returned row (PostgREST's `return=minimal`) still succeeds. The proof below inserts that way.

## Tests, and where they run

| Test | What it holds | Where |
|---|---|---|
| `scripts/test/mission-catalog-sources-sql.test.mjs` | the pending pair's shape: header, one transaction, the guards, revoke before the one grant, the functions, no foreign key onto a mission, every check named, the words check equal to `pgPattern()`, the rollback's refusal before its drops | root suite |
| `scripts/test/mission-catalog-sources.integration.mjs` | the pair on PGlite over `supabase/tests/mission_catalog_sources.stub.sql` (production's default privileges, role check and organization checks): 76 checks, and nine mutated copies each failing a named check | CI `mission-sources-store` |
| `scripts/test/mission-catalog-sources.native.integration.mjs` | the same proof on PostgreSQL 16 and 17, plus one key from two sessions recorded once, a moved revision refused, and the 5 s lock bound | local only (`ALLOW_LOCAL_EUP_DB_TESTS=1`) |
| `workers/mccluster/test/mission-sources.test.mjs` | the route: the owner check, every body rule, every row of the error table, no upstream text, the dispatch | the Worker's `npm test` |
| `scripts/test/mission-sources-owner.integration.mjs` | the real route over the real SQL in PGlite (`scripts/test/support/mission-sources-plane.mjs`) | CI `mission-sources-owner` |
| `scripts/test/control-mission-sources.test.mjs` | the card's words, buttons, refusals, unknown outcome and wiring | root suite |
| `scripts/e2e/control-mission-sources.e2e.mjs` | the real `control.html` over the plane at 390, 820 and 1440 | CI `mission-sources-control` |
| `scripts/test/publish-strip-parity.test.mjs`, `scripts/test/cloudflare-pages-stage.test.mjs` | D10 | root suite; export CI |
| `scripts/test/mission-sources-records.test.mjs` | the README's rules and this record's words | root suite |

The World's half (B2) landed its implementation and pure/static tests in `70b11591565a`:
`scripts/test/world-source-profile.test.mjs` and `scripts/test/mission-areas.test.mjs`. The promised browser suite was missing
at recovered head `69058f8997b3`; it was added during the recovery review below.

## Recovery review, 2026-11-19

The recovered branch contains the World page, its mission door, area mapping, search, credit, deep links and private owner
preview. The earlier handoff's "first half" status is out of date. This changes no activation prerequisite: the 125 missions
must be published and recorded before the source migration; the permission attestation and owner Show are still required.

`scripts/e2e/world-source-profile.e2e.mjs` now exercises the actual World page at 390, 820 and 1280 px using synthetic backend
answers and the catalog's actual 125 imported mission rows. It checks the public source filter, nine areas, exclusion of a
returned draft, search and Escape, source sharing, mission opening and closing with history and focus, the mission's source
door, hidden and absent sources, denied and private owner preview, recovery after a failed mission read, and phone overflow.
The shared harness has an optional `beforeNavigate` hook so the fixture routes and external-request guard are in place before
the first page loads. Existing callers do not use the hook. CI `world-source-profile` runs the two pure/static suites followed
by this browser suite and saves its screenshots and result receipts.

Local recovery evidence on Node 22.23.5: the 15 source-profile and 4 area tests pass (included in the combined 41/41 World unit
result); the 4 source-record checks also pass, making the focused command 45/45.
The source Worker suite passes 13/13 with the offline network guard. The existing owner-source integration suite passes 7/7
against the real pending SQL in disposable PGlite, including owner enforcement in both the route and SQL, the dated Show
attestation, public visibility after Show and Hide, and replay after a lost response.
The browser launch is **blocked in this workspace**, before a page opens: system Chromium reports
`ProcessSingleton socket() failed: Operation not permitted`. CI run `44548378772`, at `62277515c349900a206a1f9f3c982b2617cc056e`,
passed all 48 main source-page browser checks at 390, 820 and 1280 px. Its screenshots were reviewed: the controls and text fit
at each size. The separate mission-to-source door then timed out. The underlying detail loader marked a mission as asked
before its response arrived, so a concurrent dialog could draw without its credit and catalog and never receive the door.
The loader now waits for that mission's pending read, preserving the forty-ID batches, cache and absent-table refusal. Three
focused regression cases fail before the change and pass after; the combined mission/source/area suites pass 40/40 on Node
22.23.5. A passing post-repair browser run is still required; the preview, unavailable-page and retry scenarios had not run when
that first browser job stopped. No production SQL was applied and no page or Worker deployed by this review.

## Facts used, with sources and dates

- Project Drawdown: a 501(c)(3) nonprofit (https://drawdown.org/about); mailing address in St. Paul, Minnesota
  (https://drawdown.org/contact); the Drawdown Explorer and its requested citation "Project Drawdown. (Year, Month Date). The
  Drawdown Explorer. http://drawdown.org/explorer." (https://drawdown.org/explorer/faqs); "Project Drawdown®, Drawdown®, and the
  Drawdown logo are registered trademarks of Project Drawdown" (the site's footer); its Terms of Use ("Last Updated:
  06/04/2025": prior written permission; no impersonation) (https://drawdown.org/terms-of-use); the Zenodo community
  `pdexplorer`, 45 records, all CC BY 4.0. All read 2026-11-19.
- CC BY 4.0, sections 2(a)(6), 2(b)(2) and 3(a)(1) to 3(a)(3) (https://creativecommons.org/licenses/by/4.0/legalcode.en,
  read 2026-11-19).
- Production, read only, on 2026-11-19: ledger 376; 125 Drawdown drafts and 1 open mission; 2 organizations, none Drawdown;
  production's default privileges in schema `public` (tables: anon and authenticated `arwdm`, service_role `arwdDxtm`;
  functions: service_role `X`; sequences: anon and authenticated `rwU`) and the live checks on `network_organizations` and
  `org_members`. No `created_by` value and no personal row was read.
- The catalog (`data/missions/drawdown/missions.json`, read-only): 125 missions; 87 quote a summary, 43 cite a CC BY 4.0
  assessment, 40 both, 35 name only; nine areas; the catalog files dated 2026-11-17.
