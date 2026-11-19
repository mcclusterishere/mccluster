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

The browser suites (`scripts/e2e/environment-world.e2e.mjs` at 390, 820 and 1280, `world-environment.mjs`,
`environment-globe.e2e.mjs`, `world-missions-guest.e2e.mjs`) are recorded under "Browser runs" below once run.

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

### Waiting for Matthew's separate go

- The Worker change reaches production only with the merge of a pull request he approves (also the deploy).
- Install, then Enable, of the environment module in Control (each a production policy change; Install alone makes the public
  answer 404 off).
- Decisions D1, D2 and D8 as adopted defaults; a staging resource, if he wants one.
- Nothing was applied, installed, enabled, flagged or published.
