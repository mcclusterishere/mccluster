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

## The World tab

`mnet.html` → World is the Earth over the live network, phone first:

1. `action-globe.html?embedded=1&surface=network` fills a full-bleed band
   (`clamp(260px, 52dvh, 560px)`; rounded and taller from 600px up). In that
   surface the frame shows only the Earth, pins, region outlines and Near me.
2. Under it: the selected-mission banner, then the composer and the feed
   (posts, media, tracks, likes, comments, share, save). Nothing is hidden.
3. Tap a pin → the banner shows the mission (region · path · title) with
   **Open mission** (canonical join flow in the Missions view) and **Show
   everything**; the feed narrows to posts about that mission.
4. A post the server ties to a mission (`action_feed_cards`,
   `action_offer_cards`) whose mission has a public pin gets **Locate on
   globe**, which scrolls to the Earth and flies it to the mission.
5. Posting clears any mission filter so the new post is seen landing.

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

Browser harness (Playwright, stubbed member session and APIs) at 390, 768
and 1280px: globe boots, pins report to the page, Locate on globe → banner
and narrowed feed, Show everything → full feed, pin with no posts → honest
empty state, `scrollWidth === clientWidth` throughout.

## Still open (unchanged by this work)

The #427 release blockers stand: production migration ledger
reconciliation, the route-to-permission matrix, server-validated regional
affiliation, the mission participation and funding journeys, and staging
end-to-end tests. Also: OpenStreetMap's public tile server is not meant for
app-scale traffic. Choose a tile provider with an agreement before launch.
