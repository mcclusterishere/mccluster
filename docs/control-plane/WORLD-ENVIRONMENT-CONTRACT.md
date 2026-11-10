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
