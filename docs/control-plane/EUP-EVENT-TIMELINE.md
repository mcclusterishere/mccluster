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
  `service_role` before the one grant (EXECUTE on seven entry points, eight since S3's read below, to `service_role` only): `eup_environment_providers` (ingest
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
    read and 503 `storage_unavailable` elsewhere; on a command that is an unknown outcome, while a read only says that nothing was
    read (a busy store: read again). While the module is off every route still
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
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/eup-environment-owner.test.mjs` | 15/15 pass | the file cannot load (`owner.js` does not exist); its read-wording assertions also fail against `5d1138d9`'s `owner.js` (14/15: a read was told "the outcome is unknown") |
| `... --test test/eup-router.test.mjs test/eup-modules.test.mjs test/eup-overview-status.test.mjs test/world-environment.test.mjs test/world-environment-layers.test.mjs test/world-environment-guard.test.mjs` | 105/105 pass | |
| `PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/eup-environment-owner.integration.mjs` | 9/9 pass | 8 fail, 1 passes (the owner-only routing already existed) |
| `node --test scripts/test/control-eup-environment.test.mjs scripts/test/control-eup.test.mjs scripts/test/control-eup-league.test.mjs` | 63/63 pass | `control-eup-environment.test.mjs` cannot load; with the view file but without the `eup.js` hook 7 of its 8 fail (only the pure helpers pass) |
| `node --test scripts/test/rpc-names-exist.test.mjs` and `scripts/test/editorial-ci-partition.test.mjs` | 3/3 and 1/1 pass | |
| after merging the branch head `5d801add` (release review RS-9): the owner and router Worker tests, `world-gate` and `world-news-tint` unit tests, the owner integration | 22/22, 28/28, 8/8 pass | |
| `nice -n 15 node --test scripts/test/*.test.mjs` (the root suite, once; load 4.3 rising to 7.0) | 2,786 tests: 2,779 pass, 0 fail, 7 skipped (76.4 s) | |
| `cd workers/mccluster && nice -n 15 node --import ./test/support/offline-network.mjs --test test/*.test.mjs` (the whole Worker suite, what its `npm test` runs) | 1,980 tests: 1,959 pass, 9 skipped, 12 fail, all twelve in `test/mnet-mission-flow.test.mjs`, which fail the same way at `171bcaad` (0/12; recorded by S0 as well) | the same 12 fail |
| `python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py` | 2,902/2,902 checks pass | |
| `PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> PLAYWRIGHT_DIR=<node_modules> flock <shared browser lock> nice -n 5 node scripts/e2e/control-eup-environment.e2e.mjs <out>` (at `4db88181`) | 101/101 checks pass: 31 each at 390, 820 and 1440 px, 7 with the store not applied and 1 for a plain member (both at 390 px); no horizontal overflow at any of the six steps (`scrollWidth === clientWidth`); on Sources every button at least 44 px tall and every field labelled, 44 px tall, 16 px type; load 3.7 when it ended | not run: one browser at a time is shared by every agent, and at `171bcaad` neither `control.html` nor `js/control-room/eup.js` has the tab the proof opens first |

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

## S3. The USGS ingest into the store (private, flag off)

### Present before

At `4f9a304b` (the head this slice started from):

- S1's pending store could take USGS events (`eup_environment_ingest`, with its field-by-field input check, the alias table, the
  substantive-change rule and the tombstones), and S2's Control showed each provider's last ingest run and let the owner set the
  USGS rule, pause it or hide it, but nothing called the ingest. The only USGS reader on the public side was the layers' first
  hop, `normalizeQuake` (`workers/mccluster/src/world-halo-layers.js`), which drops `ids`, `updated`, `status`, `net`, `code`, `sig`
  and `magType`; the private intel collector (`workers/mccluster/src/intel/usgs-collector.js`) re-reads only the hour before its
  cursor, never asks for deletions and keys `usgs:<id>:<updated>`, so it cannot be the timeline's source of revisions or
  withdrawals.
- No service-role read could tell an ingest which published events to look for while the module is off: the public reads are
  gated in SQL (EUM01 / EUM03) and the owner's reads need an owner as actor.
- The ShakeMap route reported a deleted event (USGS answers 409) as `source_unavailable`, an outage it was not (lane 06 inferred
  it from the code; this slice's test showed it at `4f9a304b`).

### Integrated

- **The normaliser** (`workers/mccluster/src/eup/environment/usgs.js`, new, pure: no network, store or clock). A USGS GeoJSON event,
  a summary-feed row or an FDSN answer by id, becomes exactly the store's input: the preferred id, every id USGS associates
  (the preferred one first, at most 50), status (automatic, reviewed, deleted), origin time, USGS `updated`, position and depth,
  magnitude and its type, place, title, the USGS event page, significance, PAGER alert, tsunami flag, net and code. Values are the
  event's own properties, never a product's (an FDSN answer by id lists every origin, and with `includesuperseded` every
  superseded version too). A row the store would refuse (no id, an unknown status, no origin time, no position) is dropped and
  counted, never guessed; a link off USGS's host becomes the USGS event page; control characters never reach the store.
  `normalizeQuake` is untouched: the owner's Halo layer and the news pairing read it.
- **One run per cron tick** (`workers/mccluster/src/eup/environment/ingest.js`, new):
  1. the store's view first, `eup_environment_ingest_state`: with the parts not applied, no USGS rule yet, or an unreadable
     store, the run stops and asks USGS nothing; a paused provider records its health row (`paused`) and asks USGS nothing;
  2. the real-time summary feed for the owner's rule, through `upstream()` (`workers/mccluster/src/world-layers.js`: no
     cross-host redirect, typed failures, 15 s): the M2.5+ day, or the M1.0+ day or every magnitude when the rule's minimum is
     lower; a failed read is the run's health (`unavailable`, `upstream_error`, `timeout` or `invalid_data`, with USGS's status)
     and nothing else;
  3. published events the feed no longer lists while they are still inside its day: at most five FDSN look-ups by id a run,
     newest first, `jsonerror=true`. A 409 is a deletion (the store withdraws the event and keeps its tombstone), another
     preferred id is followed (the store resolves the alias, or merges two stored events), a 404 is asked again on a later run
     and changes nothing. Events within 30 minutes of the start of the feed's day are ageing out and never "missing"; events
     below the feed's magnitude floor are not looked for;
  4. once a day, on the 03:10 UTC tick, one FDSN search for what USGS updated in the last 48 hours, deletions included
     (`updatedafter`, `includedeleted=true`, origins from 30 days back), kept to the events the store has published in those 30
     days: late corrections and late deletions. 48 hours, so a missed day is still covered;
  5. one `eup_environment_ingest` call with everything read (one answer per event, the newest by USGS's own update time; past
     1,800 the smallest magnitudes are dropped and counted, deletions never), so one health row a run. The run id is the tick
     (`usgs-20261119T0450Z`, `-sweep` on the sweep tick): a tick delivered twice records once (the store refuses the second,
     EUE05). Identity (D5: the canonical id is the first one the store saw), what makes a revision (D6), what qualifies (D7) and
     the tombstones (D12) are the store's own rules, decided in the same transaction as the alias table; the Worker sends what
     USGS says.
- **The store's read** (`supabase/pending/20261119100000_eup_environment_events_v1_03.sql`, still pending, part 03 now 31,085 bytes):
  `eup_environment_ingest_state(provider, since, limit)`, read-only and EXECUTE for `service_role` only, answers the provider's
  switches and rule and the events ever published that are neither withdrawn nor merged (held and retracted ones included: USGS
  can still delete them), each with its aliases and last magnitude. It reads no person, decision or coverage and is not gated by
  the module (the ingest fills the store before anything is public). Part 01's header lists it, the rollback drops it, and
  `supabase/pending/live-callers.json` names it and `eup_environment_ingest` as `pending_only` callers of part 03.
- **The flag and the hook**: `workers/mccluster/src/entry.js` runs the ingest on the existing five-minute cron only when
  `EUP_ENVIRONMENT_USGS_INGEST_ENABLED` is `"true"`; `workers/mccluster/wrangler.toml` sets `"false"`. Off, the hook makes no
  network call and no store call (decision D20, **default adopted pending Matthew's confirmation**: the Worker cron, like the
  private collector). The report it logs carries counts and codes, never a store or provider message or a credential.
- **ShakeMap for a deleted event** (`workers/mccluster/src/world-environment-layers.js`, two lines): USGS's 409 is `reason`
  `withdrawn`, the source is reported as answering, not down (`docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md` lists the reason).
- **Recorded USGS answers** (`workers/mccluster/test/fixtures/environment/usgs-ingest/`, nine files, 35,855 bytes): read from
  earthquake.usgs.gov on 2026-11-19 between 04:50:41 and 05:02:16 UTC, each wrapped with its request, retrieval time, HTTP status,
  content type and what was trimmed (whole rows or bulky product listings only): 15 of the 35 rows of the M2.5+ day, the alias
  look-up `attn6uqd` (answers `us6000u3jl`), a deleted event (`aka2026wpvhsf`, M3.8) answered three ways (200 with
  `metadata.status` 409 under `jsonerror`, the plain 409, and the `includedeleted` record) plus the detail feed's own 409, an
  unknown id (404 under `jsonerror`), the `includesuperseded` history of `us6000u3jl` (five origin versions: NTWC M6.6 automatic,
  PTWC M6.6, NEIC M6.3 and two relocations), and a sweep answer holding one deleted and one automatic row. What a test builds
  from them (a feed envelope at an earlier time, the event as ComCat showed it at a moment of its history, a deleted event's row
  before its deletion) is built in `workers/mccluster/test/support/usgs-ingest-fixtures.mjs` and labelled BUILT. No test reaches
  the network: the Worker suite's guard refuses any unmocked fetch.
- Decisions D5, D6, D7 and D20 as used here, and the bounds above (the feed floor, five look-ups, the 03:10 sweep over 48 hours
  and 30 days), are **defaults adopted pending Matthew's confirmation**. No production read was needed for this slice.

### Touched paths

`workers/mccluster/src/eup/environment/usgs.js` (new), `workers/mccluster/src/eup/environment/ingest.js` (new),
`workers/mccluster/src/entry.js`, `workers/mccluster/wrangler.toml`, `workers/mccluster/src/world-environment-layers.js`,
`workers/mccluster/test/eup-environment-usgs.test.mjs` (new), `workers/mccluster/test/support/usgs-ingest-fixtures.mjs` (new),
`workers/mccluster/test/fixtures/environment/usgs-ingest/` (new, nine files), `scripts/test/eup-environment-ingest.integration.mjs`
(new), `supabase/pending/20261119100000_eup_environment_events_v1_01.sql` (header line), `_03.sql` (the read),
`supabase/pending/20261119100000_eup_environment_events_v1.rollback.sql`, `supabase/pending/live-callers.json`,
`supabase/pending/PROMOTION-ORDER.md` (section 12), `supabase/pending/README.md`, `scripts/test/support/eup-environment-database.mjs`,
`scripts/test/eup-environment-events.integration.mjs`, `scripts/test/eup-environment-events.native.integration.mjs`,
`.github/workflows/human-uprise-editorial.yml` (matrix entry `environment-ingest`, its paths in the filter),
`docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md`, the source map
(`docs/design/equity-uprise-building/production/equity-uprise-repo-source-map-v2.json` with its generated coverage report), and
this section.

### Tests

E=UP-only assertions changed on purpose, named in the commit: S1's store tests now count eight entry points and 29 functions
(`scripts/test/eup-environment-events.integration.mjs`, `.native.integration.mjs`, `scripts/test/support/eup-environment-database.mjs`).
General-news and Drawdown-mission tests are unchanged.

| Command | Result | Before the change |
| --- | --- | --- |
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/eup-environment-usgs.test.mjs` | 17/17 pass | at `4f9a304b` the file cannot load (`usgs.js` does not exist) |
| the same, with only `src/world-environment-layers.js` set back to `4f9a304b` | 16/17: "ShakeMap: a deleted event is withdrawn by USGS, not a source outage" fails (`source_unavailable`) | |
| the same, with only `src/entry.js` set back | 16/17: "the cron hook runs the ingest only with the flag, and the hook is wired" fails | |
| the same, with only `wrangler.toml` set back | 16/17: "flag off: no network call and no store call" fails (no committed `"false"`) | |
| `PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/eup-environment-ingest.integration.mjs` (the CI line) | 7/7 pass (about 6 s): flag off makes no call; not applied and no rule ask USGS nothing; the recorded day publishes 9 of 15 (M4.5+) and keeps 6 candidates, a rerun changes nothing; the recorded history `attn6uqd` -> `pt26293000` -> `us6000u3jl` replayed tick by tick stays one event `usgs:attn6uqd` with revisions 1-6 (a DYFI-only tick and a ground-failure tick refresh without one; the 2026-11-10 relocation arrives by the sweep); the alias look-up follows `attn6uqd` to `us6000u3jl`; a recorded 409 withdraws a published event by look-up and by the sweep; paused, unavailable and a re-delivered tick each record what they should | at `4f9a304b` the file cannot load (`ingest.js` does not exist); with only part 03 set back: 0/7 |
| `PGLITE_MODULE=... node scripts/test/eup-environment-events.integration.mjs` | 294 assertions pass | |
| `ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=<16 or 17> PG_MODULE=<node-postgres 8.23.1> node scripts/test/eup-environment-events.native.integration.mjs` | 29 checks pass on PostgreSQL 16.15 and 17.7; no server or data directory left behind | |
| `node --test scripts/test/eup-environment-events-sql.test.mjs scripts/test/rpc-names-exist.test.mjs scripts/test/editorial-ci-partition.test.mjs` | 7/7, 3/3, 1/1 | `rpc-names-exist` failed until both callers were listed |
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/world-environment-layers.test.mjs test/world-environment.test.mjs test/world-environment-guard.test.mjs test/eup-environment-owner.test.mjs test/eup-router.test.mjs test/eup-modules.test.mjs test/intel-mission-loop.test.mjs test/media-operation-recovery.test.mjs` | 218/218 pass | |
| `python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py` | 2,906/2,906 checks pass (the new Worker test mapped) | failed on the unmapped test file |
| `nice -n 15 node --test scripts/test/*.test.mjs` (the root suite, once; load 4.4 rising to 6.0) | 2,787 tests: 2,780 pass, 0 fail, 7 skipped (71.1 s) | |
| `cd workers/mccluster && nice -n 15 node --import ./test/support/offline-network.mjs --test test/*.test.mjs` (the whole Worker suite, what its `npm test` runs) | 1,997 tests: 1,976 pass, 9 skipped, 12 fail, all twelve in `test/mnet-mission-flow.test.mjs` (it reads only `js/mnet.js` and `js/world-mission-posts.js`, which this slice does not touch; S0 and S2 recorded the same twelve) | |

### Deviations from the plan, with reasons

- **A store read in pending SQL.** The plan gave S3 no SQL, but its step 4 (look up published events the feed no longer lists)
  needs to know which events are published, and no entry point answers that while the module is off. Part 03 gained one
  read-only, service-role function rather than a sixth part (one approval of the ingest's part), and S1's tests count it.
- **Steps 2 and 3 are the store's.** S1 put alias resolution and the substantive diff inside `eup_environment_ingest`, in the same
  transaction as the alias table; resolving them again in the Worker would be a second, racing copy. The Worker sends what USGS
  says.
- **The feed follows the owner's rule.** D7's minimum magnitude is owner-adjustable (0 to 10), so the run reads the M2.5+ day
  unless the rule asks lower. Significance above 600, a PAGER alert and a tsunami flag are read only at or above the feed's floor
  (in the week lane 06 read, PAGER alerts began at M4.9, significance above 600 at M5.3, and no event carried a tsunami flag).
- **`types` is not kept.** The plan's field list named it, but the store's input refuses unknown fields and has no column for it;
  the rupture route (S5) reads USGS's product list directly.
- **The sweep is bounded to published events.** Sweeping every stored candidate would insert older events the timeline never
  showed; the sweep keeps what USGS changed for events published in the last 30 days, at the feed's magnitude floor, with FDSN's
  `limit` at 2,000 (the 48-hour window above M2.5 read at 04:52 UTC held 251 events).
- **`includesuperseded` is read, not asked.** The normaliser reads an `includesuperseded` answer correctly (the event's own
  values, every id), and the tests replay the recorded history through the real ingest and SQL; no production path asks for it,
  because a look-up by id already lists every associated id. In the replay, the tsunami flag is held at its recorded value and
  significance is left out: the history carries neither.
- **The globe shows the new reason raw** ("no contours shown: withdrawn"): the globe's wording lives in files S5 is changing.
- **Candidates are stored.** Every row of the feed is sent, so events below the rule are kept as candidates (never public; the
  owner's review queue lists them): in the day recorded here, 19 of the feed's 35 rows; 16 qualify under the D7 default.

### Waiting for Matthew's separate go

- Applying S1's five parts in production, now with the ingest's read in part 03: each on his approval of its exact text, after
  the mission publish (`supabase/pending/PROMOTION-ORDER.md` section 12). Until then a run stops at its first read.
- Setting the USGS rule in Control (his own command, once the parts are applied).
- Turning the ingest on: `EUP_ENVIRONMENT_USGS_INGEST_ENABLED = "true"` is a committed configuration change, so a pull request he
  approves and its merge (also the Worker's deploy). It stays `"false"` here.
- Nothing the ingest stores is public until the public routes (S4) ship and the environment module is installed and then enabled
  (D3), each its own go.
- Decisions D5, D6, D7 and D20, and the bounds above, as adopted defaults. Nothing was applied, installed, enabled, flagged or
  published.

## S4. The public USGS timeline from the store, behind the same gate

### Present before

At `df5e5a25` (the head this slice started from):

- S1's pending store had its two public reads, gated in SQL by the module policy (`eup_environment_public_events`, a keyset page
  newest observation first with the tombstones kept, and `eup_environment_public_event`, one event by canonical id or alias with
  its correction history), but no route called them. S3's ingest could fill the store (flag off) and S2's Control could set the
  USGS rule.
- The public feed's `usgs` source was USGS's live all-day summary, read through the pinned product (`environmentFeed`) and the
  owner's Halo first hop (`normalizeQuake`): ids `usgs:<the live preferred id>`, no revision, no alias, a deleted event simply
  gone, USGS's own update time dropped.
- The Equity Uprise tab listed the missions, then "Environmental observations" (S0, decision D8), rebuilt in page memory from the
  panel's feed every read: no persistence, no history, no deep link. A post said Coverage and Status; Show on globe sent the
  focus and wrote no address.
- In the tab the news layer stayed on: the globe read `GET /v1/world/news-heat` every five minutes and a country's card said
  "news · 24 h" (pinned as intended in `scripts/test/world-news-tint.test.mjs` and `scripts/e2e/environment-world.e2e.mjs`).
  Behind the sign-in door the shading stepped aside (release review RS-9) but the news itself stayed on.

### Integrated

- **The public routes** (`workers/mccluster/src/world-environment-events.js`, new; committed as `cb5ed65c`):
  `GET /v1/world/environment/events?since&until&cursor&limit` and `GET /v1/world/environment/events/{id}`, reached through
  `handleWorldEnvironment` before the layer routes. The module gate runs first (off 404 `module_disabled`, outage 503
  `module_policy_unavailable`, the store never read while it refuses); every field is whitelisted again, published events and
  tombstones apart (a tombstone has no coordinates, so no globe object: decision D12, **default adopted pending Matthew's
  confirmation**); a held event or a hidden provider is 404 `not_available`; store reads are kept at the edge at most 60 s and a
  burst in one isolate shares one read, a refusal never kept; a deep link's one event counts as a lookup in the per-client limit
  (`packages/release-policy/globe.mjs` routes `events` and `event`; `world-environment-guard.js`). The module imports one
  response helper and nothing else; a static test walks the import graph of every public handler (no `intel/`, news pairing,
  Halo directory, owner route or `core/` module). The contract is `WORLD-ENVIRONMENT-CONTRACT.md`, "The public timeline from
  the event store".
- **The feed's quakes from the same store** (`workers/mccluster/src/world-environment.js`): for the public answer of
  `GET /v1/world/environment` and the planning reads that use it, the `usgs` source is the store's published quakes of the past
  day (`storeUsgsReader`), so the feed builds the store's canonical ids, and each event carries its `revision`. A store that cannot
  be read makes the source `unavailable` with its reason (`store_unavailable`, `store_not_applied`, `store_busy`, `not_shown`,
  `no_reading`; `upstream_error`, `paused` and `not_recent` serve what the store holds as `stale`); USGS's live feed is never
  read for a second id. The owner's live provider check in Control keeps reading USGS itself. Decision D7 (what qualifies),
  **default adopted pending Matthew's confirmation**, is the store's own rule.
- **The timeline in the tab** (`js/world-environment-timeline.js`, new, with one-line hooks in `js/mnet.js` and `mnet.html`):
  - a post per public event carrying the canonical id (the post id and `globe_id`) and the revision: "M6.1 · <place>" (a
    magnitude as USGS writes it, one decimal), Observed with how long ago, then a line "Revision 2 · USGS updated <time> ·
    Retrieved <time>", "Reviewed by USGS" or "Automatic, not yet reviewed by USGS", an official correction in its own line
    ("Corrected by USGS: magnitude 6.4 → 6.1; review automatic → reviewed"; "Restored by USGS", "Restored to an earlier USGS
    reading"), a deep-linked event's earlier corrections from its history, and a withdrawal as a tombstone ("Withdrawn by USGS on
    <date>", or "Withdrawn from the timeline on <date>" for the owner's retraction) whose globe button reads "Withdrawn: not on the
    globe";
  - one list with the live posts of the providers the store does not hold yet (NWS, NHC, EONET, FIRMS, WFIGS, CO-OPS), newest
    first; while the store has older pages, a live post older than the oldest loaded timeline post waits, so what shows is a true
    prefix; "Show more observations" asks the next page by the cursor;
  - the missions keep their own list, first and on page one (decision D8, **default adopted pending Matthew's confirmation**);
  - the timeline is read only after the panel's feed answered (a refusing gate is never asked again: the client already holds
    the refusal), only while the tab is the scope or a deep link wants an event, at most once a minute, and a failed read is not
    retried within the minute (the feed's own quakes, the same canonical ids, stay);
  - the deep link `?feed=equity&event=<id>` opens the tab, marks the event's post (`aria-current="true"`, an ink rule on its
    leading edge) and points the globe at the same id; an alias or a merge lands on the canonical id with the address replaced,
    never a new entry; an event further down the list opens the list down to it; an unknown, held or unreadable event says so in
    one line above the list; a frame that boots after the link spoke is told again on `hu:globe-ready` until it reports the
    event selected (or the visitor's own pick);
  - Show on globe on a post the store holds writes the address as one history entry (the same event again adds none); Back and
    Forward choose from the address again.
  - `css/world-environment.css`: the lines and the marked post, phone first, no breakpoint needed.
- **D9: the news layer is off in the tab** (**default adopted pending Matthew's confirmation**). `js/world-news-globe.js` sends
  `on:false` with `tint:false` while the feed's scope is the Equity Uprise tab: the globe reads no news heat (its five-minute read
  stops), draws no shading, legend or story pin, and a country's card drops its news count, on the frame's card
  (`js/world-countries.js`, `newsOff`) and on the page's (`js/mnet.js` place card); leaving the tab reads the counts again and
  everything comes back as it was. Travel's own off (the tint flag kept) leaves both cards as they were.
- **Carried release item 6: the door's backdrop goes as quiet as the tab.** While the sign-in door is open the same rule holds
  (news off, no shading, no counts behind the card); it comes back when the door closes. The door's own "Last 24 hours" card reads
  the news itself and is unchanged.
- **The timeline plane** (`scripts/test/support/eup-environment-timeline-plane.mjs`): the real handler over the real policy and the
  five pending parts in PGlite, the local stand-in for staging (decision D1, **default adopted pending Matthew's
  confirmation**); a browser test's page origin is allowed beside the World's sites, so the Worker's own CORS rule answers it.

### Touched paths

The Worker part (`cb5ed65c`): `workers/mccluster/src/world-environment-events.js` (new), `workers/mccluster/src/world-environment.js`,
`workers/mccluster/src/world-environment-guard.js`, `packages/release-policy/globe.mjs`,
`workers/mccluster/test/world-environment-events.test.mjs` (new), `workers/mccluster/test/world-environment.test.mjs`,
`workers/mccluster/test/world-environment-guard.test.mjs`, `workers/mccluster/test/world-environment-layers.test.mjs`,
`scripts/test/support/eup-environment-timeline-plane.mjs` (new), `scripts/test/eup-environment-timeline.integration.mjs` (new),
`scripts/test/support/eup-environment-plane.mjs`, `scripts/test/eup-environment-plane.integration.mjs`,
`supabase/pending/live-callers.json`. The client part: `js/world-environment-timeline.js` (new), `js/mnet.js`, `mnet.html` (one
script tag), `css/world-environment.css`, `js/world-news-globe.js`, `js/action-globe.js`, `js/world-countries.js`,
`scripts/test/world-environment-timeline.test.mjs` (new), `scripts/e2e/environment-timeline.e2e.mjs` (new),
`scripts/test/world-news-tint.test.mjs`, `scripts/e2e/environment-world.e2e.mjs`, the timeline plane (an `origins` option). Both:
`.github/workflows/human-uprise-editorial.yml` (matrix entries `environment-timeline` and `environment-timeline-world`, their paths
in the filter), `docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md`, the source map
(`docs/design/equity-uprise-building/production/equity-uprise-repo-source-map-v2.json` with its generated coverage report) and
this section.

### Tests

E=UP-only assertions changed on purpose, named in the commits: the Worker part's (`world-environment.test.mjs`: the fake answers
the store's page and a store read is not a domain write; `world-environment-guard.test.mjs`: no data with the store's empty page,
the feed asks three providers and the store once; `world-environment-layers.test.mjs`: the route ids gain `events` and `event`;
S0's plane: a missing function is PGRST202 and USGS says `store_not_applied` there) and, for D9,
`scripts/test/world-news-tint.test.mjs` (the three assertions that pinned "the news layer itself stays on" in the tab and behind
the door now pin it off; titles to match; one test added for the card) and `scripts/e2e/environment-world.e2e.mjs` (its
`tintQuiet` and the two tab checks, by night and by day, now require no counts held and the news off). General-news and
Drawdown-mission tests are unchanged (`world-news-feed.test.mjs`, `world-mission-posts.test.mjs`, `world-missions-guest.e2e.mjs`).

| Command | Result | Before the change |
| --- | --- | --- |
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/world-environment-events.test.mjs` | 11/11 pass: the gate first; page and tombstone whitelists, value by value; the deep link by alias, tombstone, 404s and invalid ids; store refusals never kept; the 60 s cache and 20 concurrent requests sharing one store read; query validation; the feed's USGS from the store with its revision and no USGS call (the owner's live check still reads USGS); the USGS reasons table; the lookup limit; the static import graph | 0/11 at `df5e5a25` |
| the same with `test/world-environment.test.mjs test/world-environment-guard.test.mjs test/world-environment-layers.test.mjs` | 79/79 pass at the merged head | |
| `PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/eup-environment-timeline.integration.mjs` (CI `environment-timeline`) | 11/11 pass: store not applied; off before anything; enabled but no reading; E3 a qualifying quake publishes with no news and the M3.1 stays a candidate; news never a provider; a correction is revision 2 and the edge keeps the page a minute; an alias answers the canonical event; a deletion is a tombstone; an owner hold is 404 `not_available`; the cursor walks the timeline once; the gate stays first | 2/11 at `df5e5a25` (only the unchanged gate refusals) |
| `PGLITE_MODULE=... node scripts/test/eup-environment-plane.integration.mjs` (S0's plane) | 6/6 pass | |
| `node --test scripts/test/world-environment-timeline.test.mjs` (CI `environment-unit`) | 17/17 pass: posts, corrections and history, tombstones, the brand never written, the merged list and its true prefix, the address, the reads (only after the feed, the tab or a deep link, once a minute, never after a refusal, cleared by a later one), a failed read held a minute, deep links (canonical, alias with the address replaced, held, unknown, unreadable, tombstone), one history entry per chosen event and Back, older pages by the cursor, the globe told again on `hu:globe-ready`, the page's wiring | cannot load at `df5e5a25` (the module does not exist) |
| `node --test scripts/test/world-news-tint.test.mjs` | 6/6 pass | 4 of 6 fail at `df5e5a25` (the three changed on purpose and the new card test) |
| `node --test scripts/test/world-gate.test.mjs scripts/test/world-mission-posts.test.mjs scripts/test/rpc-names-exist.test.mjs scripts/test/editorial-ci-partition.test.mjs` | 23/23, 18/18, 3/3, 1/1 | `world-gate.test.mjs`'s door-art test failed once on a rewritten tint expression; the expression was put back as it was (the door's rule is unchanged) |
| `node --test` over the 70 World, globe, news and environment test files | 698 tests: 695 pass, 2 skipped, 1 fail (that door-art test, before the expression was put back) | |
| `python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py` | 2,958/2,958 checks pass at the merged head (three new files mapped) | failed on the unmapped files |
| `nice -n 15 node --test scripts/test/*.test.mjs` (the root suite, once, at the merged head; load 1.65 rising to 2.92) | 2,934 tests: 2,927 pass, 0 fail, 7 skipped (58.4 s) | |

### Browser runs

Chromium only (decision D18: never a claim about Safari or a device), one browser at a time under the shared lock.

- `PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> CESIUM_DIR=<Build/Cesium of 1.131> node scripts/e2e/environment-timeline.e2e.mjs`
  (CI `environment-timeline-world`): **every check passed** (72) on its last two runs, the last at the merged head (100 to 110 s
  each). At 390, 820 and 1280: the deep link opens the tab and lists the store's events newest first, each once by its canonical
  id; the missions' own list first and whole; the linked post marked (`aria-current`) with its revision; the corrected event's
  title, review, times and "Corrected by USGS: magnitude 6.4 → 6.1; review automatic → reviewed"; the tombstone "Withdrawn by USGS
  on <date>" with its globe button disabled; the globe selecting the same id and drawing only the three published quakes; D9 (news
  off, no shading, no news-heat read by the globe; a country picked in the tab shows missions, posts and members only); Show on
  globe as one history entry, none for the same event again, Back marking the linked event on the page and on the globe; leaving
  the tab bringing the news back; Global's cadence; no sideways scroll at 390; no page errors. Once: an alias landing on the
  canonical id with the address replaced (one `replaceState`, no `pushState`), its post saying "Corrected by USGS: magnitude 6.6 →
  6.3; magnitude type mi → mww; ..."; an unknown event's one line; the gate refusing (module disabled) with no timeline read at
  all; the door at 1280 taking the news off and giving it back. Its first two runs failed, for reasons in the test, not the page:
  the Worker's CORS answered `https://mccluster.org` to the test page's origin (the plane now allows that origin, as the Worker
  allows its sites), and the country pick was posted from the frame to itself (the frame hears only its parent). Screenshots
  (night, device scale 1): the deep-linked tab and the marked posts at each width, the quiet door at 1280; kept with the run's
  output, not committed.
- `CESIUM_DIR=... node scripts/e2e/environment-world.e2e.mjs` (changed on purpose for D9 and S0's request check): 231/231 checks
  passed on its re-run at the merged head (load 3.2 rising to 5.8). Its first run, before the request check was changed, failed
  four: that check at each width (the page's `/events` read, now allowed on purpose) and, at 1280, "with the tour paused the globe
  renders on demand" (a `camera` hold read just after every hold had gone, load about 4: the timing-sensitive check S5 recorded;
  on the re-run every hold went within 0.8 to 1.2 s of the pause).
- `node scripts/e2e/world-missions-guest.e2e.mjs` (unchanged): 279/279 checks passed.
- A mistake, recorded: once, a command meant to run one unit test file ran `node --test` with no file list (a search found nothing),
  which runs every test the repository holds, including the Core browser executor's own Chromium tests, while this slice's e2e
  chain held the browser lock; two browsers ran at once for about a minute. It ended by itself and left nothing running.

### Deviations from the plan, with reasons

- **A new client module beside the posts module.** The plan named `js/world-environment-posts.js` for the timeline's posts; they
  are built in a new `js/world-environment-timeline.js` (pure parts and the page's controller), and the posts module is unchanged.
  The store's public shape is not the panel's feed shape, and a new file with one-line hooks keeps the hunks in `js/mnet.js` and
  `mnet.html` small while other work edits them.
- **The browser proof is a new suite.** The plan put the deep link, the corrected and withdrawn events, the missions on page one
  and Global's cadence in `scripts/e2e/environment-world.e2e.mjs`; they are in `scripts/e2e/environment-timeline.e2e.mjs`, which
  answers every environmental read with the real Worker handler over the real pending SQL (a fixture route could not prove the
  path from the store to the post and the globe). `environment-world.e2e.mjs` changed only on purpose: D9's tint checks, and S0's
  "the page never requested a layer route", which now allows the page's own timeline read (`/events`); its Global cadence check
  runs unchanged and passes.
- **The store-held ids only.** Show on globe writes the address for an event the store holds (USGS today, by canonical id, from
  the tab or from Global); a live post of another provider writes none, since its id is not the store's and a deep link to it
  would answer "not on the timeline".
- **A deep link to an event older than the globe's day** marks the post; the globe has no object for it (it draws the feed's
  day), so its pending focus expires after 30 s, as any focus on an id the globe lacks does.
- **The door's backdrop** (carried release item 6) goes as quiet as the tab: the news layer off, not only the shading. Whether the
  environmental layers or the tour should also pause behind the door is a question for Matthew; nothing else changed there.
- **Magnitudes** on the timeline's posts are written as USGS writes them (one decimal: "M5.0"); the live posts keep the feed's own
  formatting ("M5"), so a whole-number quake reads one way in Global and the other in the tab until S9 brings the other sources
  onto the same model.
- **The panel's words for the new USGS reasons** (`store_not_applied`, `not_shown`, `no_reading`, `not_recent`, ...) are not
  added: the panel is vendored (`vendor/equity-uprise/product-source.lock.json`) and shows an unknown reason as its code. A local
  patch is a later slice's (D19).
- **The e2e was not run at the pre-change head.** The fail-before proofs are the unit and integration tests (above); the browser
  suite needs the new routes and module to exist at all.

### Waiting for Matthew's separate go

- The merge of this branch through a pull request he approves (also the Worker's deploy). Until then nothing here is live.
- Applying S1's five parts in production (`supabase/pending/PROMOTION-ORDER.md` section 12), each on his approval of its exact
  text. Until then the routes answer 503 `events_unavailable` (`store_not_applied`) once the module is on, and the feed's USGS
  source says the same.
- Setting the USGS rule in Control (his command), turning the ingest on (`EUP_ENVIRONMENT_USGS_INGEST_ENABLED`, a committed
  configuration change: stays `"false"`), and installing then enabling the environment module (D3). Until the module is enabled
  every route here answers 404 `module_disabled` and the tab shows S0's honest line.
- Decisions D7, D8, D9 and D12 as used here, D1's local stand-in for staging, and the carried door item's reading (news off behind
  the door; the environmental layers there unchanged): defaults adopted pending his confirmation.
- Safari and real devices (D18): this slice ran in Chromium only.
- Nothing was applied, installed, enabled, flagged, published or deployed by this slice.

## S5. Recognisable quakes, the expanding ripple, a cancellable push, contours and documented rupture

### Present before

At `c7c8731e` (the head this slice started from; the screenshots below compare with `2855a4e9`, the release review's head):

- Every quake was a 6 px dot over a translucent energy disc, picked through Cesium's 3 x 3 px default window
  (`js/action-globe.js`): from orbit nothing said "earthquake", which, how big or where. The release review read the white fire
  summary cells (up to 80 px across) as "plain white circles" over the quakes.
- A chosen quake got one alpha-only ground pulse (adapted from the MIT-licensed reference credited in `THIRD-PARTY-NOTICES`),
  15 km wide up to M4.4, under a bounded hold; under reduced motion nothing. A tap selected without moving the camera; a post's
  Show on globe or a panel row flew straight down to 900 km (1,600 km from M7), and nothing could cancel that flight.
- The selected event's label was one LabelCollection entry with a depth test: at 390 px it ran off the frame and under the
  page's Sign in (polish-390-equity.png, "...ture event 48"), at 1280 px behind the limb.
- ShakeMap contours on selection; no rupture source anywhere (lane 06: about a dozen quakes a year carry a USGS finite-fault
  model, all M6.5 and up).
- The mission halos breathed through a `CallbackProperty` under the governor's unbounded `legacy` hold, so with any mission pin
  on the globe the Equity Uprise tab never rendered on demand.
- At 390 x 844 the World's floating app bar lay over the tour's Replay button at rest (360 x 780: over Play, Previous and Next).

### Integrated

- **The quake marks** (`js/environment-quake-marks.js`, new). Each quake is a glyph: the World's own quake pictogram (the
  seismograph trace of the quake posts' icon, `OBS_ICON.quake` in `js/mnet.js`; an icon, never anyone's mark) in a dark round
  badge ringed in its depth colour with a soft glow, 14 px at M2.5 to 44 px at M8, in one BillboardCollection, each image drawn
  once per colour and size and kept. The largest (M4.5 and up, at most 24 candidates) carry a two-line label, "M6.3" over a
  short upper-case place ("ANAMIZU, JAPAN" from "20 km NW of Anamizu, Japan"), laid out greedily by magnitude: right of the
  glyph, else left, above or below; never over another label or over the glyph of a quake as large or larger; never in the
  frame's band under the page's header (64 px measured at every width) or its foot (the legend and credits), never in the
  corners where the page lays its headline, its music and full-screen buttons and, wide, its app bar (measured on the World at
  390 x 844, 375 x 667, 430 x 932 and 1280 x 800); never behind the Earth or along its limb; 3 labels on a phone's frame, up to 14
  wide. The selected quake's label is always shown (the others yield to it), revealed over 0.32 s (at once under reduced
  motion), and its glyph gains a white ring. Nothing is built per frame: the layout runs on frames drawn anyway, and only when
  the camera's view has changed.
- **The tap target.** A tap within 22 CSS px of a glyph's centre (a 44 px target) selects that quake, the nearest one, the
  larger on a tie, when nothing else claimed the tap: a mission pin, a satellite or an aircraft keep theirs, while a fire cell's
  or an alert's fill under the finger does not hide the quake (`environmentPins.pick(e, p.position)`, one argument added in
  `js/action-globe.js`). The quake's dot is gone; its energy disc stays.
- **Fire cells de-emphasised**: drawn 1.1 times their radius across (44 px at most, no longer 80) at half opacity. (The release
  review's "plain white circles" are these cells: the hottest class of the fire colour ramp is white, as the legend says.)
- **Round where the push lands**: the quake energy discs are drawn with 48 points round their rims, the ripple's ellipse with 96.
  Cesium 1.131's `EllipseGeometry` steps round a rim by eight times its granularity whatever the radius (counted with Cesium's
  own build in Node: pi/32 gives 8 points, pi/90 24, pi/192 48, pi/384 96), so the pi/32 used before drew every disc as an
  octagon, plain once the push brings the camera to a regional frame. A first attempt here scaled the step to each disc's
  radius: that gave the M3.1 disc of the test fixture 54,308 rim points, and Chromium's renderer crashed ("Target crashed") in
  a perf run and a screenshot run; the step is now fixed, and the tests pin 48 and 96.
- **The energy disc steps back at a regional frame** (`discNearM` in the encodings): a quake's energy disc compares magnitudes
  from orbit, so it is hidden while the camera is within five of its radii, 600 km at the least, through Cesium's per-instance
  distance condition on the one ground primitive (the GPU decides; nothing is rebuilt or written per frame). The push lands
  120-300 km away, so the landing shows the ground, the travelling rings, the ShakeMap contours and the glyph, where the first
  renders after the push showed one flat grey ellipse over the whole frame (an M5.7's 84 km disc seen from 150 km). Zoomed
  out again, the discs return.
- **The ripple** (`js/environment-ripple.js`, new; D17, **default adopted pending Matthew's confirmation**). Two rings travel
  outward over the ground from the epicentre to a stated regional radius, 50 km below M5 rising 125 km a magnitude unit to 300 km
  from M7, each in 1.6 s with an ease-out, the second 0.8 s after the first, all over in 2.4 s; labelled "Ripple is illustrative:
  not a recording of shaking" in the selection and the legend. One GroundPrimitive (an ellipse at the full radius) is built once
  per selection, asynchronously, with an original ring material whose two uniforms are the only thing written per frame, under
  the bounded `env-ripple` hold (6 s at most, a timer ends it even when frames are sparse); no `CallbackProperty`, no geometry
  rebuilt, no pulse on every quake (Hitman's Halo's breathing discs, 32.4 ms a frame against 1.4 ms static, stay retired). When
  the camera is pushing in, the rings wait for the landing (2.5 s at most). Under reduced motion the same radius is a still
  outline, kept while the quake is selected, asking for no frame once built. The adapted alpha-only pulse is gone, so
  `THIRD-PARTY-NOTICES` now says so (the entry stays for its history).
- **The push** (`js/environment-camera.js`, new; D14, **default adopted pending Matthew's confirmation**). An explicit choice (a
  tap on a glyph, a post's Show on globe, a panel row, a deep link) pushes the camera in to the event: for a quake about 120 km
  away at M4.5 out to 300 km from M7.5, looking down -45 to -60 degrees, its heading kept, 1.6 s within view up to 2 s across a
  hemisphere, Cesium's cubic in-out, the event at the centre; any other kind keeps the frame its focus always had, now
  cancellable. The visitor's hand wins: a pointer, a touch, a wheel or a key on the globe cancels the push at once and the camera
  stays where it is; a new choice cancels it too. The tour and the replay never push (their flights are the director's).
  Under reduced motion a tap moves nothing and a chosen post or row jumps to the same frame with no flight. The push holds
  `env-focus` only while it flies, bounded by its duration plus 0.6 s.
- **The documented rupture** (D13, **default adopted pending Matthew's confirmation**). `GET
  /v1/world/environment/quakes/:event/rupture` (`workers/mccluster/src/world-environment-layers.js`, behind the persisted
  environment module policy like every environment route, counted as a look-up): through the very event read the ShakeMap route
  makes, the preferred ShakeMap's own `download/rupture.json` from USGS's host, kept a day per product version; only a Polygon
  or MultiPolygon whose reference names a finite fault is answered, and only its up-dip edge (the plane's shallowest side),
  called a model ("modelled rupture plane (USGS finite fault)"), never a mapped crack. A Point (the usual case), a plane naming
  no finite fault, no clear top edge, a withdrawn event, no ShakeMap or rupture file, and an unreachable USGS each say why
  nothing is drawn. The frame asks for it only for a selected quake of M6 or more (`js/environment-layers-client.js`
  `rupture()`), draws the edge as a dark underlay with a hot core on the ground, adds a Rupture fact to the selection ("modelled
  rupture plane (USGS finite fault): up-dip edge drawn, top at 0.1 km depth, model of 2026-11-03") and a legend line.
- **Halos stand still in the tab** (D16, **default adopted pending Matthew's confirmation**): while the environmental layers are
  on, the mission halos and the live badges rest at their still size and take no `legacy` hold, so the globe renders on demand
  there; with the layers off they breathe as before (`js/action-globe.js`: `envStill()`, the frame told through `onActive`).
- **The selected label clear of the page**: a quake's label is its glyph's (inside the free area above); any other selected
  event's label now draws over the limb and reads towards the centre.
- **The tour's controls above the app bar** (vendored panel, recorded local patch `S5-TOUR` in
  `vendor/equity-uprise/product-source.lock.json`): the tour's group (Play, Previous, Next, Replay and its status line) follows
  the panel's description, before the sources toolbar and the feed status, in the markup as on screen, so a keyboard meets them
  in the order shown; on a phone the title holds one line and the group and the toolbar sit 4 px closer
  (`css/world-environment.css`, restored from 600 px). At rest on a 390 x 844 phone no tour control, and no button, lies under
  the floating app bar (on a 360 x 780 phone the Refresh button's top 30 px still do, until the page scrolls).

### Art direction (references for pacing and composition only; no code or asset copied)

Studied before coding: lane 05's map of the MIT-licensed reference globe credited in `THIRD-PARTY-NOTICES` (its source read in a
local clone), Hitman's Halo (read only) and lane 04's notes on the World's own marks.

- **Recognisable before the click.** The reference labels a quake in screen space ("M6.4" over the epicentre, about 15 px
  above), largest first, with collision and a horizon cull; Hitman's Halo pairs a glowing mark with an upper-case place line.
  Taken: magnitude first and large, the place small and tracked under it, priority by magnitude, nothing behind the Earth. Made
  our own: the World's seismograph pictogram as the mark (the reference and Halo use circles), the depth colour as its ring and
  the label's hairline (colour has one job), labels that avoid the page's own furniture.
- **Focus by de-emphasis.** The reference makes the chosen thing loud by making the rest quieter; here the fire cells step back
  (smaller, half opacity), the chosen glyph gains a white ring and its label, nothing else changes.
- **The camera: pause, then move.** The reference flies 2 s to about 120 km at -45 degrees, heading kept, and cancels its flight
  on any input; Halo's fly-in arrives before anything else moves. Taken: a regional oblique frame scaled by magnitude, the
  heading kept (no disorienting spin), cubic in-out, the hand always winning, and the rings waiting for the landing so the wave
  is seen from where the visitor arrives.
- **The wave, once.** The reference's pulse breathes in place; Halo's discs breathed on every quake at 32 ms a frame. Ours
  travels outward twice and is gone, regional in size, written as two numbers a frame, labelled illustrative.
- **The official record first.** Every drawn claim names its source and model (ShakeMap modelled, rupture modelled, ripple
  illustrative); a point source says so in words instead of drawing a guess.

### The screenshots, art-directed

Rendered at device scale 2 by night on the World page (the real frame, the e2e fixtures, two mission pins), the Equity Uprise tab
at 390 x 844 and 1280 x 800, at this slice's code and at `2855a4e9` for comparison; the tap is a real click on the M5.7
fixture quake at both. Measured with each frame in `after-measure.json` and `before-measure.json`. Judged in Matthew's words:
not just dots on the board, cinematic, recognisable before you click.

- **From orbit (`*-orbit`).** Before: every quake a 6 px dot among the alerts' dots, the two loudest marks on the globe white fire
  cells, the selected event's label cut under Sign in at 390 ("...ture event 48") and behind the limb at 1280. After: each quake
  is the World's seismograph glyph ringed in its depth colour, and the largest read "M5.7 / FIXTURE EVENT 12", "M4.7 / FIXTURE
  EVENT 22", "M5.2 / FIXTURE EVENT 27" before anyone clicks, every label inside the free area, none under the header, the
  headline or the buttons. The fire cells step back (still white at the hottest class, as the legend says, at half the size and
  opacity). Recognisable before the click: yes. Still to watch: a glyph can sit under the page's headline at the top left
  (geography puts it there; labels avoid it, glyphs cannot), and the hottest fire cell is still the brightest thing that is not
  a quake.
- **The wave (`*-ripple-1..3`, the globe's own canvas).** Before, 0.5, 1.2 and 2 s after the tap: nothing moves where the quake
  is (the old pulse was 15 km wide, seen from 8,300 km). After: the camera has pushed in to a regional, oblique frame and two
  soft rings travel out from the glyph to the stated 137.5 km radius, the second following the first (fronts 0.64; 0.92 and
  0.38; 0.75 at 390, the same beats at 1280), then they are gone. This is the cinematic beat, seen from where the visitor
  lands. The ocean is flat in these frames because the test page serves no close imagery tiles; the live World draws imagery
  there.
- **Where the push ends (`*-landed`).** Before: straight down from 900 km, an octagonal grey disc with a dot and a plain label.
  After: an oblique regional frame, the glyph and its label at the centre of the free globe area, the ground clear. The first
  render of this frame showed one flat grey ellipse over everything (the energy disc seen from 150 km), the most board-like
  image of all; the disc distance rule is the answer.
- **Reduced motion (`*-reduced`).** Before: a dot and a plain label. After: the tap selects without moving the camera, the
  glyph gains its white ring and its label; the still outline is drawn at the same regional radius but, from orbit, it is a
  few pixels under a 30-40 px glyph, so it shows only once the visitor zooms in. An honest gap rather than a motion.

### Touched paths

`js/environment-quake-marks.js` (new), `js/environment-ripple.js` (new), `js/environment-camera.js` (new),
`js/environment-layers.js`, `js/environment-layers-client.js`, `js/environment-pins.js`, `js/action-globe.js`, `action-globe.html`
(three script tags), `css/world-environment.css`, `vendor/equity-uprise/src/environment/panel.mjs` and
`vendor/equity-uprise/product-source.lock.json` (patch S5-TOUR), `THIRD-PARTY-NOTICES`, `packages/release-policy/globe.mjs`,
`workers/mccluster/src/world-environment-layers.js`, `workers/mccluster/src/world-environment-guard.js`,
`workers/mccluster/test/world-environment-rupture.test.mjs` (new) with four recorded USGS files in
`workers/mccluster/test/fixtures/environment/` (new), `workers/mccluster/test/world-environment-layers.test.mjs`,
`scripts/test/environment-quake-marks.test.mjs`, `environment-ripple.test.mjs`, `environment-camera.test.mjs`,
`environment-quake-selection.test.mjs` (all new), `scripts/test/environment-globe-wiring.test.mjs`,
`environment-layers-client.test.mjs`, `environment-layers-encodings.test.mjs`, `world-environment-panel.test.mjs`,
`scripts/e2e/environment-globe.e2e.mjs`, `scripts/e2e/environment-world.e2e.mjs`, `scripts/e2e/support/environment-globe-host.html`,
`scripts/e2e/fixtures/environment/rupture-us6000u43g.json` (new: the Worker's own answer for the recorded USGS files, its clock
times set to the recording time), `scripts/perf/environment-globe-perf.mjs` (`--missions`),
`docs/control-plane/WORLD-ENVIRONMENT-CONTRACT.md`, the source map with its generated coverage report, and this section.

### Tests

E=UP-only assertions changed on purpose, named in the commits: the wiring pins in `scripts/test/environment-globe-wiring.test.mjs`
(the new scripts' order, the pick line passing the tap position, the legacy hold's `PULSE&&!envStill()`), the route-id pins in
`scripts/test/environment-layers-client.test.mjs` and `workers/mccluster/test/world-environment-layers.test.mjs` (`rupture`
added), and the reduced-motion focus in `scripts/e2e/environment-globe.e2e.mjs` and `scripts/e2e/environment-world.e2e.mjs` (the
jump now lands on the regional frame, about 132 km up, with a still ripple outline labelled illustrative, where it was 900 km
straight down with no ripple). General-news and Drawdown-mission tests are unchanged.

| Command | Result | Before the change |
| --- | --- | --- |
| `node --test scripts/test/environment-quake-marks.test.mjs` | 11/11 pass | at `c7c8731e` the file cannot load (`js/environment-quake-marks.js` does not exist) |
| `node --test scripts/test/environment-ripple.test.mjs scripts/test/environment-camera.test.mjs` | 7/7, 13/13 | at `c7c8731e` neither can load |
| `node --test scripts/test/environment-quake-selection.test.mjs` (the layers with the three modules in one realm) | 11/11 | at `c7c8731e` with only the three new modules copied in (the layers unchanged): 0/9 (the rim and distance tests came later; see the next two rows) |
| the same file with `scripts/test/environment-ripple.test.mjs` (the rims) | 18/18 | with the earlier steps restored (pi/32, pi/90) the two rim tests fail (8 and 24 points); with the radius-scaled step they fail (220, 2,884 and 54,308 points on the three discs, 440 on the ripple) |
| the disc distance test in the same file | passes | with the distance condition taken out: fails (no near distance on any disc) |
| `node --test scripts/test/environment-globe-wiring.test.mjs scripts/test/environment-layers-client.test.mjs scripts/test/environment-layers-encodings.test.mjs` | all pass | at `c7c8731e`: 11 of 41 fail (the new pins, the D16 test, the rupture look-up, the cell size, the legend) |
| `node --test scripts/test/world-environment-panel.test.mjs scripts/test/equity-product-consumer.test.mjs` | all pass (the new S5-TOUR test; the lock's hash and patch entry) | the consumer test refused the patch until each regression test named S5-TOUR |
| `node --test scripts/test/world-environment*.test.mjs scripts/test/environment-*.test.mjs scripts/test/globe-*.test.mjs` (CI `environment-unit`, its exact command) | 243/243 at the final state; with `scripts/test/equity-product-consumer.test.mjs`, 247/247 | |
| `cd workers/mccluster && node --import ./test/support/offline-network.mjs --test test/world-environment-rupture.test.mjs` | 8/8 | at `c7c8731e` the file cannot load (no `RUPTURE` export) |
| `... --test test/world-environment-rupture.test.mjs test/world-environment-layers.test.mjs test/world-environment-guard.test.mjs test/world-environment.test.mjs test/eup-environment-usgs.test.mjs` | 93/93 (with S3's ingest test, after S3's 409 change landed) | |
| `python3 docs/design/equity-uprise-building/production/verify_equity_uprise_repo_sources.py` | 2,930/2,930 at the final state (2,914 before the mission-source commits merged in) | failed on the two unmapped test files |
| `nice -n 15 node --test scripts/test/*.test.mjs` (the root suite, once, at 07:00 UTC: after the rim fix, before the disc distance rule, which touches only `js/environment-layers.js` and the selection test, both in the environment suite run after it) | 2,841 tests: 2,834 pass, 0 fail, 7 skipped (82.7 s; load 4.0 rising to 7.4) | |
| `cd workers/mccluster && nice -n 15 node --import ./test/support/offline-network.mjs --test test/*.test.mjs` (the whole Worker suite) | at the final state: 2,020 tests, 2,011 pass, 0 fail, 9 skipped (28.2 s); at `1cb28842` with the rim fix: 2,007, 1,998 pass, 0 fail, 9 skipped. The twelve `test/mnet-mission-flow.test.mjs` failures S0 to S3 recorded are gone (repaired on the branch before these runs) | |

### Browser runs

One browser at a time under the shared lock, Chromium with SwiftShader (software GL), Cesium 1.131 served locally under the CDN
URL; WebKit was not run and no real device was used (D18), so nothing here claims Safari or device acceptance. The final runs
are on the branch head `1cb28842` with this slice's last changes (the mission-source commits merged after them touch no file
these pages load).

- `CESIUM_DIR=<Cesium 1.131 Build/Cesium> node scripts/e2e/environment-globe.e2e.mjs <out>`: **148/148 checks** (390 and 1280,
  the three refusals, reduced motion, D16 with mission pins, the perf self-test; 1-minute load 3.5 at its end).
- `CESIUM_DIR=... node scripts/e2e/environment-world.e2e.mjs <out>`: **231/231 checks** at 390, 820 and 1280 by night and day,
  the S5-TOUR at-rest check among them (1-minute load 8.3 at its end).
- `node scripts/perf/environment-globe-perf.mjs --missions --modes off,on --sizes 390,1280 <out>` (two mission pins with their
  halos, 10 s idle after 12 s settling):

  | Size, layers | Before (`2855a4e9`): task s / frames | After: task s / frames | Flight frame mean, before / after |
  | --- | --- | --- | --- |
  | 390, off | 10.05 / 29 | 10.22 / 33 | 501 / 363 ms |
  | 390, on | 10.54 / 22 | **0.18 / 0** | 558 / 388 ms |
  | 1280, off | 10.14 / 18 | 10.19 / 16 | 654 / 686 ms |
  | 1280, on | 10.31 / 18 | **0.14 / 0** | 667 / 771 ms |

  With the layers on, the globe now renders on demand with mission pins present (D16); with them off the halos breathe as
  before, by design. Heap with the layers on 32 and 33 MB (before 32 and 32). The flight frames are software-GL frames of a few
  samples each; 1280's push runs about 100 ms a frame heavier than before, which a GPU pass should measure (no device here).
- Runs recorded as they were. Earlier e2e runs at this slice's first commit: the globe suite failed two S5 checks at 1280 only
  (a 1.7 s push had landed before the read, and the cancel came after the landing; the checks now accept the flight's record
  once it has landed and press right after a fresh tap), then stopped once on a script error (a `setView` during a push; the
  harness now stops the flight first), then passed 148/148; the World suite failed one check that predates this slice ("with
  the tour paused the globe renders on demand" at 390: the `camera` hold read just after every hold had gone, load about 4)
  and passed 231/231 on its re-run. Two perf runs and one screenshot run crashed Chromium's renderer ("Target crashed") on the
  radius-scaled rim step described above. Two globe runs were stopped by hand and are not counted: one overlapped the moment the
  rim fix was set back to prove its tests fail, the other ran on code without the disc distance rule.
- The 390 overlap, measured before the fix (`probe-layout`, the World page with the real frame): the app bar at y 762-830 lies
  over Replay at 390 x 844, over Play, Previous and Next at 360 x 780; nothing at 414 x 896 or 1280 x 800. After the patch: the
  tour's controls at y 564-660 (390 x 844), 537-633 (360 x 780), 586-682 (414 x 896), clear of the bar; `scrollWidth ===
  clientWidth` at every size.

### Deviations from the plan, with reasons

- **The e2e cancels the push with a press, not a wheel.** Under software GL the wheel reached the page about 3 s late while frames
  were drawn (a probe measured 3.2 s), after a 1.6-2 s push had landed. The e2e presses and drags right after a fresh tap; the unit
  tests cancel with each of pointerdown, touchstart, wheel and keydown, and with a new choice.
- **The tour's controls moved in the vendored panel.** The plan named the 390 overlap but no file. Moving the tour's group up in the
  panel's markup is the one change that keeps every control clear of the World's floating app bar at rest without hiding anything:
  recorded local patch `S5-TOUR` (hash and regression tests in the lock), with a smaller title and margins on a phone.
- **Labels keep out of the page's furniture by measured rectangles.** The frame cannot see the page around it, so the header band,
  the headline, the music and full-screen buttons and, wide, the app bar are rectangles measured on the World (constants in
  `js/environment-quake-marks.js`). A new World layout needs them measured again.
- **The "plain white circles" were fire cells.** They are the fire summary's hottest class (white, as the legend says), not quake
  discs. They were made smaller and half as opaque rather than recoloured, so the fire ramp and its legend stay as they were.
- **The disc distance rule is not in the plan.** It came from the first renders after the push (one flat ellipse over the landing).
  It belongs to the push's composition, so it shares D14's status: default adopted pending Matthew's confirmation.
- **The rupture is asked from M6, for USGS ids only.** Lane 06 found finite-fault models only at M6.5 and up; M6 leaves a margin
  for a model published lower. Ids that are not USGS event ids (other providers, the fixtures' hyphenated ids) are never asked.
- **The ShakeMap fact keeps its wire words** ("no contours shown: no_shakemap", the S3 note): S5's plan names no wording change
  for it, while the new rupture fact has words of its own. Left for a later slice.
- **V10 stays partial.** Every new motion (the push, the ripple, the label reveal) follows reduced motion, but `PULSE` is still
  read once at load and there is no in-app switch; S6 and S7 carry the rest of V10.
- **`--missions` is a flag.** The plan asked for the perf run with mission pins; the script's default stays `[]` so earlier
  records remain comparable.

### Waiting for Matthew's separate go

- D13 (the rupture drawing), D14 (the push on every explicit choice, with the disc distance rule as part of its landing), D16
  (still halos while the layers are on), D17 (the ripple's scale) and D21 (the reference's name only in licence attribution):
  each a **default adopted pending Matthew's confirmation**.
- Nothing is live. The branch is not merged or deployed; the rupture route ships with the Worker's next deploy and answers only
  behind the persisted environment module policy, which stays off until he turns it on.
- A real-device pass (D18: WebKit was not run here and no device was used): on an iPhone at 390 px, the glyphs read from orbit,
  a tap lands within the 44 px target, a touch stops the push, the rings are seen from where the camera lands, and the tour's
  controls sit clear of the app bar at rest; then an iPad and desktop Safari.

## Recovery review, 2026-11-19: delayed reads and changed event availability

At recovered head `69058f8997b3`, the S4 timeline was already complete beyond the earlier handoff. A focused review found
that a read begun before a module refusal could finish afterward and restore cleared events; a delayed deep link could also
take selection and camera focus back from a newer choice. In addition, an owner withdrawal with the same content revision
left its cached published post intact, and a held event's 404 left an older cached post visible.

`js/world-environment-timeline.js` now tracks the gate generation and the selection generation. A refusal ends all reads from
the old gate, clears the busy state and pending focus, and permits the next open gate to read immediately. A newer deep link,
visitor selection or Back discards an older event answer. A same-revision detail answer replaces the cached event, including
its availability and coordinates; a held or gone detail removes its cached post and shows the existing absence message.
Neither a tombstone nor a held event leaves a pending globe focus. The Worker contract, pending SQL and source policy are
unchanged.

Five regression tests in `scripts/test/world-environment-timeline.test.mjs` fail against the recovered implementation and
pass with this change. On Node 22.23.5 the focused suite passes **22/22**; the combined timeline, source-profile and area suites
pass **41/41** (45/45 including the four source-record checks). These are local Node tests, not a new browser or device proof.
The Worker timeline suite passes 11/11 with the offline network guard. The existing timeline integration suite passes 11/11
against the real pending SQL in disposable PGlite, including off-before-store reads, alias resolution, corrections, owner
holds, source withdrawals and pagination. The earlier Chromium receipts above remain records of the earlier implementation.
No production migration, ingest enablement, module activation or deployment was performed by this review.
