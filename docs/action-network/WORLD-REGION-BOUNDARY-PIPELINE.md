# State/province boundary and mission placement pipeline

## Geospatial authority
- First-level administrative regions (ISO 3166-2 or mapped equivalent) are the canonical unit, never city-level member dots.
- Import a licensed, versioned authoritative polygon dataset (e.g. geoBoundaries with appropriate license and attribution) into an admin-managed registry. Record source, version, date, geometry validation, and stable ISO code.
- Validate polygon topology, antimeridian crossing, multi-polygons and overlapping borders. Use PostGIS ST_Covers on geography/geometry (not nearest centroid) to resolve a *consenting* device position to a state/province.
- Return only the canonical region key to the app; discard raw coordinates after resolution, and do not log them. Offer manual region selection/correction and consent withdrawal. A browser location permission is not proof of residency or eligibility.
- On the globe, load a simplified public boundary GeoJSON per viewport/zoom, draw region outlines, highlight the user's chosen region and lock out-of-region mission actions. The worldwide map remains viewable. Accessible text must distinguish *locked participation* from *hidden content*.
- Every published mission requires an admin-approved region key and a non-sensitive display centroid; exact beneficiary and volunteer coordinates must not appear in public API responses.
- User eligibility requires mission-specific server-side rules and authorization; never infer eligibility solely from geolocation.
- Fly the camera to the selected mission's **approved public regional marker**, not to private location. Pin click, next/previous, and story selection share the same camera transition.
- Avoid assigning a state from a nearest centroid or reverse-geocoding without a verified boundary match.

## Rollout gates
1. Provision licensed polygons and validated region registry.
2. Implement authenticated consent and server-side region resolver with no coordinate retention.
3. Implement admin mission-to-region approval and import/backfill for all active missions, with review queue for ambiguous records.
4. Publish simplified region outlines and optional locked marker state; don't activate locking until the region is confidently resolved.
5. Verify mobile gestures, marker pick, camera fly-to, keyboard focus, and the 45/20/35 viewport.
6. Run privacy, permissions-denied, border-point, wrong-region, and region-change tests before production.

Current implementation: mission camera fly-to and a region-aware locked-marker renderer are committed. The region resolver, polygon registry, consent backend, mission mapping/backfill, and public outlines are **not yet complete**.
