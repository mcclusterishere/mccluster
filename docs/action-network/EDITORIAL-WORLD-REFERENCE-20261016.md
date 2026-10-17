# Human Uprise: approved World and social interface

The owner's October 16–17 reference images supersede the old fixed-height
45/15/35 composition in WORLD-SCREEN-UX-HANDOFF-20261014.md. This is the new
visual standard for the public-facing World and social feed.

- Graphite background, restrained crimson accents, light system typography,
  thin separators and open spacing. No starfield, country flags, continent
  labels, decorative ruler, glowing card borders or raised feed cards.
- October 17 refinement: remove the redundant “World / Discover meaningful work”
  heading and give that space to the globe. Keep the globe visible while the
  mission/community panel scrolls independently. Portrait uses a fixed stack;
  wide screens and landscape phones use a side-by-side split. Mission context
  lives inside the scrolling panel, and the real bottom navigation remains accessible.
- Show the published mission records. A visitor explicitly selects one to
  open its context; do not automatically select the newest mission.
- Compact mission/region disclosure, accessible search, full globe expansion,
  existing location and map interactions. Respect safe-area navigation space.
- The bottom bar in the generated images was explicitly rejected. Preserve
  the real shared Music / supplied M / World bar, current destinations and
  complete original artwork. The profile/account remains at the top right.
- The supplied Equity Uprise emblem remains an accessible all-missions door.
  No fabricated photography: current mission data has no approved thumbnail
  field, so the preview uses a neutral action icon.
- Use “Community” for the existing posts-only filter. “Following” would promise
  a relationship-based feed that is not supplied by this endpoint. “For you”
  retains the existing community/news mix; no recommendation algorithm is implied.

## Implementation boundaries

`css/human-uprise-editorial.css` is the final presentation layer for `mnet.html`.
`css/globe-editorial.css` and the editorial scene mode apply to the public
Cesium globe. Control/Analytics retains its rendering mode. Shared navigation,
auth, storage and APIs stay on the canonical McCluster plane.

Optional-layer authorization and withdrawal from PR #475 are integrated into
this branch. Ship the frontend and canonical Worker together; the new design
preserves that release policy and its server-side checks.
Application approval, introduction video, resume, motivation, tax paperwork
and payout readiness remain the separate mission-application requirements;
this visual implementation does not claim to implement that backend.

## Internal intelligence boundary — owner clarification, October 16, 2026

Flight and satellite positions, vehicle telemetry, CCTV and Hitman's Halo feeds
belong to the internal intelligence system for ingestion and analysis. They are
not public globe features, future membership unlocks or paid customer tiers.
This supersedes the earlier idea of offering those layers to signed-in users.
Guests, ordinary members, creators and business accounts must have neither
controls for these feeds nor access through the globe APIs. Verified operators
retain internal access under the existing privacy and authorization checks.

The policy's `admin_preview` name is retained for wire compatibility; it means
internal operator access, not an announced public release. General modular
feature publishing must not make these intelligence feeds customer products.
The user-facing World remains focused on curated missions and the community.
This boundary does not claim that every provider or learning pipeline is built.

## Verification

Run repository contracts with `node --test scripts/test/*.test.mjs`.
The `editorial` family in `scripts/e2e/world-screen.e2e.mjs` uses actual Cesium
and synthetic account/feed fixtures at 390×844, 844×390, 820×1180, 1180×820 and
1440×900, for guests and members. It checks overflow, stack/split composition,
real navigation destinations, mission selection, search and feed filters.
`site-navigation.e2e.mjs` separately covers the actual hosted-page profile and
admin navigation. The Human Uprise responsive workflow preserves screenshots
and reports. These are browser emulations; physical-device Safari remains a
release smoke check.
