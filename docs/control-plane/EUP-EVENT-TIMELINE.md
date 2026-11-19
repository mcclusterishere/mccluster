# E=UP event timeline: the record, slice by slice

Owner direction, 2026-11-19 (relayed at Matthew McCluster's direction): make E=UP a signed-out environmental event timeline tied
to the globe, one stable canonical event id and revision driving the post, the globe object, the selection and the deep link; a
qualifying public government observation publishes with no news coverage; news alone stays out of the public E=UP timeline and
globe; USGS earthquakes are the first complete slice; diagnose the signed-out environment and EONET 503
`module_policy_unavailable` and tell off, outage and no data apart; owner controls for source health, review and rollback first;
production policy changes stay Matthew's separate go. And: make the actual event the thing a visitor clicks, recognisable before
the click.

This file is the record of that work, one section per slice: what was present before, what was integrated, the touched paths, the
tests with their commands and results, deviations from the plan with their reasons, and what waits for Matthew's separate go.
Requirement ids (E1-E12, V1-V11, G1), slices (S0-S10) and owner decisions (D1-D22) are those of the reconciliation of
2026-11-19. Where a decision's recommended default was used, it is marked **default adopted pending Matthew's confirmation**: none
of them is his decision until he says so.

**Nothing here is live.** The public site serves `main` (`fc1986ec` on 2026-11-19); this branch reaches production only through
a pull request Matthew approves, and a merge is also the Worker's deploy (about 30 s, no automatic rollback:
`WORLD-RELEASE-20261118.md`). No SQL was applied, no module installed or enabled, no flag set and no mission published by this
work.

## The production diagnosis (read only, 2026-11-19)

Signed-out GETs, no credential, `Origin: https://mccluster.org`:

| Time (UTC) | Request | Answer |
| --- | --- | --- |
| 02:53:23 | `GET https://api.mccluster.org/v1/world/environment` | 503 `{"ok":false,"code":"module_policy_unavailable"}` |
| 02:53:23 | `GET https://api.mccluster.org/v1/world/environment/layers/eonet` | 503, the same body |
| 02:53:24 | `GET https://api.mccluster.org/v1/health` | 200, `deployment_sha` `fc1986ec…`, worker `mccluster` |

Production Supabase, catalog and counts only (no row of any person, actor, reason or key), read at 2026-11-19 02:53:16 UTC:

```sql
select (select count(*) from public.eup_module_policies) as policy_rows,
       (select count(*) from public.eup_module_policies where module_id = 'environment') as environment_rows,
       (select count(*) from public.eup_module_policy_commands) as command_rows,
       to_regclass('public.action_environment_missions')::text as env_missions_table,
       (select count(*) from supabase_migrations.schema_migrations) as ledger_rows,
       (select max(version) from supabase_migrations.schema_migrations) as ledger_latest,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'eup_module_policy_read') as read_function_rows,
       now() as read_at
```

Result: `policy_rows 0, environment_rows 0, command_rows 0, env_missions_table null, ledger_rows 376, ledger_latest
20261118035654, read_function_rows 1`.

**Why it answers 503.** The environment module was never installed: the policy store exists (its read function is there) but holds
no row and no command was ever sent, so `eup_module_policy_read('environment')` raises the store's own `EUM01
module_not_installed`. The Worker read that reason and threw it away: `environmentGate` and the pinned product's server turned
every failed policy read into the same 503 `module_policy_unavailable`. So "off" (never installed) read exactly like a store
outage, on the wire and on the page. It is off, not an outage. Signed-out is not a factor: no identity is read before the gate.

**Staging.** None exists for the Worker or Supabase (no `[env.*]` in `workers/mccluster/wrangler.toml`, `workers_dev = false`,
one Supabase branch, the production project). Decision D1, **default adopted pending Matthew's confirmation**: the local
stand-ins are the staging proof (the real handler over the real policy SQL in PGlite, the Worker harness, the browser fixtures);
a staging Worker or Supabase branch is a new, possibly paid resource and a new infrastructure name, and creating one is Matthew's
call.

## S0. Gate truth, honest visitor states and the two seam defects

### Present before

At `2855a4e9` (the head this slice started from; `a8d2502d` plus the release fixes):

- One sentence for every module-level case. `workers/mccluster/src/world-environment.js` `environmentGate` and the vendored
  `vendor/equity-uprise/src/environment/server.mjs:51-53` answered any failed policy read with 503 `module_policy_unavailable`;
  the Worker tests pinned that collapse (`workers/mccluster/test/world-environment.test.mjs`, `world-environment-layers.test.mjs`,
  "module not installed (EUM01)" among the 503 cases). The page set `html[data-we-feed]` to `unavailable` for any failed first read
  (`js/world-environment-mccluster.mjs`) and `mnet.html` showed one line, "Environmental reports are not available right now.";
  the frame's legend one line for off and outage alike, and a layer whose provider reported nothing simply vanished from it.
- Every activation of the Equity Uprise tab while the gate refused asked the five layer routes again: the layer client forgot the
  refusal on `start()` (release review: 6, 11, 16 and 21 requests after four activations, 13 to 14 console errors).
- The public layer routes had no rate limit and no coalescing (release security review SEC-2): 40 concurrent requests for one
  uncached layer made 40 provider requests, 60 distinct event ids 60, and with every NOAA request hanging one `GET /layers/tides`
  took 81 s, past the browser client's 20 s.
- The perimeter seam (E2): the globe keys a perimeter `wfigs:<NIFC id>` (`js/environment-layers.js`), the digest it hands the page
  carries NIFC's own id, and the perimeter post used that bare id as its `globe_id` (`js/world-environment-posts.js`), so its Show
  on globe found nothing. The unit test and the integration e2e both fed an already prefixed digest, so no test saw it.
- The Drawdown missions in one list with the observations (E9): the tab merged missions (by creation time) and live observations
  (by recorded time) newest first into one page of twenty (`js/mnet.js` `paintMissionFeed`), so once the module is on the missions
  sit behind every current observation (USGS alone keeps up to 150 rows a day).
- The USGS source's "Latest observation" (E6) was the summary feed's generation time (`metadata.generated`), not an observation.
- The panel's search placeholder measured 2.1 to 2.9:1 and its "Sources, coverage and limitations" summary was a 23 px target.

### Integrated

- **Off, outage and no data on the wire** (`workers/mccluster/src/world-environment-guard.js`, new; one-line hooks in
  `world-environment.js` and `world-environment-layers.js`): the policy is read once per request; a module never installed (the
  store's EUM01) answers 404 `module_disabled`, the same answer as an installed, disabled module (decision D2, **default adopted
  pending Matthew's confirmation**); 503 `module_policy_unavailable` stays for store, schema (PGRST202, 42883), secret and
  malformed failures; 200 with nothing is no data. The pinned `server.mjs` is byte-identical: it receives this request's read
  through `loadPolicy`, and a write still reads the store again before it is made. `workers/mccluster/src/eup/modules.js` now
  attaches the store's SQLSTATE to a refused read (additive), so EUM01 and a missing function (42883), which the guard table names
  alike, are told apart.
- **SEC-2** (same file): concurrent misses for one kept copy share one provider read per isolate (a waiter that is not answered
  within 30 s, or whose leader failed, asks on its own, so a cancelled request strands nobody); at most 16 on-demand lookups are
  fetched at once per isolate; a per-client token bucket over the public GETs (120 at once, 2 a second) and a tighter one over the
  lookups (30, one every 2 s) answer 429 `rate_limited` with `retry-after`, keyed by `cf-connecting-ip` (an IPv6 address by its
  /64), held in isolate memory only (never stored, cached, logged or sent), at most 4,096 addresses; the water-level crawl ends by
  a 15 s deadline. The Cache API alone bounds neither: it keeps a copy after a fetch has finished, and every request that misses
  before then asks the provider.
- **E6**: the USGS source's latest observation is the newest quake's origin time among the quakes served, never the feed's
  generation time (the shared `fetchQuakes` and `normalizeQuake` are untouched: the owner's Halo layer reads them).
- **On the page**: `html[data-we-feed]` is `off`, `unavailable`, `empty` or `ready`, and `mnet.html` carries one line for each
  cause: off "Environmental reports are turned off for now.", an outage or this browser's network "Environmental reports are not
  available right now." (unchanged), no data "No qualifying environmental events right now." (`css/world-environment.css` shows
  only the line for the cause).
- **No re-asking** (`js/environment-layers-client.js`): a refusal is remembered (off 5 minutes, outage 1 minute); an activation
  within the hold says the same state again and asks nothing; after it one route asks first and the other four only once that
  answer is not a refusal. A policy result carries `gate: 'off' | 'outage'`; the visitor's own network stays `unavailable` with
  reason `network` or `timeout`.
- **The frame's legend** (`js/environment-layers.js`) names off ("Environmental layers are turned off for now"), an outage
  ("Environmental layers are not available right now"), an unreachable network ("Environmental layers could not be reached from
  this browser") and a layer whose provider reported nothing ("Fire perimeters: none reported right now").
- **E2**: a perimeter post's id and globe id are `wfigs:<NIFC id>`, the globe's own pick id (an id already prefixed is not
  prefixed twice).
- **E9** (decision D8, **default adopted pending Matthew's confirmation**): the Equity Uprise tab draws the missions first, a page
  of twenty with "Load more missions" right under them, then the observations under the heading "Environmental observations",
  newest first, with their own "Show more observations"; the feed's own Load more stays hidden in the tab.
- **The panel's two findings** in McCluster's sheet (`css/world-environment.css`): the search placeholder takes the panel's dim
  ink (`--we-dim`, 4.5:1 or better on the field by night and by day) and the sources summary is a 44 px row. The vendored panel is
  unchanged, so no local patch was needed.
- **The staging stand-in** (decision D1): `scripts/test/support/eup-environment-plane.mjs`, the real `handleWorldEnvironment` over
  the real applied module-policy SQL in PGlite, and `scripts/test/eup-environment-plane.integration.mjs` on it.

### Touched paths

`workers/mccluster/src/world-environment-guard.js` (new), `workers/mccluster/src/world-environment.js`,
`workers/mccluster/src/world-environment-layers.js`, `workers/mccluster/src/eup/modules.js`,
`workers/mccluster/test/world-environment-guard.test.mjs` (new), `workers/mccluster/test/world-environment.test.mjs`,
`workers/mccluster/test/world-environment-layers.test.mjs`, `js/environment-layers-client.js`, `js/environment-layers.js`,
`js/world-environment-mccluster.mjs`, `js/world-environment-posts.js`, `js/mnet.js`, `mnet.html`, `css/world-environment.css`,
`scripts/test/environment-layers-client.test.mjs`, `scripts/test/environment-layers-runtime.test.mjs`,
`scripts/test/world-environment-posts.test.mjs`, `scripts/test/world-environment.test.mjs`,
`scripts/test/equity-product-consumer.test.mjs`, `scripts/test/support/eup-environment-plane.mjs` (new), `scripts/test/eup-environment-plane.integration.mjs` (new),
`scripts/e2e/environment-world.e2e.mjs`, `scripts/e2e/world-environment.mjs`, `scripts/e2e/environment-globe.e2e.mjs`,
`scripts/e2e/fixtures/environment/feed-empty.json` (new), `.github/workflows/human-uprise-editorial.yml` (the plane as matrix
entry `environment-plane`, its paths in the filter), `docs/control-plane/WORLD-ENVIRONMENT.md`,
`docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md`, this file, and the source map
(`docs/design/equity-uprise-building/production/equity-uprise-repo-source-map-v2.json` with its generated coverage report).

### Tests

E=UP-only assertions changed on purpose, each named in its commit: the Worker gate-collapse tests (EUM01 is now off, 404; 42883 and
EUM00 join the outage cases), the layer client's "one retry on the next activation" (now: nothing within the hold), the ShakeMap
policy result (it carries its gate), the consumer test's pin of the inline `loadPolicy` (now the request's one read through the one
reader), and in the e2e suites the single sentence, the one list by time and the legend line for 404.
General-news and Drawdown-mission tests are unchanged (`world-missions-guest.e2e.mjs`, `world-mission-posts.test.mjs`,
`world-news-feed.test.mjs`).

| Command | Result at this slice | At `2855a4e9` (before) |
| --- | --- | --- |
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/world-environment-guard.test.mjs` | 9/9 pass | 9 fail |
| `... --test test/world-environment.test.mjs test/world-environment-layers.test.mjs test/eup-modules.test.mjs` | 86/86 pass | the two new EUM01-is-off tests fail |
| `PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/eup-environment-plane.integration.mjs` | 6/6 pass | 3 fail (not installed, installed-but-disabled bytes, USGS observed time); 3 pass (no data, draining, outage) |
| `node --test scripts/test/world-environment*.test.mjs scripts/test/environment-*.test.mjs scripts/test/globe-*.test.mjs scripts/test/world-mission-posts.test.mjs scripts/test/world-news-feed.test.mjs` | 227/227 pass | |
| `node --test scripts/test/environment-layers-client.test.mjs scripts/test/environment-layers-runtime.test.mjs scripts/test/world-environment-posts.test.mjs scripts/test/world-environment.test.mjs scripts/test/equity-product-consumer.test.mjs` | 51/51 pass | 9 fail, 42 pass (the S0 tests: the hold three times, the three gate states, the ShakeMap gate, the legend, the consumer pin, the perimeter seam, the page states) |
| `nice -n 15 node --test scripts/test/*.test.mjs` (the root suite, once) | 2769 tests: 2760 pass, 7 skipped, 2 fail; both were S0's own and are fixed in the next commit (below) | |
| `node --test scripts/test/equity-product-consumer.test.mjs scripts/test/action-network-redesign.test.mjs` after that fix | 13/13 pass | |
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/*.test.mjs` (the whole Worker suite, what its `npm test` runs; at `3ffe3565`) | 1965 tests: 1944 pass, 9 skipped, 12 fail, all twelve in `test/mnet-mission-flow.test.mjs`, which fail the same way at `2855a4e9` (they pin a `js/mnet.js` shape the release fixes changed before this slice) | the same 12 fail |
| `python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py` | 2898/2898 checks pass | |

The root suite's two failures: the World's page and script never write the mark out, not even in a comment, and S0's comments did
(`scripts/test/action-network-redesign.test.mjs`); and the consumer test pinned the inline `loadPolicy` S0 replaced
(`scripts/test/equity-product-consumer.test.mjs`, changed on purpose).

### Browser runs

One browser at a time (each command under the shared lock, `flock <lock> nice node <suite> <out>`), headless Chromium with
SwiftShader, `CESIUM_DIR` the pinned Cesium 1.131.0 build, fixtures only (no network, no Supabase). The first three ran at
`5e5397d3`; `environment-world.e2e.mjs` waited on the lock and ran at `5d1138d9` (the branch head with S1's records and S2's owner
routes, which contains every S0 commit) with this section's e2e checks added.

| Command | Result |
| --- | --- |
| `node scripts/e2e/world-environment.mjs <out>` | exit 0, 11 of 11 PASS: the page as it ships at 390, 820 and 1280, by day at each width, and the 503 and 404 lines at 390 (load 6.93 at the start) |
| `node scripts/e2e/world-missions-guest.e2e.mjs <out>` (unchanged) | exit 0, 279/279 checks passed |
| `node scripts/e2e/environment-globe.e2e.mjs <out>` | exit 0, 127 PASS, "all checks passed", including `scripts/perf/environment-globe-perf.mjs --check` |
| `node scripts/e2e/environment-world.e2e.mjs <out>` | exit 0, 228 PASS, "all checks passed" (load 4.26 at the end) |

What `environment-world.e2e.mjs` showed for S0:
- **The two lists (D8)** at 390, 820 and 1280: the three missions first, then the observations under "Environmental observations",
  each list newest first, each with its own more button; the feed's own Load more hidden in the tab.
- **The perimeter seam (E2)** at each width: a perimeter post's Show on globe selects `wfigs:2026-CAXXX-000001` on the globe,
  the post's own id.
- **Off, outage and no data** at 390: 503 shows "Environmental reports are not available right now." and the frame's legend
  "Environmental layers are not available right now"; 404 shows "Environmental reports are turned off for now." and "Environmental
  layers are turned off for now"; a feed with nothing in it shows "No qualifying environmental events right now."; each with no
  panel, no observation post and the three missions untouched, and nothing scrolls sideways at 390.
- **No re-asking**: after the refusal, four activations of the tab asked the layer routes 5 times in all (each route once); the
  release review had counted 6, 11, 16 and 21.
- **The panel's two findings** at 390, 820 and 1280, by night and by day: the search placeholder is the panel's dim ink (checked
  against `--we-dim` itself, so the field's typed ink cannot pass for it), 9.5:1 on its field by night and 8.76:1 by day; the
  sources summary is 44 px tall.

These browser checks were not run against the pre-change code: the off, outage and empty lines, the two lists and the seam rest on
the unit and Worker tests above, which fail at `2855a4e9`; the placeholder and summary figures before (2.1 to 2.9:1, 23 px) are
the release review's own measurements.

### Deviations from the plan, with reasons

- **Rate limit scope.** The plan asked for a per-client limit on the parameterized lookups; the limiter also covers every public
  GET (a looser bucket), because every public request reads the policy from Supabase and nothing else bounded that per client.
  A request without Cloudflare's client address (only tests and local tools send one) is not limited.
- **The station list.** The review's hint to refuse a station when NOAA's station list cannot be read was not taken: the Worker
  test pins "an unreadable list does not block a reading" as intended, and the per-client lookup limit already bounds that path.
- **The panel test.** The plan named `world-environment-panel.test.mjs` for the perimeter seam; the vendored panel passes the
  digest's id through unchanged, so the seam is proven where the post is built (`world-environment-posts.test.mjs`, the real
  unprefixed digest from `scripts/e2e/fixtures/environment/layers-perimeters.json`) and through the real page (the integration e2e).
- **The tab with no missions.** With observations present and no open mission, the tab now says "No missions are open right now."
  above the observations' own list (before, the observations alone).
- **Coalescing in workerd.** Shared provider reads are proven in Node; that a waiter survives its leader's request being cancelled
  rests on the waiter's own 30 s timer, not on a workerd run.
- **Visitor lines at one width.** The plan asked for the three visitor lines at 390, 820 and 1280; the browser proves them at 390
  only (the line, the panel and the posts do not change with width), and the unit tests prove the page's states and the sheet's
  rule for each.

### Waiting for Matthew's separate go

- The Worker change reaches production only with the merge of a pull request he approves (also the deploy).
- Install, then Enable, of the environment module in Control (each a production policy change; Install alone makes the public
  answer 404 off).
- Decisions D1, D2 and D8 as adopted defaults; a staging resource, if he wants one.
- Nothing was applied, installed, enabled, flagged or published.

## S1. Canonical event store, as pending SQL only

### Present before

At `2855a4e9` (and at `5e5397d3`, the head this slice merged before its records):

- No event store. Posts were rebuilt in page memory from the providers' current windows on every read; the only identity was the
  string `<provider>:<id>` built from whatever id the provider sent that minute. USGS `updated`, `ids`, `status`, `net`, `code`,
  `sig` and `magType` were dropped at the first hop (`normalizeQuake`, `workers/mccluster/src/world-halo-layers.js`, which this slice
  leaves untouched: the owner's Halo layer and the news pairing read it), so a preferred-id change (`attn6uqd` became `us6000u3jl`)
  made a new, unlinked post, a correction overwrote the old value, and a USGS deletion vanished silently.
- No durable source health (the Cache API, per Cloudflare location, 7 days), no per-event or per-provider owner control, no decision
  log for either, no place to bind news coverage to an event and its revision. The pending `20261107120000_world_environment_v1.sql`
  covers mission review only and has no rollback file.
- The pattern to follow was there: the applied module policy (`supabase/migrations/20261117144103_eup_module_policy_v1.sql`), with
  its owner-only commands, idempotency keys, expected revisions, reasons and append-only command log.

### Integrated

Five pending parts and one rollback, `supabase/pending/20261119100000_eup_environment_events_v1_01.sql` to `_05.sql` and
`20261119100000_eup_environment_events_v1.rollback.sql` (`supabase/pending/PROMOTION-ORDER.md` section 12). Nothing is applied.

- **Seven tables**, row level security on, no policy, every privilege taken back from `PUBLIC`, `anon`, `authenticated` and
  `service_role` before the one grant (EXECUTE on seven entry points, to `service_role` only): `eup_environment_providers` (ingest
  active or paused, publication shown or hidden, the publication rule, a revision), `eup_environment_events` (one row per canonical
  event: state, revision, the snapshot at that revision, observed, USGS-updated, retrieved, revised and first-published times),
  `eup_environment_event_revisions` (append-only: every revision's snapshot, its change old -> new, its cause, the source and fetch
  times), `eup_environment_event_aliases` (append-only: provider id -> canonical id), `eup_environment_source_health` (append-only,
  one row per ingest run: ok, empty, unavailable or paused, with counts and reasons; rows older than 30 days leave through the
  ingest's own purge only), `eup_environment_decisions` (the owner's append-only decision log, the module policy's command-log rules)
  and `eup_environment_coverage` (news coverage bound to a canonical event and its revision).
- **Identity (D5, default adopted pending Matthew's confirmation)**: the canonical id is `<provider>:<the provider's preferred id
  when the store first saw the event>`, never reassigned; every id the provider lists is an alias; a read by any alias answers the
  canonical event with `redirected_from`; when the provider lists ids of two stored events as one, the one published later becomes a
  redirect (`merged`).
- **Revisions (D6, default adopted pending Matthew's confirmation)**: a new revision only for origin time (1 s or more), location (1
  km or more), depth (1 km or more), magnitude or its type, review status, tsunami flag, PAGER alert or deletion; USGS `updated` and
  significance are kept and shown but never make a revision; a rerun of the same content writes no event row at all.
- **Publication (D7, default adopted pending Matthew's confirmation)**: M4.5+ worldwide, automatic events included (the public
  shape carries `review_status`), plus significance above 600, a PAGER alert or a tsunami flag, as an owner rule with a revision
  (`set_rule` without a rule stores this default). A rule change applies from each event's next ingest; a published event is never
  unpublished, by a rule change or by a downward correction.
- **States (D12, default adopted pending Matthew's confirmation)**: `candidate` (stored, not qualifying, never public), `published`,
  `held` (owner; hidden, its deep link answers `not_available`), `withdrawn_by_source` (a tombstone with no coordinates, so no globe
  object; its deep link answers it), `retracted` (owner; the same tombstone), `merged` (a redirect). The state is decided by the facts
  (a CHECK holds every row to it), and the owner's hold, release, retract and restore never move the content's revision.
- **Entry points**: `eup_environment_ingest` (one call per run, idempotent per run id, one health row per run, USGS only),
  `eup_environment_public_events` (a keyset page, newest observation first, whitelisted fields, with each shown provider's last run
  and last successful read, so no data is told from an outage) and `eup_environment_public_event` (canonical id or any alias), both
  gated in SQL by the environment module policy as the Worker gates them (EUM01 not installed, EUM03 disabled; draining still reads); `eup_environment_owner_preview` (the same page while the module is off; decision D11, an
  authorization addition that ships only with Matthew's approval of the pull request that calls it); `eup_environment_owner_read`
  (every provider with its rule, last run and last success, the health log, the review queue, the decisions; one event in full);
  `eup_environment_owner_command` (hold, release, retract, restore, rollback to revision N as a new revision, provider pause, resume,
  hide, show and rule, coverage attach, reject and retract; the house owner only, a reason of 1-500 characters, an idempotency key
  and the expected revision, 409 when it moved); `eup_environment_coverage_propose` (what a matcher found).
- **Coverage** (the store's half of E5; the matcher is S8): accepted only for a published event at its current revision, on an
  official identifier that is one of the event's own aliases (found in the article's URL or headline; attaches at once, stays
  retractable) or on the incident type, a place term from USGS's own place text found in the headline and a time within 72 hours
  (waits for the owner, decision D10). The basis carries words and identifiers only, never coordinates, so a GDELT mention point
  cannot be the evidence. A correction makes type-place-time matches stale and moves official-identifier matches to the new
  revision; a withdrawal, merge or owner retraction retracts them; a rejection, or an owner's retraction, sticks.
- **Only government providers (E4, E8)**: `usgs`, `nws`, `nhc`, `eonet`, `firms`, `wfigs`, `coops`; `gdelt` is refused by every
  table's CHECK, by the ingest and by the owner's commands; news can never create, revise or publish an event.
- **For the later slices**: `scripts/test/support/eup-environment-database.mjs` applies the policy and the five parts in PGlite and
  carries `ENVIRONMENT_STORE_RPC`, a PostgREST stand-in for the owner routes (S2), the ingest (S3) and the public routes (S4).

### Touched paths

`supabase/pending/20261119100000_eup_environment_events_v1_01.sql` to `_05.sql` (new),
`supabase/pending/20261119100000_eup_environment_events_v1.rollback.sql` (new), `supabase/pending/PROMOTION-ORDER.md` (section 12),
`supabase/pending/README.md`, `scripts/test/support/eup-environment-database.mjs` (new),
`scripts/test/eup-environment-events.integration.mjs` (new), `scripts/test/eup-environment-events.native.integration.mjs` (new),
`scripts/test/eup-environment-events-sql.test.mjs` (new), `.github/workflows/human-uprise-editorial.yml` (matrix entry
`environment-store`, its paths in the filter), and this section.

### Tests

| Command | Result |
| --- | --- |
| `PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/eup-environment-events.integration.mjs` | 294 assertions pass (about 3.6 s) |
| the same with `EUP_ENVIRONMENT_PARTS_DIR` naming eight mutated copies of the parts, one weakening each (a 0.1 km depth threshold, a SELECT grant to `anon`, the append-only guard off, `gdelt` in the provider list, the public gate removed, USGS `updated` making a revision, coverage at any revision, a hold ignoring the expected revision) | each of the eight fails it |
| the same with the five parts absent (`EUP_ENVIRONMENT_PARTS_DIR` naming an empty folder: the tree before this slice) | fails (ENOENT, part 01) |
| `ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=/usr/lib/postgresql/16/bin PG_MODULE=<node-postgres 8.23.1> node scripts/test/eup-environment-events.native.integration.mjs` | 29 checks pass on PostgreSQL 16.15 |
| the same with a PostgreSQL 17.7 `PG_BIN` | 29 checks pass (production runs 17.6) |
| the native proof over two mutated copies (the idempotency-key lock removed; the provider lock removed) | both fail (duplicate key on the decision log; duplicate key on the events) |
| `node --test scripts/test/eup-environment-events-sql.test.mjs scripts/test/editorial-ci-partition.test.mjs` | 8/8 pass |
| `node --test scripts/test/rpc-names-exist.test.mjs scripts/test/mission-import.test.mjs` | 29/29 pass |
| `PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/eup-environment-plane.integration.mjs` (S0's plane, after the merge) | 6/6 pass |
| `nice node --test scripts/test/*.test.mjs` (the whole root suite, once, load average 4.8 rising to 7.9) | 2,776 tests: 2,769 pass, 0 fail, 7 skipped (81.5 s) |
| `python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py` | 2,898/2,898 checks pass (no new file needs a map entry) |

The native proof shows what one PGlite session cannot: two ingest runs of one provider queue on the provider lock and the second
changes nothing; one idempotency key on two sessions runs once; an owner hold waits for an ingest that holds the event and is then
refused at the old revision; a coverage proposal and a withdrawal of one event queue on the event row in either order without a
deadlock; and an owner command behind a held row gives up after the 5 s lock timeout (55P03), changing nothing. Every RPC there
commits as `service_role`, which is how the commit-time revision check was found to need SECURITY DEFINER (it reads the history at
COMMIT as whoever commits; it only reads).

### Deviations from the plan, with reasons

- **Five parts, not one file.** The store is about 110 KB of SQL; the repository records 32,000 bytes as what one
  `apply_migration` call carries safely and requires the stored statement to equal the committed file (`PROMOTION-ORDER.md` 10.3).
  Each part is one transaction that refuses until the part before it is in; one rollback undoes any number of them.
- **The public reads are gated in SQL too**, not only by the Worker's gate, so the public shape stays unreachable while the module
  is off even if a later route forgets the gate; the owner's preview is the only way round, and it is owner-only.
- **A `candidate` state** beside the plan's five, for events stored but not qualifying (the owner's review queue lists them with
  whether they would qualify under the current rule).
- **The revision is the content's.** The plan asked for hold, restore and rollback "with the expected revision"; hold, release,
  retract and restore are logged decisions that do not move the revision (a post's revision changes only when what it shows
  changes), and a rollback makes revision N's content a new revision. An ingest that still sees the source differ revises it
  again, so the documented recovery for a wrong source is to pause the provider first.
- **Origin time counts from 1 s** (D6 named no threshold), and **health rows are kept 30 days** (the plan said "bounded" without a
  number): both defaults adopted pending Matthew's confirmation.
- **Two provider switches**: `pause_provider` stops the ingest; `hide_provider` takes the provider's events out of the public reads.
- **Coverage intake in S1.** The plan puts the coverage table here and the matcher in S8; the intake and lifecycle live with the
  table so there is one SQL approval, and S8 can still amend these pending parts before they are applied.
- **No `live-callers.json` entry**: no shipped code calls these names yet. S2, S3 and S4 add the callers and their `pending_only`
  entries.

### Waiting for Matthew's separate go

- Applying the five parts, each on his approval of its exact text, in order, independent of and after the mission publish (release
  step 9); then their promotion records. Applying them changes nothing public until the ingest flag and the environment module are
  turned on.
- Decisions D5, D6 (with the 1 s origin-time threshold), D7, D10, D11 and D12, and the 30-day health retention, as adopted defaults.
- Setting the USGS rule in production (an owner command, once S2's route ships), the ingest flag (S3), and Install then Enable of
  the environment module (D3).
- Nothing was applied, installed, enabled, flagged or published.

## S2. Owner controls first: source health, review and rollback

### Present before

At `171bcaad` (the head this slice started from):

- The owner's E=UP controls were module-level only: Control › System › E=Up › Overview › Modules installs, enables, drains and
  disables the environment unit with a reason, a revision and a key (`js/control-room/eup.js`, `workers/mccluster/src/eup/modules.js`).
  Nothing showed the owner the environmental providers while the module is off: their health lived only inside the gated public
  answers, which refuse before any provider is asked. Control's Sources & Review tab covers the intake connectors, not one
  environmental provider.
- S1's pending store had the owner's three entry points (`eup_environment_owner_read`, `_owner_preview`, `_owner_command`) but no
  route called them, so there was no review queue, no hold, withdrawal, restore or rollback of one event, no provider pause or rule,
  and no owner preview.

### Integrated

- **Owner routes** (`workers/mccluster/src/eup/environment/owner.js`, new; one section entry in `workers/mccluster/src/eup/router.js`),
  behind the existing house-owner check (`requireHouseOwner`, `workers/mccluster/src/index.js`): a signed-out request is 401 and a
  signed-in account that is not a house owner 403 before anything is read; every answer is `private, no-store`; the acting owner is
  always the session user, never a body field, and the store checks the owner again (42501).
  - `GET /v1/eup/environment/health`: every E=UP source, three facts each. **What a signed-out visitor gets now**: off (the module
    not installed or disabled, 404 `module_disabled`; or the provider not configured here, FIRMS without the Worker secret
    `FIRMS_MAP_KEY`, named, never read into an answer), outage (the module policy unreadable, 503; or the provider failing, a kept
    copy marked `stale` still served), no data (the provider answered with nothing) or reporting. **What the provider answers now**:
    a live read of every public surface (the feed's four sources and the five globe layers) through the public routes' own code and
    kept copies (the Cache API keys `consumer-environment-v1-*` and S0's shared in-flight reads), whatever the module's state, so an
    owner check never asks a provider twice for what a visitor's page is asking. **What the store recorded**: the provider's rule,
    ingest active or paused, timeline shown or hidden, its last ingest run (ok, empty, unavailable, paused) and last success, from
    S1's durable log.
  - `GET /v1/eup/environment/review`: the queue (candidates with whether they would qualify, held, withdrawn by the owner,
    withdrawn by USGS, merged, corrected, coverage waiting), the providers and the decision log. `GET /v1/eup/environment/events/:id`:
    one event in full (its revisions with their changes, aliases, coverage, decisions and its public shape).
  - `GET /v1/eup/environment/preview` (decision D11, **default adopted pending Matthew's confirmation**): the public timeline page
    exactly as the store projects it, readable while the module is off. It is an **authorization addition** (the owner reads what
    the public cannot yet) and ships only with Matthew's approval of the pull request.
  - `POST /v1/eup/environment/commands`: `hold`, `release`, `retract` (the owner's withdrawal, labelled Withdraw), `restore`,
    `rollback {to_revision}` (restore an older revision as a new one); `set_rule` (without a rule: the D7 default),
    `pause_provider`, `resume_provider`, `hide_provider`, `show_provider`; `attach_coverage`, `reject_coverage`, `retract_coverage`.
    The module policy's body rules (`modules.js`): a key of 8-128 safe characters, a reason of 1-500 characters on one line, the
    revision that was read; every one is checked before the store is called, and `gdelt` (news) is refused as a provider. The same
    key and command answer the stored receipt (idempotent); a moved revision is 409 `revision_conflict`; a key reused for another
    command is 409 `idempotency_conflict`. Store text and provider messages never reach the owner: codes and fixed sentences.
  - **Honest before anything is applied.** Until the five pending parts are applied their functions do not exist: a read answers 200
    with `store.status` `not_applied` (and the parts' paths) and everything else it knows (the module, the providers now); a
    command answers 503 `store_not_applied` and records nothing. An unreachable store is `store.status` `unavailable` on the health
    read and 503 `storage_unavailable` elsewhere; on a command that is an unknown outcome. While the module is off every route still
    answers: the owner sees sources, review and preview before anything is public, and nothing here installs, enables or changes
    the module.
- **Control** (`js/control-room/eup-environment.js`, new, `window.CR.eupEnvironment`; created by `js/control-room/eup.js` as the
  League tab is; `control.html` loads it and `css/control-eup-environment.css`): a sixth local tab, **Environmental events**, in the
  existing E=Up workspace, with four views. *Sources*: the module and the store in a sentence each, then every source with its public
  state and its provider state as chips and in words (never colour alone), each surface's health, the store's line, and for USGS the
  rule form (minimum magnitude, automatic events, significance, PAGER alert, tsunami), Set this rule, Set the default rule, and once a
  rule exists Pause or Resume the ingest and Hide or Show on the timeline. *Review*: the queue, Read again, and an opened event with
  its revisions (old → new), Hold, Release, Withdraw, Restore, "Restore revision N as revision M" (rollback), coverage decisions and
  the decisions on it. *Preview*: what it is (D11), what the public answers now, the projection with corrections and tombstones,
  paging. *Decisions*: the append-only log. Commands follow the module policy card: a required reason, the revision that was read, a
  fresh key, buttons that wait (aria-disabled, still focusable) while one is pending, a read-back after each; a timeout, a lost
  answer or an unreadable answer is an unknown outcome that is never resent by itself: the decision log is read back and searched for
  its key (found: recorded; absent: the same key and body can be sent by hand). The slow live check gets its own requester with a
  45 s deadline; every other read keeps eup.js's 15 s. Mobile first: one column at phone width, full-width 44 px buttons and 16 px
  fields, room at 720 and 1024 px with `min-width` queries only and `minmax(0, 1fr)` tracks; the four views are a row of tabs that
  scrolls inside itself.
- **The staging stand-in** (decision D1): `scripts/test/support/eup-environment-owner-plane.mjs`, the real Worker router for `/v1/eup`
  over the real module policy and the five pending parts in PGlite, with PostgREST bound by argument name and declared type (the
  League plane's emulation, reused unchanged), so the Worker's argument names are checked against the real SQL; the providers are
  small built answers; faults drop a committed answer.

### Touched paths

`workers/mccluster/src/eup/environment/owner.js` (new), `workers/mccluster/src/eup/router.js`,
`workers/mccluster/test/eup-environment-owner.test.mjs` (new), `workers/mccluster/test/eup-router.test.mjs`,
`supabase/pending/live-callers.json` (the three owner functions as `pending_only` of their parts),
`scripts/test/support/eup-environment-owner-plane.mjs` (new), `scripts/test/eup-environment-owner.integration.mjs` (new),
`js/control-room/eup-environment.js` (new), `js/control-room/eup.js`, `control.html`, `css/control-eup-environment.css` (new),
`scripts/test/control-eup-environment.test.mjs` (new), `scripts/test/control-eup.test.mjs`,
`scripts/e2e/control-eup-environment.e2e.mjs` (new), `.github/workflows/human-uprise-editorial.yml` (matrix entries
`environment-owner` and `environment-control`, their paths in the filter), `docs/control-plane/EUP-ADMIN-WORKSPACE.md`, this
section, and the source map (the Worker test; `docs/design/equity-uprise-building/production/equity-uprise-repo-source-map-v2.json`
with its generated coverage report).

### Tests

E=UP-only assertions changed on purpose, each named in its commit: `workers/mccluster/test/eup-router.test.mjs` lists `environment`
among the E=Up sections, and `scripts/test/control-eup.test.mjs` counts six local tabs (End now reaches Environmental events).
General-news and Drawdown-mission tests are unchanged.

| Command | Result | At `171bcaad` (before) |
| --- | --- | --- |
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/eup-environment-owner.test.mjs` | 15/15 pass | the file cannot load (`owner.js` does not exist) |
| `... --test test/eup-router.test.mjs test/eup-modules.test.mjs test/eup-overview-status.test.mjs test/world-environment.test.mjs test/world-environment-layers.test.mjs test/world-environment-guard.test.mjs` | 105/105 pass | |
| `PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/eup-environment-owner.integration.mjs` | 9/9 pass | 8 fail, 1 passes (the owner-only routing already existed) |
| `node --test scripts/test/control-eup-environment.test.mjs scripts/test/control-eup.test.mjs scripts/test/control-eup-league.test.mjs` | 63/63 pass | `control-eup-environment.test.mjs` cannot load; with the view file but without the `eup.js` hook 7 of its 8 fail (only the pure helpers pass) |
| `node --test scripts/test/rpc-names-exist.test.mjs` and `scripts/test/editorial-ci-partition.test.mjs` | 3/3 and 1/1 pass | |
| after merging the branch head `5d801add` (release review RS-9): the owner and router Worker tests, `world-gate` and `world-news-tint` unit tests, the owner integration | 22/22, 28/28, 8/8 pass | |
| `nice -n 15 node --test scripts/test/*.test.mjs` (the root suite, once; load 4.3 rising to 7.0) | 2,786 tests: 2,779 pass, 0 fail, 7 skipped (76.4 s) | |
| `cd workers/mccluster && nice -n 15 node --import ./test/support/offline-network.mjs --test test/*.test.mjs` (the whole Worker suite, what its `npm test` runs) | 1,980 tests: 1,959 pass, 9 skipped, 12 fail, all twelve in `test/mnet-mission-flow.test.mjs`, which fail the same way at `171bcaad` (0/12; recorded by S0 as well) | the same 12 fail |
| `python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py` | 2,902/2,902 checks pass | |
| `PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> PLAYWRIGHT_DIR=<node_modules> node scripts/e2e/control-eup-environment.e2e.mjs <out>` (under the shared browser lock) | queued behind other agents' browser runs when this section was written; its result is recorded under "Browser run" below once it has run | |

### Deviations from the plan, with reasons

- **A new browser suite.** The plan named `scripts/e2e/control-eup.e2e.mjs`; the proof is a new file,
  `scripts/e2e/control-eup-environment.e2e.mjs`, at 390, 820 and 1440, with its own CI matrix entry. Several agents edit this branch at
  once (new files over shared ones), and `control-eup.e2e.mjs` is in no CI workflow today.
- **The store's command names.** The plan's "withdraw" is the store's `retract` (labelled Withdraw) and "restore revision N" is
  `rollback {to_revision}`; the store's `restore` undoes a withdrawal, and its coverage commands are offered on the opened event.
- **The live check is slow on a cold cache.** It reads every provider with the public routes' own timeouts (FIRMS up to 25 s) and
  answers when all have settled; Control gives that one read a 45 s deadline. A provider that does not answer within its own timeout
  is an outage with reason `timeout`, as the public route would report it.
- **"Store not applied" is a state, not a failure** on reads (200 with `store.status`), and a settled refusal on commands (503
  `store_not_applied`: nothing was recorded), so the owner sees the providers and the module before Matthew applies anything.
- **The sixth tab is appended**, so the existing tab order and keyboard paths keep their meaning; only End moves.
- **No provider other than USGS takes a command**: the store refuses them (`provider_not_supported`) until their ingests exist (S9).

### Waiting for Matthew's separate go

- The pull request and its merge (also the Worker deploy). The owner preview (D11) is an authorization addition that ships only
  with his approval of that pull request.
- Applying S1's five parts in production: until then every route here answers "store not applied" and records nothing.
- Setting the USGS rule, and any hold, withdrawal or rollback, in production: owner commands, his own acts, once the parts are applied.
- Install, then Enable, of the environment module (D3): in Overview › Modules, unchanged by this slice.
- Decisions D1 and D11 as adopted defaults. Nothing was applied, installed, enabled, flagged or published.
