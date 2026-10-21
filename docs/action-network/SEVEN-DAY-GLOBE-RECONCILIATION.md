# Seven-day spatial/globe reconciliation — 2026-10-13

## Recovered architectural authority
- `docs/design/equity-uprise-building/HALO-GLOBE-SPATIAL-INTELLIGENCE-SPEC.md`: visible globe for everyone, permissioned layers, private operational Halo for owner. Reuse this boundary.
- `PRIM3/game/halo/ADR-001-dual-halo.md`: shared renderer, isolated data worlds; do not mix public missions with ops feeds or the fictional game.
- `docs/control-plane/SEEK-FIRST-PRODUCT-ARCHITECTURE.md`: canonical Worker/Supabase authority, entitlement firewall; no separate backend.
- McCluster #410 / Halo #11: existing **owner-only** regional geo analytics, not an anonymous public feed. Keep owner insights protected.
- Recent Action PRs #419–#426: simplified navigation, creator upload/identity, song mission catalog. Avoid merging conflicting tabbar edits without reconciliation.
- Halo #12–#20: runtime repair, infrastructure/camera adapters and deployment QA. Public globe should import only Cesium rendering/camera patterns, not these datasets.
- Existing `feat/world-as-feed-globe` branch already has a mobile Cesium viewer; avoid reimplementing from scratch.

## Public geographic model
- Publish state/province/first-level administrative subdivision (ISO 3166-2 where possible) **centroids**, not member or mission coordinates.
- Membership totals require opt-in and at least five consenting members per region. Suppress smaller cohorts.
- Doers = unique consenting members with verified mission assignments. Verified actions = verified assignment rows. Completed missions = distinct mission IDs with verified assignments. These are explicitly different metrics.
- Rank regions **within each country**, by verified actions then completed mission types. Public totals must not include nonconsenting members.
- User location permission is optional for nearby camera focus; never publish or persist GPS directly. A separately authorized server workflow can assign a member to a validated region, support corrections and withdrawal, and must not infer city-level public dots.
- Mission publication is admin-reviewed and pinned at regional centroids. Do not use precise recipient or creator location as public coordinates.

## Music portfolio
- `js/music-engine.js` exposes a 'See this song's impact' link.
- `action_globe_song_missions` is a curated link, not a claim that songs have verified outcomes.
- The globe filters to linked missions; absent links display an honest empty state.
- Future player panel should list **verified portfolio evidence** with consent and attribution. Equity Uprise's historic recording work should be entered as reviewed archival mission evidence, not retroactively marked verified by title alone.

## Current status / gaps
- Committed: regional schema, public read-only RPCs, song association, World tab, nearby camera control, globe filters.
- Not deployed: migrations and static assets; no test-run confirmation.
- Missing: authenticated regional assignment/opt-out service, moderation interface, published region registry, robust mobile viewer fallback, actual impact proof ingestion and historic Equity Uprise evidence verification.
- Ground News resale is blocked pending commercial redistribution rights. No live provider integration is claimed.
- **Migration sequencing:** the earlier `20261013230000_action_globe_public_projection.sql` defines a deprecated city-level projection and is followed by region-only functions. Before production migration, consolidate/remove the unused city tables and RPCs, run staging SQL validation and permission tests.
