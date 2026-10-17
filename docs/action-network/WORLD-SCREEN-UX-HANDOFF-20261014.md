# Action Network — World screen UX contract and Claude handoff (2026-10-14)

> Visual composition superseded by [the approved editorial reference](EDITORIAL-WORLD-REFERENCE-20261016.md). Existing data, privacy and action semantics remain in force.

**Owner direction: this is the required destination UX, not optional inspiration.** The globe is its **own dedicated World screen**. It must coexist with the actual Action Network social feed in one persistent viewport. Do not reinterpret "world as feed" as a fullscreen globe that replaces social posting or as two mutually exclusive Map/Discover screens.

## Above-the-fold screen allocation

On a normal portrait viewport, allocate approximately:

1. **50% target (45–50% acceptable): interactive globe, at the top.** Keep the globe visually and functionally present, with regional pins, geographic exploration, camera controls and selections. Small, unobtrusive floating actions are permitted.
2. **15% target: middle context / action strip.** Show selected region/mission/post context, concise filters, targeted next action (join, do, fund, create, amplify, show up, as applicable), and a clear affordance linking the globe to the feed. This is not a second full-size discovery page.
3. **30% target: actual member social feed, at the bottom.** Show real, authorized Action Network post cards and mission-linked activity, with familiar **Like, Comment, Share** interactions; author identity, appropriate media and credible activity state. The bottom section independently scrolls and is **not merely a grid of published mission records**.
4. **Remaining ~5%: global chrome / safe area / spacing.** The targets total 100% and are approximations, not a pixel-perfect mandate; do not inflate middle to 20% or sacrifice globe space to oversized feed. The bottom feed must remain usable and scroll independently. Handle varying device sizes responsively while preserving this hierarchy.

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

1. A portrait screenshot of `action-globe.html` demonstrates approximately **~50% globe / ~15% context / ~30% real feed / ~5% chrome** with all three regions simultaneously visible.
2. The same composition is verified on `mnet.html` World tab (embedded, if retained) with correct navigation and independently scrolling bottom feed.
3. A genuine public post (not a mission fixture) is visible in the bottom feed when allowed; authenticated member interactions exercise canonical Like/Comment/Share and update correctly. Signed-out experience gracefully handles read-only and login.
4. A mission pin selection updates middle context without hiding feed; a social card selection does not hide globe. Empty/no-pins and no-posts states remain truthful.
5. iPhone portrait/landscape, iPad/tablet and desktop have no overlap, overflow or inaccessible actions; map drag does not scroll the feed and feed scrolling does not rotate the globe.
6. CI and authorization tests remain green; no privacy, tenant isolation, server-side post/mission permission, or deployment regression.

## Immediate direction for a collaborator

**Stop any redesign that assumes posts, likes or comments should disappear from the World view.** Build the actual member-feed experience as the bottom third of the dedicated globe screen. Audit the existing network/Worker APIs and preserve the existing social feature behavior. The owner has expressly chosen this three-tier composition. If a social publishing policy conflicts with it, surface the conflict rather than silently deleting the social experience.

This document specifies the owner's UX decision, **not a claim that the current implementation already satisfies it**.


## Binding navigation decision — authoritative October 14 update

This supersedes older "Trinity: Music, M, Profile" and all four-/five-/six-tab workspaces. The product has **exactly three persistent global bottom destinations**, signed in or signed out, in this order:

**Music | M (emblem / platform home) | Globe (World)**

- The **right-hand Globe destination REPLACES the previous Profile tab**. Do not append Globe *beside* Profile. Do not append Record, Analytics, Inbox, Campaigns, Creator Dashboard or Admin as additional permanent bottom tabs. A visible profile icon in the World header is not a fourth navigation tab; it opens an account/profile drawer or separate detail page.
- The **middle M is the McCluster platform home**, never hardcoded as the founder's personal profile. When viewing another creator's branded portfolio, its emblem/portfolio context may adapt as previously specified without generating another persistent tab. Guests can use M to reach the public McCluster home. An authenticated member uses the M hub for general platform activity. The action/network member feed belongs within World and does not need a separate permanent Feed tab.
- **Music** enters the shared music experience. **World** enters one canonical shared World globe + social-feed experience at `action-globe.html` (or one equivalent unified route). `mnet.html?view=feed` may redirect/delegate into that canonical experience; do not create a second competing world in a profile frame.
- **Profile/account exists but is contextual**: top-right avatar, avatar menu, M Account, profile details, creator landing, password/security, settings, sign-out and deletion all remain accessible. Removing the global Profile tab must not remove those capabilities.
- **Record/Create** is a contextual action inside the feed or selected mission, with correct authorization. **Inbox and alerts** belong in a header indicator or accessible drawer. **Campaigns, missions, people, groups, clips, live** remain contextual panels, links, filters or overflow destinations; do not put all of them into a competing persistent row. **Analytics** is not a main nav tab.
- **Creator scope**: the same World screen can expose creator-only geographic analytics, audience reach, genuine metrics, mission distribution and portfolio signals as an authorized layer or overlay. Do **not** create a separate creator globe or analytics destination. Never reveal creator-private data to public/member APIs. Analytics data must be based on authorized backend measurements, never mocked.
- **Admin scope**: separate secured Control/owner tools. Do not place these in the public primary bottom bar or mix owner-only Halo camera/operational data into the public World.

### Actual code mismatches, confirmed at PR #427 head

- `js/tabbar.js` declares `ORDER = ["music", "home", "world", "profile"]`, creates a `world` tab **before** the profile tab, then `paintAuthState` adds `data-member-tab="record"` and `data-member-tab="analytics"` when signed in. This can yield **six** global navigation destinations for signed-in users. Logged-out users hide profile, leaving three, but that does not satisfy the universal three-tab rule.
- `js/tabbar.js` points the signed-out World tab to `guest-globe.html` and the signed-in World tab to `action-globe.html`. Guest mode may render less data but should stay structurally consistent with a *single* World shell rather than a separate globe product.
- `mnet.html` independently renders `<nav class="mn__tabs">` with **World / Campaigns / Inbox / Profile** and `mn__quicklinks` with **Clips / Live / People / Groups / Alerts**. `css/mnet.css` enforces these four navigation columns. These are a second competing navigation system, not the desired simplified hierarchy.
- `mnet.html`'s `#mnFeedView` includes an iframe to `action-globe.html?embedded=1`, while `#mnProfileView` is a separate profile editor/detail surface. The **miniature embedded globe is inside the feed view, not directly inside the profile view**. Do not confuse them or preserve two public world destinations just because they exist in the source.
- `css/mnet.css` force-hides the real `.mn__legacy-feed` with `display:none!important`. Existing `js/mnet.js` implements posts/likes/comments/share. Move/reuse the actual authorized social-feed capabilities in the **bottom portion of World** instead of deleting them.
- `scripts/test/action-network-redesign.test.mjs` explicitly asserts four network top-level tabs, `['feed','missions','messages','profile']`. This test encodes an **outdated product assumption**. Update it alongside navigation code, add logged-in/logged-out nav count and role-permission tests, and do not optimize around keeping an obsolete assertion green.
- Resolve route and event-handler precedence and multiple copied global appbars (some pages contain inline markup). Keep one canonical navigation contract across global app pages, embedded experiences, and signed-in/-out state; browser back and deep links should remain valid.

### Role matrix (one World UI, varied capabilities)

| Capability | Guest | Member | Creator (granted) | Owner/admin |
|---|---|---|---|---|
| Globe navigation and public pins | Yes | Yes | Yes | Yes |
| Public approved member feed | Read permitted public material | Yes | Yes | Yes |
| Like, comment, save, follow | Sign-in prompt | Authorized | Authorized | Authorized |
| Join / prove mission | Sign-in prompt | When eligible | When eligible | As authorized |
| Create/publish content | Sign-in prompt | Only with approved policy/provenance | Authorized creator/policy actions | Explicit scoped control |
| Creator performance / geographic analytics | No | No | Own/authorized assets only | Separate owner Control or restricted overlays |
| Exact member location / private Halo / owner tools | No | No | No | Separate secured system only |

Do not confuse account role, creator status and geographic eligibility. All sensitive permissions must be enforced server-side, not merely by hiding a UI element. The member feed remains visible below the globe even if region/mission counts are empty.

## Updated screenshot acceptance (supersedes earlier 45/15/35 visual target)

On an iPhone-like portrait mockup, the globe should dominate roughly the **top 50%**, context approximately **15%**, the **actual member feed around 30%** and slim navigation/safe areas about **5%**. The illustrative image is a **visual standard only**: do not seed fictitious users, posts, mission locations or metrics as real product data. The feed must independently scroll.

**Canonical navigation screenshot:** exactly three bottom destinations `Music | M | Globe` across guest, member and creator sessions. No separate Profile, Record, Analytics, Messages, Campaigns or Live permanent bottom columns. A standalone World-screen design illustration may omit the global bottom bar for visual clarity, but production navigation must still contain exactly those three destinations.

**Current release guard:** PR #427 must not be merged or deployed until its production migrations and roles/visibility boundaries have been reconciled and validated. Draft PR #428 finances remain excluded.
