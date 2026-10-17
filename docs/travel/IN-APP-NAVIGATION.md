# In-app street navigation

## Product behavior

The public World entry opens Travel with an optional location request and a
destination field. Browser permission follows the existing entry privacy notice.
Denial, timeout and devices without geolocation leave manual starting-address
entry available. No example city is represented as the visitor's location.

Selecting a destination reveals Drive, Walk, Bike and Get a ride. **Get
directions** requests a route; selection, entry, saved-journey loading and GPS
acquisition do not prefetch routes. Changing mode or swapping places after a
route has already been requested is an explicit request for replacement
directions. “Plan a longer trip” contains flights, trains, dates and stays.

A successful route shows estimated time and distance, the actual road/path
polyline on the existing Cesium globe, and a list of turn instructions. Selecting
a turn focuses that place on the map. **Start navigation** starts a foreground
GPS watch, displays the next turn and remaining distance, and follows the current
position. Two usable off-route fixes can trigger a new route from the current
location, with a 30-second rerouting cooldown. Poor accuracy cannot advance the
route or falsely report arrival. Ambiguous crossings favor continuity with the
current progress instead of jumping to a later loop.

Stop, leaving Travel, hiding the page, leaving World, sign-out and switching an
existing account cancel the applicable watches or in-flight work. Late responses cannot restore an old
trip. Returning to a hidden page requires Start navigation again. Route steps
remain useful when live GPS or WebGL is unavailable. This release does not provide
offline maps, background navigation, spoken instructions, live traffic in the
pilot, or a certified navigation device.

The globe retains its supplied artwork and shared navigation. Travel road routes
do not become straight decorative arcs, appear in operator Analytics, or expose
internal vehicle/flight telemetry. Same-origin, parent-frame validation applies
to all route and location messages.

## Canonical service

The route is served by Worker **`mccluster`**, through
`workers/mccluster/src/entry-platform.js`. No new Worker, database, auth stack,
Durable Object class or migration is required. `HereTenantAgent` stays exported.

`POST https://api.mccluster.org/v1/travel/route` accepts JSON:

```json
{
  "origin": [-72.92888, 41.30806],
  "destination": [-72.92506, 41.29886],
  "mode": "walk"
}
```

The coordinates are public sample landmarks in New Haven, not visitor data.
Coordinate order is **longitude, latitude**. Modes are `drive`, `walk`, `cycle`.
The public endpoint requires an allowed McCluster browser origin, accepts at most
2 KiB of request JSON, rejects route parameters in URLs, and requires no account.
Origin checks are browser policy, not bot authentication.

A successful response is `{ "route": ... }`, containing validated endpoints,
mode, provider, attribution, distance, duration, full geometry and ordered steps.
Each step includes its instruction, location, geometry index, distance, duration
and maneuver. Both server and browser reject invalid geometry, disconnected
endpoints, out-of-order steps, impossible metrics and a response for another
trip. Responses are bounded to 2 MB, 10,000 points and 1,500 instructions.

No route is a `422`; malformed input is a `400`; busy or exhausted pilot capacity
is `429` with Retry-After; missing configuration and upstream failures are `503`.
The browser and Worker time out rather than spin indefinitely. Error text never
returns an upstream URL, provider key or raw upstream payload.

## Provider and capacity

The deployed configuration opts into the free, **noncommercial pilot**:

```toml
TRAVEL_ROUTING_PROVIDER = "fossgis-pilot"
TRAVEL_ROUTING_PILOT = "noncommercial"
TRAVEL_OSRM_BASE = "https://routing.openstreetmap.de/"
```

FOSSGIS / OSRM supplies distinct car, foot and bicycle routes. The reviewed host
is pinned; travelers cannot supply an upstream URL. Requests include an
identifying user agent, site referrer and the already-published operator contact.
Attribution, the OpenStreetMap correction link and contact remain visible.

The existing HereTenantAgent namespace uses one dedicated routing-quota instance
to enforce **one upstream request in flight**, at least **1.1 seconds between
requests**, and a **1,000-request UTC-day application budget**. That daily budget
is our protective rollout cap, not a published FOSSGIS allowance. The object
persists only quota timing, count and reservation identity, never route
coordinates or a traveler's identity. Restarting an instance does not reset the
budget. Upstream throttling adds a cooldown. Unauthenticated scripted callers
can consume this shared budget; the pilot prioritizes bounded upstream usage,
and does not claim an availability SLA.

The FOSSGIS policy review is not written provider approval. Nonprofit status
alone does not establish commercial-use permission. Replace the public pilot
before paid routing, booking commissions, a substantial commercial offering, or
traffic beyond modest public-service use. The existing Photon address search
also needs an appropriate hosted or contracted service before substantial use.

For a separately authorized McCluster TomTom connection, configure
`TRAVEL_ROUTING_PROVIDER = "tomtom"` and provision **`TRAVEL_TOMTOM_API_KEY`** as
a Worker secret. The adapter requests real Calculate Route guidance and enables
traffic for driving. No McCluster TomTom key was available during implementation;
the adapter is fixture tested, not live verified. Halo's TomTom secret belongs to
that product and must not be reused. Review capacity, provider attribution and
the UI's routing-provider disclosure as part of any provider change; pilot caps
currently continue to apply until deliberately changed.

Disable routing by clearing the selected provider or removing the explicit pilot
opt-in. The UI then displays that the service is unavailable while manual search,
longer-trip planning and external ride handoff remain usable. Roll out backend
and static assets through the repository's existing release pipeline, and verify
the deployed commit and route endpoint before reporting it live.

## Location and ride boundaries

Travel stores draft and route state in memory. Only explicit Save writes a
private journey through the existing account store. Route POST bodies carry
coordinates and transport mode, not identity, address labels or an auth token.
The routing provider receives route endpoints and may log requests under its
policy. Photon receives the search query, without GPS bias. The map's existing
tile providers continue to receive ordinary map requests.

The planner, destination label and saved-journey dialog are private analytics
surfaces. Handoff URLs with precise endpoints must not enter click telemetry.
These controls do not alter or claim to remove the separately approved site
analytics feature that can collect location after permission.

Get a ride constructs an official `https://m.uber.com/looking` link with `pickup`
and `drop[0]` JSON containing the selected coordinates and place labels. A manual
pickup remains exactly as selected. A device-derived pickup needs a usable fix
less than 30 seconds old; Refresh pickup location obtains it inside the ride
panel without modifying the private draft. The user
chooses **Continue in Uber**, reviews availability and price there, and confirms
there. No invented app identifier, fare, ETA, driver, reservation, affiliate
commission or dispatch state is shown. This link is not a supplier booking API.
The old Whip rider prototype contains sample dispatch data and must not be
exposed as a live cab service. Direct taxi booking still needs an approved
supplier account, credentials, operational terms and a real confirmation flow.

## Verification and sources

The routing suites cover request/response bounds, real OSRM structures, malformed
and no-route responses, provider configuration, cancellation races, canonical
HTTP routing, actual HereTenantAgent orchestration, persistent quota behavior,
navigation turns and loops, poor GPS, off-route detection, arrival, and Uber's
coordinate handoff. Node tests shim Cloudflare runtime imports and SQL storage;
the Worker dry build verifies the production entrypoint compiles. The compiled
entrypoint also passed an actual workerd/SQLite Durable Object check with the
captured public route response: HTTP 200 with all 66 points and seven turns,
concurrent HTTP 429, and exactly one outbound request. The local environment's
DNS restriction prevented direct upstream access from workerd; public-provider
smoke requests were made separately through the permitted network path.

Live FOSSGIS requests between New Haven Green and Union Station returned distinct
road/path routes in all three modes. This is a provider contract smoke test,
not a claim of physical on-road navigation testing. Browser checks exercise the
actual Cesium renderer, phone/tablet/desktop layouts, no-prefetch selection,
permission denial, route errors, guidance, cancellation and mode isolation.

Primary references reviewed for this implementation:

- [FOSSGIS routing service and use requirements](https://routing.openstreetmap.de/about.html)
- [FOSSGIS current server-use policy source](https://github.com/fossgis/fossgis-webseite/blob/master/content/arbeitsgruppen/osm-server/nutzungsbedingungen.md)
- [OSRM Route API](https://project-osrm.org/docs/v5.24.0/api/)
- [TomTom Calculate Route](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route)
- [Uber ride-request deep links](https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction)
- [Photon service](https://github.com/komoot/photon)
