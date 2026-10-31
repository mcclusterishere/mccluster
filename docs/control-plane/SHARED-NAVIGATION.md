# Shared navigation contract

Owner direction, 2026-10-16: every admin destination belongs in the same bottom
control bar used across the site. Profile and account belong at the top right.
This implements navigation; it does not claim a completed redesign of each editor,
the public World, mission applications, tax onboarding or feature-release tooling.

## One bottom bar

The server-verified house owner has Play, Control, the supplied M, Analytics and
Globe. Control expands a bottom-anchored destination panel with All, Home,
People, Sell, Create, Insights, System and Products filters and text search.
This avoids shrinking dozens of buttons into one row. Its groups swipe
horizontally and its destination list scrolls independently; the page and bar
stay in place.

## One Control navigation definition

Owner, 2026-10-30 (the consolidation mockup: "get that control room under
wraps"): Control is six sections, Home, People, Sell, Create, Insights and
System, defined once in `js/control-room/nav.js` (`window.CR.nav.NAV`). Every
Control navigation surface reads it: the sidebar and phone section bar in
`control.html`, the phone More sheet, the ⌘K palette, `js/control-registry.js`
(the owner palette on other pages) and the route inventory in
`js/control-room/workspace-core.js` that this shared bar's destination panel
lists. Each NAV entry carries `was`, the old routes (`#work:*`, `#create:*`,
`#ai`, `#analytics`, `#system:*`, `#apps`) and old names that fold into it, so
every old link and bookmark lands on its new view and the palettes find a view
by its old name. `scripts/test/control-nav.test.mjs` holds NAV to covering every
old view and naming only renderers that exist.

On control.html the shared bar keeps the bottom of the screen. The Control
sections are that page's own index, not a second global bar: a row under the
Control topbar on a phone and the sidebar from 1024px. Without the shared bar
(a guest preview, or the bar failing to load) the same element is a floating
bottom bar with Home, People, Sell, Create and More.

Eight existing product/workspace doors are included in the destination panel:
World, Your desk, Hitman's Halo, PRIM3, Whip, WE Manufacture, Asset Lab and
Spatial Intelligence. Registered tenant apps remain in System → Apps; no
unverified app URL is added to the global bar automatically.

While already in Control, navigation changes the hash on the same document. The
organization query, optional workspace presentation, editors and retained
Analytics globe keep their existing lifecycle. Browser Back/Forward work normally.
From a World host, Control points to Matthew's host using the bar's existing
cross-origin sign-in handoff. Local chapter tabs, filters and editor tools remain
local; they do not replace the global destination menu.

If the shared module fails, the original Home link and the Control sections
remain usable. The destination panel is a nonmodal popover: Escape and Close
return focus to Control; moving focus outside closes it. Opening it does not
automatically raise the phone keyboard.

## Profile and account

Pages using the shared bar get a fixed top-right Profile / Sign in control with
safe-area spacing and a minimum 44-pixel touch target. On Control, Profile opens
the existing account actions, including View profile, settings, refresh and sign
out. World reuses its native avatar and account menu, retaining messages and sign
out. Other signed-in pages expose profile and account links in a small popover.
The homepage sound control makes room for profile.

Embedded product frames and pages explicitly opting out through `data-no-appbar`
retain their host-owned navigation. Printouts omit these controls. This shared
shell applies to pages carrying `js/tabbar.js`; it does not inject navigation into
separately deployed satellite products or the native app.

## Permission and failure behavior

The existing `/v1/status` house-owner check remains the source of the admin bar.
Positive owner results are rechecked on page entry, destination-panel opening and
returning to a visible tab. Only negative answers receive a one-minute session
cache. No credential is copied into that cache. A denied, failed or timed-out
check withdraws the admin menu. Request generations and current-session checks
prevent late responses from restoring signed-out navigation. These are display
gates; existing API and database permissions remain authoritative.

## Validation and release

`scripts/e2e/site-navigation.e2e.mjs` exercises the actual shared bar and pages at
390, 820 and 1280 pixels, all native destinations, search/group filters, workspace
query preservation, browser Back, keyboard focus, account actions, guests/members,
revocation, sign-out races, World routing and embedded opt-outs. All network calls
are intercepted with synthetic fixtures. The existing workspace and Analytics
browser suites cover retained globe state and the Analytics deck.

The Control visual workflow runs these suites and uploads screenshots for review.
This is source implementation for review, not a production deployment. Merge and
deployment retain the human authority established in `ECOSYSTEM.md`.
