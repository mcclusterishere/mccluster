# Equity Uprise environmental World: review build

## Product and integration

Equity Uprise is the product; McCluster is the current host implementation.
The Environmental Justice mode is a supplied-logo button in the existing
`.wt-world-modes` bar in `mnet.html`. It retains `mnWorldFrame` and its Cesium
viewer. News feed remains the default. Travel/general Missions remain owner-only,
and the existing Halo release gate is unchanged. Expanding the environmental
map reuses the same frame; selecting an observation returns to its action panel.

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
