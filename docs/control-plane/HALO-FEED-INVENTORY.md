# Hitman's Halo: feed inventory

Written 2026-11-23 (readings taken 2026-11-24 04:36 UTC). Scope: every feed the Halo view **declares**
(`js/halo/halo.js` `GROUPS`, 17 items), not only the ones that draw. The same list is served to the owner, with live
configuration flags, by `GET /v1/eup/halo` (Control → System → Hitman's Halo → Declared feeds).

## What was and was not verified

| Kind of number | Status |
|---|---|
| Counts through the Worker with the owner's session (what Halo actually returns and shows in production) | **Partly verified**, 2026-11-24 05:20 UTC, off the screen of the owner's signed-in desktop app: the two feeds that were on (Earthquakes 246, Tropical cyclones 0). The other feeds were off and were not switched on. No owner token was used by any script. Signed out, the production Halo link shows the plain public globe and loads no Halo script |
| Which secrets are set on the production Worker (`FIRMS_MAP_KEY`, `AISSTREAM_API_KEY`) | **Not verified.** `GET /v1/eup/halo` reports this as booleans once this change is deployed |
| Public provider answers read directly, unauthenticated | Read for USGS, NOAA NHC and NASA EONET (below). These are the provider's numbers, **not** Halo's |
| Fixture counts | The nine files in `scripts/e2e/fixtures/halo-feeds/` are synthetic. **Fixture counts are not live counts** |

## Live reading through the owner's session (2026-11-24 05:20 UTC)

Read off the screen of the owner's signed-in McCluster Desktop app (production, the code deployed that day, **before**
this change), with the 3D map working. Read-only: no layer was switched, nothing was refreshed or saved. One group was
expanded to read its counts and collapsed again.

| What | Reading |
|---|---|
| Halo header | 126 active missions, 1 awaiting review; members online shown as a dash |
| Intelligence | 5 enabled sources, 100 need review, 0 partial or stale, 0 unavailable; Feed 102 signals, Briefs 9, Sources 18 |
| Earthquakes | **On, 246 shown**, "Updated 2m ago" |
| Tropical cyclones | **On, 0 shown**, "Updated 2m ago" in green |
| Missions; Intelligence connector; Missions and evidence | Updated just now; updated 5m ago; updated just now |
| Member regions | "Live" |
| Aircraft, Military aircraft, Ships, Weather alerts, Natural events, Thermal hotspots, Water levels, Wildfire perimeters, Satellites, Launches, Cameras, Intel events, Exchanges | **Off** on this device |

### Second reading, 05:22 to 05:26 UTC, with the owner's go-ahead

Each feed that was off was switched on, read, and switched off again; the groups were collapsed afterwards. The device's
saved setup ends as it began (Earthquakes, Tropical cyclones, Missions and Member regions on).

| Feed | Shown in production | Note |
|---|---|---|
| Aircraft | 1,020 shown / 1,020 loaded | |
| Military aircraft | 71 (67 four minutes later) | |
| Ships (AIS) | **"Needs a key"** | `AISSTREAM_API_KEY` or its binding is not set on the production Worker |
| Weather alerts | 9 mapped / 405 reports | 396 alerts carry no coordinates: listed, not mapped |
| Natural events | 46 mapped / 46 reports | |
| Earthquakes | 246, then 244 | already on |
| Thermal hotspots | **"Needs a key"** | `FIRMS_MAP_KEY` is not set on the production Worker |
| Water levels | 303 stations | reference data |
| Tropical cyclones | 0 | already on; NHC listed no active storm |
| Wildfire perimeters | 50 | |
| Satellites | 166 shown / 166 loaded | |
| Launches | 0 | not checked against Launch Library |
| Cameras | 6,512 | catalogue entries, not live streams |
| Missions | 0 on the map | 126 active missions, none with a place |
| Member regions | Shown | |
| Intel events | 69 | |
| Exchanges | 13 open / 49 | |

Every declared feed answered. **Two return nothing because a key is missing in production**, which the page says only
once the feed is switched on. The narrow list column also breaks the "Aircraft" and "Satellites" labels across lines
when a count is shown.

What this settles:

- **With the map working, twelve of the seventeen declared feeds showed nothing because they were switched off** in this
  device's saved Halo setup, not because they failed. Only Earthquakes and Tropical cyclones were on (the Intelligence
  tab turns those two on by itself). Whether the others return data is still unread: reading them means switching them
  on, which changes the saved setup, so it was left for the owner.
- The cyclone feed read **0 with a green "Updated 2m ago"** while NHC listed no active storms: an empty answer shown as
  an ordinary fresh count, as described below. After this change it reads "No records".
- "Updated 2m ago" is the Worker's fetch time. The earthquake count (246) is what the page could use; what the Worker
  returned is not shown by the deployed code, so returned versus shown is still unknown for production.
- Not read: the no-map path in production (the map worked), and what the Worker returned before the page's own
  filtering.

## The trace, per feed

Path for every extended feed: release guard (owner only) → Worker route → provider fetch through `upstream` →
`cachedLayer` (Cache API, last good answer kept 6 h past the TTL) → envelope → `js/halo/layers.js` normalize → list,
Intelligence feed, timeline → paint on the map when there is one. There is no canonical store on this path: these are
live reads, not ingested evidence. Canonical evidence (`intel_evidence`) reaches Halo separately through
`/v1/intel/evidence` and `/v1/intel/geo`.

| Feed | Source | Needs | Route | Provider time in the envelope | Lists without the map |
|---|---|---|---|---|---|
| Aircraft (`flights`) | adsb.lol, or OpenSky with credentials | optional OpenSky credentials | `/v1/world/layers/flights` | `observed_at` | **No** (a globe base layer) |
| Military aircraft | adsb.lol `/v2/mil` | none | `/v1/world/layers/military` | `observed_at` (provider "now") | Yes |
| Ships (AIS) | AISStream via the `HereTenantAgent` Durable Object | `AISSTREAM_API_KEY` + binding | `/v1/world/layers/vessels` | `last_message_at` | Yes |
| Weather alerts | NOAA NWS | none | `/v1/world/layers/weather` | per row `observed_at` (alert sent) | Yes |
| Natural events | NASA EONET | none | `/v1/world/layers/natural` | per row `observed_at` (latest geometry date) | Yes |
| Earthquakes | USGS `all_day.geojson` | none | `/v1/world/layers/quakes` | `observed_at` (feed generated) and per row `time` | Yes |
| Thermal hotspots | NASA FIRMS VIIRS, two satellites | `FIRMS_MAP_KEY` | `/v1/world/layers/fires` | per row `acq` | Yes |
| Water levels | NOAA CO-OPS station list | none | `/v1/world/layers/tides` | none (reference data) | Yes |
| Tropical cyclones | NOAA NHC `CurrentStorms.json` | none | `/v1/world/layers/cyclones` | **none** | Yes |
| Wildfire perimeters | NIFC WFIGS | none | `/v1/world/layers/perimeters` | none (per row `discovered` is not an update time) | Yes |
| Satellites | CelesTrak elements, positions calculated | none | `/v1/world/layers/satellites` | none | **No** |
| Launches | Launch Library 2 | optional token | `/v1/world/layers/launches` | none | **No** |
| Cameras (CCTV) | the Halo camera service behind the Worker proxy | internal credential | `/v1/world/cctv/*` | per snapshot | **No** |
| Missions | Supabase, service role | none | `/v1/world/halo/missions` | n/a (first-party) | Yes |
| Member regions (5 or more) | the globe's own aggregate | none | none of Halo's | n/a | **No** |
| Intel events | canonical `intel_evidence` | none | `/v1/intel/geo`, `/v1/intel/evidence` | `observed_at`, `retrieved_at` | Evidence list yes; map layer no |
| Exchanges, GDP and listings | `js/halo/markets.js` | none | markets routes | schedule | **No** |

`fetched_at` in every envelope is the **Worker's** clock, not the provider's. Before this change the view showed
"Updated N ago" and "Live" from it.

## Returned, shown, and why they differ

`js/halo/layers.js` `status(id)` now carries, per feed: `returned` (rows the Worker sent), `count` (rows usable here),
`dropped` with `dropWhy`, `mapped`, and four clocks (`provider`, `newest`, `fetched`, `checked`). The source detail in
Halo shows them. The standing reasons a shown number is smaller than a returned one:

| Step | Rule | Where |
|---|---|---|
| Worker | Caps per feed (quakes 2000, fires 25000 lowest radiative power first, vessels 8000, military 4000, perimeters 400, weather 1500, natural 500); privacy-flagged airframes withheld; AIS rows older than an hour dropped; rows without a valid id or position dropped | `workers/mccluster/src/world-halo-layers.js` |
| Page, reading | A row without a valid position, a perimeter without three valid points, a station id that is not seven digits, an alert without an id or already expired | `normalize` in `js/halo/layers.js` |
| Page, map | Alerts and natural events with no coordinates are listed and not mapped | `mapped` vs `count` |
| Intelligence feed | Quakes: M4.0 and above, the 12 strongest; fires: the 6 strongest by radiative power; then the timeline window (1, 6 or 24 hours) and the area filter | `feed()`, `feedFiltered()` in `js/halo/halo.js` |

### Readings

| Feed | Provider, read directly (2026-11-24 04:36 UTC) | Through the Worker, owner session | Fixture (synthetic) |
|---|---|---|---|
| Earthquakes | 235 features, all with a valid id and position; 20 at M4.0+; feed generated 04:36:27Z; newest event 04:28:26Z; newest `updated` 04:32:50Z | not verified | returned 4, usable 3, 1 dropped (no valid position); 2 in the feed (M4.0+) |
| Tropical cyclones | 0 active storms: a real empty answer | not verified | returned 1, usable 1 |
| Natural events | 500 open events with my own `limit=500` query (the cap was hit, so the true total is not known from this); the Worker's own query was not replayed | not verified | returned 2, usable 2 |
| Weather alerts | not read | not verified | returned 3, usable 2, 1 dropped (no id) |
| Military aircraft | not read | not verified | returned 3, usable 3 |
| Ships (AIS) | cannot be read without the key | not verified | returned 3, usable 2, 1 dropped (no valid position) |
| Thermal hotspots | cannot be read without the key | not verified | returned 3, usable 3 |
| Wildfire perimeters | not read | not verified | returned 2, usable 1, 1 dropped (no drawable boundary) |
| Water levels | not read | not verified | returned 3, usable 2, 1 dropped (station id) |

With today's NHC answer, the old view would have shown the cyclone feed as an ordinary count of 0 marked "Live"; it now
reads "No records: the provider answered with nothing", which is different from unavailable.

## What the owner was missing, and what is fixed

1. **Fixed.** No extended feed was fetched when the Cesium viewer did not start (`layers = V && …` in `js/halo/halo.js`).
   Nine feeds now load and list without the map.
2. **Fixed.** A failed refresh dropped the count to "Unavailable" and cleared the rows. The last good answer is kept and
   labelled stale, by whom and why.
3. **Kept and tightened.** A 403 already removed the rows. It now also forgets that there ever was a good answer, so a
   later outage cannot bring them back as "stale".
4. **Fixed.** An empty answer read as a bare `0` marked "Live". It now reads "No records", separate from
   "Unavailable" and "Failed".
5. **Fixed.** Fetch time was shown as the data's age. Provider time, newest record, Worker fetch time and the page's
   clock are separate; a feed whose provider gives no time says so.

## Still open

- **Seven declared items still need the map** (aircraft, satellites, launches, cameras, member regions, the intel map
  layer, markets). They are drawn by the globe's own layer code (`G.layer`), which has no list path. Without WebGL they
  read "Needs the map". Aircraft, satellites and launches have Worker routes and could be listed the same way; that is a
  change to `js/action-globe.js`, which this change does not touch.
- **USGS revisions are dropped at the Worker.** `normalizeQuake` keeps `time` and drops `updated`, `status`, `magType`
  and `ids`, so Halo cannot show that an event was revised. Needed before quakes become keyed evidence (source, revision,
  content hash).
- **NHC and NIFC supply no usable time in the envelope.** The Worker could pass the advisory time through.
- **The live reading covers two feeds.** The rest need the owner to switch them on (or to say that may be done), and
  returned-versus-shown needs the source detail panels this change adds, after deploy.
- **A feed that is off looks the same as a feed with nothing in it** until the owner opens the list. Worth deciding
  whether the Intelligence tab should say how many declared feeds are off.
