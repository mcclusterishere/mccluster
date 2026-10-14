# Human Uprise — the world is the feed

Owner direction, 2026-10-14: the Action Network is now **Human Uprise**, and
its home is the globe. This file records what that means in the shipped code.
It does not lift any release gate in `EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md`.

## Name

- Public product name: **Human Uprise** (formerly the Uprise Action Network /
  Action Network). The entity graph keeps both old names as `alternateName`
  and the stable `@id` (`mnet.html#uprise-action-network`) does not move.
- Equity Uprise runs on Human Uprise as a program and remains its own
  McCluster Corp public-interest project. "Founded by Equity Uprise" stays
  under the wordmark, with the owner-supplied Equity Uprise mark.
- **There is no Human Uprise logo yet.** The header shows the name as text.
  Do not draw one (AGENTS.md, "THE LOGOS ARE NOT YOURS TO DRAW"); ask the owner.
- Unchanged on purpose, for compatibility: `mnet.html`, `/v1/mnet/*`,
  `action_*` tables and RPCs, `action-network-*.html` routes, analytics
  surface names, native component names, applied migrations, history docs,
  and the résumé dossier (regenerated only through its own manual workflow).

## The World screen

Built to the owner's contract in `WORLD-SCREEN-UX-HANDOFF-20261014.md`.
`mnet.html` → World is one persistent screen, phone first:

1. **Globe** (top): `action-globe.html?embedded=1&surface=network`. In that
   surface the frame shows only the Earth, pins, region outlines and Near me.
2. **Context strip** (middle, ~92px): idle, it says what is pinned; after a
   pin or a post picks a mission it shows region · path · title with
   **Open mission** (canonical join flow), **Only posts about this**
   (toggle) and ✕.
3. **Feed** (bottom): composer and the real member feed (posts, media,
   tracks, Like, Comment, Share, Save), scrolling on its own.

`js/mnet.js` sizes the view to the room between the tabs and the app bar
(`--mn-world-h`, class `mn-world-fit`): globe and feed share it 45:35 and the
page itself does not scroll, so dragging the Earth never scrolls the feed and
reading the feed never turns the Earth. Below 340px of room in portrait (or
440px otherwise, e.g. a phone on its side) the pieces stack and the page
scrolls instead of hiding anything. From 1100px the Earth and its strip sit
on the left and the feed runs beside them.

- Pin → strip shows the mission and the feed narrows to posts the server ties
  to it (`action_feed_cards`, `action_offer_cards`); an honest empty state
  when there are none.
- Post → **Locate on globe** (only when its mission has a public pin) flies
  the Earth there and fills the strip **without** narrowing the feed being
  read.
- Posting lets go of any mission so the new post is seen landing.

Measured with a stubbed member (Playwright): at 390×844 the globe, strip and
feed take 32% / 11% / 28% of the screen. That is 45 : 16 : 39 of the World
area, matching the contract's hierarchy. The remaining ~30% is the house
header, the four tabs and the app bar, which sit outside the World area. The
spec's "~5% chrome" is not reachable without hiding those; that is the
owner's call. iPhone SE (375×667) also fits on one screen; a phone on its
side scrolls.

### Standalone `action-globe.html`

- Members are sent to the World screen (`mnet.html?view=feed`, carrying
  `?song=` from the music player's "See this song's impact"), so there is
  one World for members. `?explore=1` keeps the full explorer (search,
  layers, policy links); the World screen's **Full world ↗** uses it.
- Guests get the public explorer at 45 / 15 / 40 with one readable column
  of mission cards and a "Member posts live here · Sign in" card where the
  feed would be. Member posts are never shown without a session.
- The house app bar is styled now. It used to render as raw links and a
  giant mark because the page did not load `css/style.css`, and the page's
  bare `nav` rules hijacked it. Those rules are scoped to `.world-tools`.
- The member World tab in the app bar points at `mnet.html?view=feed`;
  guests still get `guest-globe.html`.

## Bridge contract (same-origin `postMessage`)

| Direction | `type` | Payload |
| --- | --- | --- |
| page → globe | `hu:hello` | none; globe re-sends its ready state |
| page → globe | `hu:focus-mission` | `missionId` (uuid) |
| page → globe | `hu:clear-selection` | none |
| globe → page | `hu:globe-ready` | `missionIds`, optional `dataUnavailable` |
| globe → page | `hu:globe-unavailable` | none (no WebGL / Cesium failed) |
| globe → page | `hu:mission-selected` | `mission_id`, `title`, `region_label`, `action_path` |
| globe → page | `hu:selection-cleared` | none |

Both sides check `event.origin === location.origin` and the exact peer
window, and post with `location.origin` as the target. Only public,
admin-approved pin fields cross; no coordinates, member ids or counts.

## Fixed on the way

- Every Cesium globe on the branch called
  `Cesium.OpenStreetMapImageryProvider.fromUrl`, which does not exist in
  Cesium 1.131, so the globe threw on every device and showed "Interactive
  globe unavailable". Now `new Cesium.OpenStreetMapImageryProvider({url})`
  in `js/action-globe.js`, `guest-globe.html` and `js/world-news.js`.
- OpenStreetMap attribution is visible wherever its tiles render (Cesium's
  credit bar is hidden on these pages).
- The embedded globe opts out of the app bar and auth chip
  (`data-no-appbar`) instead of hiding them with CSS.
- The World CSS is min-width only (AGENTS.md hard rule 14).

## Verified

Browser harness (Playwright, stubbed member session and APIs) at 390×844,
375×667, 844×390, 768×1024 and 1280×800: the globe boots, pins report to the
page, the composition fits where it should, and only the feed scrolls (page
`scrollY` stays 0). Post → globe leaves the feed whole; the toggle narrows
it; pin → narrowed feed or honest empty state. `scrollWidth ===
clientWidth` everywhere. Standalone page: guest at 45 / 15 / 40 and one
column; a member is redirected with `?song=` intact.

## Still open (unchanged by this work)

The #427 release blockers stand: production migration ledger
reconciliation, the route-to-permission matrix, server-validated regional
affiliation, the mission participation and funding journeys, and staging
end-to-end tests. Also: OpenStreetMap's public tile server is not meant for
app-scale traffic. Choose a tile provider with an agreement before launch.
