# Owner navigation consistency

## Live versus draft

User playtesting reported missing Games and three-tab owner navigation on the live globe/profile, with overlapping top-right Command Room, Account and Search controls. Direct live verification from this executor is blocked: both `matthew.mccluster.org` and `mccluster.org` return a proxy CONNECT 403, not an application response. This is not evidence of a live application 403.

Canonical main remains `4fc32c84970d1a5cbc69c2df218e700bcea14032`. Its `js/tabbar.js` has five owner tabs and no Inbox or Games. Draft #745 is stacked on Games overlay #726 and has seven owner tabs; neither draft has been merged or deployed by this task. Therefore the requested seven-tab layout is review code, not a verified live release. A live three-tab bar additionally means the owner presentation was not active; determining whether that was session restoration, a denied/unavailable role check, cached assets or a different release requires live session evidence unavailable here. No role was inferred from the user's email.

## Inventory and fixes

Root inventory: 124 HTML files, including redirects. Existing `appbar-consistency` tests inventory the root routes and explicitly exempt redirects, embeds, error pages and immersive labs. Nested production pages already using the shared bar inherit the registry and role logic; this is not a claim that every nested demo/tool is a product route.

| Surface | Finding and disposition |
| --- | --- |
| City Arcade, Game Hub, PRIM3 transit/world/tactics preview, Weather desk | Already load shared bar but omitted early `shell-boot.js`; added reservation of navigation until owner role/presentation resolves, preventing a transient public bar |
| Equity Uprise landing | Previously omitted shared navigation; now uses shared style/boot/bar and keeps footer above the safe-area dock |
| Server lab 3D | Preserved immersive layout and existing Back to PRIM3 exit; added Back to Games on access-check/denied screen |
| 404 | Preserved short-route recovery and explicit home exit |
| demo/embed/guest globe | Preserved intentional embedded/preview opt-outs and existing host navigation/sign-in door |
| Control/editor/Analytics/member front/World | Existing shared bar retained; direct owner/member/guest routes tested |
| Game destinations | Central owner active-state list in `tabbar.js` now marks Games for City, Arcade, hub and PRIM3 routes |
| Legacy command header and Halo operator | Hidden only after shared navigation is ready; existing command search and account actions remain in Profile/native account menus |

The owner bar keeps Play, Inbox, Home, M, Analytics, World/Halo, Games, then adds Sell, Create and System from the existing Control NAV registry. Owner status still comes from the existing server check; member/guest bars retain three destinations. Owner-only page gates and globe source entitlements remain independent. No copied page-specific owner bar, backend grant, migration or production setting was added.

## Functional root causes found in cross-page tests

Audio continuity used the existence of `#deck` as proof of a music page. The globe has a non-media panel with that ID. Consequently World/Games/Profile clicks could be intercepted as retained-music World navigation, changing the URL and making the profile popover inert. `musicSurface` now requires the existing music engine or an actual AUDIO/VIDEO deck. Explicit explorer/Halo/Games/embedded globe URLs are not rewritten to the World feed. Shared profile/destination actions are not intercepted by the audio link handler. Real music-to-World continuity is regression-tested separately.

The legacy command palette also used a client email claim to decide whether to mount, and could reload after sign-in. It now waits in place for `MCC_BAR.admin()`, checks the shared server-verified role before opening, and closes on revocation. It retains its registry, commands and keyboard shortcut. No additional server authority is granted by this presentation change.

Profile contains View profile, existing Settings & account, owner-only Home · Command Room, command search where supported, and Close. Native Control/World account menus retain their existing operations and receive the gated Home link. Escape restores focus; native popovers dismiss outside. The shared control respects safe areas and 44px touch targets. Redundant legacy top-right shortcuts are not rendered over it.

## Reproduction

All browser requests are intercepted with synthetic roles/data; no live accounts or writes are used.

```sh
node --test scripts/test/control-*.test.mjs scripts/test/appbar-consistency.test.mjs scripts/test/no-screen-flashes.test.mjs scripts/test/globe-games-gate.test.mjs
PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_EXECUTABLE=/usr/bin/chromium CESIUM_DIR=/tmp/admin-ui-tools/node_modules/cesium/Build/Cesium node scripts/e2e/site-navigation.e2e.mjs /tmp/admin-nav-complete
NAV_ROLE_MATRIX=1 PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_EXECUTABLE=/usr/bin/chromium CESIUM_DIR=/tmp/admin-ui-tools/node_modules/cesium/Build/Cesium node scripts/e2e/site-navigation.e2e.mjs /tmp/admin-nav-role-matrix
PLAYWRIGHT_DIR=/tmp/admin-ui-tools/node_modules CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/e2e/music-world-continuity.e2e.mjs /tmp/admin-nav-audio
```

The primary suite covers owner restoration, unavailable authority, revocation, sign-out races, cross-host World navigation, all retained Control routes, profile and game direct entry, no duplicate bars, minimum target sizes, actual globe → Games → Inbox links and embedded opt-outs. The role matrix covers owner/member/guest at phone/desktop across globe, profile, Control, editor, game and Analytics routes. Graphics/physics gameplay and physical-device safe-area rendering remain outside this navigation acceptance.

## Scrollable owner dock

The bottom dock shows roughly five legible items on phones and scrolls horizontally to the rest. All six top-level Control sections are reachable: Home, Inbox, Sell, Create, Analytics and System. The three appended sections come from NAV, not a duplicate page list. The six-tab limit inside Analytics remains separate and unchanged.

Native touch scrolling, left/right buttons and Arrow/Home/End keyboard navigation are supported. Hints reflect actual scroll extent: right at the start, both in the middle, left at the end, none when all fit. They update on scroll, resize, content and role changes. A brief two-cycle cue stops automatically; reduced motion disables animation and smooth scrolling. Focused/current items are brought into view without resetting manual browsing on routine renders. Safe-area offsets and minimum 44px targets remain.

Navigation does not imply a sellable module. System remains internal infrastructure; no pricing, sales entitlement or module publication behavior changed.

Validation before the scroll extension: 396/396 full navigation checks, 50/50 role-matrix checks, 117/117 real audio-playback continuity checks, and 122/122 focused source checks. The scroll extension adds browser checks for start/middle/end, fit, resize, role transitions, keyboard, actual touch events and reduced motion. Final combined results are reported with the pushed revision. Physical-device validation and live asset/session inspection remain outstanding.

Final combined navigation/scroll run: **417/417 checks passed**. Focused source checks: **122/122**. Dedicated scroll run: **21/21**. The editor path was additionally corrected to the canonical `#create:front-page` route and checked with its actual form mounted (not just a route fallback). Audio continuity: **117/117**. Review screenshots: `review/owner-profile-390.png` and `review/owner-scroll-dock-390.png`, synthetic data only.
