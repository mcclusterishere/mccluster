# Unified owner analytics

Design authority: Matthew's approved Analytics concept, 16 October 2026. The existing five-tab bottom bar, tab names and supplied logos are unchanged. The globe is a roughly 30%-height geographic reference. The existing owner Control shell, Worker, Supabase authority, property scope and detail views remain the application.

## What this implementation connects

- Overview: property-wide traffic, unique visitors, new accounts, verified live sales net of refunds, scoped reach chart, first-party conversion funnel, track starts/listeners/returning listeners, mission assignment states, bookings/refunds, workspace access and site error/friction counts.
- Globe: the existing geographic renderer, selection/filter mechanics, country/state suppression thresholds and unknown-location accounting. Country selection controls the reach view; metrics without country-specific support explicitly remain property-wide/all-country. No individual visitor coordinates.
- World intelligence: all sources returned by the canonical owner-gated `/v1/seek-first/sources` registry, with capabilities, credential readiness (never values), entitlement status and persistence classification. Configuration is not labeled feed health.
- Each source has an explicit read-only provider snapshot action using the existing authenticated broker with `persist:false`, `include_raw:false`, internal consumer lane and a requested limit capped at 500. No automatic upstream polling, ingestion, paid plan, scheduled job or credential copying is introduced. The server's source-specific validation and provider bounds remain authoritative; not every provider honors a generic `limit` input. The view renders at most 50 records.
- Stored entities and recent ingestion attempts use their existing owner-only reads. Missing storage is shown as unavailable rather than empty or zero.
- CCTV: the existing Austin adapter previously returned its catalog only in `raw` while leaving `records` empty. The adapter now returns bounded normalized metadata including unknown positions and catalog status. It does not equate TURNED_ON with a verified stream and does not fetch or redistribute frames.
- Data coverage: existing data families and a searchable directory of every field in the 455 application relations found during this audit. Private authentication, vault and infrastructure schemas, secret values, personal rows and conversation contents are excluded from the published metadata inventory.

## Audited evidence and limits

The database metadata query inspected 522 tables/views across application and platform schemas; 455 were in `public`. `data/analytics/application-schema-inventory.json` records the public relation/column metadata as of 16 October 2026. This proves schema presence, not row completeness, permission to read every row, freshness or operational health. System-maintained row estimates were used only for investigation and are not displayed as business totals.

The live metadata inventory contained no `seek_first_*` spatial archive or `intel_*` canon tables. The existing spatial route checks `seek_first_sources`; the intel service reports `intel_schema_not_ready` when its required functions are absent. This PR does not silently apply the historical spatial replay migrations or the pending intel migration. Existing transient reads and the new UI can work independently of storage readiness. Provisioning the governed archive remains an explicit production migration task with its own review and validation.

The shared source registry covers Census, EIA, Data Commons, BLS, FRED, USAspending, Grants.gov, EPA, USGS, Open-Meteo, NHTSA, CelesTrak, Overpass, ADSB.lol, Launch Library 2, Radio Browser, terrain, GBFS, CCTV, PeeringDB, RIPE Atlas, Nominatim, GDELT, NASA FIRMS, Copernicus, Planet research, OpenSky research, TomTom, AISStream, Mapbox, Google Maps and Cesium ion. Source-specific inputs are required; validation failures are visible. No health claim follows from a key being configured.

## Halo runtime coverage

Audited Halo head: `02326075d46290554fd4a1ae7632ed6b5978035a`; relevant sources: `DATA_SOURCES.md`, `src/data/dataCredits.js`, `src/cloudflareWorker.js`, `src/cloudflareCctv.js`, `src/cloudflareCctvExtraSources.js`.

Halo has 11 CCTV pack families: Austin, Caltrans, TfL, Ontario, Fintraffic, DriveBC, TxDOT, NSW, Calgary, DelDOT and Vegvesen. A family can contain multiple district catalogs. The McCluster CCTV adapter currently supports Austin; the other Halo packs are runtime coverage, not falsely represented as already unified archive records. Camera catalogs, actual frame availability and HLS video are distinct measurements.

Halo also has runtime aircraft/traces, AIS vessels, orbital elements and derived satellite positions, launches, traffic, roads, bikeshare, weather/regional news, fires, earthquakes, radio, Internet facilities/probes, terrain, imagery and bundled geographic context. Derived detections, inferred headings, route animation, modeled visibility and model geometry are not independent observed events. The common data plane already registers many underlying providers; Halo's exact renderer state, frame caches, isolate health and runtime-only packs still require an authenticated snapshot contract to be projected into this overview. Halo and McCluster credentials stay separate.

Historical GEV/Seek First functionality is inspected through the existing fork and source registry. No claim is made that every original GEV capability is implemented or live. The requested camera-data category is handled as CCTV; no unrelated service named CZTV is invented.

## Validation

Unit tests cover missing-vs-zero values, live/test commerce separation, provider-output escaping, suppressed geography, camera deduplication/unknown coordinates, bounded catalogs and normalized CCTV adapter responses. Browser QA runs the real Control shell, real geographic assets and renderer with labeled in-memory API fixtures at 390, 820 and 1280 px. It checks no horizontal overflow, compact geography, unchanged five-tab navigation, archive-unavailable state, user-triggered snapshot requests, no ingestion and no runtime errors. Fixture tests are not verification of a signed-in production feed.

Run:

```sh
node --test scripts/test/analytics-unified.test.mjs workers/mccluster/test/analytics-camera-catalog.test.mjs
PLAYWRIGHT_DIR=/path/to/node_modules CHROMIUM_PATH=/path/to/chromium CESIUM_DIR=/path/to/cesium/Build/Cesium node scripts/e2e/analytics-unified.e2e.mjs /tmp/analytics-qa
```

No production deployment or database change is included in this branch.
