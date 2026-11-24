# Handoff to Codex, 2026-11-23

Matthew (the owner) asked for this on 2026-11-23, when his weekly usage was close to its limit: "have a handoff
ready for codex to finish what you started and bring it home". This file is the single entry point. Everything it
names is in this repository; nothing depends on the earlier session's private files.

The **Status** section at the bottom is updated at the end of the earlier session. If it disagrees with the body,
the Status section wins, and GitHub wins over both: check `git ls-remote`, the pull requests and
`GET https://api.mccluster.org/v1/health` before you act.

## 0. Read first

1. `AGENTS.md` completely (the law), then `CODEX.md` and `docs/control-plane/ECOSYSTEM.md`.
2. This file, then `OWNER-DIRECTIONS-AND-STATUS.md` in this folder: Matthew's own words of 2026-11-23 and the
   reading of each, plus the status lines the earlier session kept. Treat his words as the requirements.
3. The spec for the stream you pick up, in `specs/`. The specs were written read-only against the code of
   2026-11-23; their `file:line` references point at that code, so re-check each one before you edit. Where a spec
   names local evidence of the earlier session, that evidence is gone; the spec's own text carries its findings.

## 1. Rules that bind you (from the law and Matthew's standing instructions)

- **Evidence ladder.** Source, local tests, CI, merged, deployed, verified on the live site. Report each level
  separately and never claim one you did not see.
- **Production database** (Supabase `zmnhbrjyhxzhkxmhkexs`) is read-only for you unless Matthew approves that exact
  change in his own words. Never replay an applied migration, never delete an applied migration file or a
  `schema_migrations` row, never run all of `supabase/pending`. An approved change is applied by the owner's tooling
  and then recorded with the pattern in `supabase/pending/PROMOTION-ORDER.md`.
- **Git.** Never force-push or rewrite pushed history. Commit by path, with plain messages. Merging to `main`
  deploys: Worker `mccluster` through Cloudflare's Git integration, and GitHub Pages through
  `.github/workflows/deploy-pages.yml` once the deploy-gate checks are green.
- **Public repository.** No secrets, keys or tokens; none of the owner's personal data (email, phone, address); no
  server IP addresses or hostnames; no Windows paths; no raw AI transcripts.
- **The closing song.** Never write the title of the last song of the CIA Mind Control album anywhere. Call it "the
  closing song".
- **Logos.** Never draw, trace, crop or recolour a logo (`AGENTS.md`, "THE LOGOS ARE NOT YOURS TO DRAW").
- **Mobile first.** `min-width` queries only, `minmax(0,1fr)` never a bare `1fr`; check at 390 px that
  `document.documentElement.scrollWidth === clientWidth`.
- **Two entities.** McCluster Corp and Matthew McCluster stay separate in metadata and structured data, even when
  one site serves both. No `@id` moves.
- **Live probes** of production are GET or HEAD only.
- **Browser suites** run in Chromium, one at a time (they share ports and fixtures).
- **Talking to Matthew.** Short plain sentences, no internal codes, at most one question. His rule: "anything I
  confirm, get it done". He approved shipping finished, checked work ("ship it all baby").

## 2. Where everything stands (2026-11-23, about 21:10 UTC)

| Stream | State |
| --- | --- |
| Production | `main` at `b51ede03`, live: `GET https://api.mccluster.org/v1/health` answered `deployment_sha` `b51ede03a4faefe000749ec71630b1a584146fed`. |
| Production database | Ledger of 384 rows. The four 2026-11-23 migrations (the network-connections consent guard; environment events parts 03, 04 and 05) were applied with Matthew's approval and are recorded on the working branch (`0ef1481c`). Matthew attested in person that Project Drawdown permitted the quotes on their page (recorded in `30503182`). |
| Working branch `claude/new-session-83ken5` | At `0ef1481c` before this handoff commit, 25 commits ahead of `main`: the music fixes M3 and M3 follow-up (independently verified; their last commit is `dc0185aa`), M5's one-player shell (`2000c609`, `5d8c533e`: built, not reviewed), and the two record commits. |
| Known regression on the working branch | `workers/mccluster/test/analytics-creator-attribution.test.mjs` fails with "MCC_PAGE_IDENTITY is not defined" from `2000c609` on (it passes at `dc0185aa`). The fix is designed in `specs/SPEC-ENGINE.md` section 9 (stage 0). Run the whole Worker suite after it. |
| Release 1 | Branch `claude/release-20261123`: `dc0185aa` (M3 and M3 follow-up, without M5) plus cherry-picks of `30503182` and `0ef1481c`, the ingest switch (`EUP_ENVIRONMENT_USGS_INGEST_ENABLED = "true"` in `workers/mccluster/wrangler.toml`, with `workers/mccluster/test/eup-environment-usgs.test.mjs` asserting the approved value) and release notes. See Status. |
| Release dock fix | See section 3.A.2 and Status. |
| Music quick wins Q1 to Q7 | Built and self-tested; independent review and verification never ran. A snapshot of the work is `patches/QW-quick-wins-snapshot.patch` (base `5d8c533e`). See Status. |
| One engine, one player | Spec only: `specs/SPEC-ENGINE.md` and `specs/BAR-RESTORE.md`. Not started. |
| Platform move | Spec only: `specs/SPEC-PLATFORM.md`. Its first stage was started and stopped at its first step; nothing from it was pushed. |
| Unfinished earlier work | `patches/` (see `patches/README.md`). |

## 3. What to do, in order

### A. Ship Release 1

1. If `claude/release-20261123` is not on GitHub, rebuild it exactly as the table says: from `dc0185aa`, cherry-pick
   `30503182` and `0ef1481c`, set the ingest switch to `"true"` and make the USGS ingest test assert it, and add a
   short shipped note to `docs/music/MUSIC-RELEASE-20261119.md`. Do not include M5 (`2000c609`, `5d8c533e`).
2. **The dock fix.** Release 1 carries `73349a06`, which in the installed Home Screen app makes the red Music tab a
   second Pause beside the dock's own on the Listen page, and grows the dock to two rows while it says Muted.
   Required:
   - One Play/Pause in the installed dock on every page. Where the page makes the red Music tab the music's
     Play/Pause (Listen, the album), the dock hides its own Play/Pause; elsewhere the dock keeps its own and the
     Music tab is navigation. The control that plays or pauses shows the truthful glyph and accessible name.
   - Muted is said in the song line's second line; the dock stays one row (46 px).
   - The short trouble states (Reconnecting…, Connection lost · tap play, Loading…, Could not load · tap play) keep
     the status row while they last (`specs/BAR-RESTORE.md` 4.4: their words do not fit the song line).
   - The ordinary browser bar, the World and the lock screen are unchanged.
   - Tests in `scripts/e2e/installed-app.e2e.mjs` at 390 and 320 px, failing before the fix and passing after; then
     the installed-app, music-background and now-playing e2e suites and the root unit suite.
3. Open the pull request to `main`. CI must be green. Merge with a merge commit.
4. Verify: `deployment_sha` from `GET https://api.mccluster.org/v1/health` equals the merge commit; the Pages deploy
   run is green; `https://matthew.mccluster.org/listen.html` plays; the installed app shows one Pause.
5. Tell Matthew his steps in Control: System, E=Up, Environmental events, Sources, USGS, "Set the default rule".
   After the first healthy ingest run: Overview, Modules, Environment, then Preview, Install and Enable.

### B. Land the music quick wins

What they are (his words are in `OWNER-DIRECTIONS-AND-STATUS.md`):

- Q1 one McCluster artist profile ("McCluster is the artist"; not a house profile plus an artist profile).
- Q2 list albums and artists only; no playlists or house categories yet.
- Q3 whole covers, uniform squares.
- Q4 a creator is never told to "join as a creator".
- Q5 the closing song plays for no one except the owner's own play; pressing play opens a pop-up that says why.
- Q6 an album stops after its last song (a shuffle started by the World keeps going).
- Q7 the two measurement events Matthew approved (`music_interrupted` and the would-not-load event) are in the
  measurement dictionary, with the hold removed.

If the quick-wins commits are already on the working branch, run an independent review and verification (they
never ran). If they are not, apply the snapshot on its base (`git apply --3way` on `5d8c533e`), run the tests,
finish the record section in `docs/music/MUSIC-RELEASE-20261119.md`, the CI wiring and the source map rows, push,
then review and verify. Tests: `node --test scripts/test/music-quick-wins.test.mjs`, the root unit suite, and the
e2e suites music-quick-wins, music-shell, music-background, now-playing, installed-app, music-world-continuity and
human-uprise-door.

### C. After Release 1 merges

Merge `main` back into `claude/new-session-83ken5` with a merge commit (expect it to be clean: the release commits
are cherry-picks of branch commits).

### D. Release 2

The quick wins, M5 with its stage 2 off (`ROUTES.album = { top: false, view: false }`, `specs/SPEC-ENGINE.md` 4.10;
Matthew rejected two players behind one bar), and the analytics regression fix, with the whole Worker suite green.
Same routine as A.3 to A.4.

### E. One engine, one player, everywhere

Build `specs/SPEC-ENGINE.md` stages 0 to 4 with the bar of `specs/BAR-RESTORE.md`. Matthew's answers, already given:

- "I want a singular fucking music engine with 1 fucking player at all times": one audio element, one Now sheet,
  one set of controls; the album page keeps no deck of its own.
- "Everything should be running on the player, every page, the front page, back page": `index.html` joins the
  one player (he named the front page, so hard rule 3 allows it).
- Shuffle plays count as plays.
- "If you go to the world ... and you click on the globe and you're already playing a song, it shouldn't change
  the song you have or the order of the songs you have": the shuffle starts only when nothing is held.
- One mute for the World and Music. Google and Apple sign-in must not end the song (a pop-up). After sign-in, return
  to the music. Move the Sign in chip off the Now sheet's Album link.
- The bar is the compact "Before" bar he chose: Previous and the song line on the left, the tabs in the middle with
  the red Music tab as the one Play/Pause, Next and Sound on the right; on every page, browser and installed.

Ordering with the platform move: engine stages 0 and 1 can run beside platform P0 (who owns which file:
`specs/SPEC-PLATFORM.md` section 5); platform P1 lands before engine stage 2.

### F. The platform move

Matthew: "let's just have the whole site on mccluster.org instead, and matthew.mccluster.org be my profile, my
personal profile ... the real shit should be equityuprise.com ... We must prepare without breaking anything to do
that." `specs/SPEC-PLATFORM.md` has the stages (P0 prepare with no visible change, P1 the platform serves every
page, P2 canonicals and sitemaps, P3 the profile host answers 301s, P4 clean-up, F equityuprise.com later), the exact
law text (section 3) and the tests.

The defaults Matthew was given for the spec's five questions (his to change):

1. `matthew.mccluster.org` keeps opening on his HERE page.
2. His person pages (profile, résumés, engineering, portfolio, card, press, photography, films) stay on his host.
3. The AI-crawler policy of each host stays as it is today.
4. `humanuprise.com` sends people to the platform once it is routed.
5. The Home Screen app added from `mccluster.org` opens on the World.

### G. Matthew's backlog, in his order

1. Creator Studio v2: album (multi-song) upload through the existing submission path, a beautiful interface built
   mobile first, lyric control after upload. `patches/M6-*` hold the 2026-11-19 Creator Studio publish work.
2. While a song plays, the background becomes the universe: a Cesium globe spinning, the solar system, stars that
   pulse to the beat. Not interactive. Drive it from the peaks data, not Web Audio, so background playback on iPhone
   stays safe; respect reduced motion; pause when hidden.
3. Silence trim: detect long silent tails at build time, show the trimmed length, count listens on it.
4. The closing song's full gate: sign-in, a full profile (name, full address, full phone) and a short
   questionnaire, then it plays; owner-only storage. This needs new SQL: Matthew approves it before it is applied.
5. Collaboration with full track-outs (the consent guard it needs is live).
6. A granular sweep of the music experience: every small rough edge, fixed with a test each.
7. Then: Project Drawdown (restore the 87 quotes removed in PR #819 and finish the source page;
   `patches/B2-drawdown-source-page.patch`), the environmental timeline S6 to S8
   (`patches/S6-shared-selection-time-cursor.patch`, design in `docs/control-plane/EUP-EVENT-TIMELINE.md`), and the
   promotion of McCluster Core to OVH (`deploy/ovh-production` is far behind `main`;
   `.github/workflows/promote-ovh-production.yml`, `docs/control-plane/OVH-510-CONTRACT-AND-AUTH-RUNBOOK.md`).

### H. Steps only Matthew can take

- The Control steps of A.5.
- Locking down his server's private network. Step 1 is his: strong sign-in on every account, proving the OVH
  console login, a read-only baseline script on the server, a port check from outside, and the state of the OVH
  Edge Network Firewall. The plan was sent to him privately and is deliberately not in this public repository. Ask
  him for it if you help, and never commit server addresses.
- The platform move's provider steps: Google Search Console and the Supabase Site URL after P2; Cloudflare (an SSL
  rule, proxying the `matthew` record, the Worker route) at P3; moving `equityuprise.com`'s DNS later.
- Approving any production SQL.

## 4. Commands the earlier session used

```bash
node --test scripts/test/*.test.mjs                       # root unit suite
(cd workers/mccluster && npm test)                        # the whole Worker suite, as CI runs it
node --test scripts/test/domain-architecture.test.mjs
node scripts/music-peaks.mjs --check
node scripts/music-artwork.mjs --check
node scripts/music-track-lengths.mjs --check
python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py   # source map
node scripts/e2e/installed-app.e2e.mjs      # one browser suite at a time; others in scripts/e2e/
```

Every new file whose text names the program must get a row in
`docs/design/equity-uprise-building/production/equity-uprise-repo-source-map-v2.json`, or the source map check
fails. Every new test file must be run by a CI workflow job.

## 5. This folder

| Path | What it is |
| --- | --- |
| `CODEX-HANDOFF.md` | This file. |
| `OWNER-DIRECTIONS-AND-STATUS.md` | Matthew's words and decisions of 2026-11-23, with the earlier session's status lines. |
| `specs/SPEC-ENGINE.md` | One engine, one player, everywhere: design, stages, tests. |
| `specs/BAR-RESTORE.md` | The compact bar Matthew chose, exactly, and its history. |
| `specs/SPEC-PLATFORM.md` | The whole site on one platform address, Matthew's profile as a tenant, equityuprise.com later. |
| `specs/SPEC-M5.md` | M5's design (one player across the music pages); its stage 2 was later rejected by Matthew. |
| `patches/` | Unfinished work saved as patches, with their bases (`patches/README.md`). |

## Status (updated by the earlier session, 2026-11-24, about 15:30 UTC)

Release 1 is merged and live. Everything else is on GitHub as a branch; nothing below is lost if a session ends.

| Work | Branch | Pull request | State |
| --- | --- | --- | --- |
| Release 1 | merged into `main` as `df21444f` (the branch at `3f12e039`) | #825, merged 2026-11-24 06:40 UTC | Live. `GET https://api.mccluster.org/v1/health` answered `deployment_sha` `df21444f42fa7226a8016f265c20ec2f112ca296` at 06:40:45 UTC. Site deploy: the deploy run `45342165555` passed the ten deploy-gate checks and finished green at 06:52 UTC; `HEAD https://matthew.mccluster.org/assets/audio/dealer-plates-b.m4a` answers 200 `audio/mp4` (it was 404 before), and `https://matthew.mccluster.org/listen.html` loads its scripts stamped `?v=df21444f42fa`. CI on the pull request was green except `environment-globe` (a timing check, 6,579 ms against a 6,500 ms budget on a slow runner; not a deploy gate, not in the diff; fixed on its own branch below). Matthew's steps in Control are section 3.A.5. |
| Release 1 follow-ups | `claude/release1-followups-20261124` (`4f7d283c`) | none | This session's fixes of the four findings (CX-1, CX-2, CI-1, CI-2). Matthew's `3f12e039` on the release branch fixed the same four first and shipped. The edges `3f12e039` left are carried into engine stage 0. Reference only: do not merge. |
| Music quick wins | `claude/new-session-83ken5` (`60d356f7`) | #826, closed | Independently verified: go at `60d356f7`. Ships in Release 2. Matthew's open decisions are listed in `OWNER-DIRECTIONS-AND-STATUS.md`. |
| Platform move P0 | `claude/new-session-83ken5` | none | Verified go. No visible change. Ships in Release 2. |
| Platform move P1 | `claude/platform-p1-20261124` (`a63e664e`) | none yet | The eight review items are fixed and re-proven at `c7183983`. Its final verification then found one more: on `matthew.mccluster.org` the bar's Music tab and the account chip opened `mccluster.org`, which stops a playing song (and fails `scripts/e2e/music-shell.e2e.mjs`, 103 of 113). Decision under Matthew's words ("prepare without breaking anything", "1 player at all times"): at P1 those links stay on his address; they move at P3. Fix round 2 (`a63e664e`) also adds the kept-song offer and a line phones can see; its final verification is running. Matthew: "keep it, ship P1 when it passes". Ships in Release 2. |
| One engine, stage 0 | `claude/engine-s0-20261124` (`2bb82abf`; base `d1375242`) | none | Built. Two reviews (music journeys; measurement and law) found items to fix; the fix round is running, then a verification. Ships in Release 2. |
| Globe e2e timing | `claude/globe-timing-20261124` (`2590754b`, from `df21444f`) | none | Verified: ship. The ripple checks in `scripts/e2e/environment-globe.e2e.mjs` read the deadline from `js/environment-ripple.js`'s own constants and excuse only the main-thread stall measured at the deadline (a 20 ms heartbeat in the frame), never the ripple's own work. Ships in Release 2. Found a separate globe defect, next row. |
| Globe: parked camera keeps rendering | not started | none | Once the camera parks, Cesium 1.131's heading/roll getters (read every tick because `js/action-globe.js` and `js/environment-layers.js` listen to `camera.changed`) drift `up` past EPSILON15, so `moveStart` fires with nothing moving and `js/globe-render-governor.js` renders continuously for 0.6 to 4.3 s. Fix in the governor (ignore sub-tolerance pose changes) or stop forcing the getter round trip; test that a parked camera gives no `moveStart` for 20 s. |
| Release 2 | to be cut from `main` by merging `claude/engine-s0-20261124`, `claude/platform-p1-20261124` (which carries this branch) and `claude/globe-timing-20261124` | to be opened | Quick wins, P0, M5 with album containment, engine stage 0, P1 and the globe timing fix. Same routine as section 3.A.3 to A.4. |
| One engine, next | after stage 0 | none | Matthew, 2026-11-24: "For #4 I think the world music and the other music should be on the same engine". Order: stage 1a (engine API, contexts, the bar's player, one mute), then stage 2 (the World on the engine: SPEC-ENGINE rows W1 to W5 and W7 to W11), then stage 1b (the album as a view, the other players as callers) with row W6. |
| Known failure on the working branch | | | Fixed: `workers/mccluster/test/analytics-creator-attribution.test.mjs` passes again from `1580bde5`. |
| Creator Studio publishing | `claude/wip-creator-studio-publish` | #828, draft | Unfinished (2026-11-19). |
| Project Drawdown source page | `claude/wip-drawdown-source-page` | #829, draft | Unfinished (2026-11-19). |
| Environmental timeline S6 | `claude/wip-eup-timeline-s6` | #830, draft | Unfinished (2026-11-19). |

If a branch is ahead of what this table says, the branch wins.
