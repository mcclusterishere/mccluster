# Seek First / Spatial Intelligence — state and remaining owner actions

Supersedes the original Claude handoff. That document asked for work; this one
records what was done, what was verified and how, and what is still yours.

## User intent (unchanged, still authoritative)

- Seek First is **not** a replacement for any public McCluster page.
- `matthew.mccluster.org` stays visually and behaviorally unchanged.
- Seek First is an **internal/backend operations and spatial-intelligence surface**.
  No public navigation, no public product page.
- Access goes through Cloudflare Access or the existing backend auth boundary,
  never an unauthenticated Pages route.
- Per-source licensing is preserved and enforced.

## What changed

### The public exposure was removed

The prior branch added `feature/gev-spatial-intelligence` to the GitHub Pages
deploy trigger, built the upstream viewer into the public web root at `/gev/`,
and mirrored its model directory to the site root. `tools/build-gev.sh` also
baked the Supabase anon key into the generated HTML and monkey-patched
`window.fetch` to redirect `/api/*` at a Supabase Edge Function.

All of it is gone. `.github/workflows/deploy-pages.yml` is back to the
main-branch version and publishes only from `main`. A test asserts the public
Pages workflow never mentions Seek First again.

### The console is McCluster's, and it boots

Upstream `src/main.js` reads `import.meta.env.CESIUM_ION_TOKEN` and
`import.meta.env.GOOGLE_MAPS_API_KEY` — Vite BUILD-time variables. A runtime
JSON fetch injected into the generated HTML could never satisfy that code path,
which is why the prototype sat on its loading cover.

Rather than keep patching a build-time credential path at runtime, the viewer
is now McCluster's own: `workers/mccluster/src/seek-first/console.html`, served by the
canonical Worker at `GET /internal/seek-first`, querying `/v1/seek-first/*`.
The canonical intelligence is the API and the database; the renderer is
replaceable.

Boot is built so the stuck-cover failure cannot recur:

- provider configuration is fetched at runtime and awaited before the map stack
  is constructed;
- every step is timed out and its result shown;
- the cover is dismissed in a `finally` AND by a hard deadline;
- a fatal error shows a diagnostic with Retry / Continue, never a spinner;
- the globe is built from OpenStreetMap imagery and an ellipsoid, so it renders
  with zero paid credentials; Google 3D Tiles and ion terrain are added after,
  each timed out, each falling back to the open stack;
- a missing key disables one layer and names the binding it wants.

### The API is authenticated and lane-aware

Only `GET /v1/seek-first/health` answers unauthenticated, and it reports liveness
only. `sources`, `readiness`, `entitlements`, `capabilities` and the viewer
config all require a McCluster house owner, because the provider inventory is a
map of where the credentials are.

Cloudflare Access (RS256 assertion verified against the team JWKS) sits in
front of `/internal/seek-first` and the Seek First routes when configured.

An entitlement firewall decides whether a consumer's lane may consume a
source's licence class, and gates retention. See `SPATIAL-INTELLIGENCE.md`.

### AIS is genuinely persistent

An outbound WebSocket in a Durable Object cannot hibernate: if the object is
evicted, the socket dies with it and in-memory status goes too. So connection
state is persisted in DO SQL, a self-re-arming alarm acts as the heartbeat and
reconnects, failures back off exponentially, AISStream's in-band error frames
fail the connection instead of being ignored, rows are pruned on a one-hour
TTL, stored payloads are bounded, and the snapshot takes `bbox` and `limit`.
With no key the endpoint reports `unconfigured` and the console says so.

## What was verified, and how

**Cold browser** (Chromium via Playwright, three configurations, 28 checks):

- no session: sign-in card, never an undiagnosed cover;
- keyless authenticated: cover clears, Cesium 1.145.0 loads, globe geometry is
  present under the centre of the view, the imagery layer attaches and its tile
  queue drains, 12 layers render, paid modes are disabled;
- keyless provider layer loads and reports mapped counts; a keyed layer with no
  key degrades to "needs FIRMS_MAP_KEY"; AIS with no key says so; stored PostGIS
  entities load;
- config endpoint returning 500: still boots the globe keyless;
- keyed: Google 3D and ion modes enable, and a rejected Google request degrades
  with a message instead of killing the console;
- no uncaught errors and no CSP violations in any configuration.

That pass found three real bugs, all fixed: the CSP had no
`'unsafe-eval'`/`'wasm-unsafe-eval'` so Cesium never constructed; `connect-src`
omitted the tile host, and Cesium fetches tiles over XHR rather than `<img>`, so
the globe rendered blank with no visible error; and the point renderer used the
global `isFinite`, which coerces `null` to `0` and pinned every position-less
record to Null Island.

**Database** (PostgreSQL 16 + PostGIS, migrations replayed from empty):

- all three spatial migrations apply cleanly;
- the DeKalb scenario reads correctly end to end — April wooded parcel, May
  permit event, June cleared, July building footprint, September energy
  observation — and `seek_first_timeline` returns them in order for a window;
- a re-ingest that changes nothing writes no revision;
- observation idempotency holds on `(org_id, source_key, external_id)`;
- `seek_first_nearby`, `seek_first_bbox`, `seek_first_events_nearby`, `seek_first_timeline` all return
  correct distances and counts;
- after deliberately re-granting the old permissive Supabase defaults,
  re-running the migration closed the boundary again: `anon` and `authenticated`
  were refused both the tables and the RPCs, `service_role` still worked.

Applying the trigger against real PostGIS also found a bug: comparing
`geometry` with `is not distinct from` under `search_path = ''` is ambiguous.
It now compares `st_asewkb`.

**Provider adapters, called live against the real APIs** (no keys, 14 sources):
USGS, Open-Meteo, CelesTrak, ADSB.lol, Overpass, Launch Library 2, Radio
Browser, Nominatim, USAspending, Grants.gov, NHTSA, EPA ECHO and the Re:Earth
config route all returned normalized records. That pass found three more bugs:

- **EPA ECHO returned zero records against a 200 OK.** `get_facilities`
  RESOLVES a query and answers with a QueryID and row counts, never with
  facility rows. Worse, the obvious fix is also wrong: `get_qid`'s default
  column set carries `FacLat` and not `FacLong`, so a parser reading both still
  gets nothing mappable. The adapter now resolves, refuses a query too broad to
  return honestly, then reads `get_geojson`. A New Haven query now returns 1560
  facilities, all positioned.
- **Overpass answered 503.** The main instance sheds load often enough that a
  single-endpoint adapter reads as broken; it now tries the public mirrors in
  turn, and a 4xx (our query is wrong) still fails immediately.
- **GDELT timed out** at the default 15s budget; it now gets 40s.

GDELT still answers 429 from this egress address — upstream rate limiting, not
a defect, and the adapter reports it as 429.

**Worker**: 67 unit tests pass. `wrangler deploy --dry-run` bundles cleanly at
~536 KiB (113 KiB gzip) with the `HereTenantAgent` Durable Object binding
present. Routes were probed against a local `wrangler dev`.

**Public site**: against `main`, this branch changes nothing outside
`workers/`, `supabase/`, `docs/` and one `.gitignore` line. No HTML, asset, CSS
or `js/` file in the published web root is touched, and `index.html` is
byte-identical to `main`. The prior branch's changes to
`.github/workflows/deploy-pages.yml` and `tools/build-gev.sh` were reverted, so
they too are net-zero against `main`.

## What is still yours

### 1. Deploy the Worker

This session had no Cloudflare deploy credential, so nothing was pushed to the
`mccluster` Worker. Deploy latest `main` (or this branch's merge) as a **new**
production deploy — do not Retry an old red build. The good log must show the
`HereTenantAgent` Durable Object binding.

### 2. Apply the migrations

Not applied to production. Reconcile the production migration lineage first,
then apply `20260909034000`, `20260909034100` and `20260909040000` through the
repository's Supabase workflow and run the advisor checks. Until then the
Worker reports `mode: adapter-ready`; provider brokering works and only the
stored-data routes return `spatial_schema_not_ready`.

### 3. Put Cloudflare Access in front of `/internal/seek-first`

Create an Access application for `api.mccluster.org/internal/seek-first`, then set on
the Worker:

- `SEEK_FIRST_ACCESS_TEAM_DOMAIN` — e.g. `yourteam` or `yourteam.cloudflareaccess.com`
- `SEEK_FIRST_ACCESS_AUD` — the application's AUD tag

Until both exist the shell is reachable but empty: every byte behind it still
requires a house-owner token. With both set the shell itself is unreachable
without a valid assertion.

### 4. Add provider keys as they arrive

`wrangler secret put <NAME>` on the `mccluster` Worker, or the dashboard.
Nothing else is needed: the source activates on the next request.

| Binding | Unlocks | Notes |
| --- | --- | --- |
| `CENSUS_API_KEY` | Census / ACS | |
| `EIA_API_KEY` | energy series | |
| `DATA_COMMONS_API_KEY` | Data Commons v2 | |
| `BLS_API_KEY` | labor series | |
| `FRED_API_KEY` | economic series | |
| `FIRMS_MAP_KEY` | NASA FIRMS active fires | |
| `COPERNICUS_CLIENT_ID` + `COPERNICUS_CLIENT_SECRET` | Sentinel STAC search | |
| `PLANET_RESEARCH_API_KEY` | Planet imagery | **ACADEMIC lane.** Refused to commercial consumers by design. |
| `OPENSKY_CLIENT_ID` + `OPENSKY_CLIENT_SECRET` | OpenSky states | ACADEMIC lane, transient |
| `TOMTOM_API_KEY` | traffic flow | COMMERCIAL lane, transient |
| `AISSTREAM_API_KEY` | live vessels | COMMERCIAL lane, transient, DO-cached |
| `MAPBOX_ACCESS_TOKEN` | geocoding / tiles | COMMERCIAL lane, transient |
| `GOOGLE_MAPS_API_KEY` | Photorealistic 3D Tiles, geocoding | **Reaches the browser.** Restrict by HTTP referrer. Content is never persisted. |
| `CESIUM_ION_TOKEN` | World Terrain, ion assets | **Reaches the browser.** Use a scoped read-only token. |
| `LL2_API_TOKEN` | Launch Library 2 | Optional; the adapter works unauthenticated |

Optional AIS tuning, non-secret: `AISSTREAM_BOUNDING_BOXES`,
`AISSTREAM_MESSAGE_TYPES`.

### 5. Working with no keys at all

These need nothing: USGS, Open-Meteo, CelesTrak, ADSB.lol, OpenStreetMap
Overpass, Nominatim, USAspending, Grants.gov, EPA ECHO, NHTSA, Radio Browser,
Launch Library 2, GBFS, public CCTV catalogues, GDELT, and the OpenStreetMap
basemap the console boots on. Each was reached live while this work was done.

## Known gaps

- **Not deployed and not migrated** — items 1 and 2 above.
- **OSM tile policy.** The keyless basemap uses `tile.openstreetmap.org`, which
  is fine for a handful of operators but is not a heavy-use tile source. Move
  to Mapbox or self-hosted tiles if the console gets real traffic.
- **CelesTrak returns orbital elements, not ground positions.** The layer
  reports a count until SGP4 propagation is added.
- **The CCTV adapter is a catalogue stub.** Only the audited Austin feed is
  enabled, and it normalizes no records yet.
- **Overpass is slow through the mirrors** — a 3km infrastructure query took
  ~40s in testing. The console times it out at 20s, so wide Overpass queries
  will sometimes report a timeout rather than data.
- **GDELT is rate limited by source IP.** Cloudflare's egress may fare better
  than this test host, but expect 429s under load.
- **Re:Earth / Mapterhorn terrain is raster terrarium**, not Cesium
  quantized-mesh. `terrain.reearth.land` no longer resolves at all. The registry
  now reports the live Mapterhorn tilejson and says it is not a drop-in
  `TerrainProvider` URL; a decoder or a quantized-mesh source is still needed.
- **The CSP allows `'unsafe-inline'` and `'unsafe-eval'`** because Cesium
  requires eval and WASM compilation, and the console is a single inlined file.
  Tightening to a nonce plus `strict-dynamic` is possible but needs its own
  browser verification pass; it is not free.
- **No `POST /v1/seek-first/query` or `/analyze` yet.** Buffers, spatial joins and
  difference-in-differences are the next layer, and they belong on top of
  `seek_first_timeline` rather than beside it.

## Public site invariant

Still true, still checked: the Pages deployment publishes only the web root
from `main`, and the internal console lives on the Worker. A test fails if the
public workflow ever mentions Seek First again.
