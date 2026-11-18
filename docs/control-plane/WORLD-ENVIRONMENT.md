# Equity Uprise environmental World: review build

## Product and integration

Equity Uprise is the product; McCluster is the current host implementation.
Environmental Justice lives behind the Equity Uprise tab of the World feed's
strip (`#mnFeedScope`, key `equity`; owner, 2026-11-17, see
`WORLD-FEED-AND-MISSIONS-20261117.md`), above that tab's missions. From
2026-11-07 to 2026-11-17 it was a supplied-logo button in the centre
`.wt-world-modes` bar; that button is gone. It retains `mnWorldFrame` and its
Cesium viewer. Global (key `global`; labelled Everything from 2026-11-17 to
2026-11-18) remains the feed's default. Missions are public; Travel remains
owner-only, and the existing Halo release gate is unchanged. While the tab is
selected, expanding the map reuses the same frame; selecting an observation
returns to its action panel.

The environmental panel, transport/auth adapter and Cesium pin adapter are
separate. See `packages/equity-uprise/environment/README.md` and its explicit
public-source export manifest. A clean-directory export imports without
McCluster globals. This is an initial portable frontend module, **not** a claim
that the complete social/media/funding product has a standalone backend.

The owner selected private `mcclusterishere/Equity-Uprise` as the product home.
Stage 2 is in its draft PR #2; this consumer branch now imports a pinned local
product follow-on, documented in `EQUITY-PRODUCT-CONSUMER.md`. The public
McCluster bridge is still local pending publication approval. Never copy sessions,
credentials, database rows, member information or private Halo state.

## Journey and owner controls

1. Guest selects the supplied logo, reads sourced observations and their actual
   observation/retrieval dates, selects a marker or accessible list item.
2. Source health, coverage, missing geometry, stale readings and limited results
   are explicit. A hazard does not itself establish environmental injustice.
3. Signed-in member reads the team disclosure and explicitly joins Environmental
   Justice Team. Canonical open-group membership is visible to other team members;
   private assignments are returned only to that person and the verified owner.
4. Member suggests a source-linked remote research/accessibility mission. It is
   saved as a draft with immutable source evidence. No mission is auto-published.
5. Owner reviews source, safety/evidence requirements, approves/pauses/closes it
   and sees assignments in the server-authorized oversight section.
6. Member joins an approved mission via canonical assignment/eligibility rules.
   Reload recovers the actual assignment. Recording opens only the existing
   assignment-qualified setup, labelled “Check recording availability”.

API, SQL, dependency registry and recovery details are in
`WORLD-ENVIRONMENT-CONTRACT.md`. Pending SQL is not applied. Existing live policy
is disabled in the checked-in Worker configuration. No camera prompt, live
stream, publishing opt-in, payment or funding campaign starts from selecting a
marker or joining the team.

## Not complete / release gates

- Browser acceptance at 390px and 1440px is prepared in
  `scripts/e2e/world-environment.mjs`, but Chromium startup was denied by the
  runtime's socket restriction before rendering. No screenshot or overflow pass
  is claimed. The harness isolates Cesium/API with fixtures and therefore is not
  real provider, GPU or production-media acceptance even when it runs elsewhere.
- Native multi-session PostgreSQL concurrency could not run because Unix socket
  creation is denied. PGlite SQL/sequential behavior and native single-user SQL
  checks are narrower evidence, not a substitute for concurrency/RLS acceptance.
- Pending SQL needs reviewed promotion and canonical production schema/RLS checks.
- Government adapters are covered by offline tests; current production endpoint
  health, cache behavior and deployment have not been accepted for this feature.
- Canada AQHI PR #614 remains separate, unmerged and conflicting. No pollution,
  PFAS, flood-zone, land-cover or water-chemistry coverage is fabricated.
- Watchable broadcasts, mission-specific governed support and a complete
  standalone backend are still open integrations. Text/link proof review and
  consented publication are now local follow-on code, still pending release. This branch creates no new
  payment rail, live grants or fabricated campaign links.
- No push, remote PR, merge, deployment or live migration was performed here.
  Sole merger/release coordination remains authoritative.

## Reproduce local verification

```
npm test
(cd workers/mccluster && npm test)
node --test scripts/test/world-environment.test.mjs
PGLITE_MODULE_PATH=<installed runtime> node scripts/test-environment-pglite.mjs
node scripts/e2e/world-environment.mjs
node scripts/export-equity-environment.mjs /tmp/new-equity-environment-export
(cd workers/mccluster && npx --no-install wrangler deploy --dry-run)
```

Use the locked Wrangler version, no credentials/configuration changes. Disposable
local log/config output may be placed in an allowed temporary directory. Keep
passed, failed and unrun evidence separate in the final release record.


## Mission resume checkpoint, 2026-11-08

Your missions now remains available when the selected observation expires or a
provider fails. The private read preserves source provenance and mission
requirements, clears immediately on account change, and does not expose member
information on globe pins. Canonical status/start/end checks suppress recording
setup for paused, closed, future or expired missions. Completed/submitted work
stays visible without offering a new capture link.

Local verification after the follow-on:
- Product package and clean-directory export: 42 tests passed.
- Consumer root suite with test concurrency 2: 2,047 passed, 3 skipped, no failures.
  All 7 Python checks passed. Lower concurrency avoids unrelated test-process
  failure observed during the first simultaneous aggregate run.
- Worker: all 1,470 tests passed. The absent fal.ai client was resolved for this
  run by reusing the already-installed locked 1.10.1 dependency from another
  local checkout. No package versions, credentials or deployment settings changed.
- PGlite canonical SQL fixtures passed: own-assignment resume, saved source,
  pause/future/expiry capture gates, membership leave without history loss,
  authorization refusals, idempotent proposals and stale approval rejection.
- Browser harness now includes outage/resume assertions but was not run again.
  The previous socket denial remains a release blocker, not a visual pass.
- Native multi-session PostgreSQL was not retried after its socket denial.
  No production schema, provider/live-media acceptance, merge or deploy occurred.

This is a continuation checkpoint, not a completed action-media launch. News-
shaped mission drafting, environmental proof submission/publication, sponsor
proposal generation and approved outreach still need integrated acceptance.
Existing canonical proof/review/share-intent paths should be reused rather than
creating another proof ledger or opening the owner-only general Missions mode.


## Action-media integration checkpoint, 2026-11-08

Local continuation now connects proof editing/review/sharing, revision-bound
owner news review, news-aware mission proposals and evidence-backed sponsor
candidate/draft preparation. It preserves the existing globe and owner-only
Travel/general Missions modes. No production or remote publication occurred.

Final local checks:
- Portable product and clean export: 58/58 tests.
- Root suite (concurrency 2): 2,047 passed, 3 skipped; 7 Python tests passed.
- Worker suite: 1,516/1,516 tests, including three controller integration tests.
- Socket-free canonical SQL rehearsals: membership/mission lifecycle and
  immutable reviewed-news context; corrected news rejection; actual canonical
  proof/retry/review/points/publication flows; exact-consent/legacy privacy,
  publication-failure recovery, queue priority, helper-role denials and
  receipt-preserving suspension; actual ops/CRM DDL insertion and default fields.
- Product manifest/hash isolation, clean export and RPC dependency registry pass.
- Browser harness was extended for proof editing and reload, but remains unrun
  after the earlier denied socket startup. No visual, mobile-overflow, real-GPU,
  provider-network or full production end-to-end acceptance is claimed.
- Native concurrent PostgreSQL remains unrun after its prior denial. Socket-free
  sequential tests cannot prove concurrency or the deployed RLS/schema state.

Public McCluster publication is still awaiting explicit approval. The private
product PR remains a previous Stage 2 draft; these follow-ons are local commits,
not updates to that PR. Live streaming, member location consent, actual sponsor
outreach/model automation and governed funding remain unactivated/unimplemented
in this patch. Its sponsor preparation is deterministic, never labelled AI-sent.

## Independent review checkpoint, 2026-11-08

Independent review found and reproduced a stale-owner-decision flaw: a pending
proof can be replaced under the same ID. The final adapter requires the exact
queue `proof_revision` as `expected_revision` through UI, controller, bearer RPC
and SQL. Assignment then proof locks precede comparison; changed evidence and
same-content rejected/resubmitted attempts fail before verification, points or
publication. Missing revision controls fail closed. The old wrapper overload is
removed. No canonical generic review authority is changed.

After the fix, portable source and clean export pass 60/60; the Worker aggregate
passes 1,518/1,518; root tests pass 2,047 with 3 skips, plus 7 Python checks.
Expanded PGlite tests cover stale decisions, same-content retry, no stale awards
or posts, latest-revision success, and existing privacy/recovery checks.

A fresh native PostgreSQL 17.7 single-user database also passed canonical/pending
SQL compilation and sequential proof assertions, exact publication, exactly-once
award, same-content retry rejection, retained receipt after opt-out, removed old
wrapper, and equal read/queue revision tokens across New York/Tokyo timezones.
This used no listener or socket. It does not replace native concurrent locking,
production schema/RLS, browser, real-provider, GPU or media acceptance. Independent
spot-check reported no remaining confirmed blocker in the reviewed local slice.
Browser startup was not retried; its wait-loop typo is fixed and syntax checked.

## The environmental globe, slice G1 (2026-11-17): the panel, the posts and the page

Owner direction and the design: `WORLD-FEED-AND-MISSIONS-20261117.md` ("The environmental globe", targets 4, 11 and 13)
and the contract's "Client" section in `WORLD-ENVIRONMENT-CONTRACT.md`. The slice has two lanes on the one globe: the
iframe side (typed batched primitives, the layer client, the render governor and the scene director: `js/environment-layers.js`,
`js/environment-layers-client.js`, `js/globe-render-governor.js`, `js/globe-scene-director.js`, with `scripts/e2e/environment-globe.e2e.mjs`
and `scripts/perf/environment-globe-perf.mjs`) and the feed side recorded here. Nothing is deployed; production still answers
503 `module_policy_unavailable` until the owner enables the module in Control, and the pending SQL is unchanged.

### What was built on the feed side

- **The panel** (`vendor/equity-uprise/src/environment/panel.mjs`, local patch `G1-PANEL` in `product-source.lock.json`) speaks
  to the one globe in a fixed order: `hu:environment-layers` before `hu:environment-pins` on every activation and again on
  `hu:globe-ready`; layers off then pins off when the tab changes; on destroy, layers off and then exactly
  `{type:'hu:environment-pins', on:false, items:[]}` as the last message. The pins carry, beside the fields they always had,
  the row's category, location kind, source, observed and fetched times, facts and the host's `significant` flag (the one pure
  rule in `js/world-environment-posts.js`, handed in through the adapter: USGS at M5.5 or with a ShakeMap, NWS Extreme or
  Severe with a point of its own, every NHC storm, EONET fires, cyclones, tornadoes, storms and volcanoes). The feed is read
  once at mount, so Global can carry the significant observations before the tab is opened; the five-minute refresh still
  runs only while the tab is open and the page visible.
- **Per-source health** under "Sources, coverage and limitations": one row per feed source and one per globe layer that has
  reported (`hu:environment-layer-state`): the status word, the reason in plain words, Retrieved and Last success each with
  how long ago ("never known" is never guessed around), coverage, attribution, licence and the provider's page; the alert
  layer's counts of alerts drawn, zone-only (listed, never placed) and rejected; one honest line when the gate refused the
  layers. A fetch time is never shown as an observation time; relative times sit beside absolute ones in the list and detail.
- **The tour and the 2D view**: Play/Pause, Previous, Next and "Replay last 24 h of quakes" send `hu:environment-scene` and
  resend the layers with `replay`; "2D map" sends `hu:environment-view`; the words follow `hu:environment-scene-state` and
  `hu:environment-view-state`, never a guess. The tour autostarts once per opening of the tab only while the frame is at least
  a quarter in view, the page is visible, motion is allowed and the visitor has not pressed Pause in this page session.
- **A pick that is no feed row** (a detection, a 1-degree area, a perimeter, a station, a contour) draws a "Selected on the globe"
  card from `hu:environment-selected`: the item's own time under its own label (Acquired, Sent, Captured, Reported, Observed,
  Computed; "Time not supplied by provider" when none), Retrieved, coverage, status and reason, the facts, the source, and the
  words owed to a visitor (a modelled reading is said to be modelled, an illustrative ripple to be illustrative).
- **Observation posts** (`js/world-environment-posts.js`, pure and tested; `js/mnet.js` draws them): the feed reaches the page
  as the DOM CustomEvent `mcc:world-environment-events` (nothing is fetched twice; the transport now attaches the gate's code to a
  refusal and the detail says `unavailable` with that code). One post per event id by the system author "Environmental desk",
  typed "Environmental observation", with a plain line icon (never the mark), stamped "Recorded <local time> · <ago>" or, when
  the source gives no event time, "Retrieved <local time> · <ago> · source gives no event time", the facts, coverage and status,
  "Show on globe" (`hu:environment-focus`, after turning the feed to the Equity Uprise tab) and the source's page. A known event
  whose words changed keeps its post and shows "Updated <ago>"; an event that left the feed loses its post; fires are summarised
  per 1-degree area from the globe's digest (never one post per detection), perimeters post with their acres and dates. The
  Equity Uprise tab lists every observation with the mission posts in one list by time; Global carries the significant ones,
  one after every six other items and never padding a short feed. While the module answers 503 or 404 there are no observation
  posts and the tab's honest line stands.
- **By day**: the panel's palette is tokens on `.we-panel` (`css/world-environment.css`, the night values unchanged) and
  `css/daylight.css` turns them in one place; the observation posts use the feed's own tokens.

### What was verified here (fixtures only, nothing live)

- `node --test scripts/test/world-environment.test.mjs scripts/test/world-environment-posts.test.mjs scripts/test/world-environment-panel.test.mjs scripts/test/world-environment-lifecycle.test.mjs scripts/test/world-mission-posts.test.mjs`:
  115 passed, 0 failed (the lifecycle suite's EQ1/EQ2 races unchanged; the consumer lock test passes with the new hashes).
- `node scripts/e2e/world-environment.mjs <outDir>` (Playwright, headless Chromium, one page at a time): at 390x844, 820x1180
  and 1280x800, harness A (the modules alone, the journey the module always had) and harness B (the page as it ships with a
  stub globe frame): the significant observations in Global at most one in six, every observation in the Equity Uprise tab
  with the missions by time exactly as the pure module orders them, typed and stamped, "Show on globe" posting
  `hu:environment-focus` (a fire area posts the globe's `cell:<west>:<south>`), layers before pins (62 items, 16 significant, the
  public fields only), one read of the feed route and no layer route from the page, the health rows, a summarised fire post from
  a layer digest, the globe-selection card, the tour and 2D controls, `scrollWidth === clientWidth`, no page errors; by day every
  measured pair (panel title, eyebrow, subtle text, buttons, status words, list rows, the post's author, sub-line, title, body
  and actions) reads 5.4:1 or better; under 503 and 404 the honest line shows, the panel stays hidden, zero observation posts
  exist and the missions still post, with one read and no retry loop.
- Not verified here: the iframe side (its own suite and perf benchmark belong to the other lane), any production answer (the
  module is not enabled there), real provider health.

### The integration pass (2026-11-17, evening): the page and the frame together

Lane L2 proved the page with a stub globe frame and lane L1 proved the frame under a stand-in host; the integration pass
(`scripts/e2e/environment-world.e2e.mjs`, run in CI as the `environment-world` suite of
`.github/workflows/human-uprise-editorial.yml`) opens `mnet.html` as a guest at 390x844, 820x1180 and 1280x800 with the REAL
frame (Cesium 1.131 served from a local build under the CDN URL, so the page's SRI still applies) and every read a fixture
(the feed, the six layer routes, the ShakeMaps, member posts, news, missions). What it proved, with the real messages between
the panel, the page and the frame:

- Global carries the significant observation posts from the panel's first feed load, one after at least six other items;
  with Global open the layers are off and the frame keeps its continuous loop byte for byte (requestRenderMode false,
  maximumRenderTimeChange 0, legend hidden).
- The Equity Uprise tab turns the typed layers on inside the frame: 50 quake discs and dots among 62 events, 600 fire
  footprints and 20 summary cells, 50 perimeters with their rings, 70 alert polygons with 25 zone-only and 5 rejected listed
  and never placed, 11 EONET points, 1 track and 1 polygon, 14 station columns with labels; the legend shows, collapsed, naming
  the quantities, with no logo and no brand; the governor runs on demand (maximumRenderTimeChange 60) once the tour lets go of
  the camera and every bounded hold is released.
- The panel's health rows show the four feed sources and the six layers the frame reported, in the Worker's own words (fires
  available, 600 of 600, the VIIRS attribution and CC0; the natural-events layer and the EONET feed source both stale with
  "the provider refused, failed or answered an error"; water levels 14 of 20; alerts 70 placed, 25 zone-only, 5 rejected); no
  refusal line while the gate allows. Since the review fixes, a layer's row renders every source record it carries: the water
  levels' station catalogue (retrieved 08:00) and readings (retrieved 19:56) each with its own times, the two fire satellites
  each on its own line; the frame holds the feed providers' terms the panel sent with the pins; a water-level station chosen on
  the globe shows Observed 15:48 and Retrieved 19:56 in the panel's card, never the catalogue's 08:00.
- The tab lists the missions and every observation, the fire areas and the largest perimeters from the frame's digests among
  them, in one list by time exactly as the pure module orders them; every post typed; the newest quake leads, stamped with its
  recorded time in local time.
- The tour starts by itself when the frame is at least a quarter in view, pauses on a wheel over the globe with the panel
  saying the visitor moved it, resumes, steps and pauses on the panel's controls; under reduced motion it never starts, Play is
  refused with the stated reason, focus jumps without a flight, no ripple runs and the legend says animations are off.
- Choosing a quake in the list focuses the globe and the detail shows Observed, Retrieved, the facts and the USGS page; the
  ripple runs under its bounded hold and the legend labels it illustrative; the ShakeMap contours draw and the panel gains a
  ShakeMap health row; the ShakeMap makes the quake significant and the tour queue takes it in (capped at 12 scenes).
- A real tap on a fire perimeter through the page answers with the globe-selection card: Captured, Retrieved, Coverage, Status,
  the acres and the source, never an Observed slot. Show on globe focuses the event from the tab and, from Global, turns the
  feed to the tab, brings the layers back and honours the focus once they arrive.
- The 2D map morphs and back with the layers and their counts intact; leaving the tab turns the layers off, stops the director,
  restores the continuous loop and hides the legend and the panel; Local, News, the member posts and the guest's People gate are
  as before; nothing scrolls sideways in the page, the panel, the feed or the frame; the frame never requests the feed route and
  the page never requests a layer route; no page errors.
- Landing on `?feed=equity` before the frame has booted: the layers draw and the tour starts once the globe says ready.
- With the gate answering 503 `module_policy_unavailable` or 404 `module_disabled` for the feed and the layers: the honest line,
  no panel, zero observation posts, the missions untouched; inside the frame every layer in the policy state with that reason,
  the legend saying the layers are not available, no retry against the gate.
- One layer unavailable (perimeters answering 500) beside the stale natural-events layer: both rows truthful, nothing drawn for
  the failed layer, its sentence absent from the legend.
- By day every measured pair of the panel, its rows and the observation posts reads 4.5:1 or better, and the frame's legend on
  its own ground.

Seams found and fixed on the real page (each with a test): the panel's activation words and its one autostart were lost when
the tab was open before the frame had booted (`hu:globe-ready` now re-arms them, `scripts/test/world-environment-panel.test.mjs`;
the frame's director treats a second `play` on a tour under way as a no-op, `scripts/test/globe-scene-director.test.mjs`), and a
ShakeMap that made a quake significant never reached the tour queue because the pins' geometry had not changed
(`js/environment-layers.js` re-syncs the director on a change of significance or recorded time without a rebuild,
`scripts/test/environment-layers-runtime.test.mjs`); and when the gate refused, the layer whose 503 body was still being read
when the first refusal landed was reported "unavailable, HTTP 503" beside the others' "policy" (the abort lands in the body
read, not the fetch; `js/environment-layers-client.js` now answers the policy state for every layer once the gate has refused,
`scripts/test/environment-layers-client.test.mjs`). A fourth finding was Cesium's, not the slice's, and stopped the globe for good
in two of five full runs: Cesium 1.131's zoom toward the cursor rotates the camera about the cross product of the picked and the
centre ground normals; with the pointer at the exact centre pixel the two picks coincide, the axis is the zero vector,
`Camera.rotate` normalises it into NaN and the render loop stops ("An error occurred while rendering. Rendering has stopped").
`MCC_GLOBE_GOVERNOR.guardCamera(viewer)` (wired at boot in `js/action-globe.js`) skips a rotation about a zero-length axis or by a
non-finite angle, which is no rotation; the e2e's wheel over the centre of the globe is the regression check
(`scripts/test/globe-render-governor.test.mjs` covers the guard itself).

Results. The integration lane's own runs before its fixes (2026-11-17): run 2 passed 138 checks and failed 13, run 3 passed 144
and failed 10, run 4 was stopped after Cesium's render stop at 820, and run 5 (every seam fix and the guard) ended with its
session at 1280 before it could finish. The completed run, on the branch with the integration fixes and the review fixes below
(2026-11-18, this machine, headless Chromium through Playwright, software GL "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device
(Subzero) (0x0000C0DE)), SwiftShader driver)"): `CESIUM_DIR=<Cesium 1.131.0 Build/Cesium> node scripts/e2e/environment-world.e2e.mjs
<outDir>` passed 163 checks, failed none, exit 0, in 7 min 9 s: 44 each at 390x844, 820x1180 and 1280x800, then at 390 the landing
on `?feed=equity` 3, reduced motion 5, the 503 gate 4, the 404 gate 4, one layer unavailable 3, and by day 4 at each width. With
the tour paused every hold was released 1,117 / 1,405 / 1,486 ms after the pause (390 / 820 / 1280), the ShakeMap contours were
drawn and built 470 / 588 / 755 ms after the list click, and the 2D morph completed in 5,173 / 6,038 / 5,727 ms; the wheel over the
exact centre pixel left the render loop running at every width (no render error was recorded).

### Review fixes (2026-11-18): the twelve findings at `fe0d53b2`

The adversarial review of the slice at `fe0d53b2` found twelve things, four of them major. Each is fixed on this branch in the
smallest truthful way, with a test that fails without the fix (each finding's test was run against the slice's sources as the
review saw them, unchanged on the branch head these fixes start from, and failed there). Nothing is deployed; production still
answers 503 until the owner enables the module.

- **G1R-1 (major), the tour never learnt a significance change.** A ShakeMap marks a quake significant and the panel re-sends
  the pins with the flag, but the globe's events signature (id, position, stale, category, facts) had not changed, so the
  director was never given the pins again. `js/environment-layers.js` keeps a second, tour-only signature (id, significant,
  observed_at, category) and re-syncs the director when either changed, without rebuilding geometry
  (`scripts/test/environment-layers-runtime.test.mjs`).
- **G1R-2 (major), the policy gate's race.** The first 503 put every layer in the policy state and aborted the pending fetches;
  a layer whose 503 body was still being read saw the abort land in the read, not the fetch, and ended as `unavailable
  http_503` after its `policy` message. `js/environment-layers-client.js` answers the policy state after a body read once the
  gate has refused, and says nothing after it (`scripts/test/environment-layers-client.test.mjs`); the in-iframe e2e asserts the
  LAST state of every layer is `policy`.
- **G1R-3 (major), the station catalogue's time stood for the readings.** A layer's state and a selection took `sources[0]`: the
  water levels carried the 24-hour station catalogue's retrieval (08:00) for readings observed at 15:48 and retrieved at 19:56,
  and a ShakeMap carried the event detail instead of the contours. The globe now chooses the record that speaks for a layer by
  id (`coops_latest`, `usgs_shakemap`; a fire detection its own satellite; otherwise the newest retrieval) and names it in the
  layer state's `source_id`; the panel's row for a layer renders every record in `sources`, each with its own status, reason,
  Retrieved and Last success, under the layer's status and counts; the digests handed to the page take their label from the
  record `source_id` names. `scripts/e2e/environment-globe.e2e.mjs` now expects the readings' 19:56 (it encoded the catalogue's
  08:00) and checks that no selection's retrieval precedes its observation; the runtime test asserts the same on the tides
  fixture (every reading observed no later than the readings were retrieved); the integration e2e checks the station's card in
  the real panel (`scripts/test/environment-layers-runtime.test.mjs`, `scripts/test/world-environment-panel.test.mjs`, the
  three e2e suites).
- **G1R-4 (major), the autostart lost before the frame booted.** Landing on `?feed=equity`, the panel's one autostart went to a
  frame that could not listen yet and `hu:globe-ready` re-sent the layers and pins only. It now clears the stale tour words and
  re-arms the autostart under the same rule, and the director treats `play` on a tour already under way as a no-op (local patch
  `G1-INT-GLOBE-READY`; `scripts/test/world-environment-panel.test.mjs`, `scripts/test/globe-scene-director.test.mjs`).
- **G1R-5 (minor), a merge commit without the trailers.** `c7db9b53`, the feed lane's merge of the remote branch, carries
  neither of the two attribution trailer lines (the co-author line and the session line) that every other commit of the slice
  ends with. It is pushed, and amending it would rewrite published history, so it stays as it is and is recorded here. The rule
  for the next rejected push: `git fetch` the branch, `git merge --no-edit FETCH_HEAD`, then amend that merge commit's message so
  it ends with both trailer lines before pushing.
- **G1R-6 (minor), 15 px buttons.** `.we-panel button,.we-button` now read `font-size:max(16px,1em)` (AGENTS.md hard rule 14);
  the feed-side e2e measures every panel button at 16 px or more at 390, 820 and 1280.
- **G1R-7 (minor), a repaint per digest.** The panel hands a layer's digest to the page only when it changed from the last one
  handed on for that layer, or when it re-marks a row of a freshly loaded feed with its ShakeMap (so a reload never hides that
  mark from the page), and `js/mnet.js` repaints the feed only when the ordered observation posts' ids, content hashes,
  significance, source labels or update times changed (`scripts/test/world-environment-panel.test.mjs`;
  `scripts/test/world-environment-posts.test.mjs` runs the page's listener as it ships; the feed-side e2e re-dispatches the same
  detail and checks the first card's node survives).
- **G1R-8 (minor), one pick id per multi-polygon row.** Every polygon of a perimeter or an alert, and every reported EONET
  polygon, carries its own frozen pick id (`part:'polygon'`, `index`), so the selection fade and the ShakeMap dim reach all of
  them; a pick on any part resolves to its row (`scripts/test/environment-layers-runtime.test.mjs`, over a fake Cesium that finds
  instance attributes by the id's identity as Cesium 1.131 does).
- **G1R-9 (minor), contract words.** A selection the panel's list made is told as `via:'focus'`, never `panel`; `env-build` is
  documented in the contract as a bounded hold owner (30 s at most while Cesium builds a ground primitive); the search re-sends
  the pins once the typing pauses (250 ms), so the globe rebuilds its events layer once per pause instead of per keystroke.
- **G1R-10 (minor), records.** The per-layer source rule is in the contract (above). The events layer's terms are no longer a
  client copy: the pins carry the feed providers' terms as the feed's own source records give them (`sources: [{id, label, url,
  attribution, license, coverage}]`), the globe answers a feed item's selection and credits its earthquake legend with them, and
  `scripts/test/environment-globe-wiring.test.mjs` fails if any of the Worker's `FEED_SOURCE_TERMS` strings reappears in
  `js/environment-layers.js`. The perf numbers, with the machine's GL path and the commands, are below.
- **G1R-11 (minor), aria-pressed on a label that changes.** The Play/Pause button changes its label and no longer carries
  `aria-pressed`.
- **G1R-12 (minor), the centre-pixel wheel.** `MCC_GLOBE_GOVERNOR.guardCamera(viewer)` (wired at boot) skips a rotation about a
  zero-length axis or by a non-finite angle (`scripts/test/globe-render-governor.test.mjs`; the wiring test checks it is wired
  right after the governor). The integration pass saw Cesium 1.131 stop rendering after a wheel over the frame's centre in two
  of five full-page runs before the guard; the review's targeted repro did not reproduce it. The guard is defensive and the stop
  is Cesium's defect, not a claim of the slice; the integration e2e keeps its wheel over the centre pixel as the regression check.

What ran for the fixes, all with fixtures and nothing live (2026-11-18, this machine: 4 CPUs, headless Chromium through
Playwright, software GL):

- The unit suites of every file touched: `node --test scripts/test/world-environment*.test.mjs scripts/test/environment-*.test.mjs
  scripts/test/globe-*.test.mjs scripts/test/equity-product-consumer.test.mjs scripts/test/world-mission-posts.test.mjs`: 191
  passed, 0 failed (the new `scripts/test/environment-layers-runtime.test.mjs` among them). Each of the four code commits of
  this record was checked the same way on its own tree: 173, 178, 182 and 191 passed, none failed.
- The same tests against the slice's sources without the fixes failed where each finding says they should: the runtime test 7
  of 8 (G1R-1: the director given the pins once, not twice; G1R-3: the water levels retrieved at 08:00 instead of 19:56, the
  ShakeMap credited to the event detail instead of the contours, the fires retrieved at 19:58 instead of 19:59; G1R-8: one pick
  id shared by two polygons; G1R-9: `via` 'panel'; G1R-10: the globe kept its own words when the Worker's changed); the layer
  client's G1R-2 case (a layer ended unavailable after the policy state); the director's G1R-4 case (a second flight); the
  governor's G1R-12 case (no guard); nine cases of the panel's suite (the readings record missing from the water-levels row,
  `aria-pressed` beside a changing label, seven events dispatched for five, the digest named after NOAA-20 for a layer that speaks
  for NOAA-21, the autostart not re-armed by `hu:globe-ready`, four pins messages for four keystrokes, no terms with the pins,
  15 px buttons, and, with only the re-mark condition taken out, a re-marked row never reaching the page); the page's listener
  with only its skip line taken out (three repaints for one); the wiring test's three cases (the guard not wired, the terms not
  forwarded by the pins shim, a client copy of the NWS attribution).
- The root suite: `node --test scripts/test/*.test.mjs`: 2,672 tests, 2,665 passed, 0 failed, 7 skipped (as before);
  `python3 -m unittest discover -s scripts/test -p 'test_*.py'`: 7 tests, OK.
- `node scripts/e2e/world-environment.mjs <outDir>`: harness A and B at 390, 820 and 1280, the day contrast at each width (every
  measured pair 5.43:1 or better), 503 and 404 at 390: 11 passed, exit 0.
- `CESIUM_DIR=<Cesium 1.131.0 Build/Cesium> node scripts/e2e/environment-globe.e2e.mjs <outDir>`: 127 passed, 0 failed, exit 0
  (53 each at 390 and 1280, one layer unavailable 2, the 503 gate 6, the 404 gate 6, reduced motion 5, the perf self-check 2): the
  water levels and a station speak for the readings retrieved at 19:56, the fires for NOAA-21 at 19:59, the ShakeMap for its
  contours, every selection retrieved no earlier than observed, the frame holding the feed's four providers' terms, the last state
  of every layer `policy` under 503 and 404.
- `CESIUM_DIR=<Cesium 1.131.0 Build/Cesium> node scripts/e2e/environment-world.e2e.mjs <outDir>`: 163 passed, 0 failed, exit 0
  (above, "The integration pass").
- The perf benchmark, run with no other browser on the machine (sampled every 15 s): `node scripts/perf/environment-globe-perf.mjs --root
  <a checkout of b7554a8b, the pre-slice base> --modes off --sizes 390,1280 <before>` then `node scripts/perf/environment-globe-perf.mjs
  --modes off,on --sizes 390,1280 --baseline <before>/perf.json <after>` on the closed tree, with `CESIUM_DIR` as above. GL path:
  "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", software GL, so the flight
  frame times are information, not gated; 12 s settle, 10 s idle window, CDP task and script time; the pass rule applied by the
  script (exit 0):

  | run | idle10s taskSec | scriptSec | frames in 10 s | flight mean / p95 ms | heap MB | load ms |
  | --- | --- | --- | --- | --- | --- | --- |
  | before, 390, layers off (b7554a8b) | 10.23 | 0.08 | 38 | 320.8 / 381.3 | 25 | 1369 |
  | before, 1280, layers off (b7554a8b) | 10.62 | 0.05 | 19 | 840.2 / 999.1 | 36 | 1160 |
  | after, 390, layers off | 10.23 | 0.06 | 41 | 336.6 / 530.8 | 29 | 1068 |
  | after, 390, layers on (on demand, no holds) | 0.18 | 0.10 | 0 | 327.4 / 410.1 | 34 | 1174 |
  | after, 1280, layers off | 10.50 | 0.05 | 20 | 605.4 / 736.2 | 23 | 887 |
  | after, 1280, layers on (on demand, no holds) | 0.17 | 0.10 | 0 | 660.2 / 766.5 | 30 | 914 |

  PASS at both sizes: after.off idle <= before.off * 1.05 (10.23 against 10.23; 10.50 against 10.62), after.on idle <=
  min(before.off, 10.09) * 1.05 (0.18 and 0.17 s of main-thread work in ten idle seconds, no frame drawn), heap(on) <= heap(off) +
  40 MB (34 against 29; 30 against 23). The scratch probe's 10.09 s for the continuous loop stands as the ceiling. The layers-off
  comparison sits at the software renderer's saturation (about ten busy seconds in ten), so it can only reveal a regression that
  changes the frame count; the on-demand saving with the layers on is the real one.
- Not verified here: any production answer (the module answers 503 there), real provider health, a hardware GL path, and the
  flight frame-time rules, which gate only on hardware GL.

### Second review fixes (2026-11-18): the ten findings at `58fef668`

The second adversarial review, of the close-out (`7a4d58db..c81e4b59`) and the feed row (`b67bb9ef`, `58fef668`) at `58fef668`,
found ten things, one of them major. Each is fixed on this branch in the smallest truthful way, with a test that fails without
the fix (each run against the sources as the review saw them, unchanged in these files on the branch head the fixes start from).
Nothing is deployed; production still answers 503 until the owner enables the module.

- **RV2-1 (major), a tour the visitor stopped started again by itself.** The G1R-4 fix re-armed the one autostart on every
  `hu:globe-ready`, and the globe says ready several times per boot (at boot, when its missions read answers, in answer to
  `hu:hello`, after a bfcache restore): a tour the visitor had stopped by moving the globe, or one that had ended, flew again on
  the next ready. `js/action-globe.js` now draws a random boot id once per page load and every `hu:globe-ready` carries it; the
  panel re-arms the autostart and clears the tour words only for a globe that has just booted (a boot it has not heard, or the
  first ready of all), never in an opening of the tab in which the director reported `input` (the visitor's hand on the globe, or a
  focus the visitor chose) or `end`; the autostart also waits for the feed, so its play follows pins that carry something to tour
  (without it, a globe ready before a slow feed would no longer get its play from a later ready). The same globe saying ready again
  gets the layers and the pins only and keeps the words of a tour still playing (local patch `RV2-1`;
  `scripts/test/world-environment-panel.test.mjs`: input plus ready, end plus ready, the same boot during a playing tour, a new
  boot, the feed after the ready; `scripts/test/environment-globe-wiring.test.mjs`: every ready names the boot;
  `scripts/e2e/environment-world.e2e.mjs`, scope `1280-late-ready`: the frame's missions read held until a wheel has paused the
  autostarted tour, then released, and no play reaches the frame).
- **RV2-2 (minor), a status that changed with the same rows.** The G1R-7 dedupe keyed on the digest's rows alone, so a layer whose
  Worker answer went stale with the same cells never reached the page, and its fire-area posts kept "Status: available" beside the
  panel's stale row. The panel now hands a layer on when the whole entry the page receives for it changed (rows, status, reason,
  retrieval, label, link, coverage, terms); the same entry again still dispatches nothing (local patch `RV2-2`).
- **RV2-3 (minor), a 1-degree area credited to one satellite.** The Worker sums both satellites' detections into one set of cells,
  but an area's selection and every fire-area post named the newest satellite's record alone beside the fact "Sensor: VIIRS
  NOAA-20/21". `js/environment-layers.js` now makes the fires layer (and its areas) speak for every satellite record that served
  data: `source_id` `firms_viirs_noaa20+firms_viirs_noaa21`, the new layer-state field `label` "NASA FIRMS VIIRS NOAA-20 and
  NOAA-21", the coverage and terms of each, and the newest retrieval (no acquisition in the merged cells can follow it); one
  satellite serving speaks alone; a detection still names its own satellite. The panel takes the layer's `label` for the digest,
  and `js/world-environment-posts.js` derives the Sensor fact from the satellites that label names, so it never claims both when
  one served (`scripts/test/environment-layers-runtime.test.mjs`, the panel and posts suites, the in-iframe e2e's fires state
  and cell payload).
- **RV2-4 (minor), a pending focus the pins never honoured.** `setEvents` looked the pending id up with `picks.has(id)`, but
  picks are keyed by layer and id, so only a layer's data could honour a focus kept pending; it now looks it up by id as
  `onLayerData` does (`scripts/test/environment-layers-runtime.test.mjs`: focus before the pins, with no layer data).
- **RV2-5 (minor), a guard without its own test.** The layer client's two G1R-2 guards each have a case that fails without it: the
  ShakeMap whose 503 body is still being read when a layer route's refusal lands (the ShakeMap path does not go through `run()`,
  so only the body-read guard holds it), and a layer whose answer was read just before another route's refusal, in the same task
  (only the `run()` guard keeps it from saying "available" after the policy state) (`scripts/test/environment-layers-client.test.mjs`).
- **RV2-6 (minor), the 2D toggle's two signals.** `#weView2d` read "3D globe" with `aria-pressed="true"` in 2D ("3D globe,
  pressed"); it now keeps its one label, "2D map", and says the view with `aria-pressed` and the pressed colour (local patch
  `RV2-6`; the panel suite and both page suites).
- **RV2-7 (minor), 14px tabs.** The feed row's tabs are form controls at `max(16px,1em)` (`css/human-uprise-editorial.css`), the
  reading of AGENTS.md hard rule 14 the panel's buttons already follow (G1R-6); `scripts/e2e/world-missions-guest.e2e.mjs`
  measures every tab at 16px or more at 390, 820 and 1280.
- **RV2-8 (minor), the sixth tab past the row's edge at 1280.** On the split desktop (1000px and wider) the row wraps onto a second
  line, so every tab sits inside it; the phone and the stacked tablet keep their one dragging row, and at 820 the six still fit on
  it. The guest suite checks every tab inside the row's box from 1000px; the twelve guest screenshots were rendered again.
- **RV2-9 (minor), a ripple read in two evaluates.** The in-iframe e2e reads the ripple, the governor's holds and the legend in one
  evaluate; a ripple already over when it is read is judged by the record it left (bounded, its hold released), and the
  selection's own `illustrative` label is checked beside it.
- **RV2-10 (minor), fixtures retrieved before they were observed.** `feed.json` had two quakes (20:25, 20:50) and the USGS source
  record observed after their 20:05 retrieval and a storm observed at 18:00 in EONET's 14:00 copy; `pins.json` the same two quakes
  after their 20:04 retrieval. The USGS retrieval is now 20:55 in `feed.json` (rows and source record) and 20:54 in `pins.json`, and
  the storm's report time is 12:00 as `pins.json` already had it (the significance tour keeps the same twelve scenes, and no
  quake's time moved, so the 24-hour replay is unchanged);
  `scripts/test/environment-layers-runtime.test.mjs` asserts every row of both fixtures, and every feed source record, observed no
  later than it was retrieved.

What ran for these fixes, all with fixtures and nothing live (2026-11-18, this machine: 4 CPUs shared with two other workflows'
browser runs, headless Chromium through Playwright, software GL; for each browser run, the one-minute load average its log recorded
at the start and at the end):

- The unit suites of every file touched: `node --test scripts/test/world-environment*.test.mjs scripts/test/environment-*.test.mjs
  scripts/test/globe-*.test.mjs scripts/test/equity-product-consumer.test.mjs scripts/test/world-mission-posts.test.mjs
  scripts/test/action-world-home.test.mjs`: 209 passed, 0 failed.
- Each new or changed test against the sources without its fix (the reviewed file swapped in, or only the fix's line taken out):
  the panel's three autostart cases fail with the reviewed panel (input plus ready, end plus ready, the same boot during a playing
  tour, the feed after the ready); the wiring case fails with the reviewed `js/action-globe.js` (no boot id); the integration
  step `1280-late-ready` fails with the reviewed panel (a `play` reached the frame after the wheel and the director was playing
  again); the RV2-2 panel case fails with the digest-only key; the RV2-3 runtime case fails with the fires back on the newest
  record, the posts case with the fixed Sensor words and the panel case with the record's label preferred to the layer's; the
  RV2-4 runtime case fails with `picks.has`; the client's body-read case fails without the body-read guard and its `run()` case
  without the `run()` guard (with both taken out the G1R-2 case fails too); the 2D toggle case fails with the changing label; the
  fixture assertion fails on the old `feed.json` (`usgs:fx-gen-49` observed 20:25 after its 20:05 retrieval). The row's two new
  guest checks reject what the review measured on the unchanged CSS (every tab 14px at 390, 820 and 1280; People outside the row
  at 1280). The ripple read (RV2-9) is a race under load and cannot be forced; the check now reads one snapshot.
- The root suite: `node --test scripts/test/*.test.mjs`: 2,697 tests, 2,690 passed, 0 failed, 7 skipped;
  `python3 -m unittest discover -s scripts/test -p 'test_*.py'`: 7 tests, OK.
- `node scripts/e2e/world-environment.mjs <outDir>`: 11 passed, exit 0 (load 6.45 at the start, 6.67 at the end).
- `CESIUM_DIR=<Cesium 1.131.0 Build/Cesium> node scripts/e2e/environment-globe.e2e.mjs <outDir>`: 127 passed, 0 failed, exit 0
  (load 6.54 at the start, 6.29 at the end): the fires state and a 1-degree area name both satellites, the ripple read in one
  snapshot, the quake retrieved at 20:54.
- `CESIUM_DIR=<Cesium 1.131.0 Build/Cesium> node scripts/e2e/environment-world.e2e.mjs <outDir>`: 169 passed, 0 failed, exit 0
  (163 before, and the six checks of `1280-late-ready`; load 5.94 at the start, 12.97 at the end).
- `CESIUM_DIR=<Cesium 1.131.0 Build/Cesium> node scripts/e2e/world-missions-guest.e2e.mjs <outDir>`: 246 of 246 passed, exit 0
  (load 12.36 at the start, 14.42 at the end): every tab at 16px or more at each width, every tab inside the row at 1280.
- Corrected on 2026-11-18 by the release polish below (review V2-M5): the load figures above first quoted 6.5 to 13.0 for the
  integration suite and 10.9 to 14.4 for the guest suite, and 6.5 and 6.3 to 7.1 for the other two, none of them the logs'
  start and end readings; they are now the logs' own one-minute figures.
- Not run again: the perf benchmark (no change here touches a render loop, a hold or the governor).

### Release polish (2026-11-18): the Equity Uprise tab before release

The second verification of the slice left four minor findings (V2-M1, V2-M2, V2-M3, V2-M5) and the G1 close-out one open flip;
each is fixed here in the smallest truthful way, with a test that fails without it, and the words that still called applied SQL
pending now say what production holds. Nothing is deployed; production still answers 503 until the owner enables the module.

- **V2-M3, the news tint under the environmental layers.** The World's news heat map ("News mentions · last 24 h": each country
  shaded by the stories that mention it, `js/world-countries.js`) stayed on in the Equity Uprise tab and coloured whole countries
  under the quakes, fires and alerts. While the feed's scope is the tab, the page says so on the message it already sends
  (`js/world-news-globe.js`: `hu:world-news-pins` carries `tint: false`, sent again on `mcc:feed-scope` and on every
  `hu:globe-ready`); the frame (`js/action-globe.js`) hands the flag to the countries, which hide the fill, a picked country's
  states and the legend and keep the counts, so a country's card still says how many stories. Any other tab, or a page that never
  sends the flag, keeps the tint, and leaving the tab brings back the same shading and legend
  (`scripts/test/world-news-tint.test.mjs`; `scripts/e2e/environment-world.e2e.mjs`, over the whole Earth on Global, in the tab and
  after it, by night and by day at 390, 820 and 1280).
- **V2-M2, a list of 65 observations before the first post.** The panel listed every observation above the posts, so the first post
  sat 6,964 px (8.25 screens) below the feed's row at 390 with the fixtures (6,650 px at 820, 6,748 px at 1280; measured on the
  unchanged panel right after it rendered). The list now opens on two rows: the significant observations (the host's rule, what the
  tour plays) newest first, then the newest of the rest, and a selected row wherever it is; the posts under the panel carry every
  observation by time, newest first. A count line says which few are shown, and a full-width toggle under them, "Show all 65
  observations" (`aria-controls`, `aria-expanded`), lists every row in place and moves the focus to the first one it revealed;
  "Show fewer observations" closes the list again with the focus kept on the toggle. The search narrows the whole list as before (a
  long result opens compact too). One thing more stood between the row and the posts: the tour starts by itself in the tab, and the
  panel opened its full card for every scene (723 px at 390 with the fixtures), and `select()` revealed the panel (closing an
  expanded map) and scrolled the card into view each time. A scene the tour chose (`via: 'tour'`) is now named by the scene line
  only, and a card the tour moved the globe away from closes; a visitor's own choice (a row, a tap on the globe, Show on globe) opens
  the card as before. With the tour playing, the first post is now 1,142 px (1.35 screens) below the row at 390, 924 px
  (0.78) at 820 and 1,018 to 1,038 px (1.27 to 1.30, as the scene line wraps) at 1280 (local patches `V2-M2` and `V2-M2-TOUR-CARD` in
  `vendor/equity-uprise/product-source.lock.json`; `scripts/test/world-environment-panel.test.mjs`; the integration suite at each
  width, measured with the sources' details closed as a visitor first gets them).
- **G1 close-out, Show on globe from Global taken back.** With an event chosen earlier in the tab, Show on globe on another event's
  post in Global flew the globe to the clicked event and then back to the earlier one, over and over, the panel with it (17 changes
  in ten seconds at 390 with the fixtures): the reopened panel sent its older selection with the pins, the frame took it, a cached
  ShakeMap's answer reported it as the globe's own, and the panel answered every report with the pins again. The
  panel now follows the globe's `hu:environment-selected` without sending the pins back, so no selection can echo (local patch
  `G1-SHOW-ON-GLOBE`; the panel suite: no pins in answer to the globe's report, and a model globe and the panel that stop talking;
  the integration suite samples the frame's selection every 50 ms for ten seconds after the click).
- **V2-M1, the guest suite's Local check.** `scripts/e2e/world-missions-guest.e2e.mjs` waited for the country's missions only and then
  counted its news too; it now waits for what it checks (the country's news cards and mission posts, and France's "No news from
  France" line). A slow news read is a race this machine cannot force, so no run here shows the old wait failing; the new wait is
  the check's own condition.
- **V2-M5, two load averages.** Corrected above from the run logs.
- **Applied SQL no longer called pending.** `js/mnet.js`, `js/world-mission-posts.js`, the guest suite,
  `scripts/test/world-mission-posts.test.mjs`, the feed brief (`WORLD-FEED-AND-MISSIONS-20261117.md`: the status line, production
  steps 1, 2, 3, 5 and 6, the D1 row) and the first line of `supabase/pending/eup_module_policy_v1.rollback.sql` now say what
  production holds (ledger 376): the join scope, the details table, the import's seven parts and the module policy are applied, the
  publish is pending for the deploy window, and the owner confirmed on 2026-11-18 that the Auth Redirect URLs include
  `https://mccluster.org/**`.

What ran, all with fixtures and nothing live (2026-11-18, this machine: 4 CPUs shared with another workflow's browser runs,
headless Chromium through Playwright, software GL; for each browser run, the one-minute load average its log recorded at the start
and at the end):

- The unit suites of every file touched and their neighbours: `node --test scripts/test/world-news-tint.test.mjs
  scripts/test/world-environment*.test.mjs scripts/test/world-countries.test.mjs scripts/test/heat-scale.test.mjs
  scripts/test/world-news-globe-source.test.mjs scripts/test/world-news-feed.test.mjs scripts/test/world-mission-posts.test.mjs
  scripts/test/equity-product-consumer.test.mjs scripts/test/environment-*.test.mjs scripts/test/world-first-and-layers.test.mjs`:
  236 passed, 0 failed.
- The new tests against the sources without their change: with the tint, panel and heat-scale suites copied onto `31e55c9b`, the
  branch head the polish starts from, 13 of their 36 tests fail: the four tint tests, the panel's seven new ones (the compact list,
  its toggle and its CSS, the two Show on globe tests, the two tour-card tests), the health-rows test (it now opens the full list
  before it reads) and the heat-scale test's new pin of the quiet flag. The two tour-card tests also fail with only the panel's tour
  line taken out. A copy of the integration suite's new checks as they first stood (before the two-row list and the tour-card check),
  run at 390 against `31e55c9b` (load 4.06 at the start, 3.29 at the end), failed five: the list of 65 rows with no toggle (the first
  post 11,226 px below the row, the sources' details open), the tint in the tab by night and by day, and the Show on globe watch (the
  globe's selection changed 17 times in ten seconds, back and forth between the clicked event and the earlier one).
- The root suite: `node --test scripts/test/*.test.mjs`: 2,731 tests, 2,724 passed, 0 failed, 7 skipped. Its first run failed two:
  `scripts/test/heat-scale.test.mjs` pinned the two lines of `js/world-countries.js` the tint rewrites (now pinned as they read, the
  quiet flag included), and an empty `e2e-out/` that an early probe of this work had left at the checkout's root, which the export
  parity test rightly refuses (removed). `python3 -m unittest discover -s scripts/test -p 'test_*.py'`: 7 tests, OK.
- `node scripts/e2e/world-environment.mjs <outDir>`: 11 passed, exit 0 (load 0.29 at the start, 0.58 at the end).
- `CESIUM_DIR=<Cesium 1.131.0 Build/Cesium> node scripts/e2e/environment-globe.e2e.mjs <outDir>`: 127 passed, 0 failed, exit 0, its
  perf self-check included (`scripts/perf/environment-globe-perf.mjs --check` exits 0 with numbers for the layers off and on at 390;
  load 7.00 at the start, 7.27 at the end).
- `CESIUM_DIR=<Cesium 1.131.0 Build/Cesium> node scripts/e2e/environment-world.e2e.mjs <outDir>`: 205 passed, 0 failed, exit 0
  (169 before and 36 new: nine in each width's journey, three in each width's day run; load 6.71 at the start, 8.09 at the end).
  Three earlier runs shaped the final checks: the first measured the gap with the sources' details open (the health-row checks open
  them); the second, with them closed, measured 1,970 px at 390 while the tour's card was open, which led to the card change above,
  and its keyboard checks counted a fixed three rows while a tour scene had added a fourth; the third failed only the count line's
  words, which the two rows had changed.
- `CESIUM_DIR=<Cesium 1.131.0 Build/Cesium> node scripts/e2e/world-missions-guest.e2e.mjs <outDir>`: 246 of 246 passed, exit 0
  (load 7.17 at the start, 9.10 at the end).
- `CESIUM_DIR=<Cesium 1.131.0 Build/Cesium> node scripts/e2e/world-first-visit.e2e.mjs <outDir>`: 83 of 83 passed, exit 0 (load 8.77
  at the start, 8.24 at the end).
- Screenshots for the owner, not committed: eight at deviceScaleFactor 2 by night, at 390x844 and at 1280x800: the Equity Uprise
  tab with the tour paused and the whole Earth in view (the layers drawn, the tint and its legend hidden), the tab scrolled to the
  list's count line (two rows, the toggle, the first posts), Global after the tab (the same shading and legend back), and Global
  scrolled to its first posts; nothing scrolls sideways in any of them.
- Not run: the perf benchmark in full (only its `--check` mode, inside the in-frame suite); nothing here touches a render loop, a hold
  or the governor, and the tint's switch is read in the frame step that already set the shading's visibility.
