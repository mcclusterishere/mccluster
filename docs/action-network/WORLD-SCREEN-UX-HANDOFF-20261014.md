# Action Network — World screen UX contract and Claude handoff (2026-10-14)

**Owner direction: this is the required destination UX, not optional inspiration.** The globe is its **own dedicated World screen**. It must coexist with the actual Action Network social feed in one persistent viewport. Do not reinterpret "world as feed" as a fullscreen globe that replaces social posting or as two mutually exclusive Map/Discover screens.

## Above-the-fold screen allocation

On a normal portrait viewport, allocate approximately:

1. **45%: interactive globe, at the top.** Keep the globe visually and functionally present, with regional pins, geographic exploration, camera controls and selections. Small, unobtrusive floating actions are permitted.
2. **15%: middle context / action strip.** Show selected region/mission/post context, concise filters, targeted next action (join, do, fund, create, amplify, show up, as applicable), and a clear affordance linking the globe to the feed. This is not a second full-size discovery page.
3. **35%: actual member social feed, at the bottom.** Show real, authorized Action Network post cards and mission-linked activity, with familiar **Like, Comment, Share** interactions; author identity, appropriate media and credible activity state. The bottom section independently scrolls and is **not merely a grid of published mission records**.
4. **Remaining ~5%: global chrome / safe area / spacing.** These approximate proportions total 95%. Use the remaining space for actual global navigation and device safe areas; do not silently inflate the middle to 20% or eliminate the feed. Handle varying device sizes responsively while preserving this hierarchy.

**Always-visible invariant:** On first load in portrait, the top globe, middle context, and a visible portion of the bottom social feed are simultaneously present. Users should not need to toggle a different mode, close the globe, or navigate to a new page to discover member posts. The globe must not disappear merely because feed content is being read.

On compact phones: preserve a usable globe and a readable **single-column** scrolling feed. Do not force three narrow feed cards per row just to mimic the existing mission-card grid. Use safe-area-aware viewport units (e.g. `dvh`) and reduced-motion/low-memory handling. On tablets and desktop, adapt card width and column layout without compromising the globe+feed composition. A full-screen globe **expansion** can be an extra control, not the default World view.

## Exact code reality as reviewed on 2026-10-14

- `action-globe.html` is the standalone route. The Action Network World tab in `mnet.html` currently embeds `action-globe.html?embedded=1` inside `.mn__world-home`; there is also an "Explore full world" link. Keep a consistent UX between the embedded and standalone route, avoiding nested scroll traps or double navigation.
- `css/action-globe.css` already has a later "Persistent World viewport" block declaring `--world-map:45dvh;--world-context:20dvh;--world-discover:35dvh`. **That 20% middle allocation does not match the owner's 15% instruction.** Earlier CSS still contains fullscreen/hide-mode rules that are later overridden; consolidate or ensure the effective cascade cannot revert to fullscreen swapping.
- `js/action-globe.js` has `renderFeed()`, but it renders `missions` into `#worldFeedList` using `.world-story` cards. Its "Discover" wording is **mission discovery**, not a real authenticated social feed. `setMode('feed')` changes button state/scroll, not genuine social data. The mission list can remain a feed filter or card type; it cannot be the only feed data source.
- `mnet.html` contains an existing `#mnComposer` and `.mn__legacy-feed` wrapped in an explicitly `hidden` block; an apparently complete social feed interface does **not** make it visible or integrated into World. Do not delete the underlying capabilities by treating hidden as deprecated.
- `js/mnet.js` contains real existing post rendering and calls to `/v1/mnet/posts`, plus Like, Comment and Share actions. `supabase/migrations/20261013201327_action_network_comments.sql` defines server-only comment storage; review canonical Worker visibility, block rules and authentication. Reuse these paths and semantics rather than inventing an unauthenticated parallel feed or a second, inconsistent comment system.
- `docs/action-network/MISSION-ORIGINATED-PUBLISHING-CONTRACT.md` proposes **mission-originated publishing only**, but explicitly says this is **not yet enforced by the backend**. Before exposing a composer, reconcile that policy with the owner's requirement for posting: enable an authorized, appropriately scoped creation path, not arbitrary client-origin trust or a fake disabled composer. Do not represent policy as implemented without backend proof.
- The current regional globe functions and admin-reviewed mission pins remain useful *alongside*, not *instead of*, the social timeline. Location/region association must never be fabricated for posts without authorized location provenance.

## Required interaction contract

- Tap a mission/region pin -> update the **15% middle context** and, where genuinely related records exist, highlight or filter corresponding items in the **35% bottom feed**. The globe stays visible.
- Tap a post in the feed -> expand/read/respond **within the feed region**; show the related region/mission on the globe **only if a trustworthy association exists**. No fake coordinates.
- Member feed: author avatar/name, text, media, timestamp when available, Like, Comment, Share, and mission/activity context when genuinely attached. A member can browse without mission pins, and an empty feed shows a real empty state, not fabricated posts.
- An anonymous visitor can only access allowed public projections. Authenticated actions must use the canonical M Account session and existing API authorization/visibility logic; block and moderation rules persist. Handle signed-out Like/Comment/creation with a clear sign-in path.
- Do not mix public Action Network with owner-only Halo operational layers (e.g. live cameras, private analytics), private member locations or contact data. Preserve the public regional >=5-consenting-members aggregation and opt-out controls. No city-level/member GPS leakage.
- Maintain **at most four primary navigation items** on the main Action Network surface; keep extra capabilities behind appropriate contextual menus instead of introducing a crowded top row.
- Do not turn the World view into a mission directory-only screen, generic TikTok full-screen feed, a fullscreen news explorer, or a standalone unrelated globe experience.
- Current repo #427 is the globe release; #429 capacity fix and #430 database behavior test have been merged into its feature branch. Financial/security draft #428 is **separate**. Do not bundle unvalidated payout changes or merge/deploy #427 until production migration/rollback verification is complete.

## Acceptance tests / visual evidence for handoff

1. A portrait screenshot of `action-globe.html` demonstrates approximately **45% globe / 15% context / 35% real feed / 5% chrome** with all three regions simultaneously visible.
2. The same composition is verified on `mnet.html` World tab (embedded, if retained) with correct navigation and independently scrolling bottom feed.
3. A genuine public post (not a mission fixture) is visible in the bottom feed when allowed; authenticated member interactions exercise canonical Like/Comment/Share and update correctly. Signed-out experience gracefully handles read-only and login.
4. A mission pin selection updates middle context without hiding feed; a social card selection does not hide globe. Empty/no-pins and no-posts states remain truthful.
5. iPhone portrait/landscape, iPad/tablet and desktop have no overlap, overflow or inaccessible actions; map drag does not scroll the feed and feed scrolling does not rotate the globe.
6. CI and authorization tests remain green; no privacy, tenant isolation, server-side post/mission permission, or deployment regression.

## Immediate direction for a collaborator

**Stop any redesign that assumes posts, likes or comments should disappear from the World view.** Build the actual member-feed experience as the bottom third of the dedicated globe screen. Audit the existing network/Worker APIs and preserve the existing social feature behavior. The owner has expressly chosen this three-tier composition. If a social publishing policy conflicts with it, surface the conflict rather than silently deleting the social experience.

This document specifies the owner's UX decision, **not a claim that the current implementation already satisfies it**.
