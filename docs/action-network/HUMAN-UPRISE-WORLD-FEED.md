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
2. **Context strip** (middle, `clamp(92px, 14dvh, 150px)`): idle, **Explore
   the world · Find a mission or region**, with Missions (steps through the
   pins), Regional impact (shows or hides the counted regions), Policy ↗ and
   Near me; after a pin or a post picks a mission, the mission card with
   **Join** (canonical join flow), **Locate**, **Only posts about this**,
   **All missions** and ✕.
3. **Feed** (bottom): the real network from `js/mnet.js`: composer, posts,
   media, tracks, Uprise, Share, Save, verified-action and mission-offer
   cards. It scrolls on its own; the page does not.

### Uprise, not like (owner, 2026-10-14)

"This is not a social media where you can like and comment things." A post
has one reaction, **Uprise**, and it counts only from a member who has
completed a mission.

- **Server:** `POST /v1/mnet/posts/:id/reactions` is refused with 403 and
  `detail.reason = "no_verified_action"` unless the caller has a verified
  assignment of their own on a mission that is not a clip job
  (`hasVerifiedAction`, the same test `action_record` applies). Taking an
  uprise back is never gated. The row keeps the reaction value `like`, so
  no table changes; the response carries `uprised` (and `liked` for older
  callers).
- **Page:** the card offers Uprise, Share and Save; there is no comment
  button and no thread. A member whose Action Record shows no verified
  action is told in the card ("Complete a mission to uprise. Your first
  verified action unlocks it.") with **Find a mission**, before any request;
  a 403 from the server says the same. A guest is asked to sign in with the
  rule. The alerts trigger still writes "liked your post"; the page shows
  "uprised your post" until a migration renames it.
- The Worker keeps its reply routes: live-room chat runs over them.

Measured (Playwright, `scripts/e2e/world-screen.e2e.mjs`):

| Device | Globe | Context | Feed | Notes |
|---|---|---|---|---|
| iPhone 390×844 portrait | 45% | 14% | 30% | header floats over the starfield; app bar and safe area are the rest |
| iPhone SE 375×667 | fits one screen | | | |
| iPhone 844×390 landscape | left half | right, top | right, below | side by side, one screen |
| iPad 820×1180 portrait | 45% | 13% | 30% | |
| iPad 1180×820 landscape, desktop | left column | under the globe | right column | feed beside the Earth |

- The feed starts broad: every post the reader is allowed to see. Pin → the
  strip fills and the feed narrows to posts the server ties to that mission
  (`action_feed_cards`, `action_offer_cards`), outlined; when there are none
  it says so and offers **See every post**. ✕ restores the broad feed. The
  globe stays.
- Tap a post (or its **Locate on globe**) → the Earth flies to its mission
  and the strip fills, without narrowing the feed being read. Only posts the
  server ties to a pinned mission do this; no coordinates are invented.
- Posting lets go of any mission and folds the composer, so the new post is
  seen landing.

### The look (owner's mockups, 2026-10-14)

- **Material:** graphite and one red (the owner's later mockups): steel
  panels (`--w-steel`), dark glass pills with a faint red rim (`--w-rim`),
  chrome type for HUMAN UPRISE (and only that, no WORLD line; the mark is
  the owner's to supply) with a red rule under it, the Earth in a bezel from
  600px with a "Global missions · n" corner tag, and an instrument scale
  down the frame's left edge (decoration only). No navy remains. The house
  app bar is left to the house stylesheet.
- **Globe:** a lit NASA Earth (owner's signed-out reference): Blue Marble Next
  Generation by day, Black Marble city lights by night (lifted so the sea
  reads navy), the Visible Earth cloud composite (a still, not today's
  weather), an atmosphere rim, and the sun where it really is when the page
  opens, so the day/night line is the real one. The layers button cycles
  three looks: **Earth** (that lit one), **Night** (the city lights
  everywhere, the owner's World mockups), **Street** (OpenStreetMap, which
  also fades in on its own below ~900 km). All NASA imagery is public
  domain; the clouds are served from `assets/img/globe/`. In 3D Cesium
  measures the lighting fade distances from the Earth's centre, so they
  carry the radius. Pins are glowing red markers; continent labels count
  public pins only and hide when their continent is round the back of the
  Earth. Floating controls: World (reset), Near me, zoom in/out, the layers
  cycle, and for a creator only, Your audience.
- **Header:** HUMAN UPRISE set in type (no drawn mark), search,
  bell (with the unread count) and avatar. The search is a bar in the header
  row at every width (the owner's iPhone mockup); on a phone a guest's row is
  wordmark, search and Sign in, with Join added from 600px. Search narrows the feed and the pins as you type and
  opens suggestions: pinned missions and places (fly there), open missions
  without a pin (never clip jobs), people and groups that match (members;
  a guest is asked to sign in), and All missions · Find people · Browse
  groups. Enter flies to the first matching mission, or searches people.
- **Mission card:** the kind as an icon tile (missions carry no photo and
  none is invented), Latest badge when nothing is picked (members), place,
  kind, public joined/verified counts (`action_mission_stats`, anon-granted),
  title, description from 600px, and **Join · Locate · Posts · All
  missions**. No Fund button: there is no verified funding flow yet.
- **Feed:** tabs All posts · Missions · Music · Photos & video (filters by what
  a post carries; no invented topics or locations), steel cards, picture as
  a right-hand thumbnail with a 1/n badge that opens all of them on tap,
  **Uprise** with count, share, save. A post that carries a mission
  shows it as a red **Mission attached** banner with Take action and Locate
  on globe (server-vouched, as before).
- **Time rewind** (owner's desktop mockup): Live · −24h · −7d · −30d under
  the composer. It reads the feed from before that moment through the same
  `before=` paging the server already does (member and public feeds alike);
  nothing is reconstructed. Posts only: the Earth and its pins stay live,
  and the line under the control says so. One glass row on a phone, the
  description joins it from 600px.
- Graphite and one red, on the World screen only; the other rooms keep the
  house look. The bottom bar stays the house bar (Music | M | Globe, the
  contract's order), not the mockup's Home | Music | Globe.

### Guests: the same World, read-only

- `GET /v1/mnet/public-feed` (Worker, no session): `visibility=public`
  posts outside any group, not deleted, not replies, by members whose own
  profile is public; no internal ids, viewer state or media addresses; page
  of 20, `cache-control: public, max-age=30`. Recorded in
  `docs/control-plane/SECURITY-POSTURE.md`; tested in
  `workers/mccluster/test/mnet-public-feed.test.mjs`.
- The strip opens on **Explore the world** (the owner's signed-out
  reference) rather than the latest mission. The composer is replaced by
  **Member posts live here.** over a real Equity Uprise rally photo
  (`assets/img/rally/rally-01.jpg`) with Sign in → and Create account. Uprise,
  Save, people, groups, missions, media and every other room open sign-in
  with the reason at the top and a way back to the World. Nothing is sent. Share works (every guest
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

"Three destinations. One small account menu. Contextual features
everywhere else." Navigation entries were removed; no capability was.

- **App bar: exactly three columns for everyone: Music | M | Globe.** The
  Globe replaced Profile and opens the one World screen
  (`mnet.html?view=feed`) for guests and members alike. M is the platform
  home (`index.html`) signed in or out. Each column keeps a two-room
  long-press wing so a held tab never moves; the Globe wing holds Missions
  and Account.
- **No second nav inside the network**, and **the avatar is a small account
  menu**, not a directory: who you are (name, @username), **View profile**,
  **Messages** (request count; a dot on the avatar), **Settings & account**
  (the M Account) and **Sign out** (ends the session here and on the server,
  capped at 1.5s, then reopens the World as a guest). Do not add rooms to it.
- Where everything else lives now:

| Was in the menu | Lives now |
| --- | --- |
| Alerts | The bell, with the unread count; it opens them |
| Missions & campaigns | Globe pins and the mission card (**All missions**), search, the Missions tab, the profile's **Action Record**, the Globe wing |
| People | World search (matches as you type; **Search people**); the block list is on the profile |
| Groups | World search (groups that match; **Groups about …** filters the directory) |
| Clips | A door under the Music and Photos & video tabs, with the real terms from `clip_campaigns_open`, shown only while campaigns are open. Clips are paid work, not posts, so they are not a feed filter |
| Live | A LIVE badge over the globe while anything is on air (opens the live rooms); **Go live** in the composer for a granted host once live video is on |
| Record or create | The composer: a visible + when folded, Record / Create when open (`create.html`) |
| Your analytics | For a member with a music creator profile: **Your audience** on the globe (below) and **Your analytics** on their profile (`creator.html`). The old `creator-landing-analytics.html` measured nothing and is no longer linked |
| M Account | Settings & account |

- Every room has a "← World" way back. `?view=`, `?mission=`, `?group=`
  and `?song=` deep links are unchanged.
- Not yet changed: the native app (`native/src/AppBar.tsx`) still has its
  own Music · HERE · Create · Network bar.

### A creator's audience on the globe

The handoff's creator scope ("an authorized layer or overlay … based on
authorized backend measurements, never mocked") is built on what the Worker
already measures:

- `GET /v1/analytics/my-creator` (signed-in; ignores any id the caller
  passes) now returns `audience`: views of the caller's own creator page
  (`music-creator.html?handle=<their handle>`) in the last 30 days, by
  **country only** (`events.country`, from Cloudflare). A country with fewer
  than 5 views is never named; it is folded into `elsewhere_views`.
  Missing or Tor countries are `unknown_views`. No region, city, postal
  code or coordinates are read or returned. The same sampling limits as
  the rest of that endpoint apply (newest 1,000 page views), and it says so.
- The endpoint's `creator` flag used to be true for every linked member; it
  is now true only with a music creator profile or tracks.
- The page asks `music_creator_profiles` for the member's own row (their RLS)
  and only then shows the globe's **Your audience** switch. Turning it on
  fetches with the creator's own session and places each country at its
  Natural Earth label point (`data/geo/country-label-points.json`, public
  domain). The summary names what is folded away.

## Bridge contract (same-origin `postMessage`)

| Direction | `type` | Payload |
| --- | --- | --- |
| page → globe | `hu:hello` | none; globe re-sends its ready state |
| page → globe | `hu:focus-mission` | `missionId` (uuid) |
| page → globe | `hu:clear-selection` | none |
| page → globe | `hu:search` | `q` (≤ 80 chars) |
| page → globe | `hu:regional` | `on`; the globe answers with `hu:status` |
| page → globe | `hu:near-me` | none; the answer comes as `hu:status` |
| page → globe | `hu:creator-mode` | `on` (shows the audience switch) |
| page → globe | `hu:audience-points` | `points` [{lon, lat, name, views}], ≤ 250 |
| globe → page | `hu:globe-ready` | `missionIds`, optional `dataUnavailable` |
| globe → page | `hu:globe-unavailable` | none (no WebGL / Cesium failed) |
| globe → page | `hu:mission-selected` | `mission_id`, `title`, `region_label`, `action_path` |
| globe → page | `hu:selection-cleared` | none |
| globe → page | `hu:status` | `text` (≤ 200 chars) |
| globe → page | `hu:audience` | `on` (the creator flipped the switch) |

Both sides check `event.origin === location.origin` and the exact peer
window, and post with `location.origin` as the target. From the globe, only
public, admin-approved pin fields cross; no coordinates, member ids or
counts. The only data going the other way that is not public is a creator's
own country-level audience, fetched with their session and drawn in their
own browser.

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
portrait/landscape and desktop; Post, Uprise (and taking it back), the
uprise gate for a member with no verified action, and Share round trips
with the exact requests; pin → strip and narrowed feed; post → globe
without narrowing; Time rewind (the request carries before= a day ago, the
honest empty state, Live brings the feed back); the layers cycle; search
suggestions (pinned and unpinned missions, never a clip job; people;
groups; the full lists); the Clips door; the Live badge;
the bell's count; the account menu (exactly four entries, whose account,
message requests on the avatar); a creator's analytics door and audience
layer, and their absence for a member who is not a creator; signing out to
the guest World; and the guest path (Explore the world, Member posts live
here, the chips, no session sent, public posts only, actions open sign-in and
send nothing). It does not touch production; Worker authorization is
covered by the Worker test suite.

## Still open (unchanged by this work)

The #427 release blockers stand: production migration ledger
reconciliation, the route-to-permission matrix, server-validated regional
affiliation, the mission participation and funding journeys, and staging
end-to-end tests. Also: OpenStreetMap's public tile server is not meant for
app-scale traffic. Choose a tile provider with an agreement before launch.
NASA GIBS has no SLA and sends `no-store`; caching its tiles would belong
in the `mccluster` Worker. The creator audience is sampled like the rest of
`my-creator`; an aggregate in the database would make it exact.
