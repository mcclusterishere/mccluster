# Free travel navigation core — first reusable implementation

Status: implemented as isolated functions, not connected to a shipping screen.
Base reviewed: `9692fcbdb2443c75560ef92465c81cd21c7465e1` (2026-10-16).

## Why this change, not a bulk merge

PR #451 demonstrates a key-free Google Maps directions handoff, but mixes it
with private partner-funding UI, older World markup and an outdated ledger.
This implementation reuses that approach, not the entire stale branch. PR #453
needs a separate driver-consent migration before its registration path is ready;
it is not activated here. No historical PR is declared equivalent or closed.

## Implemented

- Dependency-free ES module `js/travel/navigation-core.mjs`.
- Normalized place queries or finite GeoJSON `[longitude, latitude]` coordinates.
- Apple and Google external directions URLs for driving, walking, cycling and
  generic public-transit search, with encoded parameters and fixed HTTPS hosts.
- Bounded, immutable draft itineraries with ordered drive/walk/cycle/transit,
  flight/train/bus and stay legs. No client input becomes a confirmed booking.
- A selected-ground-leg handoff. Flight, specific train/bus and stay legs do not
  become a misleading driving route; they explicitly have no supported handoff.
- An explicit `startHere` option omits the planned origin. The map provider then
  handles origin entry/location permissions. This code never asks for GPS.
- Missing ETA, price and geometry stay null. No invented flight status or routes.

The plan is an in-memory *planning* object, not the proposed authoritative
Journey Engine, reservation ledger, driver-assignment service or sharing system.
No deduplication/event coordination, notifications, live aircraft or route
polyline is claimed in this change.

## Run without keys or installation

```sh
node --test scripts/test/travel-navigation-core.test.mjs
node scripts/demo/free-travel-navigation.mjs
```

Focused tests cover encoding/injection, coordinate order, null/boolean/sparse
inputs, identifier/length limits, immutable copies, unsupported modes, leg
selection and separation of flight/stay versus ground directions. The example
prints only synthetic planning data plus handoff URLs; it makes no network call.

## Integration and privacy contract

The existing globe/navigation sheet may import these functions later. Offer
external links only after user action, name the provider, and use
`rel="noopener noreferrer"`. Show place names as text, not unescaped HTML.
Constructing a link sends nothing. Opening it sends the included endpoint text
or coordinates to the selected maps service; it may store its own history.
Do not put these URLs or precise endpoints in analytics events or share tokens.
Do not claim GPS stays on the device after the user opens an external map.
Text queries are not verified addresses, accessible entrances or airport pickup
zones. Resolve/confirm those separately before making coordination promises.

Apple unified Maps URLs target supported versions (iOS 18.4+, macOS 15.4+,
watchOS 11.4+). Actual iPhone/provider handoff and availability require manual
QA before consumer UI activation. Unit tests prove generated syntax, not that
a provider finds every destination or operates a service. Google mode `bicycling`
is mapped from the shared `cycling` value. Regional coverage remains provider
controlled. No automatic start parameter is set.

## Preserved boundaries

No shipping page, bottom bar, Worker, secret, paid API, dependency, SQL migration,
ledger, authentication rule or deployment configuration changes. No new backend.
Nothing calls the owner-only Travel Desk or any payment, ticket or dispatch route.
No Google route data is fetched or drawn onto Cesium: these links leave the app.

## Verification limits

The focused tests and demo were executed on Node 22.16.0. A full checkout could
not be obtained in the working container (GitHub DNS resolution unavailable).
Full existing-repository checks must run in GitHub CI on the exact new head.
No browser screenshot or real-device test is claimed. No approval to merge a
navigation/analytics redesign or apply migrations is inferred from this module.

## Next bounded integration

Wire a guest-only navigation preview to the existing globe, preserving the dock
and authenticated Social mode. Build destination selection and chosen-leg state
around this module; add permitted route-provider geometry separately. Keep the
preview off the default route until screenshots and mobile behavior are approved.

## Provider references (checked 2026-10-16)

- Google Maps URLs: https://developers.google.com/maps/documentation/urls/get-started
- Apple unified Maps URLs: https://developer.apple.com/documentation/mapkit/unified-map-urls
- Prior handoff concept: https://github.com/mcclusterishere/mccluster/pull/451

URLs need no API token. This does not grant data redistribution rights or make
transportation, reservations or provider services free.
