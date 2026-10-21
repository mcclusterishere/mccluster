# Hitman's Halo on the admin globe

Owner direction, 2026-10-21:

> "I need you to put all the capabilities of Hitman Halo into the admin experience of the globe section. And I don't mean the
> experience of Seek First … it looks like God's Eye View … It needs to be more advanced than this repository with the user
> interface of the current globe we have on our website."
>
> "And fix the fact that the control room points to seek first … Hitman Halo's UI also needs a redesign, but we'll save that
> for last."

This record says what the admin globe now holds, where each piece lives, what is next, and the rules it keeps. Companions:
`HALO-INTEL-IMPLEMENTATION-MAP.md` (Seek First retirement), `WORLD-GLOBE-FEED-AND-ANALYTICS.md` (the World globe),
`INTEL-TO-MISSION-CANON.md`.

## Where it lives

- **The full-screen globe** (`action-globe.html?explore=1`) mounts the Halo console for the house owner only:
  `js/halo/halo.js` (console), `js/halo/layers.js` (Halo's live layers), `js/halo/vision.js` (visual modes),
  `js/halo/hud.js` (telemetry HUD), `css/halo.css`, `css/halo-hud.css`.
- **The World's frame** (`mnet.html`) shows the owner a round Halo button above World; it opens
  `action-globe.html?explore=1&halo=1`, the console open.
- **The Control Room** tile "Hitman Halo" and the site menu's "Halo on the globe" open the same link. The "Spatial
  Intelligence" tile, which opened the Seek First console (`auth/seek-first-handoff.html`), is removed; nothing in Control
  links to Seek First any more. The standalone Halo product (`prime.mccluster.org`) keeps its own menu entry.
- **Who sees it.** `js/action-globe.js` loads none of these files unless the Worker's `/v1/world/access` answer says
  `release.admin_preview === true` for this session (the house owner: `org_members` owner of `mccluster`). Losing that answer
  unmounts the console and its layers. Every Halo request goes to the canonical Worker `mccluster` on owner-gated routes; the
  release guard (`packages/release-policy/globe.mjs`, `workers/mccluster/src/world-release.js`) refuses everyone else before
  dispatch. There is no second backend: Halo's own Worker and OVH runtime are not called.

## Phase 1 (this release)

| Capability (Halo) | On the admin globe | Data |
|---|---|---|
| Live flights | Globe's Flights layer, in the console; tap → facts + **Follow** | `/v1/world/layers/flights` (OpenSky with credentials, else adsb.lol) |
| Military flights | Console layer; amber, emergencies red; heading-true icons; tap → facts + Follow | `/v1/world/layers/military` (adsb.lol `/v2/mil`, ODbL; privacy-flagged airframes dropped) |
| Ships (AIS) | Console layer; heading-true icons; tap → facts + Follow | `/v1/world/layers/vessels` (the existing AIS Durable Object; needs `AISSTREAM_API_KEY`) |
| Satellites | Globe's layer; tap → orbit preview + **Follow** (SGP4 each frame) | `/v1/world/layers/satellites` (CelesTrak) |
| Space missions | Globe's layer | `/v1/world/layers/launches` (Launch Library 2) |
| Earthquakes | Console layer; size by magnitude, colour by depth; M4.5+ labelled; tap → USGS facts + link | `/v1/world/layers/quakes` (USGS, public domain) |
| Active fires | Console layer; VIIRS hotspots sized by radiative power | `/v1/world/layers/fires` (NASA FIRMS; needs `FIRMS_MAP_KEY`, says "Needs a key" without it) |
| Wildfire perimeters (from GEV) | Console layer; ground-draped polygons | `/v1/world/layers/perimeters` (NIFC WFIGS, public) |
| Tropical cyclones (from GEV) | Console layer; position, class, wind; NHC advisory link | `/v1/world/layers/cyclones` (NHC, public domain) |
| Intel events, CCTV | Globe's own layers in the console; CCTV keeps its mission gate | `/v1/intel/geo`, `/v1/world/cctv/*` |
| Google Photorealistic 3D Tiles | Console "Photoreal 3D cities"; the globe hides while the city mesh stands in; OSM Buildings step aside | ion asset 2275207 through `/v1/world/ion` (the account token never reaches the page) |
| Visual modes | Night vision, Thermal, CRT, Anime, Noir, Snow; Sharpen, Bloom; keys 1–7 | `js/halo/vision.js` (GLSL post-process stages) |
| Intelligence HUD | Lat/lon (DMS), MGRS, altitude, heading/pitch, GSD estimate, sun elevation, UTC; key H | `js/halo/hud.js` |
| Location search | Search a place, pick a result, fly there | `/v1/world/geocode` (Photon, Nominatim fallback; cached a day) |
| Click-to-track | Follow any Halo item, flight or satellite; Esc stops | camera `lookAt`, keeps the owner's zoom and angle |
| Orbit | Slow orbit around the followed thing or the Earth; key O; off under reduced motion | — |
| Share links | Copy a link carrying camera, vision, HUD and layers; opens for the owner only | URL hash `#halo=` |
| Remembered setup | Vision, HUD, open layers, tab, open state | `localStorage halo:prefs`, this browser only |

Honesty, as in Halo: a layer says its count, "stale", "Needs a key", "Owner only" or "Unavailable"; nothing moves between
snapshots; the visual modes are labelled as treatments, and the fake sensor read-outs some of the original shaders painted
(temperatures, REC, frame counters) are removed.

## Next phases (each its own PR)

**Phase 2: tracking.**
- The cockpit view on a followed aircraft.
- Detection boxes (screen-space, from known positions, labelled as such).
- Smooth motion between snapshots, labelled as interpolation, never as observation.
- Trails and 3D aircraft models.
- The 250 km contacts roster.

**Phase 3: the ground.**
- CCTV projected into the 3D city, behind the existing mission and privacy gate.
- Street traffic, labelled as simulated.
- Street-level imagery.
- Recent satellite imagery with A/B swipe.
- Wind and observed weather.
- Transit, bikeshare and radio.
- Datacenters and dams (ODbL). Submarine cables stay out: TeleGeography is non-commercial.

**Phase 4: beyond God's Eye View.** These are the gaps its own docs name:
- **Time machine.** Owner snapshots persisted to `ops_ingest_*`, a 4D scrubber, and replay of any area and window.
- **Watchlists and geofences.** Rules (squawk 7700, AIS gaps, loitering, a quake near a site) that raise owner alerts.
- **Cross-layer entity resolution.** One ship or aircraft across feeds.
- **An analyst.** It answers through McCluster's own AI routing (`docs/control-plane/AI-HARNESS.md`), not a page-held key.

**Last:** the standalone Halo product's UI redesign.

## Licences and terms, in short

| Source | Terms |
|---|---|
| adsb.lol | ODbL 1.0 |
| OpenSky | Non-commercial research and education |
| CelesTrak | Asks for citation |
| Launch Library 2 | Credit |
| USGS, NHC, NIFC, NASA FIRMS | Public / open |
| AISStream | Beta terms |
| Photon and Nominatim | ODbL data; Nominatim at most 1 request a second, with a User-Agent |
| Google Photorealistic 3D Tiles | Attribution stays on screen; no caching outside Cesium's |
| Cesium ion | Plan terms |

The visual-mode shaders are adapted from God's Eye View (MIT, © 2026 Bilawal Sidhu) via Hitman's Halo. The notice is at
`vendor/LICENSES/gods-eye-view-MIT.txt`.
