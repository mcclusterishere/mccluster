# The World release of 2026-11-18: record and runbook

Status: a release candidate on the release branch. **Nothing in it is merged and nothing in it is deployed.** The public
site still serves `main` at `fc1986ec` (read on 2026-11-18, below). No pull request is open for it: the owner decides
when to open one, and every later step that touches production waits for the owner's approval of that exact step.

**The scope grew on 2026-11-19.** By the owner's direction of that day, the E=UP environmental event timeline is now part of
this release: one canonical event id and revision driving the post, the globe object, the selection and the deep link; a
qualifying public government observation published with no news coverage; USGS earthquakes as the first complete slice;
the quake visuals, a shared time cursor, a non-WebGL fallback and reduced motion; owner controls for source health, review
and rollback. It is built on this branch after the release review's fixes (below, "Fixed after the release review"), and the
final verification of the whole release follows it: the counts, the check tables and step 2's numbers here describe the
candidate before that work and are refreshed by that verification. Production policy changes for it (enabling the
`environment` module, its SQL) stay the owner's separate go.

This record says what the release changes for a visitor, what it leaves off, where production stands, the steps from a
pull request to a verified public release, what was checked here and what could not be, and what the owner still has to
decide. The build brief and its decisions are `docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md`; the sign-in door is
`docs/design/WORLD-SIGN-IN-DOOR.md`; the environmental module is `docs/control-plane/WORLD-ENVIRONMENT.md`; the SQL order
is `supabase/pending/PROMOTION-ORDER.md`, section 10.

## What ships, and what a visitor sees change

At `12d9b458`, the head this record was written on, the release is 154 commits over `main` and 294 changed files;
this record adds two commits and one file. `index.html`, `CNAME`, the music transport and its lyric
line (`js/world-audio-continuity.js`, `data/lyrics/`) are unchanged.

| Part | What a visitor sees on the World (`https://mccluster.org/`, and `mnet.html` on Matthew's site) |
| --- | --- |
| The feed's row | One row under the globe: Local, the Equity Uprise tab (the supplied mark alone, white by night and the supplied dark mark by day), Global (chosen on load), Live, News, People. A signed-out visitor and an ordinary member see nothing above it: no centre mode bar. The house owner keeps Travel and News feed. |
| Missions as posts | Every open mission is a post the size of any other post. Global shows one after every three other items; the Equity Uprise tab lists them 20 at a time with Load more. The swipe deck is gone. Until the publish (step 9) a visitor sees the one mission that is open today; after it, that one and the 125 Project Drawdown missions, each with its credit. |
| The mission dialog | Opens for a signed-out visitor: the description, the proof hint, the safety line, the quotation with its credit, the full credit line. Join asks a guest to sign in or create an account and keeps `?mission=<id>` in the address; Share copies a `?mission=<id>` link. The dialog is named by its title, and the phone's Back closes it where the visitor was (release review RS-5, RS-6). On `mccluster.org`, `/mnet.html?mission=<id>` answers one 301 to `/?mission=<id>`: existing behaviour of the company host's router (unchanged on this branch), now covered by a Worker test (`workers/mccluster/test/company-site.test.mjs`). |
| The member's Action Record | A member's own record (verified actions, points, missions in progress) above the open missions, reached from the profile; on `main` only the house owner reached it. No mark is painted behind its words, it reads 4.5:1 or better by day and by night, a mission's field is said in words, and leaving it no longer stops the globe (release review RS-1, RS-2, RS-3, RS-7). |
| The country card | News in the last 24 hours, missions, posts and members for the country tapped, and the feed turns to Local with that place's missions and news. With no pins in production every country lists every open mission (a mission pinned nowhere can be done anywhere). The members figure shows a dash until `world_member_regions_v1.sql` (pending, not in this release) is applied. |
| The sign-in door | Sign in and Create account rise over the living World as a door (a sheet on a phone, a card from 700 px, a column beside the Earth from 1100 px) instead of replacing it, with the way back to the World, the supplied mark as its crest, and the World's real pulse: the open mission, the countries in the news, the Docket 516R record. Behind it the globe's news shading steps aside (release review RS-9). Every auth call sends what it sent before. |
| The first visit | The World opens with the globe and the missions at once and the privacy notice as a banner, not a full-screen wall. Nothing is recorded and no analytics request is made until the visitor agrees. Every other page of the house keeps its wall. |
| The retired tagline | "Get Your Hu Up!" is gone from the World, `action/index.html`, `heal-the-3rd-world.html`, `mccluster-corp.html`, the member desk and the `/company` footer. Nothing replaces it. |
| The environmental line | The Equity Uprise tab shows one plain line where the Environmental Justice panel will be, because the module is off (below). No observation posts, no layers on the globe. |
| Project Drawdown's source page | Nothing yet. The code ships inert: no visitor sees a door or a page until its SQL is approved, applied after step 11, and the owner confirms the written permission's scope and shows it; until then `?source=project-drawdown` says "That page is not available." on the feed's status line. |

What else is in the merge, with nothing for a visitor to see:

- **Worker `mccluster`**: seven public `GET` routes for the environmental layers
  (`/v1/world/environment/layers/{fires,perimeters,alerts,eonet,tides}`, `/v1/world/environment/tides/:station`,
  `/v1/world/environment/quakes/:event/shakemap`), all behind the module gate and answering 503 today; the `/company`
  footer without the tagline; the module-policy messages name the applied migration. `HereTenantAgent` is still exported.
- **The Control Room** (owner only): the image and "Use the browser" controls of Ask McCluster show only when the running
  Core declares them. Against the Core that runs today (`deploy/ovh-production` at `eb942248`) the owner sees one plain
  line in place of each, and a turn carries neither.
- **Records**: `supabase/migrations/` gains the twelve files production already holds (ledger 365 to 376), with the
  ledger, the drift contract, the schema manifest, a 2026-11-18 production snapshot and a replay twin so a fresh CI reset
  passes the 2026-11-14 registry migration. The merge applies no SQL: the repository's migrations and production's
  ledger are the same 376.
- **CI**: seven workflow files change (240 lines in, 13 out). The World browser matrix has 44 suites where `main` has 26
  (both counted at `fc001103`; the door's two join it in this release preparation, and Project Drawdown's source page
  adds three: `mission-sources-store`, `mission-sources-owner`, `mission-sources-control`); the Control workspace job
  runs the Control Room's AI browser suite; a root test runs the deploy gate's merge-marker guard. `compute-node-ci.yml`
  gains a whole job, `browser-executor` (38 lines, its own Playwright 1.63.0 install, the browser executor's
  real-Chromium tests, failing rather than skipping when Chromium is missing) and a step asserting that the Core never
  depends on Playwright; that workflow starts on a push to `core/compute-node-v1`, a branch that does not exist, or by
  dispatch, so the new job has never run in GitHub Actions and runs only when dispatched. `music-platform-ci.yml` gains
  the music module's playback, peaks and accounts checks and a `browser` job (99 lines). `api-economic-core-ci.yml` and
  `archive-browser-acceptance.yml` each drop the retired swipe deck's test command
  (`scripts/test/mission-swipe-deck.test.mjs` in one, `scripts/e2e/mission-swipe.e2e.mjs` in the other) with its path
  filters; the archive job's filters gain `mnet.html` and `js/mnet.js`. One deploy workflow changes one command line:
  `deploy-pages.yml`'s strip step also removes `data/missions/drawdown/` (the frozen mission catalog stays out of the
  published site; the Cloudflare export refuses it too; the comment above the line says why). No trigger changed.

## What does not ship

| Left off | Why, and what turns it on |
| --- | --- |
| The Core and laptop work (device nodes: the Windows GPU node, vision routing, the node's browser, the Core's agent loop) | The code is on the branch, but Core changes reach production only through the separate OVH promotion (`promote-ovh-production.yml`, the owner's dispatch) and a laptop install. Not part of this release. `supabase/pending/compute_claim_task_yield_v3.sql` is not applied and is not needed. |
| The environmental module | `GET /v1/world/environment` and the seven layer routes answer 503 `module_policy_unavailable` until the owner installs the `environment` module in Control (System, E=Up, Overview, Modules), and 404 `module_disabled` until the owner enables it. Verified with fixtures only; production has never answered with the module on. Before it is enabled, the layer routes need the per-client rate limit, the negative caching and the bounded tides crawl the security review asked for (SEC-2, carried into the E=UP timeline work): today 60 distinct event ids make 60 upstream requests and one slow tides read runs 81 s. |
| Opening on the visitor's country | `WORLD_PLACE_SCOPE_ENABLED` stays `"false"` in `workers/mccluster/wrangler.toml`, so the feed opens on Global. Turning it on is its own pull request after the public-only feed checks in `docs/action-network/WORLD-REGION-FEED-RELEASE.md`. |
| The 125 Drawdown missions as public missions | They are in production as hidden drafts. The publish is a separate, owner-approved SQL step in the deploy window (step 9). |
| Mission pins | Production has none. Placing them is the owner's separate decision with its own SQL. |
| Travel, the clip-campaign door, the Live room's action blocks | Still owner-only (`hu-travel-off`). |
| Project Drawdown's source page: its SQL and its showing | A separate, owner-approved step after step 11 (below, Later). The organization row is public from the moment the SQL is applied. |

## Production today

Read on 2026-11-18 between 18:35 and 18:50 UTC with plain public `GET`s and read-only GitHub API calls. Nothing was
changed.

| What | Observed |
| --- | --- |
| `https://mccluster.org/` | 200 through Cloudflare (`server: cloudflare`, `cache-control: public, max-age=300`). The page is the World with the company host's own head: `<title>Equity Uprise · McCluster</title>`, `rel="canonical"` `https://mccluster.org/`, `og:site_name` "McCluster Corp", a `WebPage` node, and no `noindex`. The same file read from `https://matthew.mccluster.org/mnet.html` (GitHub Pages, `server: GitHub.com`) carries `noindex` and no canonical. That head is what `workers/mccluster/src/world-host.js` writes, so the apex answers from Worker `mccluster` today. Its assets carry `?v=fc1986ec0f4c`. |
| `https://mccluster.org/company` | 200 through Cloudflare, `<title>McCluster Corp · …</title>`, canonical `https://mccluster.org/company`. |
| `https://humanuprise.com/` | Not read: this machine's outbound proxy refused the connection (502). Nothing is concluded about it. |
| `https://api.mccluster.org/v1/health` | `deployment_sha` `fc1986ec0f4c473f9df8db4578058f1f39f3bd52`, `deployment_ref` `HEAD` (Cloudflare Workers Builds), the six capability flags true. |
| Git | `main` `fc1986ec…`; `gh-pages` `2837568b41a48632e93f4383f538380713be85fc`; `deploy/ovh-production` `eb94224883685c0e3d2cf8a54eb14bbc1349d0bf`. The "Workers Builds: mccluster" check on `fc1986ec` names Worker version `cd7d8859-69f1-4465-8041-c7267457c87d`. |
| Pull requests | None is open from the release branch (its last one, #793, merged on 2026-11-10). #760 is open (below). |

Supabase project `zmnhbrjyhxzhkxmhkexs`, **as the repository records it** (`supabase/production-ledger.json`,
`core/drift-contract.json`, `docs/control-plane/evidence/releases-2026-11-18/LEDGER-376-APPLIED-VERIFICATION.md`; production
was not read again for this record):

- The ledger has 376 rows; the latest is `20261118035654` `action_mission_drawdown_import_07`.
- The twelve rows after `20261110220135`, each equal byte for byte to its file under `supabase/migrations/`:

  | Version | Name | Applied |
  | --- | --- | --- |
  | `20261114015120` | `equity_uprise_platform_registry` | 2026-11-14, outside Git; imported from the stored statement |
  | `20261114060150` | `equity_uprise_music_workspace` | 2026-11-14, outside Git; imported from the stored statement |
  | `20261117144103` | `eup_module_policy_v1` | 2026-11-17 |
  | `20261117222809` | `action_globe_join_scope_v1` | 2026-11-17 |
  | `20261118021521` | `action_mission_details` | 2026-11-18 |
  | `20261118034753` to `20261118035654` | `action_mission_drawdown_import_01` to `_07` | 2026-11-18 |

- `public.action_missions` holds 1 open mission and the 125 Drawdown missions as drafts, with 125 rows in
  `public.action_mission_details`; an anonymous read sees the 1 open mission. There are 0 mission pins.
- The module policy tables exist; there is no policy row for `environment`.
- **Not applied:** the publish, `supabase/pending/20261117100300_action_mission_drawdown_publish.sql` (23,619 bytes, md5
  `9d5e9f4e9178bf52fac4255453787798`). The owner decided on 2026-11-18 that it runs in the deploy window, after the new
  feed is live. Also not applied and not part of this release: `20261107120000_world_environment_v1.sql`,
  `20261108120000_world_environment_proofs_v1.sql`, `world_member_regions_v1.sql`, `compute_claim_task_yield_v3.sql`.
- Supabase Auth: the owner confirmed on 2026-11-18 that the Redirect URLs include `https://mccluster.org/**`.

## From a pull request to a verified public release

Two rails deploy at different times. **The Worker deploys about 30 seconds after a merge, before CI has finished and with
no automatic rollback** (Cloudflare Workers Builds; on `fc1986ec` its check completed 31 seconds after the push).
**Pages publishes only after the ten deploy-gate checks pass on the merge commit** (`docs/control-plane/deploy-gate.json`;
6.6 minutes on `fc1986ec`; it refuses on any check that is not a success and gives up after 45 minutes). Between the two
the old front-end runs against the new Worker; the Worker's changes are additive, so it keeps working. The World on
`mccluster.org` is passed through from Pages, so it follows the Pages rail.

Agents do not open the pull request, merge, deploy, dispatch a workflow or apply SQL: each of those is the owner's, or an
agent's only on the owner's explicit go for that step (`AGENTS.md`, "Autonomous operations contract").

None of the three production rollbacks below (a Worker version rollback, a `gh-pages` restore, the publish rollback)
has been exercised: nothing under `docs/` records a Worker version rolled back or `gh-pages` restored; the workflow's
own automatic Worker rollback sits in its `deploy` job, which is not the path deploying today (Workers Builds; health
reports `deployment_ref` `HEAD`); and the publish rollback has run only on a disposable PostgreSQL 16.15. Each is a
procedure read, not one practised.

### 1. Freeze the head

- **How:** nobody pushes to the release branch after the prepared head. Read it twice, minutes apart, with
  `git ls-remote origin refs/heads/<release branch>`.
- **Who approves:** the owner says the scope is closed.
- **Check right after:** the two reads agree; `git rev-list --count <head>..origin/main` is 0 (the ruleset wants the
  branch up to date with `main`).
- **Roll back:** nothing is deployed; a commit can be reverted on the branch.

### 2. Open the pull request

- **How:** a non-draft pull request from the release branch to `main`, in the GitHub UI or with `gh pr create`, with the
  prepared text. There is no template in the repository.
- **Who approves:** the owner. Opening it deploys nothing. The "Protect Main" ruleset asks for GitHub's automatic code
  review and for every review thread to be resolved; it requires no human approval.
- **Check right after:** 30 workflows start, 88 jobs in all (counted at `fc001103` from its workflow files and its
  diff with `main`; 24 and 69 at `fc324947`): `architecture` (the one required check), `contracts`, `scan`, `smoke`,
  Reconciliation CI's six jobs, "Validate authority, program, plans, and building", and the path-filtered workflows this
  diff touches, among them the World browser matrix (44 suites, each with a 60 minute limit; the longest here,
  `world-gate`, took 30 minutes on a machine that took 15 minutes for `editorial-iphone-portrait`, which the workflow's
  last CI run did in under 8). The branch cleanup workflow starts only when the pull request closes.
- **Roll back:** close the pull request.

### 3. Bring CI to green on the pull request's head

- **How:** fix forward on the branch; each push restarts CI. Resolve every review thread (the ruleset requires it).
  "Supabase migration reset", "Credits, billing, idempotency, rate-limit, and COGS regression" and the PRIM3
  acceptance's database step could not run in the preparation, and `browser (editorial-video-composer)` could not be
  completed there (below): the pull request is where they first run on this head, so read them first. If the reset's
  step "Compare the rebuilt schema with supabase/schema-manifest.json" reports a difference, the job's `reset-schema`
  artifact holds the manifest the reset built (`schema-manifest.json`): commit that file as
  `supabase/schema-manifest.json`, as the workflow's own comment says, and never edit the manifest by hand.
- **Who approves:** nobody; this is the gate before the owner looks.
- **Check right after:** `gh pr checks <number>` shows every check as a success, none cancelled, except two that skip
  by design: "Publish generated building artifacts" (its job's `if` runs it only on a dispatch from a branch that asks for
  it) and "Supabase Preview" ("This git branch is not associated with any Supabase Branch"; it was skipped on #793 and
  on `a8d2502d` alike). Any other state of "Supabase Preview" on the pull request is a stop. `npm audit` in `contracts`
  reads the registry at run time (0 vulnerabilities on 2026-11-18), so look again just before the merge.
- **Roll back:** nothing to roll back.

### 4. The owner reviews the screens

- **How:** from the pull request's artifacts (`human-uprise-editorial-<run>-<suite>`, kept 7 days; the Control
  workspace's `control-workspace-proof-<run>`): the row and the Equity Uprise tab by night and by day, Global with
  mission posts, a mission post and its dialog, the plain environmental line, a country card, the door in both doors at
  390, 820 and 1280, the first visit with the banner, the Control Room's Ask McCluster lines.
- **Who approves:** the owner, screen by screen.
- **Check right after:** the owner's written go.
- **Roll back:** fix on the branch and repeat steps 3 and 4.

### 5. Before the merge: settle #760, hold other merges, write down the anchors

- **How:** decide #760 first (below): merged before this release it forces a branch update, conflicts in
  `js/live-content.js` and puts the wall back on the World. Hold every other merge to `main` until step 10 is done.
  Read the open pull requests again at this step (`gh pr list --base main --state open`); on 2026-11-19 they included
  the Dependabot pull requests #806, #807, #808, #810, #811, #816 and #817 (#817 bumps Wrangler from 4.156.0 to 4.162.0
  and #816 `@fal-ai/client`, both in `workers/mccluster`; #809 was closed unmerged on 2026-11-18), and #785, #803, #758
  (`js/control-room-v2.js`) and #679 (the Equity Uprise source map and its coverage report), which touch files this
  branch touches. The rule is the hold, not the list. Write down: the live Worker version (Cloudflare, Workers & Pages, `mccluster`, Deployments; today the
  one named above, unless something newer exists), `gh-pages`, `main`, `deploy/ovh-production`, the ledger's count and
  latest row, and whether `FIRMS_MAP_KEY` is among the Worker's secrets (by name).
- **Who approves:** the owner.
- **Check right after:** the pull request is still 0 behind `main`, every check is still green, every anchor is written.
- **Roll back:** nothing to roll back.

### 6. Merge with a merge commit

- **How:** a merge commit pinned to the frozen head: `gh pr merge <number> --merge --match-head-commit <frozen sha>`,
  which refuses if the branch moved after step 1. The freeze is by agreement only: `gh pr merge` without that flag does
  not refuse, the web button refuses only when the head moved after its page loaded, and the cleanup job deletes the
  branch by name without comparing its tip, so a push after the last look rides into `main` and into the Worker within
  30 seconds, and one between the merge and the delete is removed from the remote. Never squash or rebase: the OVH
  promotion needs ancestry, and the commit hashes the records quote must stay reachable. The merge at once sets off: the
  Worker deploy (about 30 seconds); CI on the merge commit; `deploy-pages`, which waits for the gate; the Worker's
  observer job; IndexNow after Pages; and the branch cleanup, **which deletes the release branch**, so nothing may be
  pushed to it again. The Supabase integration finds the repository's migrations and production's ledger equal at 376
  and has nothing to apply; no Edge Function changed.
- **Who approves:** the owner's explicit approval of this merge.
- **Check right after:** the merge commit is on `main` with two parents, the old tip of `main` and the frozen head; the
  branch is gone; "Supabase Preview" on the merge commit is a success (as on `fc1986ec` and on #793's merge `7e41f0b3`),
  and a catalog-only read of the ledger still finds 376 rows.
- **Roll back:** each rail as in steps 7 and 8. A revert of the merge is its own pull request and needs a green
  `architecture` check, because force pushes to `main` are blocked. A revert takes the twelve migration files and their
  376-row records out of `main` while production keeps them, so the drift check and the Supabase integration then see
  production versions the repository lacks (the #370 row of `docs/control-plane/SECURITY-POSTURE.md`). The release
  branch is gone by then, so the release is re-landed as a revert of the revert on a new branch, through its own pull
  request and this runbook from step 1.

### 7. Verify the Worker rail (about 30 seconds after the merge)

- **How:** two reads tell the new Worker from the old: `GET https://api.mccluster.org/v1/health` until `deployment_sha`
  is the merge commit, with `deployment_ref` `HEAD` and the six capability flags true; and
  `https://mccluster.org/company` answering 200 without the tagline (the old Worker's page still carries it once). Watch
  "Verify Cloudflare Git deployment" (it polls 18 times, 10 seconds apart, then checks the MCP contract, the flags and
  the gate). Three more reads **must not change**, because the Worker live today already answers them this way:
  `/v1/world/environment` and `/v1/world/environment/layers/fires` answer 503 `module_policy_unavailable`, and
  `https://mccluster.org/mnet.html?mission=<id>` answers one 301 to `/?mission=<id>`.
- **Who approves:** nobody; this rail is automatic and the operator watches it.
- **Check right after:** the direct reads above within about three minutes of the merge. The Worker's observer job
  finishes only with the Pages gate, six minutes or more after the merge (six on #793's merge, 22:38:08 to 22:44:08),
  and it goes red when any gate check fails even if the Worker is fine.
- **Roll back:** in Cloudflare, `mccluster`, Deployments, roll back to the version written down in step 5 (or
  `wrangler versions deploy <id>@100` with the owner's token). Do not run step 9. Pages will still publish the new
  front-end once the gate is green, about seven minutes after the merge, against the rolled-back Worker: that pairing is
  safe for this diff (the live Worker already answers 503 `module_policy_unavailable` on every layer route, and the new
  front-end then shows its plain line); to stop it anyway, cancel the `deploy-pages` run (`gh run cancel <run id>`)
  before its publish job pushes `gh-pages`. The next push to `main` deploys whatever `main` then holds, to the Worker
  and to Pages.

### 8. Verify the Pages rail, and the World on both hosts

- **How:** `deploy-pages` `publish` waits for the ten gate checks on the merge commit, stamps the first 12 characters of
  the merge commit into every asset URL, builds, strips the internals and pushes `gh-pages`; `verify-live` then reads the
  stamp from the live site and checks the private paths answer 404. Then load `https://matthew.mccluster.org/mnet.html`
  and `https://mccluster.org/` as a new visitor at 390 and 1280. The apex is answered with `max-age=300`, so it can lag
  Matthew's host by some minutes.
- **Who approves:** nobody; this rail is automatic.
- **Check right after:** both jobs are green; assets carry the new stamp on both hosts; the row in its order with no
  mode bar; the privacy banner, not the wall; the plain environmental line; only the mission that was already open; the
  door from Join; `scrollWidth === clientWidth` at 390.
- **Roll back:** if the publish refused, do not run step 9: re-run the failed check (a passing re-run supersedes it) and
  re-dispatch `deploy-pages` from `main`, or roll the Worker back. One known cause of a red `contracts` was a timing race
  in a Core test ("TERM to wrapper, bootstrap and bounded reload ...", ENOTEMPTY under load, already on `main`); this
  branch removes it (release review RM-7), and a re-run is still the remedy if it recurs. To undo a bad publish, force
  `gh-pages` back to the hash written down in step 5 (no ruleset covers it) or merge a revert. **A forced `gh-pages`
  lasts only until the next push to `main`:** `deploy-pages` runs on every push to `main`, with no path filter, and ends
  with `git push origin HEAD:refs/heads/gh-pages --force`, so the next fix, held pull request or Dependabot merge
  republishes `main`'s tree and silently undoes it. While `gh-pages` is forced back, nothing merges to `main` until the
  revert or the fix is the thing that merges.

### 9. Publish the 125 missions, only after steps 7 and 8 both report the merge commit

- **How:** wait ten minutes after `verify-live` has read the new stamp. It reads `index.html?verify=<stamp>-<n>`, which
  bypasses caches, while Pages serves the pages with `max-age=600` and the apex root comes with `max-age=300`, so a
  returning visitor's cached old page, whose swipe deck would show all 125, can stay in use for up to ten minutes. Then
  read first: the ledger holds the seven import parts and no publish row; 125 catalog missions are drafts with 125
  details rows. Then apply `supabase/pending/20261117100300_action_mission_drawdown_publish.sql` from `main`, byte for
  byte (23,619 bytes, md5 `9d5e9f4e9178bf52fac4255453787798`), with the Supabase MCP `apply_migration` as postgres,
  under the name `action_mission_drawdown_publish`.
- **Who approves:** the owner's go for this exact file at that moment. The timing is decided: with the deploy, after the
  new feed is live. Run before the new front-end is live, the old one would show all 125 in its swipe deck.
- **Check right after:** the ledger has 377 rows and the newest is `action_mission_drawdown_publish`; the open missions
  are the earlier count plus 125; as a new visitor on `mccluster.org` the Equity Uprise tab lists 20 posts and Load more,
  Global shows one mission after every three items, a dialog shows its credit and DOI, `?mission=<id>` opens that
  mission. One effect to expect: the Live room's mission picker (`/v1/mnet/live/options`,
  `workers/mccluster/src/platform-api.js`) reads `action_missions?status=eq.open&...&order=created_at.desc&limit=100`, so
  with 126 open missions the oldest 26 (the mission open before the import and 25 catalog missions) drop out of it. That
  picker is the house owner's today (the Live room's action blocks are owner-only).
- **Roll back:** If Project Drawdown's source page is shown, Hide it first (Control, Missions & fellows, Mission sources): a
  shown page over a rolled-back publish lists no missions. Then
  `supabase/pending/20261117100300_action_mission_drawdown_publish.rollback.sql` (11,851 bytes, md5
  `16cb998e034e30208bb99c098ca504b2`), with the owner's approval, applied the way the forward file was: the Supabase MCP
  `apply_migration` as postgres (its header and `supabase/pending/PROMOTION-ORDER.md` section 10 say so), under the name
  `action_mission_drawdown_publish_rollback`. It sets the 125 back to draft. Its first line, "never a forward migration",
  keeps it out of the forward chain, but `apply_migration` still records it: the ledger then has 378 rows, and step 11
  records both the publish and its rollback (each moved to `supabase/migrations/` under its own ledger version). Until
  that lands, the Supabase integration fails every push while production holds versions the repository lacks
  (`docs/control-plane/SECURITY-POSTURE.md`, the #370 row). The import rollback can follow only while nothing references
  a mission; one member's join blocks it.

### 10. Try the guest sign-in and join once

- **How:** in a private window on `mccluster.org`: open a mission post, press Join, sign in or create and confirm an
  account, see the page return to `?mission=<id>`, complete the three profile pages if asked, press Join once. Use the
  mission that was open before the import: a test join on a Drawdown mission would make the import rollback refuse.
- **Who approves:** the owner; it uses a real account and writes a real assignment.
- **Check right after:** exactly one assignment for that account and mission.
- **Roll back:** withdraw the test assignment through the normal member or owner path.

### 11. Record the publish in the repository

- **How:** on a new branch: move the publish to `supabase/migrations/<its ledger version>_action_mission_drawdown_publish.sql`
  (equal to the stored statement; and its rollback under its own version if step 9's rollback ran). Give
  `tools/build-mission-import.mjs` the publish's ledger version and migration path, as it already holds the seven
  parts' (`APPLIED_IMPORT_PART_VERSIONS`; its `OUTPUT_FILES.publish` still names the pending path), and update
  `scripts/test/mission-import.test.mjs`, which reads the publish through `OUTPUT_FILES` and counts what is still
  pending. Update `supabase/production-ledger.json`, `core/drift-contract.json`, `supabase/pending/live-callers.json` and
  the records that call it pending. Run `node tools/build-mission-import.mjs --check`,
  `node --test scripts/test/*.test.mjs` and `node scripts/control-plane-drift-contract-check.mjs`, and merge with a
  merge commit.
- **Who approves:** the owner approves the merge.
- **Check right after:** all ten deploy-gate checks green on the records pull request, not the drift check alone: moving
  the file without the generator and its test turns `contracts` red (the release review moved it in a scratch copy:
  `--check` exited 1 and the unit test failed 8 of 26), and with `main` red the gate refuses every later Pages publish.
  The drift check is then ok at 377 (378 with a rollback row). Until this lands the Supabase integration sees a
  production version the repository lacks; it has nothing to apply either way.
- **Roll back:** a revert; the change is records only.

### Later, each its own step

- **The environmental module.** The owner installs and then enables `environment` in Control. First decide whether
  `20261107120000_world_environment_v1.sql` (and the proofs file) is applied before it: without it the panel's member
  features (team, propose, review, join) answer 503. Fires need the Worker secret `FIRMS_MAP_KEY`; without it that layer
  answers `not_configured`. Check: `/v1/world/environment` and the layer routes answer 200, the panel replaces the plain
  line at 390, 820 and 1280. Undo: Drain, then Disable, in Control.
- **Opening on the visitor's country.** The checks in `docs/action-network/WORLD-REGION-FEED-RELEASE.md`, then a pull
  request that sets `WORLD_PLACE_SCOPE_ENABLED = "true"`. A dashboard-only change is overwritten by the next deploy.
- **The OVH Core promotion**, for the device-node work: the owner's dispatch of `promote-ovh-production.yml` in a chosen
  window, with its own preconditions. A ref rollback there is a forward promotion of a revert.
- **Project Drawdown's source page** (`docs/control-plane/WORLD-MISSION-SOURCES.md`; every decision there a default adopted
  pending Matthew's confirmation). *How:* after step 9 has published and step 11 has recorded it, read production (SELECT
  only: the ledger equals `supabase/production-ledger.json`, the publish row is there, the open Drawdown missions counted, no
  `project-drawdown` organization), then apply `supabase/pending/20261119140000_mission_catalog_sources_v1.sql` byte for
  byte as postgres with `apply_migration` under `mission_catalog_sources_v1`; the ledger then has one more row, its number
  named then. *Who approves:* Matthew, for the exact text: it publishes the organization row's words and adds the house
  owner's commands (an authorization addition). *Check right after:* one organization row and one draft link; anon REST
  answers `[]` for the link; Control shows Draft; `?source=project-drawdown` says "That page is not available."; the "Ask
  for a change" route opens `https://mccluster.org/company`. *Before Show:* Matthew confirms, outside this repository, that
  the written permission covers (a) a page headed by Project Drawdown's name on McCluster Corp's platform, which also sells
  sponsorships, (b) the 87 quotations there and (c) the citation; Show records only that date. Then Preview, then Show: that
  is the page's publication. *Roll back:* Hide (instant for every new visit; open pages keep it until they reload); or the
  rollback file with his approval, as postgres, which refuses, changing nothing, while anything else names the
  organization. *Record:* as step 11 (move to `supabase/migrations/` under its ledger version, the ledger, drift contract,
  manifest from the CI reset, snapshot, `ledger-receipts.json`, `live-callers.json`, PROMOTION-ORDER, the pending README);
  one records change covers every version applied since the last record.

## Fixed after the release review

Three reviews read the candidate at `a8d2502d` on 2026-11-19: security (SEC-1 to SEC-5), the release's mechanics (RM-1 to
RM-10) and what a visitor sees (RS-1 to RS-9). Each finding below was reproduced at `a8d2502d` first, fixed in the smallest
truthful way in a commit of its own (findings on one surface share one), committed by path, and given a test that fails
against `a8d2502d`'s files and passes after the fix; the one exception, RM-7, says so in its row. Nothing was skipped,
switched off or quarantined. The E=UP timeline work (its first two stages, S0 and S1) was merged into the branch between
these fixes and this section; at `5d801add`, the merge of the two, the release is 177 commits over `main` (`fc1986ec`,
0 behind) and 319 changed files.

| Finding | What was wrong at `a8d2502d` | The fix | The test that fails without it |
| --- | --- | --- | --- |
| RS-1 (blocker) | The member's Missions view, now reached by every member, painted the Equity Uprise emblem behind its words: cropped by its box, filtered and turned, which is drawing over a supplied mark | The rule is gone from `css/mnet.css`, with a dead rule of the same kind; `d6934049` | `scripts/test/logo-css-backgrounds.test.mjs` refuses a supplied mark used as a filtered, transformed, blended, cropped, covering or tiled background (2 of its 3 tests fail at `a8d2502d`) |
| SEC-1 (major) | `?next=` could leave the site after sign-in: `/.//host` collapses to `//host` (`safeNext` in `js/mcc-auth.js`, and the copy in `login.html`) | Both refuse an answer that starts with two slashes or resolves to another origin; `262ce6c0` | `scripts/test/one-signup-flow.test.mjs`, two new tests (both fail at `a8d2502d`); in a browser, 3 escapes at `a8d2502d` and none after |
| RS-2 (major) | With the World hidden (the Action Record, or a sign-in from a mission's Join and back) the globe's canvas was 0 x 0, the camera's home height infinite, and Cesium stopped with its error pane | The home height is used only while the canvas has a size; the resize watcher skips a 0 x 0 canvas; `6d921fb4`. The door suite then launches with the World suites' GL path (`bd80fdd6`, below) | `scripts/test/world-globe-hidden-canvas.test.mjs` (0 of 2 at `a8d2502d`); `world-missions-guest` e2e, `world-hidden-and-back-390` |
| RS-3 (major) | The member's Action Record by day kept its night veil under the day's black ink: the title read 1.1:1, Refresh 1.4:1, the points 1.6:1 | By day the veil goes (`css/daylight.css`) and the view is the white page every other room is; the points take a gold made for white, a record's verified and rejected lines the day's green and red; `69180c42` | `world-missions-guest` e2e, `member-action-record-{390,1280}-{night,day}`, every text measured from pixels (14 checks fail at `a8d2502d`) |
| RS-7 (minor) | The record printed a mission's field as its key ("MUTUAL_AID"), and the small red kickers of the record and the mission dialog ("Credit") read 3.6 to 4.2:1 by night | The field in words, through the feed's own label; the night kickers in `#ff4d6d`; `69180c42` | `scripts/test/world-mission-posts.test.mjs` (the label) and the e2e above. The finding's third part, the posts' grey meta line at 4.18:1, is refuted: at rest every such line reads 5.91 to 5.95:1 at 390 and 1280 by night; the 4.18 was a line at the viewport's foot crossed by the feed's 1 px border |
| RM-1 to RM-6, RM-8 to RM-10 | The runbook: step 11 turned `contracts` red; rollbacks incomplete and never exercised; probes that pass on today's Worker; a stale list of pull requests; an understated CI line; checks skipped by design; two timings; the publish's known effect; a merge that pinned no commit | Steps 3 and 5 to 11 of this record and "What ships"; `eca77573` | `scripts/test/world-release-record.test.mjs` (none of its first 8 tests passes at `a8d2502d`) |
| RM-7 (minor) | A Core test ("TERM to wrapper, bootstrap and bounded reload ...") raced its own clean-up under load, ENOTEMPTY (already so on `main`) | The test ends the wrapper's process group and waits for it before its box is removed, and the removal retries; `c4e39ecb` | The race was not reproduced here, so this one is a fix by construction, not a failing test: `core/test/deploy-timeout-bootstrap.test.mjs` passed eight runs in a row, 18 of 18 each |
| SEC-3 (minor) | A guest's feed asked `action_offer_cards`, which production grants to signed-in members only | `loadActionOfferCards` asks nothing for a guest; `5f674418` | `scripts/test/creator-action-distribution.test.mjs` (fails at `a8d2502d`) |
| SEC-4 (minor) | The door kept a typed password after it closed, and Show could reveal it on a shared device | Leaving the door empties both password fields and hides them again; `d1aa8bb5` | `scripts/test/world-gate.test.mjs` (20 of 21 at `a8d2502d`) |
| RS-5, RS-6, RS-8 (minor) | The mission dialog had no name; the phone's Back left the World, or dropped `?mission=` with the dialog still open; a shared link to a mission that is gone switched tabs without a word | The dialog is named by its title; opening a mission from the World pushes one entry, the door's way (Back closes the dialog where the visitor was, the × and Escape step back over it, a shared link's landing replaces); the gone mission's line stays until another tab is chosen; `2855a4e9` | `scripts/test/world-mission-posts.test.mjs` (on a fake history), `scripts/test/world-news-feed.test.mjs` (the page's own `loadFeed`), and the `world-missions-guest` e2e (`guest-dialog-back-390`, `guest-shared-link-back-390`, `guest-gone-mission-390`, `guest-escape-390`); at `a8d2502d` three of them fail and the run stops when Back leaves the World |
| RS-4 (minor) | From 1100 px the onboarding pages' centred measure lay under the centred floating bar: at rest 87 % of the action's words under it at 1280 x 720, 88 % at 1366 x 768 | From 1100 px the bar steps aside, right of the measure: moved, never hidden; the phone keeps it where it was; `7641000e` | `world-gate` e2e, `onboard-bar`, at 1366 x 768, 1280 x 720, 1100 x 700 and 390 x 844 (6 of 11 checks fail at `a8d2502d`); `scripts/test/world-gate.test.mjs` |
| RS-9 (minor) | The door's art direction: at 1280 by day a grey column with a hard edge beside the Earth; the news shading behind the card; at 390 the record's line cut to "Bridg…" | The veil whole from 1100 px; the news shading steps aside while the door is open and comes back when it closes; the record's line takes a second line, and the third card waits for a 267 px stage; `09404805` | `world-gate` e2e, `door-art` (5 of 9 checks fail at `a8d2502d`); `scripts/test/world-news-tint.test.mjs`; `scripts/test/world-gate.test.mjs` |

What the owner sees change: the Action Record (no mark behind it, readable by day and by night, the field in words), the
phone's Back on a mission, the bar beside the onboarding pages on a laptop, and the door's backdrop and third card. The
owner's ten renders of the door and the first onboarding page were made again at `5d801add`.

Not fixed here:

- **SEC-2** (no per-client rate limit, no negative caching and an unbounded tides crawl on the environmental layer routes,
  inert while the module is off) is carried into the E=UP timeline rework; it is a prerequisite of enabling the module
  ("What does not ship").
- **SEC-3's second half:** two calls name functions production does not have (`action_globe_public_business_pins` in
  `js/action-globe.js`, `action_mission_card_extras` in `js/mnet.js`). Both are on `main` too, fail quietly, and belong to
  the build queue's W5 item.
- **SEC-5** is the owner's to decide: decision 10 below.
- **Carried into the E=UP timeline rework** from the surface review: the tab asks the five layer routes again on every
  activation while the module answers 503, and off, outage and no data are not told apart; the quake discs read as plain
  white circles; at 390 the music bar covers the panel's tour controls and the chosen event's label is clipped behind the
  header; the panel's search placeholder reads 2.1 to 2.9:1 and its "Sources, coverage and limitations" summary is 23 px
  high; with the E=UP layers on, the door's backdrop should go quiet too.

Checks run on these fixes on 2026-11-19, on the same 4-CPU machine, shared with other sessions whose browser runs take
turns with these through one lock; Playwright 1.63.0 with its Chromium 153, Cesium 1.131.0 from a local copy of the pinned
build. They are the suites that cover what changed; the final verification after the E=UP work runs every pull-request job.

| Check | At | Result |
| --- | --- | --- |
| `scripts/e2e/world-gate.e2e.mjs`, the whole suite | `09404805`, the tree before the merge | 577 of 577 (37 minutes; load 1.8 at the start, 3.4 at the end) |
| its `door-art` and `onboard-bar` scenarios, again after the merge | `5d801add` | 20 of 20 |
| `scripts/e2e/world-missions-guest.e2e.mjs`, the whole suite | `5d801add` | 279 of 279 (7 minutes; load 5.5 to 4.5) |
| `scripts/e2e/sign-in.e2e.mjs`, the whole suite | `5d801add` | 174 of 174 (18 minutes; load 3.1 to 4.4) |
| `scripts/e2e/world-first-visit.e2e.mjs`, the whole suite | `5d801add` | 83 of 83 (3 minutes) |
| `scripts/e2e/human-uprise-door.e2e.mjs`, the whole suite | `bd80fdd6` | 122 of 122 (3 minutes). At `5d801add` it stopped twice after 78 checks, on a screenshot ("Unable to capture screenshot"): with RS-2's fix the globe keeps drawing after a hidden World, and on Chromium's default GL path that kept the GPU process busy into the next scenario (bisected to `6d921fb4`; 122 of 122 at `262ce6c0`). `bd80fdd6` gives the suite the software GL path every other World suite launches with; no check changed |
| `scripts/e2e/environment-world.e2e.mjs`, the whole suite | `5d801add` | 222 checks, 0 failed, and the suite's own "all checks passed" (10 minutes; load 2.0 to 4.4) |
| the unit tests in `scripts/test/` that read `js/mnet.js`, `mnet.html` or `js/world-news-globe.js`, with the fixes' own | `5d801add` | 534 of 534 |
| `workers/mccluster/test/mnet-mission-flow.test.mjs`, the Worker's unit test of the mission dialog, left out of the row above until 2026-11-19: it reads `js/mnet.js`, and the deploy-gate checks `contracts` and `Worker contracts` run it with the whole Worker suite, as do `worker-tests` and `users-analytics` | `5d801add` | 0 of 12, each stopped in its harness: `2855a4e9` (RS-6) changed `function closeMission(){`, the line it sliced from (12 of 12 at `d1aa8bb5`, the commit before) |
| the same file, repaired on 2026-11-19: the harness runs the dialog's history block as it ships, the Escape test proves both ways the mission leaves the address, and two new tests cover the phone's Back and the ×'s click event | `a41af051` | 14 of 14; the whole Worker suite 2,007 tests, 1,998 passed, 0 failed, 9 skipped |
| `node --test scripts/test/*.test.mjs`, the root suite of `contracts` | `5d801add`, with this record's section in the tree | the 294 other files: 2,770 tests, 2,763 passed, 0 failed, 7 skipped (55 s); this record's own test, `scripts/test/world-release-record.test.mjs`, 9 of 9 on this text |
| the Equity Uprise source-map validator | `5d801add` | 750 candidates, 2,898 of 2,898 checks |
| `core/test/deploy-timeout-bootstrap.test.mjs` | `c4e39ecb` | 18 of 18, eight runs in a row |

## Checks run for this record

Run on 2026-11-18 on one 4-CPU machine, one job at a time, each from its workflow's own commands. At `fc324947` a pull
request from the release branch started 24 workflows and 69 jobs. Every one of them is a row below, with the commit it
ran at. `12d9b458` is the head this record was written on; `fc324947` is the commit that added this record, its
source-map entry and one paragraph of the door's record. The browser suites of the World matrix ran at `12d9b458` and
read none of those files. Every other pull-request job ran at `fc324947`, each step stopping at its first failing
command as a CI step does. The rows of the second table name their own commits; `b6008b2e` is the branch three commits
before `12d9b458`, and the CI entries, the source-map entries and the notices fix lie between the two. The commit that
added these tables changed nothing else in the repository.

Local differences from CI: Playwright 1.63.0 with its own Chromium 153 where the workflows pin 1.57.0; Cesium 1.131.0
from a local copy of the pinned build; PostgreSQL 16.15 binaries in place of the service containers; Deno 2.9.6; Python
3.13 where the building job pins 3.12. Node was 22.23.4, and 24.22.1 for `contracts`, as the workflows pin. One suite
failed and was run a second time before it was judged (`editorial-video-composer`, below); its failure is not one of
timing.

| Workflow | Job | Result |
| --- | --- | --- |
| Canonical Architecture Contract | architecture | PASS at fc324947: 12 of 12 steps (0 s) |
| Secret scan | scan | PASS at fc324947: 1 of 1 steps (5 s) |
| Control Plane Drift Guard | drift-contract | PASS at fc324947: 3 of 3 steps (0 s) |
| Production Security Contract | production-boundaries | PASS at fc324947: 12 of 12 steps; 23 tests, 23 passed, 0 failed (1 s) |
| MCP Continuity and Preview | contracts | PASS at fc324947 on Node 24.22.1: npm ci 39 packages, npm audit 0 vulnerabilities; Core check and 851 tests, 851 passed, 0 failed; Worker 1954 tests, 1945 passed, 0 failed, 9 skipped; MCP transport 8/8; root suite 2743 tests, 2736 passed, 0 failed, 7 skipped; Python 7 tests OK; Wrangler dry-run compiles both Workers (2866.09 KiB, gzip 642.84 KiB; 16.62 KiB, gzip 5.08 KiB); workerd HTTP contract 6/6 and 6/6 checks (101 s) |
| Reconciliation CI | Worker contracts | PASS at fc324947: 5 of 5 steps; 1954 tests, 1945 passed, 0 failed, 9 skipped; the merge-marker guard passes (22 s) **On `main`:** PASS at fc1986ec: 5 of 5 steps; 1907 tests, 1898 passed, 0 failed, 9 skipped. At bd38cb76, before the fix, this job failed on the branch at its last step: THIRD-PARTY-NOTICES had six lines of 80 equals signs. |
| Reconciliation CI | McCluster Core contracts | PASS at fc324947: 13 of 13 steps; 221 tests, 221 passed, 0 failed (6 s) |
| Reconciliation CI | Equity Uprise Edge Function contracts | PASS at fc324947: 2 of 2 steps (0 s) |
| Reconciliation CI | Admin evidence and pending SQL contracts | PASS at fc324947: 3 of 3 steps; 59 tests, 59 passed, 0 failed (10 s) |
| Reconciliation CI | Equity Uprise RLS wall and offline function contracts | PASS at fc324947: 3 of 3 steps; RLS wall on PostgreSQL 16.15: ALL PROMISES HELD, 39 ok notices, 0 not ok; 8 offline function suites ran to the end (brain, desk-flows, domain, flows, inbox-auth, mcp, platforms, price) (2 s) |
| Reconciliation CI | Supabase migration reset | NOT RUN HERE: it needs the Supabase CLI and Docker. What stands in for it is under "Could not run here". **On `main`:** success on main at fc1986ec in GitHub Actions on 2026-11-13 (150 s), for the 364 migrations before this branch |
| Site smoke gate | smoke | PASS at fc324947: 4 of 4 steps; the walk: 458 checks passed, 0 failed ("SMOKE CLEAN"); BLS inspector 3 PASS lines, 0 FAIL; workbench 74 tests, 74 passed, 0 failed (250 s) |
| Equity Uprise Core V2 CI | Validate authority, program, plans, and building | PASS at fc324947: steps 3 to 49, 46 of 46 pass (66 s), the source-map validator among them; after regeneration 3 files differ from the committed ones (equity-uprise-core-v2-plan-semantics-report.json, equity-uprise-floor-01-b1-simulation-report.json, equity-uprise-program-coverage-report.json), each only by the absolute path of the checkout it embeds; with that path replaced by the runner's, step 50 passes. As written, off the runner's path, step 50 always fails on those three files **On `main`:** at fc1986ec the job as written ends the same way here: 47 of 48 steps pass and the one that fails is [50] Require committed generated artifacts to be current (exit 1), on the same three reports that embed the checkout path |
| Analytics Platform CI | analytics-contract | PASS at fc324947: 3 of 3 steps; 42 tests, 42 passed, 0 failed (0 s) |
| Analytics Platform CI | collector-contract | PASS at fc324947: 1 of 1 steps (1 s) |
| Music Platform CI | music-contract | PASS at fc324947: 3 of 3 steps; 21 tests, 21 passed, 0 failed (1 s) |
| Music Platform CI | music-edge | PASS at fc324947: 1 of 1 steps (0 s) |
| Unified World feed and discussions | source-and-auth | PASS at fc324947: 1 of 1 steps; 35 tests, 35 passed, 0 failed (0 s) |
| Unified World feed and discussions | Isolated PostgreSQL role and rate-limit verification | PASS at fc324947: 2 of 2 steps (1 s) |
| Users Analytics CI | users-analytics | PASS at fc324947: 6 of 6 steps; 29 tests, 29 passed, 0 failed (1 s) |
| API Economic Core CI | Worker security boundaries | PASS at fc324947: 3 of 3 steps; 22 tests, 22 passed, 0 failed (0 s) |
| API Economic Core CI | Credits, billing, idempotency, rate-limit, and COGS regression | NOT RUN as a whole: steps 2 to 14 need the Supabase rebuild (Supabase CLI and Docker). Its two scratch-database steps ran on PostgreSQL 16.15: PASS at fc324947: bounty claim existence guard: ok; PASS: archive publication, claim/replay, owner edits, reseeding and API-role boundaries; PASS: three open missions, preserved proof access, idempotent acceptance, private arsenal and held CfAL draft (2 s) |
| Social hardening tests | worker-tests | PASS at fc324947: 3 of 3 steps; 1954 tests, 1945 passed, 0 failed, 9 skipped (20 s) |
| Music label artists | music-label | PASS at fc324947: 3 of 3 steps; 8 tests, 8 passed, 0 failed (2 s) |
| PRIM3 adaptive PostgreSQL acceptance | PRIM3 adaptive real PostgreSQL | PARTLY RUN: the unit step PASS at fc324947 (13 tests, 13 passed, 0 failed); the PostgreSQL and PostgREST step cannot run here (no Docker daemon, no PostgREST) |
| Halo Finance integration proof | finance | PASS at fc324947 with a stand-in for the Docker CLI (the fixture's docker run, docker exec psql and docker rm served by a disposable PostgreSQL 16.15; the workflow's image is postgres:17.6): unit 33 tests, 33 passed, 0 failed; the fixture's database permission tests passed; the globe-to-ledger run at 390 and 1280 px, 0 failed assertions, no sideways overflow (78 s) |
| Archive and mission browser acceptance | browser | PASS at fc324947: 40 PASS lines, 0 FAIL lines; 18 tests, 18 passed, 0 failed (30 s) |
| Control workspace visual proof | browser | PASS at fc324947: 3 of 3 steps; unit 219 tests, 219 passed, 0 failed; browser suites 1867 PASS lines, 0 FAIL lines (suite summaries: 76 site-health checks passed; 42/42 checks passed; 78/78 desk bot checks passed; 92/92 checks passed; 214/214 passed; 73/73 checks passed; all checks passed) (972 s) |
| City Arcade release checks | arcade | PASS at fc324947: 8 PASS lines, 0 FAIL lines; 105 tests, 105 passed, 0 failed (253 s) |
| Equity Uprise rendered building proof | Render B1–L7 at 390px | PASS at fc324947: 110 PASS lines, 0 FAIL lines; 19 tests, 19 passed, 0 failed; with playwright@1.57.0 from the registry (the suite refuses any other version: with the pre-installed 1.63.0 it stops at its own version assertion) driving the pre-installed Chromium 153 through the suite's CHROMIUM_EXECUTABLE (97 s) |
| Equity Uprise rendered building proof | Render B1–L7 at 1440px | PASS at fc324947: 110 PASS lines, 0 FAIL lines; 19 tests, 19 passed, 0 failed; with playwright@1.57.0 from the registry (the suite refuses any other version: with the pre-installed 1.63.0 it stops at its own version assertion) driving the pre-installed Chromium 153 through the suite's CHROMIUM_EXECUTABLE (264 s) |
| Site accessibility ratchet | axe | PASS at fc324947: axe ratchet: 66 pages at or below baseline (138 s) |
| Curated World release proof | world-release-390 | PASS at fc324947: 113 PASS lines, 0 FAIL lines; 46 tests, 46 passed, 0 failed (150 s) |
| Curated World release proof | world-release-820 | PASS at fc324947: 113 PASS lines, 0 FAIL lines; 46 tests, 46 passed, 0 failed (191 s) |
| Curated World release proof | world-release-1280 | PASS at fc324947: 125 PASS lines, 0 FAIL lines; 46 tests, 46 passed, 0 failed (266 s) |
| Human Uprise responsive visual proof | browser (database) | PASS at 12d9b458: PASS: journey CRUD, two-owner isolation, anonymous denial and server-side validation (PGlite 0.3.14) (1 s) |
| Human Uprise responsive visual proof | browser (editorial-iphone-portrait) | PASS at 12d9b458: 186/186 checks passed by the suite's own count; 186 PASS lines, 0 FAIL lines (885 s) |
| Human Uprise responsive visual proof | browser (editorial-iphone-landscape) | PASS at 12d9b458: 111/111 checks passed by the suite's own count; 111 PASS lines, 0 FAIL lines (389 s) |
| Human Uprise responsive visual proof | browser (editorial-ipad-portrait) | PASS at 12d9b458: 111/111 checks passed by the suite's own count; 111 PASS lines, 0 FAIL lines (389 s) |
| Human Uprise responsive visual proof | browser (editorial-ipad-landscape) | PASS at 12d9b458: 111/111 checks passed by the suite's own count; 111 PASS lines, 0 FAIL lines (437 s) |
| Human Uprise responsive visual proof | browser (editorial-desktop) | PASS at 12d9b458: 128/128 checks passed by the suite's own count; 128 PASS lines, 0 FAIL lines (706 s) |
| Human Uprise responsive visual proof | browser (editorial-video-composer) | NOT COMPLETED HERE, and the same on main: at 12d9b458 seven checks pass, then the suite's own screenshot of the posted card times out after 30 s, before its last check (two runs, 72 s and 73 s, load average 4.35 and 4.46 on 4 CPUs); the suite recorded no page error. A per-frame probe of the same scenario found the card's box unchanged and only 4 frames drawn in 4 seconds, and a whole-page screenshot timed out as well: the local Chromium 153 with software WebGL stops producing frames in this scenario, the card does not move. With playwright@1.57.0 driving the same Chromium the suite stops earlier, at its first navigation wait (15 s). **On `main`:** at fc1986ec the same seven checks pass and the same screenshot statement times out (84 s); with playwright@1.57.0 the same early stop. In GitHub Actions this suite last passed on 2026-11-13 (225 s) with the pinned Playwright 1.57.0 and its own Chromium 143. |
| Human Uprise responsive visual proof | browser (travel-iphone-portrait) | PASS at 12d9b458: 32/32 checks passed by the suite's own count; 32 PASS lines, 0 FAIL lines (109 s) |
| Human Uprise responsive visual proof | browser (travel-iphone-landscape) | PASS at 12d9b458: 32/32 checks passed by the suite's own count; 32 PASS lines, 0 FAIL lines (122 s) |
| Human Uprise responsive visual proof | browser (travel-ipad-portrait) | PASS at 12d9b458: 32/32 checks passed by the suite's own count; 32 PASS lines, 0 FAIL lines (135 s) |
| Human Uprise responsive visual proof | browser (travel-ipad-landscape) | PASS at 12d9b458: 32/32 checks passed by the suite's own count; 32 PASS lines, 0 FAIL lines (137 s) |
| Human Uprise responsive visual proof | browser (travel-desktop) | PASS at 12d9b458: 34/34 checks passed by the suite's own count; 34 PASS lines, 0 FAIL lines (156 s) |
| Human Uprise responsive visual proof | browser (guest-travel) | PASS at 12d9b458: 152 PASS lines, 0 FAIL lines (216 s) |
| Human Uprise responsive visual proof | browser (member-desk) | PASS at 12d9b458: 60/60 checks passed by the suite's own count; 60 PASS lines, 0 FAIL lines (28 s) |
| Human Uprise responsive visual proof | browser (music-world) | PASS at 12d9b458: 117 PASS lines, 0 FAIL lines (33 s) |
| Human Uprise responsive visual proof | browser (news-guest) | PASS at 12d9b458: 22/22 checks passed by the suite's own count; 22 PASS lines, 0 FAIL lines (38 s) |
| Human Uprise responsive visual proof | browser (navigation) | PASS at 12d9b458: 429 PASS lines, 0 FAIL lines (212 s) |
| Human Uprise responsive visual proof | browser (creator-onboarding) | PASS at 12d9b458: 85 ok lines, 0 failed (14 s) |
| Human Uprise responsive visual proof | browser (mission-pins) | PASS at 12d9b458: 11/11 checks passed by the suite's own count; 11 PASS lines, 0 FAIL lines (3 s) |
| Human Uprise responsive visual proof | browser (world-missions-guest) | PASS at 12d9b458: 246/246 checks passed by the suite's own count; 246 PASS lines, 0 FAIL lines (353 s) |
| Human Uprise responsive visual proof | browser (world-first-visit) | PASS at 12d9b458: 83/83 checks passed by the suite's own count; 83 PASS lines, 0 FAIL lines (171 s) |
| Human Uprise responsive visual proof | browser (world-gate) | PASS at 12d9b458: 557/557 checks passed by the suite's own count; 557 PASS lines, 0 FAIL lines (1774 s) |
| Human Uprise responsive visual proof | browser (sign-in) | PASS at 12d9b458: 174/174 checks passed by the suite's own count; 174 PASS lines, 0 FAIL lines (945 s) |
| Human Uprise responsive visual proof | browser (world-countries) | PASS at 12d9b458: 34 PASS lines, 0 FAIL lines (185 s) |
| Human Uprise responsive visual proof | browser (world-globe-feed) | PASS at 12d9b458: 74 PASS lines, 0 FAIL lines (475 s) |
| Human Uprise responsive visual proof | browser (world-transport) | PASS at 12d9b458: the suite asserts in code and prints one record per state: 6 records at 390, 820, 1280 px, 0 with a failed flag, overflow or page error (193 s) |
| Human Uprise responsive visual proof | browser (anti-social) | PASS at 12d9b458: 24/24 checks passed by the suite's own count; 24 PASS lines, 0 FAIL lines (31 s) |
| Human Uprise responsive visual proof | browser (human-uprise-door) | PASS at 12d9b458: 122/122 checks passed by the suite's own count; 122 PASS lines, 0 FAIL lines (146 s) |
| Human Uprise responsive visual proof | browser (policy-mode) | PASS at 12d9b458: 39/39 checks passed by the suite's own count; 39 PASS lines, 0 FAIL lines (24 s) |
| Human Uprise responsive visual proof | browser (owner-halo-globe) | PASS at 12d9b458: 35/35 checks passed by the suite's own count; 35 PASS lines, 0 FAIL lines (89 s) |
| Human Uprise responsive visual proof | browser (world-environment) | PASS at 12d9b458: 11 PASS lines, 0 FAIL lines (16 s) |
| Human Uprise responsive visual proof | browser (environment-globe) | PASS at 12d9b458: 127 PASS lines, 0 FAIL lines (316 s) |
| Human Uprise responsive visual proof | browser (environment-world) | PASS at 12d9b458: 211 PASS lines, 0 FAIL lines (500 s) |
| Human Uprise responsive visual proof | browser (environment-unit) | PASS at 12d9b458: 191 tests, 191 passed, 0 failed (30 s) |

Also run, though no pull-request job runs them:

| Workflow | Job | Result |
| --- | --- | --- |
| Cloudflare Pages public-export security contract | safe-static-export (not started by this pull request: none of its paths changed) | PASS at fc324947: 2 of 2 steps; 6 tests, 6 passed, 0 failed (5 s) |
| Compute Node CI (dispatch only) | Browser executor against real Chromium | PASS at 12d9b458: 51 tests, 51 passed, 0 failed (18 s) |
| no workflow (local only, by consent) | native proof: replay twin, ledger rows 365 to 376 | PASS at fc324947: eu platform replay native: 45 passed on PostgreSQL 16.15 (7 s) |
| no workflow (local only, by consent) | native proof: mission catalog, import parts, publish and rollbacks | PASS at fc324947: mission catalog native: 156 passed on PostgreSQL 16.15 (1 s) |
| no workflow | pending compute_claim_task_yield_v3 on PGlite | PASS at 12d9b458: the v3 function, its rollback, re-apply and second behaviour run: PASS (3 s) |
| no workflow | the globe-games browser suite (changed on this branch) | PASS at 12d9b458: 80/80 checks passed by the suite's own count; 80 PASS lines, 0 FAIL lines (199 s) |
| no workflow (never in one) | world-screen scope E2E_ONLY=stall | FAIL (exit 1) at b6008b2e: 1 PASS, 2 FAIL, then the run stops waiting for #mnFinishGo (30 s timeout) (51 s) **On `main`:** FAIL (exit 1) at fc1986ec: 1 PASS, 2 FAIL, then the run stops waiting for #mnFinishGo (30 s timeout) (50 s) |
| no workflow (never in one) | world-screen scope E2E_ONLY=guest- | FAIL (exit 1) at b6008b2e: 3 PASS, 3 FAIL, then the run stops waiting for [data-world-chip="regional"] (30 s timeout) (49 s) **On `main`:** FAIL (exit 1) at fc1986ec: 3 PASS, 3 FAIL, then the run stops waiting for [data-world-chip="regional"] (30 s timeout) (51 s) |
| no workflow (never in one) | world-screen scope E2E_ONLY=layers | FAIL (exit 1) at b6008b2e: 0 PASS, 1 FAIL, then the run stops waiting for #ctlFlights (30 s timeout) (39 s) **On `main`:** FAIL (exit 1) at fc1986ec: 0 PASS, 1 FAIL, then the run stops waiting for #ctlFlights (30 s timeout) (42 s) |
| no workflow (never in one) | world-screen scope E2E_ONLY=member-interactions | FAIL (exit 1) at 12d9b458: 14 PASS, 1 FAIL, then the run stops waiting for #mnSearchInput (30 s timeout) (71 s) **On `main`:** FAIL (exit 1) at fc1986ec: 14 PASS, 1 FAIL, then the run stops waiting for #mnSearchInput (30 s timeout) (69 s) |
| no workflow (never in one) | world-screen scope E2E_ONLY=member-not-creator | PASS at 12d9b458: 3 PASS, 0 FAIL (20 s) **On `main`:** PASS at fc1986ec: 3 PASS, 0 FAIL (17 s) |
| no workflow (never in one) | world-screen scope E2E_ONLY=mission-archive | PASS at 12d9b458: 6 PASS, 0 FAIL (25 s) **On `main`:** PASS at fc1986ec: 6 PASS, 0 FAIL (21 s) |
| no workflow (never in one) | world-screen scope E2E_ONLY=news-member | FAIL (exit 1) at 12d9b458: 6 PASS, 1 FAIL (30 s) **On `main`:** FAIL (exit 1) at fc1986ec: 6 PASS, 1 FAIL (31 s) |
| no workflow (never in one) | world-screen scope E2E_ONLY=travel-location | PASS at 12d9b458: 6 PASS, 0 FAIL (10 s) **On `main`:** PASS at fc1986ec: 6 PASS, 0 FAIL (9 s) |
| no workflow (never in one) | world-screen scope E2E_ONLY=travel-errors | FAIL (exit 1) at 12d9b458: 1 PASS, 0 FAIL, then the run stops waiting for #wtTo (30 s timeout) (45 s) **On `main`:** FAIL (exit 1) at fc1986ec: 1 PASS, 0 FAIL, then the run stops waiting for #wtTo (30 s timeout) (46 s) |
| no workflow (never in one) | world-screen scope E2E_ONLY=travel-fallback | PASS at 12d9b458: 3 PASS, 0 FAIL (6 s) **On `main`:** PASS at fc1986ec: 3 PASS, 0 FAIL (5 s) |
| no workflow (never in one) | world-screen scope E2E_ONLY=travel-rides | PASS at 12d9b458: 4 PASS, 0 FAIL (4 s) **On `main`:** PASS at fc1986ec: 4 PASS, 0 FAIL (4 s) |

Found and fixed in this preparation:

- **"Worker contracts" failed on the branch** and passes on `main`: its last step refuses any tracked line that starts
  with seven `=`, and `THIRD-PARTY-NOTICES`, added on this branch, drew its six section rules that way. On the merge
  commit that is a red gate check with the Worker already live and Pages refusing. The rules are now rows of `#`, and
  `scripts/test/merge-marker-guard.test.mjs` runs the gate's own command in the root suite.
- **"Validate authority, program, plans, and building" failed on the branch** and passes on `main`: sixteen World files
  had no entry in the Equity Uprise source map. They are classified, and the validator exits 0 (with this record
  mapped: 746 candidates, 2,882 of 2,882 checks).
- **The door's two browser suites and the Control Room's AI browser suite ran in no workflow.** They do now
  (`human-uprise-editorial.yml`, `control-workspace-visual.yml`).

Every test file the branch adds runs in a pull-request job, with these exceptions, each as its kind was before:

- `core/test/*.test.mjs` run in `contracts` (`npm test` in `core/`); there the browser executor's real-Chromium tests
  skip without Playwright, by design, and the job that requires them (`compute-node-ci.yml`) runs on dispatch only.
  They ran here against real Chromium (the second table).
- `scripts/test/eu-platform-replay.native.integration.mjs` and `scripts/test/mission-catalog.native.integration.mjs`
  run in no workflow, like the native proofs before them: their harness starts a database server on the machine and is
  local only, by consent (`scripts/test/support/native-postgres.mjs`). Both ran here (the second table).
- `supabase/tests/compute_claim_task_yield.behaviour.sql` runs through `scripts/compute-lease-yield-sql-check.mjs`,
  which no workflow runs while the SQL is pending. It ran here (the second table).

Not regressions, recorded as they are: eleven scopes of `scripts/e2e/world-screen.e2e.mjs` run in no workflow, and
`git log -S` finds none of them in a workflow anywhere in the history of `main`. Five pass on this branch as on `main`
(`member-not-creator`, `mission-archive`, `travel-location`, `travel-fallback`, `travel-rides`). Six fail, each exactly
as on `main`: `stall`, `guest-`, `layers`, `member-interactions`, `news-member` and `travel-errors` (the second table
has the counts and the control each run stops at). They expect controls and states that `main` itself no longer shows.
Updating or retiring them is a decision of its own; nothing was skipped, switched off or quarantined to reach any
result here.

## Could not run here

| Job | Why | What stands in |
| --- | --- | --- |
| Reconciliation CI, "Supabase migration reset" (a deploy-gate check) | It needs the Supabase CLI and Docker | It passed on `main` at `fc1986ec` (2026-11-13) for the 364 rows before this branch's. For the twelve rows after them: the native replay proof ran the repository's own reset script from row 365 to 376 on PostgreSQL 16.15 and compared every relation, function, policy and trigger the twelve files create or change with production's snapshot, row for row (45 of 45 checks). The manifest differs from the one on `main` by exactly those rows, 45 added and 3 changed, and each equals the snapshot's row. The twelve files carry their own `begin` and `commit`, as eleven files on `main` do. The two join tests the job runs after its rebuild passed here against the join functions before and after the join-scope migration. Not run: the rebuild of the 364 earlier rows on the Supabase stack, the manifest comparison itself, and the analytics, ingestion and lease checks of that job. |
| API Economic Core CI, "Credits, billing, idempotency, rate-limit, and COGS regression" | The same rebuild | Its two scratch-database steps ran (the first table). Its SQL suites name none of the objects the twelve files add or change, and the branch changes none of the files those suites read. |
| PRIM3 adaptive PostgreSQL acceptance, the PostgreSQL and PostgREST step | It needs Docker and PostgREST | Its unit step ran (the first table). The workflow starts only because the branch adds files under `supabase/migrations/`; the step reads three stubs, one earlier migration and one pending file, and the branch changes none of them nor any PRIM3 file. |
| Halo Finance integration proof, on the workflow's own database image | There is no Docker daemon here | The job ran whole with a stand-in for the Docker CLI: the fixture's `docker run`, `docker exec ... psql` and `docker rm` were served by a disposable PostgreSQL 16.15, where the workflow pins the `postgres:17.6` image (the first table). |
| Equity Uprise rendered building proof, on the pre-installed Playwright | The suite refuses any Playwright but 1.57.0 | It ran with `playwright@1.57.0` from the registry driving the pre-installed Chromium 153 through the suite's own `CHROMIUM_EXECUTABLE` (the first table). |
| Human Uprise responsive visual proof, `browser (editorial-video-composer)` | The local Chromium stops drawing frames in this scenario: after seven passing checks the suite's own screenshot of the posted card times out, on this branch and on `main` alike | Seven of its eight checks pass on the branch as on `main`, and the suite recorded no page error, which is what its last check asks. In GitHub Actions the suite last passed on 2026-11-13 with the pinned Playwright 1.57.0. |
| "Require committed generated artifacts to be current", as written | Three generated reports embed the absolute path of the checkout, so off the CI runner's path they always differ; the same on `main` | With the checkout path replaced by the runner's, the step passes: every regenerated artifact is the committed file (the first table). |

## Decisions still open for the owner

1. **Pull request #760** ("Privacy consent: Agree & continue or Go back", head `8c7d60db`, 2026-11-05) puts a blocking
   privacy screen on every page. A trial merge here (`git merge-tree`, nothing written) shows it merges cleanly into
   `main` today and conflicts with this branch in `js/live-content.js`. On the World its wall is against the 2026-11-17
   decision, which `scripts/test/world-privacy-banner.test.mjs` pins. Close it, or rework it to leave the World's
   banner: the owner has been asked.
2. **The lyric line and explicit language.** While music plays, the World's headline shows the song's words line by
   line (`js/world-audio-continuity.js`, `data/lyrics/`), to a signed-out visitor too, and some of those songs use
   explicit language. This release does not touch the music preference or the lyric line. Decide what a guest may be
   shown.
3. **The door's open questions** in `docs/design/WORLD-SIGN-IN-DOOR.md` (thirteen are listed; the Redirect URLs half of
   the twelfth is answered, its Site URL half is not): the door over the World or in its place, whether a line takes the
   tagline's place, the new words, the counts, the typeface, the crest's place, "← Back" on a phone, the bar's Sign in,
   the music controls under the door, the rally photographs, members by country, Google and Apple.
4. **`FIRMS_MAP_KEY`.** Whether the Worker has it is not recorded anywhere this repository can read. Without it the fires
   layer answers `not_configured` once the module is on.
5. **The environmental module:** when to install and enable it, and whether `20261107120000_world_environment_v1.sql`
   goes first (the 2026-11-09 release record held it for admin-only scope).
6. **Larger exports of the crest.** The door shows the supplied 160 px white mark at 52 px so it stays sharp. A mark is
   never drawn or upscaled; exports of 480 px or more of both variants would let it be shown larger.
7. **Carried from the door's verification, each a design choice, none a defect:** no pulse card where the stage is too
   short (a phone's Create account with the banner, a tablet on its side); with the banner waiting, the action needs a
   scroll at 320 x 640 and at 1024 x 768 in Create account; the door's stylesheet is render-blocking (53 KB, 13 KB
   compressed) so the door paints whole in its first frame.
8. **Carried from the feed's review:** every country counts every open mission until pins exist, and the pin card's Join
   does not yet keep `?mission=` for a guest, so pins wait for that work; after a step of the environmental tour the
   Next and Previous controls scroll out of view with the card.
9. **Deploy controls:** accept for this release that the Worker deploys before CI, or first move to the gated GitHub
   deploy (`docs/control-plane/DEPLOYMENT-CONTROLS-PROPOSAL.md`); and whether the World browser matrix and "Validate
   authority, program, plans, and building" become required checks.
10. **Global Privacy Control and an agreed visitor** (security review SEC-5; already so on `main`, and `js/analytics.js`
   and `privacy.html` are unchanged by this release). With Global Privacy Control on, before any answer nothing is
   stored or sent; after "I agree & continue", the next page stores a device id and a session id and `POST /v1/collect`
   carries `device_id` and `session_id`, while `privacy.html` says the signal is honoured "before sending anything" and
   that recording of the device identifier and the session stops. Decide which is true: the browser skips creating and
   sending the device and session ids whenever the signal is on, or the policy says the server discards them (whether
   the collector does was not read).
11. **Project Drawdown's source page** (`docs/control-plane/WORLD-MISSION-SOURCES.md`, "What stays gated"): D1 to D14 and the six
   further choices, each a default adopted pending his confirmation (the owner-only route, no admin clause in the read policy,
   Show only with his recorded confirmation, the door at the foot of the mission dialog, no figures under the name, the
   restrictive authenticity-check policy not staged); the written permission: where it is kept and whether it covers a page
   headed by Project Drawdown's name on McCluster Corp's platform, the 87 quotations there and the citation; "McCluster Corp,
   which runs this platform" as the maker; a restrictive insert policy on `authenticity_checks` so no member can name a
   source's organization (a member can today, which makes the rollback refuse); a plainer corrections door on `/company`;
   whether to stage the quotations' withdrawal and an attribution-removal template now; whether to replace
   `solutions-catalog.json` in the tree with a copy without excerpts or image addresses; the area map and the facts' words;
   phase 2.

## Status

| Part | Source on the branch | Merged to `main` | Deployed | Verified here |
| --- | --- | --- | --- | --- |
| The feed's row, missions as posts, the dialog, shared links | yes | no | no | fixtures, in a browser at 390, 820 and 1280 |
| The country card and Local missions | yes | no | no | fixtures, in a browser |
| The sign-in door and the onboarding pages | yes | no | no | fixtures, in a browser, by night and by day |
| The first visit: the banner, analytics off until agreement | yes | no | no | fixtures, in a browser, nothing stored first |
| The retired tagline | yes | no | no | root test over the published tree and the Worker |
| The Environmental Justice panel, posts and globe layers | yes | no | no; and off behind the module policy | fixtures only; production has never answered |
| The Worker's layer routes | yes | no | no | Worker tests; compiled by the locked Wrangler; `workerd` contract |
| The Control Room's image and browser controls | yes | no | no | fixtures, in a browser, against both Cores' declarations |
| The Core and laptop work | yes | no | no; needs the OVH promotion | Core tests; not part of this release |
| The twelve applied migrations, ledger 376 | yes (records) | no | applied in production before this record | drift check; replay proof; production not read again |
| The publish of the 125 missions | yes (pending SQL) | no | **not applied** | native proof on PostgreSQL 16.15 |
| The CI entries and the source map | yes | no | not applicable | the jobs' own commands, here |
| The release review's fixes (2026-11-19) | yes | no | no | unit tests and browser suites at `5d801add`, each test failing at `a8d2502d` without its fix but RM-7's ("Fixed after the release review") |
| Project Drawdown's source page | yes | no | no; SQL not applied, page not shown | unit tests, PGlite and native proofs, Worker tests, browser fixtures (the Control card, and the World's page at 390, 820, 1280 and 844x390 by night and day) |
