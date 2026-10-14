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

Built to the owner's contract in `WORLD-SCREEN-UX-HANDOFF-20261014.md`. One
World for everyone at `mnet.html?view=feed`: the Globe column of the app
bar, `action-globe.html` (which hands over, keeping `?song=`) and the music
player's "See this song's impact" all land there. `action-globe.html?explore=1`
stays as the optional full-screen explorer ("Full world ↗"); `?embedded=1`
stays as a frame.

1. **Globe** (top): `action-globe.html?embedded=1&surface=network`, the
   Earth, public admin-approved pins, region outlines and Near me only.
2. **Context strip** (middle, `clamp(92px, 14dvh, 150px)`): idle, what is
   pinned; after a pin or a post picks a mission, region · path · title with
   **Open mission** (canonical join flow), **Only posts about this** and ✕.
3. **Feed** (bottom): the real network from `js/mnet.js`: composer, posts,
   media, tracks, Like, Comment (thread opens inside the post), Share, Save,
   verified-action and mission-offer cards. It scrolls on its own; the page
   does not.

Measured (Playwright, `scripts/e2e/world-screen.e2e.mjs`):

| Device | Globe | Context | Feed | Notes |
|---|---|---|---|---|
| iPhone 390×844 portrait | 45% | 14% | 30% | header floats over the starfield; app bar and safe area are the rest |
| iPhone SE 375×667 | fits one screen | | | |
| iPhone 844×390 landscape | left half | right, top | right, below | side by side, one screen |
| iPad 820×1180 portrait | 45% | 13% | 30% | |
| iPad 1180×820 landscape, desktop | left column | under the globe | right column | feed beside the Earth |

- Pin → the strip fills and the feed narrows to posts the server ties to that
  mission (`action_feed_cards`, `action_offer_cards`), outlined; an honest
  empty state when there are none. The globe stays.
- Tap a post (or its **Locate on globe**) → the Earth flies to its mission
  and the strip fills, without narrowing the feed being read. Only posts the
  server ties to a pinned mission do this; no coordinates are invented.
- Posting lets go of any mission and folds the composer, so the new post is
  seen landing.

### The look (owner's mockup, 2026-10-14)

- **Globe:** NASA Black Marble night Earth (public domain, NASA GIBS), lifted
  so the sea reads deep blue, with an atmosphere rim; the street map
  (OpenStreetMap) fades in below ~900 km or from the layers button. Pins
  are glowing red markers; continent labels count public pins only and
  hide when their continent is round the back of the Earth. Floating
  controls: World (reset), Near me, zoom in/out, Night/Street layers.
- **Header:** HUMAN UPRISE over WORLD set in type (no drawn mark), search
  ("places, people, or causes": narrows the feed and the pins as you type;
  Enter flies to the first matching mission, or for a member searches
  people), bell and avatar. A search button on a phone, a field from 600px.
- **Mission card:** the kind as an icon tile (missions carry no photo and
  none is invented), Latest badge when nothing is picked, place, kind,
  public joined/verified counts (`action_mission_stats`, anon-granted),
  title, description from 600px, and **Join · Locate · Posts**. No Fund
  button: there is no verified funding flow yet.
- **Feed:** tabs All posts · Missions · Music · Photos & video (filters by what
  a post carries; no invented topics or locations), navy cards, picture as
  a right-hand thumbnail with a 1/n badge that opens all of them on tap,
  heart with count, comment, share, save.
- Navy and one red, on the World screen only; the other rooms keep the house
  look. The bottom bar stays the house bar (Music | M | Globe, the
  contract's order), not the mockup's Home | Music | Globe.

### Guests: the same World, read-only

- `GET /v1/mnet/public-feed` (Worker, no session): `visibility=public`
  posts outside any group, not deleted, not replies, by members whose own
  profile is public; no internal ids, viewer state or media addresses; page
  of 20, `cache-control: public, max-age=30`. Recorded in
  `docs/control-plane/SECURITY-POSTURE.md`; tested in
  `workers/mccluster/test/mnet-public-feed.test.mjs`.
- The composer is replaced by an invitation; Like, Comment, Save, people,
  missions, media and every other room open sign-in with the reason at the
  top and a way back to the World. Nothing is sent. Share works (every guest
  post is public). Verified-action cards still show (`action_feed_cards` is
  anon-granted); mission-offer cards need a session.
- `mnet.html?signin=1` opens sign-in directly.

### Standalone `action-globe.html`

Hands over to the World screen (see above). With `?explore=1` it is the
full-screen explorer, now with the house stylesheet (its app bar used to
render as raw links and a giant mark), toolbar rules scoped to
`.world-tools`, a 15dvh context strip and one column of mission cards on a
phone.

## Navigation (owner's binding decision, 2026-10-14)

- **App bar: exactly three columns for everyone: Music | M | Globe.** The
  Globe replaced Profile and opens the one World screen
  (`mnet.html?view=feed`) for guests and members alike. M is the platform
  home (`index.html`) signed in or
  out. The member-only Record and Analytics columns are gone. Each column
  keeps a two-room long-press wing so a held tab never moves; the Globe
  wing holds Missions and Account.
- **No second nav inside the network.** The World / Campaigns / Inbox /
  Profile row and the Clips / Live / People / Groups / Alerts row are gone.
  Every room opens from the **avatar menu**: Profile, Inbox (unread badge,
  plus a dot on the avatar), Alerts, Missions & campaigns, People, Groups,
  Clips, Live, Record or create, Your analytics, M Account. The bell stays
  as the alerts indicator, and every room has a "← World" way back.
- Not yet changed: the native app (`native/src/AppBar.tsx`) still has its
  own Music · HERE · Create · Network bar.

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

`node scripts/e2e/world-screen.e2e.mjs [outDir]` serves the checkout, fakes
api.mccluster.org and Supabase in memory (every request recorded and
checked) and drives: the composition on iPhone portrait/landscape, iPad
portrait/landscape and desktop; Post, Like, Unlike, Comment and Share round
trips with the exact requests; pin → strip and narrowed feed; post → globe
without narrowing; the avatar menu; the three-column bar; and the guest path
(no session sent, public posts only, actions open sign-in and send nothing).
80/80 on 2026-10-14, including the composition split on iPhone and iPad, the mission card, tabs, search, thumbnails and globe controls. It does not touch production; Worker authorization is
covered by the Worker test suite.

## Still open (unchanged by this work)

The #427 release blockers stand: production migration ledger
reconciliation, the route-to-permission matrix, server-validated regional
affiliation, the mission participation and funding journeys, and staging
end-to-end tests. Also: OpenStreetMap's public tile server is not meant for
app-scale traffic. Choose a tile provider with an agreement before launch.
