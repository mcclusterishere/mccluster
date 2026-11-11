# Connecticut weather: ingest once on Core, serve small snapshots

Status, 2026-11-03: built and tested. **Ingest is off.** This is Phase D (map mode first) of the owner-adopted
AR/reconstruction/weather addendum (§8, §10). Region data is in `docs/fictional-city/PLANET-CONNECTICUT.md`.

## Shape of the system

```
NWS · NOAA CO-OPS · MRMS (noaa-mrms-pds) · NEXRAD L3 (unidata-nexrad-level3)
          │  one request per feed per run, generic User-Agent, redirects refused, bodies capped
          ▼
McCluster Core (OVH)   job weather_region_snapshot  (core/src/executors/weather-region-snapshot.mjs)
          │  output.snapshot in ops_agent_jobs  (no new table; same storage as the morning briefs)
          │  + /var/lib/mccluster-core/artifacts/weather/connecticut-pilot/latest.json (atomic)
          ▼
Worker mccluster   GET /v1/world/weather/connecticut-pilot   (owner only; one Supabase read a minute, shared)
          ▼
weather-desk.html + js/weather/client.mjs (globe-ready API) + js/weather/game-weather.mjs (pure, simulated)
```

The number of players never multiplies an upstream call. Core is the only caller of the providers. The Worker reads
one job row through a minute-long shared Cache API entry.

## Feeds

| Feed key | Source / product | Kind | Stale after |
| --- | --- | --- | --- |
| `observation` | NWS `stations/KBDR/observations/latest` | observation | 90 min |
| `forecast_hourly` | NWS `gridpoints/OKX/58,67/forecast/hourly` (24 periods; issued at `updateTime`) | forecast | 4 h |
| `alerts` | NWS `alerts/active?zone=CTZ009` (none active is a fresh answer) | alert | 15 min |
| `water_level` | CO-OPS 8467150 Bridgeport `water_level`, `datum=NAVD`, metric | observation | 30 min |
| `tide_predictions` | CO-OPS 8467150 `predictions`, `interval=hilo`, NAVD, from yesterday for 72 h | forecast | 2 d |
| `rain_now` | MRMS `CONUS/PrecipRate_00.00` (mm/h, 2-min product), cropped to Connecticut | observation | 15 min |
| `radar_reflectivity` | KOKX Level III **N0B** (product 153, 0.5° × 0.25 km, dBZ) | observation | 20 min |
| `radar_velocity` | KOKX Level III **N0G** (product 154, m/s, **radial, relative to KOKX**) | observation | 20 min |

Region grid:

- statewide bounds rounded out: lon −73.76…−71.76, lat 40.96…42.08;
- 0.02° cells, 100 × 56, north row first;
- MRMS is the mean of its native 0.01° cells inside each grid cell;
- radar is the nearest bin at each cell centre, using the ground range as the slant range (under 0.5 % out to 230 km
  at 0.5°).

## Decoders (radar decode status: working)

- **MRMS GRIB2:** `core/src/weather/grib2.mjs`. It is pure Node and uses zlib only. It reads grid template 3.0 and PNG
  packing 5.41 (and simple 5.0). It unfilters PNG rows in sequence and keeps only the crop. A CONUS message decodes in
  about 0.6 s, with RSS about 160 MB at peak; the runner unit allows 3 G. Any other template throws `unsupported`
  instead of decoding garbage. It was checked against a live message: parameter 209/6/1, 7000 × 3500, −3 = no
  coverage.
- **NEXRAD Level III:** `core/src/weather/nexrad-level3.mjs`. It parses the WMO header, the message header, the product
  description block and packet 16. The symbology block is bzip2. It is inflated by the system `bzip2 -dc`, which is
  bounded to 2 MB in and 16 MB out with a 20 s timeout. That means no npm package and no native addon. Ubuntu ships
  `bzip2`, but **its presence on the OVH box was not verified from here**. If it is missing, both radar feeds report
  `decoder_missing` and everything else still works.
  - Levels follow the product thresholds: code 0 is below threshold; code 1 is range folded (velocity) or missing
    (reflectivity); code n ≥ 2 is `min + (n − 2)·increment`.
  - It was checked live: KOKX 40.865, −72.864, VCP 35, 0.5° tilt, 720 radials, 1840 bins for N0B and 1200 for N0G.
  - The packet's range-scale halfword reads 999 on these products. The documented 0.25 km gate is used, and the raw
    value is recorded.
  - Py-ART and wradlib were not needed for these two products.
- **Level II** (`unidata-nexrad-level2`, `-chunks`) is reachable but **not decoded**. Level III N0B/N0G give the lowest
  tilt at super-resolution, which is enough for map mode. Level II (all tilts, dual-pol) is the next step if volume
  products are wanted.

## The snapshot (`mccluster.weather.snapshot.v1`)

```json
{
  "schema": "mccluster.weather.snapshot.v1", "region": "connecticut-pilot", "generated_at": "…", "mode": "live",
  "grid": { "west": -73.76, "south": 40.96, "east": -71.76, "north": 42.08, "dlon": 0.02, "dlat": 0.02, "nx": 100, "ny": 56 },
  "focus": { "name": "Bridgeport harbour", "lat": 41.172, "lon": -73.1885 },
  "counts": { "ok": 8, "carried_forward": 0, "missing": 0 },
  "feeds": { "<feed key>": "WeatherFieldV1 (below)" },
  "receipts": [ { "feed": "rain_now", "status": "ok", "ms": 1528 } ]
}
```

Each record (`mccluster.weather.field.v1`, `core/src/weather/fields.mjs`) extends the shape proposed in the planet doc:

- `status`: `ok`, `carried_forward` or `missing`.
- `data_kind`: `observation`, `forecast` or `alert`. `simulated` is only ever game weather.
- Provenance: `source_id`, `product`, `source_url`, `attribution`.
- Times: `observed_at`, `issued_at`, `valid_from`, `valid_to`, `ingested_at`, `stale_at`.
- Meaning: `units`, `vertical_datum`, `quality_flags`, `derived_from` (S3 keys).
- `payload`.
- Readers add `age_s` and `stale`, recomputed from the record's own time at read.

Rasters are uint8 base64 on the region grid:

- `mrms-rate-u8-v1`: 0 is dry; 1–199 is ×0.1 mm/h; 200–253 is 20 + 2·(n − 200) mm/h; 254 is no coverage; 255 is
  outside.
- `nexrad-level-u8-v1`: the product's level codes plus a `lut`; 255 is outside the scan.

A live snapshot is about 41 KB. With `?rasters=0` it is a few KB.

Rules:

- **No invented values.** A failed feed is `missing` with a reason.
- A previous good record is `carried_forward`, keeping its **original** times so it keeps ageing. Rasters are carried
  for 2 h at most, everything else for 24 h.
- Station QC `X` or `B` values are withheld.
- The forecast issue time is `updateTime`, never the response's `generatedAt`.
- **Radial velocity is labelled `relative_to_radar`, `radial_component_only` and `aliasing_possible`.** It never drives
  game wind; the station drives that.
- Reflectivity is flagged `returns_not_rainfall`.

## Running it

```bash
cd core
npm run weather:fixture                       # replay the recorded fixtures (no network, no database)
node src/weather-snapshot-cli.mjs --fixture --fail rain_now,alerts   # rehearse outages
npm run weather:live -- --check               # fetch each feed once; nonzero exit for missing/stale feeds
node scripts/weather-record-fixtures.mjs      # re-record core/fixtures/weather/connecticut-pilot/
npm run test:weather
```

`--check` is an explicit readiness assertion: any missing, stale or carried-forward
feed exits nonzero. Without it the CLI remains a diagnostic summary and can exit
successfully with missing feeds. A successful fixture check is only fixture proof;
only a successful `--live --check` on the intended runtime demonstrates provider
freshness there. Neither mode proves the scheduled timer or owner browser path.
`--help` prints usage without fetching. Unknown options, invalid clocks and mixing
live mode with fixture controls are rejected before network work.

Turning on scheduled ingest is an owner decision. Neither step has been done:

1. Add `WEATHER_INGEST_ENABLED=true` to `/etc/mccluster/core.env`. Optionally set `WEATHER_SNAPSHOT_KEEP_HOURS`
   (default 48; finished snapshot jobs older than that are pruned, for this job type only).
2. Run `systemctl enable --now mccluster-core-weather.timer`. The unit is installed by `scripts/deploy-ovh-core.sh`,
   but it is deliberately absent from its enable list. The cadence is 10 min.
3. The runner already knows `weather_region_snapshot` once Core is promoted.

Until then the Worker answers `available: false, reason: no_snapshot_yet`.

## Owner view

`weather-desk.html` is owner-gated by `js/owner-only.mjs`, noindex and out of the sitemap. It has five cards: Rain now,
Radar (reflectivity / radial velocity), Forecast & alerts (official alerts first, then the KBDR station and the next
hours), Tide, and Game weather. Each card shows its source, product, observed or issued time and age (counting up
between polls), and STALE, CARRIED FORWARD and MISSING badges. It was checked at 390 px with
`scrollWidth === clientWidth`.

For the globe (not edited here; the Games overlay branch owns `action-globe.*`):

- `createWeatherLayer({ getToken, onUpdate })` polls every 2 min;
- `decodeRaster(record, grid)` returns values;
- `valueAt(snapshot, feed, lat, lon)` reads a point;
- `ageNow` and `staleNow` report age and staleness.

Game weather: `gameWeather(snapshot)` in `js/weather/game-weather.mjs` returns `data_kind: 'simulated'` effects (rain
0..1, wetness, wind, tide level and trend). It returns `real_alerts` untouched. When a reading is stale or missing it
falls back to labelled defaults. `water_city_y_proposed` uses the planet doc's **proposed** `cityY = NAVD88 − 0.23`,
which is not accepted. `js/fictional-city/*` is not edited.

## Not done

- A nowcast. The persistence or pysteps baseline and its held-out verification are later work.
- Level II volume decoding.
- MADIS/CWOP stations.
- AR placement.
- A broker capability binding. `weather.field.read` stays a placeholder, because the production catalog forbids
  planned entries.
