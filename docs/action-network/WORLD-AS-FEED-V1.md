# Make the world your feed — first implementation

Public route: `/action-globe.html` (linked from `mnet.html`). Cesium mission browsing by swipe or pin; separate opt-in, thresholded member-city aggregate layer.

## Data boundaries
- `action_globe_public_missions()` returns only manually approved public pins for open missions. Never copy private Halo contacts, cameras, flight/military layers or participant locations into the public route.
- `action_globe_public_cities()` returns only opted-in member counts for cities with >=5 consenting members. No member IDs, profile data, addresses, raw GPS, or cities below threshold.
- Only the service role may manage the mapping of `m_uid` to city; obtain explicit opt-in and provide a way to withdraw it. Do not derive public city from IP or device GPS without consent.
- Empty by default. Do not seed fabricated activity or invented mission locations.
- Existing Cesium runtime is in the separate private `hitmans-halo` repo; this public view does not expose it. CDN viewer is an initial prototype and requires provider quota, mobile performance, and dependency checks.
- Google 3D imagery is optional; a restricted browser key and quota monitoring are required before activation.

## Ground News
Ground News and GNews API are **different vendors**. No verified Ground News redistribution/API contract exists here. Do not proxy subscriber-only Ground News data or sell subscriptions without explicit permission. Reserve a public-report adapter with provenance, licensing, freshness and moderation. Public news reports must never automatically become approved missions.

## Next acceptance gates
1. Apply reviewed migration in staging; test RLS and anonymous RPC output, threshold boundaries 0/4/5, opt-out and removal.
2. Build authenticated consent UX and server-validated city assignment, not client writes.
3. Add Control mission-pin editor with location fuzzing, moderation and publication review.
4. Validate globe route on iPhone/Android with reduced-motion and low-memory fallback.
5. Wire direct mission detail and fund/do actions to verified backend; currently the prototype links to Action Network with a mission query.
6. Add public report provider only after verifying redistribution license and subscription rights.
7. Deploy only after CI and manual end-to-end checks.
