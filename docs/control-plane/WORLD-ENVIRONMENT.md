# Equity Uprise environmental World: review build

## Product and integration

Equity Uprise is the product; McCluster is the current host implementation.
Environmental Justice lives behind the Equity Uprise tab of the World feed's
strip (`#mnFeedScope`, key `equity`; owner, 2026-11-17, see
`WORLD-FEED-AND-MISSIONS-20261117.md`), above that tab's missions. From
2026-11-07 to 2026-11-17 it was a supplied-logo button in the centre
`.wt-world-modes` bar; that button is gone. It retains `mnWorldFrame` and its
Cesium viewer. Everything (key `global`) remains the feed's default. Missions are
public; Travel remains owner-only, and the existing Halo release gate is
unchanged. While the tab is selected, expanding the map reuses the same frame;
selecting an observation returns to its action panel.

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
  once at mount, so Everything can carry the significant observations before the tab is opened; the five-minute refresh still
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
  Equity Uprise tab lists every observation with the mission posts in one list by time; Everything carries the significant ones,
  one after every six other items and never padding a short feed. While the module answers 503 or 404 there are no observation
  posts and the tab's honest line stands.
- **By day**: the panel's palette is tokens on `.we-panel` (`css/world-environment.css`, the night values unchanged) and
  `css/daylight.css` turns them in one place; the observation posts use the feed's own tokens.

### What was verified here (fixtures only, nothing live)

- `node --test scripts/test/world-environment.test.mjs scripts/test/world-environment-posts.test.mjs scripts/test/world-environment-panel.test.mjs scripts/test/world-environment-lifecycle.test.mjs scripts/test/world-mission-posts.test.mjs`:
  115 passed, 0 failed (the lifecycle suite's EQ1/EQ2 races unchanged; the consumer lock test passes with the new hashes).
- `node scripts/e2e/world-environment.mjs <outDir>` (Playwright, headless Chromium, one page at a time): at 390x844, 820x1180
  and 1280x800, harness A (the modules alone, the journey the module always had) and harness B (the page as it ships with a
  stub globe frame): the significant observations in Everything at most one in six, every observation in the Equity Uprise tab
  with the missions by time exactly as the pure module orders them, typed and stamped, "Show on globe" posting
  `hu:environment-focus` (a fire area posts the globe's `cell:<west>:<south>`), layers before pins (62 items, 16 significant, the
  public fields only), one read of the feed route and no layer route from the page, the health rows, a summarised fire post from
  a layer digest, the globe-selection card, the tour and 2D controls, `scrollWidth === clientWidth`, no page errors; by day every
  measured pair (panel title, eyebrow, subtle text, buttons, status words, list rows, the post's author, sub-line, title, body
  and actions) reads 5.4:1 or better; under 503 and 404 the honest line shows, the panel stays hidden, zero observation posts
  exist and the missions still post, with one read and no retry loop.
- Not verified here: the iframe side (its own suite and perf benchmark belong to the other lane), any production answer (the
  module is not enabled there), real provider health.
