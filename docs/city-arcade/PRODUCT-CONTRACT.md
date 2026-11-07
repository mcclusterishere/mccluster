# City Arcade product contract

Draft review implementation, 2026-11-04. No production deployment or canonical database change.

## Player journey and authoring

Choose one of two source-backed street entrances, choose a game, configure a mission, play,
save a practice result, return to the map and resume later. Tea Rush has a visible shop,
player, customers, brewing, delivery and timer. Sole Run uses continuous 2D locomotion on the
shared Bridgeport road network, a follow view, minimap and glowing legal checkpoints, beginning
with Robbery 1s. It is a bounded arcade game, not a replacement for the 3D city engine.

The same validated mission document drives controls, server saves, private immutable versions
and gameplay. Tea controls cover duration, speed, brewing, local points, spawn and order route.
Sole controls cover duration, speed, points, checkpoint order, road closures and optional Fashion
Police encounters: stable encounter ID, street stop, decoy name, two clues, correct evidence,
roast text, reward and time penalty. Closures must leave all checkpoints reachable. The optional
sequence is inspect → identify → theatrical prop confiscation → on-camera skit → main route.
The skit uses no device camera. Default characters are invented costume decoys; no real police
identity, real person, corporate logo or identity-based insult is introduced. Story progression
and canonical shoe wearers remain untouched.

## Canonical storage and authorization

`supabase/pending/city_arcade_v1.sql` is a reviewed LOCAL schema, not an applied migration.
It follows the existing Level Forge service-only SECURITY INVOKER/RLS pattern:

- canonical Worker `/v1/arcade` calls the existing `requireHouseOwner` for every request;
- the database RPC repeats current `org_members`/`orgs` owner membership;
- anon and authenticated roles have no direct table/RPC privileges; service_role is server-only;
- mission save checks expected revision under a transaction lock and inserts an immutable version;
- start freezes a run's mission revision; finish belongs to the same actor and is idempotent;
- server calculates practice points from the frozen mission, supplied completion count and allowed
  encounter IDs, not client-submitted points; results remain self-reported and are NOT anti-cheat
  validated, currency, rewards, cross-world benefits or a public leaderboard;
- history is owner-private, bounded to 20 completed runs; all responses are private/no-store.

Lower roles are denied, not assigned inferred editor powers. Introduce any delegated editing
capabilities only with an explicit capability model and tested database policies. No existing auth
stack, role definition or membership was changed. Concurrent writers on separate real Postgres
sessions and production session authorization have not been verified by the local PGlite tests.

Mission cloud controls use the existing API origin. They report unavailable until the reviewed
schema and Worker are intentionally promoted. They never silently label a local save as cloud.
Mission configuration also supports local play. Failed cloud finish can be retried with the same
run ID; Tea preserves the pending finish with its local session. Sole's retry is available while
its result screen remains mounted; reload recovery of that pending submission is not implemented.
Local sessions and scores are untrusted device state and use new versioned keys; old scores,
city saves, government identities and PRIM3 saves are unchanged.

## Geography and loader integration

Source: `core/data/fictional-city/district.v1.json`, neighborhood `bridgeport-robbery-1s`.
`tools/build-arcade-locations.mjs` derives the 914-byte marker manifest and server road artifact.
It verifies anchors against real retained OSM road vertices. Runtime detailed geometry comes from
the existing publisher's `data/fictional-city/district.v1.json`; do not fork or reauthor the city.
The adopted equirectangular frame and its datum/accuracy limits remain unchanged. Road widths,
props, characters and Tea's interior are authored. Entrance markers are street locations, not a
claim of real commercial tenancy or exact government/building occupancy. All 16 CT footprint
rings are read unchanged. OSM/CT attribution is visible; provider attribution remains in the globe.

The host reuses the existing network globe surface with `missions=0&arcade=1`, using existing
travel pick/journey protocols and no flight interface. One small optional hook in `js/action-globe.js`
installs `globe-observer.mjs`: after camera move-end, report centre lon/lat and camera height to
the same-origin parent. Only messages from the exact iframe and same origin reach the loader.
This optional observer is the shared-file integration point for the city task; reconcile it with
that task's observer/loader contract rather than adding another world engine.

Initial load requests lightweight markers, not game engines or full district geometry. Explicit
entry, or an actual globe view within the configured region/height, loads bounded shared geometry.
Actual game modules import only on game entry. Leaving the region or returning to the map saves
active play, stops rendering/listeners, aborts pending geometry and releases map data references.
Stale imports cannot mount. JavaScript modules remain in the browser module cache: dynamic imports
cannot be cancelled mid-transfer or un-imported. No claim of reclaiming those cached bytes is made.

Owner loading controls on this device set the bounded region, height threshold and byte budget.
They are local preferences, not cloud-synchronized mission permissions. The budget includes district
bytes plus a tested 100,000-byte reserve for arcade modules; shared shell/Cesium/provider traffic
is outside this per-game budget. Defaults: 3,000 m camera height and 1,500,000 bytes. Detailed
geometry is currently the complete 596,924-byte shared district export, not per-city chunk streaming.

## Provider and review limits

Existing Cesium ion configuration/access checks are reused without token changes or purchases.
Ion browser tokens require least privilege, asset restriction and allowed URLs:
https://cesium.com/learn/ion/cesium-ion-access-tokens/ (checked 2026-11-04).
The direct live CDN browser attempt failed with ERR_TUNNEL_CONNECTION_FAILED. Actual Cesium 1.131
was tested from its pinned local distribution with offline imagery and owner/data fixtures;
live ion imagery, account entitlements and live road-routing services are NOT verified.

Not implemented: 3D GTA camera work, city-wide vehicle gameplay/racing, mobile native packaging,
server-validated competitive rewards, full canonical story integration or production promotion.

## Default-off cloud release gate

Arcade cloud operations require the exact server binding `ARCADE_CLOUD_ENABLED=true`
plus existing Supabase configuration. No deployment binding is enabled by this change.
Owner authentication remains first; disabled requests stop before the Arcade RPC.
The owner-only `GET /v1/arcade/capabilities` reports configuration readiness without
querying mission tables. It does not certify that the schema is installed.
Both games disable cloud controls until this bounded capability check succeeds, and
disable them again on cloud unavailability. Local play and device saves remain available;
pending cloud results are retained under the existing game persistence rules. Re-enter
the game to recheck availability. An explicit flag is used only by local database fixtures.
Activation still requires separately approved schema, grants, and release verification.
