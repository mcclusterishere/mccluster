# Admin continuity and living globe

Owner request, 2026-10-24: fix inconsistencies across admin screens and replace an undifferentiated field of dots with recognizable, animated representations across the globe.

## Shared shell

Every top-level HTML entry that loads the shared bottom bar loads `js/shell-boot.js` before first paint. The bar and competing Control rails wait for the current session check and shared navigation presentation. The owner keeps the same Play / Control / M / Analytics / Halo destinations. A same-subject token refresh keeps the existing layout until the authoritative answer; denial, sign-out and account changes still withdraw admin navigation. No positive owner grant is cached. Script failure has a bounded fallback.

Halo keeps one mounted globe and four local views. A view change closes the old detail/menus, stops an old follow/orbit, updates list, statistics, detail and timeline in one synchronous paint, and retains the global navigation. No previous panel is exposed while the new view is being built.

## Visual coverage

| Data | Representation | Meaning and bounds |
| --- | --- | --- |
| Civil / military aircraft | Heading-aware silhouettes, nearby representative aircraft model | Broadcast position; no invented flight motion or airframe identity |
| Satellites | Solar-panel symbol, nearby 3D schematic, orbit | Calculated positions from TLE; generic geometry |
| Vessels | Ship silhouette, nearby hull and cabin | AIS snapshot; no invented route |
| Earthquakes | Fracture glyph and expanding ground rings | Event identification, not a measured fault or real-time wave |
| Thermal detections | Rising heat strands | Hotspots are not automatically wildfire |
| Wildfire perimeters | Reported boundary plus flame / smoke representation | Report may lag actual spread; graphic is not measured flame height |
| Cyclones | Spiral cloud bands | Latest NHC position; not satellite cloud imagery or measured size |
| NOAA water levels | Gauge / wave symbol, station mast and ripples | Station location; actual readings remain in its chart |
| NOAA tornado alerts | Animated funnel, labelled warning area | A warning is not a confirmed tornado position; geometry anchor is a boundary label |
| Flood / coastal events | Water crests, reported alert polygon when supplied | No fabricated inundation footprint |
| Thunderstorms | Cloud and intermittent lightning symbol | Event type, not a measured instantaneous strike |
| Rain / snow / cold | Cloud and falling drops or snow | Event representation, not locally measured precipitation |
| Volcano reports | Cone and ash column | Latest NASA report, not a live camera or measured plume |
| Wind / dust / haze | Flowing strands | Type representation, not an observed vector field |
| Heat / drought | Rising shimmer strands | No fabricated temperatures |
| Ice / landslides | Ice / terrain and debris glyphs | Latest reported geometry |
| Cameras | Camera glyph | Actual image availability remains separately verified |
| Launches | Rocket / launch-site symbol | Published launch schedule, no fake launched vehicle |
| Missions / teams / evidence | Flags / team / document glyphs | People remain attached to mission places, never invented personal locations |
| Region aggregates / intel cells | Existing area aggregation | Counts and evidence areas remain aggregate geography, not physical objects |

The shared event renderer caps animated symbols at 48 and nearby 3D representations at 8, culls the far side of Earth, pauses hidden documents, honours reduced motion, and exposes a motion switch and detail budget. All located events retain static selectable symbols even outside the animation budget. The user's existing density controls for aircraft and satellites remain separate.

## Real sources and honesty

Owner-only `/v1/world/layers/weather` uses NOAA NWS active actual alerts. Expired, test and cancelled alerts are excluded. Zone-only alerts stay in the list without a fabricated map position; the layer reports both mapped and total counts. `/v1/world/layers/natural` uses NASA EONET open reports in the last 30 days and their newest dated geometry. An open report does not prove ongoing activity at this instant. Source dates, provenance and official links remain inspectable. Public APIs remain behind the existing owner release guard in McCluster; no new backend or credentials.

Official source contracts: https://www.weather.gov/documentation/services-web-api and https://eonet.gsfc.nasa.gov/docs/v3 . Both are keyless. Live adapter check during implementation returned 340 NOAA alerts (23 with geometry) and 52 NASA reports. These counts vary.

## Release proof

Local script and provider-contract tests; actual Cesium browser fixtures at 390, 820 and 1280 pixels; every Control route and Analytics tab through the existing navigation and Analytics suites. New checks sample visible navigation frame-by-frame, exercise cross-page owner navigation, distinguish warning detail from observations, verify each event visual family, test zero-detail and paused animation, preserve map interaction space, and inspect rendered screenshots. Screenshots use synthetic fixtures and are labelled accordingly.

Photorealism or parity with every original God's Eye View source is not claimed. Globe clouds remain the existing static NASA composite, not live weather imagery. Geographic source data remains authoritative; animation is explanatory.
