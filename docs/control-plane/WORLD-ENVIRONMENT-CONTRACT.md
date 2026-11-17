# Consumer environmental World contract

This module builds on the existing consumer World globe. It is a separate,
public-government contract, not a public view of Halo. The canonical backend
remains Worker `mccluster` and the existing Supabase project. No second auth,
mission ledger, proof store, funding rail or member-location system is added.

## Sources and limits

`workers/mccluster/src/world-environment.js` adapts the existing NWS alerts,
NASA EONET reports, USGS earthquakes and NOAA NHC cyclone fetchers. Cache keys
are separate from Halo. Each source retains attribution, coverage, fetch time,
observation time and unavailable/stale state. A fetch time never substitutes
for an observation time. NHC's current adapter has no observation timestamp:
those markers say unknown and cannot generate a proposal. NWS zone-only
alerts stay in the list without a fabricated point. An `area_label` is an actual
polygon boundary vertex used as a label anchor, never a storm centre or centroid.
At most 150 rows per
provider, 600 total, with truncation disclosed. These are periodically fetched
reports, not continuous telemetry or proof of environmental injustice.

Each event has a bounded `facts: [{label,value}]` display contract: NWS severity,
certainty, urgency and affected area; EONET reported magnitude with its supplied
unit; USGS magnitude, depth in kilometres and an affirmative tsunami flag only
when the source flags it; NHC maximum sustained wind in knots and its supplied
classification. Missing measurements are omitted, never converted to zero.
Classification is not an inferred hurricane category. A missing tsunami flag
is not an all-clear. Official NWS `instructions` are capped at 2,000 characters.
Fact strings are control-character stripped and capped (area at 300 characters).
Source-qualified event IDs are bounded to 300 characters across API and SQL;
provider IDs longer than the earlier 160-character UI limit remain intact.

Canada AQHI draft PR #614 is not included. Military, aircraft, vessel, CCTV,
member position/presence and private Halo intelligence are not consumer data.
Existing Halo release guards are unchanged.

Each feed source also carries its health (2026-11-17, additive): beside the
pinned product's `id, label, url, status, fetched_at, observed_at, coverage,
stale`, the McCluster adapter adds `reason`, `last_success_at`, `attribution`
and `license` (the record is defined under "Source health" below).

## Endpoints

- `GET /v1/world/environment`: public events, source health, approved public
  missions; no assignments or people. `missions_unavailable` distinguishes
  missing persistence from no matching missions.
- `GET /v1/world/environment/team`: signed-in self membership plus own
  environmental mission assignments with saved title, requirements, mission
  status/end, source link and observation timestamp. Context survives provider
  expiry and outages. It is self-only, capped at the most recent 200 assignments
  with an explicit limit indicator. `POST` with `{join:true|false}` changes
  only that member's open-group membership. Banned/invite state fails closed.
- `POST /v1/world/environment/missions/propose`: accepts only `event_id` and
  `action_id`. Worker resolves a current public source and bounded safe action.
  Persisted canonical mission is always a draft; source snapshot is immutable.
  At most 20 new proposals/member/day; source/action pair is idempotent.
- `GET /v1/world/environment/oversight`: house-owner-only proposals, immutable
  source snapshots and bounded assignment identities/status. No member location.
  `GET /missions` is the owner-only proposal listing without assignment reads.
- `POST /missions/:uuid/review`: house-owner-only `open`, `paused` or `closed`.
  Both Worker and SQL recheck owner authority. Opening rechecks current event
  actionability; SQL separately checks source/mission expiry. Reviews are audited.
- `POST /missions/:uuid/join`: requires team membership and owner approval,
  then calls canonical `join_action_mission`. Capacity, region consent, dates,
  assignment reuse, proof review and rewards remain canonical. A narrow assignment
  trigger applies team/approval checks to first joins and withdrawn-assignment
  reactivation even through the existing generic join RPC. Later proof/review
  transitions continue after a member leaves; historical work is not discarded.

All responses are private/no-store. Authenticated requests use the user's
verified bearer; privileged source writes use the canonical service role only
after authorization. Unknown persistence failures return 503, not local success.

## The environmental globe's public layers (2026-11-17)

Owner direction: `docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md`, "The
environmental globe" and target items 11 and 13. Code:
`workers/mccluster/src/world-environment-layers.js`, reached through
`handleWorldEnvironment`; tests: `workers/mccluster/test/world-environment-layers.test.mjs`
and `world-environment-sources.test.mjs`.

| Route (all `GET`) | Answers | Sources consulted |
| --- | --- | --- |
| `/v1/world/environment/layers/fires` | NASA FIRMS VIIRS detections, trailing 24 hours, world, with a 1-degree area summary | `firms_viirs_noaa20`, `firms_viirs_noaa21` |
| `/v1/world/environment/layers/perimeters` | NIFC WFIGS current fire perimeters (U.S.) | `wfigs` |
| `/v1/world/environment/layers/alerts` | NWS active alerts: own polygons drawn, zone-only listed | `nws` |
| `/v1/world/environment/layers/eonet` | EONET open events with every reported geometry (tracks) | `eonet` |
| `/v1/world/environment/layers/tides` | CO-OPS water-level stations and the latest level at 20 documented stations | `coops_stations`, `coops_latest` |
| `/v1/world/environment/tides/{station}` | One CO-OPS station's observed water level, last 24 hours | `coops_water_level` |
| `/v1/world/environment/quakes/{usgs-event-id}/shakemap` | One earthquake's ShakeMap intensity contours | `usgs_event`, then `usgs_shakemap` |

**Gate.** Every route is public and unauthenticated, and every one is gated by
the same persisted module policy as `GET /v1/world/environment`:
`readModulePolicy(env, fetchImpl, 'environment')` with the service key on every
request, judged by the pinned product's own rules (`environmentGate` in
`world-environment.js`, using the vendored `module-policy.mjs`). A missing,
unapplied, unreachable or malformed policy answers 503
`module_policy_unavailable` before any provider is asked; `disabled` answers
404 `module_disabled`; `draining` still answers these reads. Nothing defaults to
on and the decision is never cached. Production applied the policy SQL on
2026-11-17 but has not installed or enabled the module, so these routes, like
the feed, answer 503 there until the owner enables it. Other errors:
405 `method_not_allowed` (anything but GET), 404 `not_found` (another path under
`layers/`, `tides/` or `quakes/`), 400 `invalid_station` or `invalid_event`,
404 `unknown_station`, 404 `no_mllw_datum`. Answers are `private, no-store`,
varying on Origin and Authorization, with the Worker's CORS, so a disabled
module stops serving at once.

**Release policy.** `packages/release-policy/globe.mjs` maps every one of these
paths, and `/v1/world/environment` itself, to the `environment` module
(`ENVIRONMENT_PUBLIC_ROUTES`, `environmentRouteForPath`) and to no owner-only
globe feature (`globeFeatureForPath` answers null), so the owner-only release
guard leaves them to the module gate. The owner-only Halo paths
(`/v1/world/layers/*`, `/v1/world/tides/*`, `/v1/world/halo/*`,
`/v1/world/geocode`) are unchanged and still refuse a guest or member with 403
`admin_preview`; the tests assert both.

**Never in an answer:** a credential (`FIRMS_MAP_KEY` travels only in the
request URL to NASA and never into an answer, header, cache key, error or log
line; the module logs nothing), a provider's error message, member data,
locations, assignments, Halo intelligence, aircraft, vessels or cameras.

### Source health

One record per provider consulted, on every answer (`sources`), and on the
feed's sources as additive fields:

| Field | Meaning |
| --- | --- |
| `id`, `label` | The provider, for example `firms_viirs_noaa20`, "NASA FIRMS VIIRS NOAA-20". |
| `status` | `available` (a fresh copy), `stale` (the last good copy, served because a refresh failed, at most 6 hours past its window) or `unavailable` (nothing to serve). |
| `reason` | Null while available. Otherwise `not_configured` (a credential this Worker lacks), `timeout`, `upstream_error` (refused, failed, rate-limited, redirected away or answered an error) or `invalid_data` (answered, in a shape that cannot be used). |
| `fetched_at` | When the served copy was retrieved; null when nothing is served. Never an observation time. |
| `last_success_at` | The newest successful retrieval this Cloudflare location knows of, kept a week apart from the copy itself; null when none is known. Never guessed. |
| `coverage`, `attribution`, `license`, `url` | Fixed per provider (research table below); `url` is the provider's public page, never an API URL. |

Only error codes reach a record. Copies live in the Cache API, which is per
Cloudflare location.

| Cache | Key (under `cache.mccluster.internal/world/layers/`) | Window | Stale grace |
| --- | --- | --- | --- |
| Fires, per satellite | `consumer-environment-v1-firms-VIIRS_NOAA20_NRT`, `...-VIIRS_NOAA21_NRT` | 30 min | 6 h |
| Perimeters | `consumer-environment-v1-wfigs` | 10 min | 6 h |
| Alerts | `consumer-environment-v1-nws-alerts` | 2 min | 6 h; an alert past its end is left out of a kept copy |
| EONET tracks | `consumer-environment-v1-eonet-tracks` | 10 min | 6 h |
| CO-OPS stations | `consumer-environment-v1-tide-stations` | 24 h | 6 h |
| CO-OPS latest set | `consumer-environment-v1-tide-latest` | 15 min | 6 h |
| One station | `consumer-environment-v1-water-{station}` | 6 min | 6 h |
| ShakeMap event detail | `consumer-environment-v1-shakemap-{event}` | 5 min | 6 h |
| ShakeMap contours | `consumer-environment-v1-shakemap-{event}-{source}-{code}-{version}-{updateTime}` | 24 h (a version does not change) | 6 h |
| Last success | `cache.mccluster.internal/world/health/{key}` | 7 days | none |

A failure is never stored as an answer.

### DTOs

Every successful answer has `ok: true`, `schema`, `generated_at` (when the Worker assembled
it) and `sources`. Coordinates are `[lon, lat]`, rounded to 4 decimals (about
11 m). Times are ISO 8601 UTC, or null when the provider gives none; a retrieval
time never stands in for an event time.

**`layers/fires`** (`world-environment-fires/v1`): `windows: [{source, since,
until}]` (each satellite covers the 24 hours before its own retrieval);
`columns: ["lon","lat","frp_mw","confidence","acquired_at","satellite","day_night"]`;
`detections` (rows in that order: FRP in MW or null, confidence
`low|nominal|high` or null, overpass time, `NOAA-20|NOAA-21`, `D|N` or null),
the strongest by FRP first, at most `cap` 10,000; `count`, `total` (detections
in the window), `truncated`, `dropped` (ragged or off-globe lines),
`outside_window`, `untimed`; `summary: {cell_degrees: 1, columns:
["west","south","detections","frp_sum_mw","frp_max_mw","latest_acquired_at"],
cells, count, cap: 20000, truncated}`, cells keyed by their south-west corner,
largest summed FRP first, counting every detection in the window whether or not
it is in `detections`; `footprint_m: 375`; `notes`. FIRMS is asked for
`/api/area/csv/{key}/VIIRS_NOAA20_NRT|VIIRS_NOAA21_NRT/world/2` (two UTC days,
because a day range of 1 means today only) and every detection outside
[retrieval minus 24 h, retrieval plus 1 h] is left out. Suomi NPP is not asked
for (production ceased 2026-11-02). Without `FIRMS_MAP_KEY` both sources are
`unavailable` with reason `not_configured`, nothing is fetched or read from the
cache, and the answer is still 200. A detection is the centre of a VIIRS pixel
(about 375 m at nadir) flagged as containing one or more fires or other thermal
anomalies, never a confirmed fire, perimeter or burned area; detections are not
a count of fires.

**`layers/perimeters`** (`world-environment-perimeters/v1`): `perimeters: [{id,
name, gis_acres, polygon_captured_at, last_edited_at, discovered_at, polygons,
polygons_dropped, geometry_truncated}]`, largest by GIS acres first, at most
`cap` 400; `polygons` is `[[exterior, ...holes], ...]`; `count`, `total`,
`truncated` (NIFC reported more perimeters), `dropped`, `polygons_dropped`,
`generalization_degrees: 0.002` (NIFC's server generalizes to about 200 m).
Times come from `poly_PolygonDateTime` (captured), `poly_DateCurrent` (last
edited, UTC) and `attr_FireDiscoveryDateTime` (discovered).

**`layers/alerts`** (`world-environment-alerts/v1`): `alerts: [{id, event,
headline, severity, certainty, urgency, sent, onset, expires, ends, area, url,
geometry, polygons, polygons_dropped}]`, newest `sent` first, at most `cap`
1,500. `id` is the World feed's event id for the same alert (`nws:<NWS id>`).
`geometry` is `polygon` (drawn with `polygons`), `zone_only` (no geometry from
NWS: counted, listed, `polygons: null`, never given a point) or `rejected` (the
published polygon failed the checks; not drawn). `counts: {polygon, zone_only,
rejected}`, `total` (features NWS returned), `truncated`. Only `status: Actual`,
non-cancelled, unexpired alerts, as in the feed.

**`layers/eonet`** (`world-environment-eonet/v1`): `events: [{id, title,
categories, kind, url, reported_by, track, track_count, track_truncated,
geometry_dropped, placeholder_times}]`, at most `cap` 500. `id` is the feed's
event id (`eonet:<EONET id>`). `track` holds every reported geometry, oldest
first (at most 500): `{date, placeholder_time, type: "Point", coordinates}` or
`{date, placeholder_time, type: "Polygon", polygons}`, each with `magnitude` and
`unit` when EONET gives them. `placeholder_time` is true when the date is
exactly 00:00 UTC, which EONET often uses when only the day is known. A track is
the reported positions, not an inferred path or forecast.

**`layers/tides`** (`world-environment-tides/v1`): `product:
"observed_water_level"`, `datum: "MLLW"`, `units: "m"`; `stations: {columns:
["id","name","lon","lat","state","tidal","great_lakes"], rows, count, total,
truncated}` (NOAA's own `tidal` and `greatlakes` flags, null when absent);
`latest: {set: "documented", stations: 20, refresh_s: 900, answered, readings:
[{station, place, name, lon, lat, value_m, observed_at, quality, q, status,
reason}]}`. `value_m` is metres above the station's Mean Lower Low Water;
`q` is NOAA's flag (`p` preliminary, `v` verified) and `quality` its word. A
station that failed keeps its place from NOAA's station list and says why. The
documented set, read with `date=latest` at most once per 15 minutes per
location, two requests at a time with a 100 ms pause: 8443970 Boston MA,
8461490 New London CT, 8518750 The Battery NY, 8534720 Atlantic City NJ,
8638610 Sewells Point VA, 8658120 Wilmington NC, 8665530 Charleston SC,
8723214 Virginia Key FL, 8724580 Key West FL, 8726520 St. Petersburg FL,
8761724 Grand Isle LA, 8771450 Galveston Pier 21 TX, 9410170 San Diego CA,
9414290 San Francisco CA, 9439040 Astoria OR, 9447130 Seattle WA, 9455920
Anchorage AK, 1612340 Honolulu HI, 9755371 San Juan PR, 1630000 Apra Harbor
Guam (each verified on 2026-11-17 to answer MLLW data).

**`tides/{station}`** (`world-environment-water-level/v1`): `station: {id, name,
lat, lon}`, `product`, `datum: "MLLW"`, `units: "m"`, `columns:
["observed_at","value_m","quality"]`, `observations` (oldest first, at most
300), `count`, `dropped`, `truncated`, `latest: {observed_at, value_m, quality,
q}` or null, `url` (the NOAA station page). The id must be seven digits (400
`invalid_station`), in NOAA's water-level station list while that list can be
read (404 `unknown_station`), and not marked non-tidal by NOAA (404
`no_mllw_datum`: the Great Lakes use IGLD, and non-tidal gauges have no MLLW).

**`quakes/{usgs-event-id}/shakemap`** (`world-environment-shakemap/v1`): the id
is two lower-case letters then 2 to 30 lower-case letters or digits (400
`invalid_event`). Always `event_id`, `modelled: true`, `units: "MMI"`. When there
is nothing to draw: `available: false` and `reason` `no_shakemap` (USGS lists
none, or only a deleted one), `event_not_found` (USGS has no such event),
`no_contours` (the product has no `cont_mmi.json` on USGS's own host) or
`source_unavailable`, with `contours: []`. Otherwise `available: true`,
`usgs_preferred_id`, `version`, `process_time`, `review_status`, `map_status`,
`max_mmi`, `update_time`, `product_code`, `product_source`, `contours: [{mmi,
color, lines}]` (lowest intensity first; `lines` are `[[lon, lat], ...]`, at
least two positions, never extended or closed), `counts: {contours, lines,
vertices}`, `thinned`, `truncated`, `lines_dropped`, `features_dropped`, `caps:
{contours: 24, lines: 600, vertices: 20000}`. Past the vertex cap every line
keeps every k-th position and both ends. A ShakeMap can exist with no contour
(a deep event): `available: true`, `contours: []`. ShakeMap is the USGS's
modelled estimate of shaking intensity, versioned, never a measurement at every
place, and is labelled so.

### Geometry rules

A ring is used only as the provider closed it: at least four positions, every
one a pair of finite numbers with longitude in [-180, 180] and latitude in
[-90, 90], the last equal to the first. A malformed ring drops its whole
polygon, which is counted: a hole is never promoted to an exterior and an
exterior is never drawn without a hole it had. The Halo normalizer then rounds,
removes repeated points and thins past 2,000 points a ring, re-closing on the
provider's own first point. A ring that rounds to fewer than three distinct
points or to no area is tiny: a tiny hole is left out, a tiny exterior drops its
polygon. At most 100 polygons and 250 rings per feature. Nothing is closed,
mended or moved.

### Sources, licences and timestamps (researched 2026-11-17)

| Source | Key | Licence | Attribution line | Coverage | Timestamp meaning |
| --- | --- | --- | --- | --- | --- |
| USGS earthquake feeds and event detail | None | Public domain (U.S. Government work); credit requested | U.S. Geological Survey, Earthquake Hazards Program | Global; the feed's summary covers the past day | `time` (origin) and `updated` are epoch milliseconds; `status` automatic or reviewed |
| USGS ShakeMap | None | Public domain (U.S. Government work) | U.S. Geological Survey ShakeMap | About M5.4 and larger worldwide; from about M3 to M3.5 in some U.S. regional networks | product `updateTime` (epoch ms), `process-timestamp` (when the map was computed), `version`, `review-status`; a modelled, versioned estimate |
| NASA FIRMS VIIRS NRT, NOAA-20 and NOAA-21 | `FIRMS_MAP_KEY`, server-side only; 5,000 transactions per 10 minutes | NASA data, CC0 1.0 (U.S. public domain) | NASA FIRMS | Global; Suomi NPP production ceased 2026-11-02 (FIRMS FAQ) | `acq_date` and `acq_time`: the satellite overpass, UTC. A detection is the centre of a pixel flagged as containing one or more fires or other thermal anomalies |
| NIFC WFIGS Interagency Fire Perimeters (current) | None | U.S. federal data with no named licence, provided as is under NIFC's disclaimer | National Interagency Fire Center, WFIGS Interagency Fire Perimeters (current) | United States; NIFC refreshes it every 5 minutes | `poly_PolygonDateTime` polygon captured; `poly_DateCurrent` record last edited (UTC); `attr_FireDiscoveryDateTime` discovered; all epoch milliseconds |
| NOAA NWS alerts API | None; NWS requires an identifying User-Agent, sent as the application name `McCluster-World/1.0 (https://mccluster.org)`, never a person or email | Public domain (U.S. Government work) | NOAA National Weather Service | United States; many alerts name zones and carry no geometry | CAP `sent` (issued), `onset` (hazard begins), `expires` (message expires), `ends` (hazard ends) |
| NASA EONET v3 | None | NASA open data; each event cites the sources it was drawn from | NASA Earth Observatory Natural Event Tracker (EONET) | Global, curated, not exhaustive; open events of the last 30 days | Each geometry's `date`; often 00:00 UTC placeholders when only the day is known. Answered HTTP 500 on 2026-11-17 |
| NOAA NHC CurrentStorms.json (feed only) | None | Public domain (U.S. Government work) | NOAA National Hurricane Center | Atlantic, eastern and central Pacific | The feed keeps the reported centre only and no observation time. No active storms and no CORS on 2026-11-17; track and cone live in NHC GIS products and are not used yet |
| NOAA CO-OPS water levels | None; requests name `application=mccluster` | Public domain (U.S. Government work); attribution requested | NOAA Center for Operational Oceanographic Products and Services (CO-OPS) | U.S. coasts, the Great Lakes and territories; MLLW exists at tidal stations only | `t`: observation minute, GMT; `q`: `p` preliminary or `v` verified. Datum MLLW, chosen and stated. NOAA asks for spaced, cached calls |

Not verified from this repository: whether `FIRMS_MAP_KEY` is set on the
deployed Worker (without it, fires answer `not_configured`); a live EONET sample
(the fixture is built in the documented v3 shape because EONET answered 500);
and any of these routes in production (the module is not enabled there).

Code provenance: `world-halo-layers.js` and `world-layers.js`, whose helpers these
layers reuse, contain portions derived from gods-eye-view (MIT, through Hitman's
Halo); see `THIRD-PARTY-NOTICES` at the repository root. The CO-OPS code in
`world-halo-ops.js` is Hitman's Halo's own and is not derived from gods-eye-view.

## Deployment dependencies and recovery

`supabase/pending/20261107120000_world_environment_v1.sql` is **not applied**.
It seeds one `network_groups` team, reuses `network_group_members`,
`action_missions` and `action_mission_assignments`, adds source links and review
audit rows, and defines narrow RPCs. It does not bypass fellowship-only cohort
admission, change existing policies or grant live-stream access. The assignment trigger is
scoped only to missions with environmental provenance; other missions are unchanged. The five
runtime dependencies are registered in `supabase/pending/live-callers.json`.
Follow the pending SQL promotion process and owner release approval; no live
migration, deployment or production acceptance is implied by local tests.

Failure recovery: retry membership or proposal safely; duplicate source/action
proposals return the existing mission. Pause or close a mission through the
owner review route. Leaving the team does not delete existing assignment/proof
history. Hosts cannot remove their own management seat through the member route.
Missing SQL leaves the public feed usable but membership/missions unavailable.

## Capture and funding boundaries

An actual assignment returns only `live-mission.html?assignment=<UUID>`, labelled
**Check recording availability**. This is a setup destination, not a statement
that recording or live broadcasting is enabled. Existing live policy, Stream
configuration, consent, authorization and the separate pending live-missions
migration remain gates. Paused, closed, future, expired and submitted/verified assignments do not get a
fresh capture link. The team RPC computes explicit canonical capture availability;
missing availability fails closed. This is only a setup destination, not a live
grant. No observer watch link or funding campaign is invented. New
missions have no fabricated campaign or payment destination. Connecting governed
watch/support surfaces requires separately verified existing campaign/live data.

## Verification

- Final focused result: 77 Worker/Halo/release tests and 3 pending-call registry
  tests pass; PGlite behavior checks pass after the feed-fidelity changes. Native
  multi-session concurrency remains blocked by Unix-socket restrictions.
- Worker tests: `node --import ./test/support/offline-network.mjs --test
  test/world-environment.test.mjs test/world-halo-layers.test.mjs
  test/world-halo-ops.test.mjs test/world-release.test.mjs` from the Worker.
- Public layers and source health (2026-11-17): `node --import
  ./test/support/offline-network.mjs --test test/world-environment-layers.test.mjs
  test/world-environment-sources.test.mjs` from the Worker, with small trimmed
  real fixtures under `workers/mccluster/test/fixtures/environment/`.
- Pending-call registry: `node --test scripts/test/rpc-names-exist.test.mjs`.
- Socket-free actual PostgreSQL-compatible checks:
  `PGLITE_MODULE_PATH=<installed PGlite dist/index.js> node scripts/test-environment-pglite.mjs`.
  Loads canonical group/mission table DDL and current join RPC, then tests
  membership, roles, banned/invite states, drafts, duplicate retry, owner review,
  canonical assignments, own-only reload, provenance immutability and stale approval.
- Native multi-session harness: `scripts/test-environment-postgres.mjs`, using
  an isolated disposable PostgreSQL server via `/tmp` Unix socket, port 54329,
  `ENVIRONMENT_PG_SOCKET` and `POSTGRES_MODULE_PATH`. It additionally tests real
  duplicate-proposal and capacity-one join concurrency. **Not run successfully
  in the current sandbox: Unix socket creation is denied**, including reviewed
  escalation. PGlite/sequential tests do not prove concurrency.

These are isolated fixtures, not a full production migration replay, actual
Supabase HTTP/RLS acceptance, deployment or end-to-end live-media verification.


## Action-media follow-on, 2026-11-08 (local only)

The portable panel/controller now offers authenticated assignment proof read,
text/link submission with explicit consent, verified-proof sharing, and an
owner-only proof queue/review. The McCluster adapter delegates to pending
`world_environment_proof_*` wrappers around the canonical proof, review/points,
share-intent and feed functions. The separate proof migration and suspension
script preserve canonical records and never activate live capture.

Public sharing is off by default. An exact proof-content consent snapshot is
required before this environmental extension can enrich a canonical public post
with the reviewed statement/link. A legacy generic share preference is not
permission to publish proof. The API checks actual visible public content before
reporting `proof_published`. Verification survives a posting failure and explicit
share can retry. Turning sharing off does not retract an existing public post.
Public proof must fit 2,000 characters including its link; private statements may
use 4,000. Existing live-required gates remain authoritative.

Owner-only POST planning routes are `/planning/context`, `/planning/review`,
`/planning/mission`, `/planning/companies`, `/planning/sponsor-draft`. They reuse
retained GDELT metadata, `ops_recommendations` review records and canonical CRM
companies. Candidates cover at most the latest 100 daily headlines; they are not
automatically verified geographic matches. Owner review binds an exact article
revision and rationale. Only bounded, public-safe attribution can be attached to
a proposal via `news_review_id`; the SQL transaction locks/rechecks the review,
current owner and article before preserving that attribution in the immutable
source snapshot. Corrected/revoked context is refused. The source/action
idempotency key is unchanged, so reusing an existing mission does not silently
replace its evidence.

Sponsor candidates use disclosed lexical matches against stored company notes.
Drafts include an unverified-fit warning and at most three complete citations,
with explicit inclusion counts. They are not sent and have no chosen recipient,
consent, partnership or funding commitment. No model invocation, unattended daily
job, automatic outreach, payments or partner collection operation is created by
this follow-on.

Pending release order: canonical action/share/retry dependencies, reviewed
world_environment_v1 (including news admission), reviewed environmental proof
extension, then the matching Worker and consumer package. Validate production
schema/RLS and installed live-required policy separately. The proof suspension
script disables environmental wrappers/publication without deleting evidence,
posts, consent receipts or points. It is not an unpublish operation.

Owner proof review also requires `expected_revision` from the displayed
`proof_revision`. The pending four-argument wrapper locks assignment then proof,
compares the complete-row revision and fails with `proof_changed` before canonical
review. A replaced pending proof or same-content rejected retry invalidates old
decisions. Refresh and inspect the latest evidence rather than blindly retrying.
