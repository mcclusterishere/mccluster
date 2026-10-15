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
   **the emblem** (the owner's Equity Uprise mark alone; the canonical join flow), **Fund**, **Locate**, **Only posts about this**,
   **All missions** and ✕.
3. **Feed** (bottom): the real network from `js/mnet.js`: composer, posts,
   media, tracks, Share, Save, verified-action and mission-offer cards with
   the emblem and Fund. It scrolls on its own; the page does not.

### The emblem or Fund it (owner, 2026-10-14)

"There's no comment or like. It's either [the emblem] or fund it." A post
has no reaction at all. A post that carries a mission (a server-vouched
offer or verified-action card) offers two things in its **Mission
attached** banner, and the mission card in the context strip offers the
same two:

- **The emblem** is the owner's Equity Uprise mark
  (`assets/img/equity-uprise-logo.webp`), complete, shown as supplied on
  its own white ground, scaled only, with no rounding and no crop. **It is
  never written out.** The owner, later the same day: "just the symbol; I
  never want to state it; I just want to use the mark, never work it out."
  So the control is the artwork alone: no caption, no wordmark, no chevron
  beside it, and no spelled-out name anywhere in the product's copy, which
  says "join" instead. The accessible name says what the control does
  ("Join this mission and do it"), not what the mark is called. The pill
  around it is the tap target (44px in the feed; the mission card's pill
  row). Tapping it is the canonical join flow (`openMission` → Take this
  mission, with the offer's attribution): join the mission's cohort and do
  it. Cohort admission itself stays with the desk
  (`admit_fellow_to_cohort`). The banner shows the mission's public counts,
  "n joined · n verified" (`action_mission_stats`, anon-granted).
- **Fund** (a banknote) asks the campaign's public bounty board
  (`action_bounty_public`, keyed by the mission's `campaign_id`) and says
  the truth in a line under the banner or card: when the campaign has
  money enabled, "Funding is open through the campaign's governed support
  rail" with a link to `give.html` and the campaign's allocation note;
  otherwise "Funding isn't open for this mission yet. You can still join
  it and do it." The page never takes money itself. The mission dialog shows
  the same line under the mission's details.
- A post with no vouched mission carries Share and Save only. A guest's
  public cards carry no mission tie (offer cards need a session), so a
  guest meets the emblem and Fund on the mission card: the emblem asks them
  to sign in with the reason; Fund answers without one, because the rail is
  public.
- The Worker keeps its reaction route (gated on a completed mission,
  `hasVerifiedAction`) and its reply routes (live-room chat) for any older
  caller; the page calls neither.

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
  title, description from 600px, and **the emblem · Fund · Locate · Posts ·
  All missions**. No Fund button: there is no verified funding flow yet.
- **Feed:** tabs All posts · Missions · Music · Photos & video (filters by what
  a post carries; no invented topics or locations), steel cards, picture as
  a right-hand thumbnail with a 1/n badge that opens all of them on tap,
  share, save. A post that carries a mission shows it as a red **Mission
  attached** banner with the emblem, Fund, its public counts and Locate on globe
  (server-vouched, as before).
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
  (`assets/img/rally/rally-01.jpg`) with Sign in → and Create account. The emblem,
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

### The World's own door: `humanuprise.com` (owner, 2026-10-14)

"The globe experience as its own solo experience ... interconnected with all
the systems." The same World is served at `https://humanuprise.com/` by the
one Worker, by host (`workers/mccluster/src/human-uprise/router.js`): `/` is
`mnet.html` passed through from Matthew's property with this host's own
canonical; the World's rooms, the sign-in pages and the static files ride
along (noindex); every other path is a 301 to the same path on
`matthew.mccluster.org`. Inert until the owner routes the host; the steps are
in `EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md` → "Production domain".

The bar is the same Music | M | Globe on either host (`js/tabbar.js`):

- on `humanuprise.com`, Music and the M link to Matthew's site outright and
  the Globe is the root of this host (`/?view=feed`), which lights the Globe
  coin, not the M;
- on Matthew's site the Globe goes to `WORLD_ORIGIN`, the company's root
  (below); to make it `https://humanuprise.com/` later, flip that one line
  after routing;
- a session is per origin, and the bar carries a member's sign-in across
  (`/v1/auth/handoff`, `workers/mccluster/src/auth-handoff.js`): the token
  rides in the link's fragment, the arriving page scrubs it, exchanges it
  from its own origin for a one-time magic-link token, and Supabase mints a
  session of that origin's own. One M Account, every host; no refresh token
  ever crosses.

### The World's door today: `mccluster.org` (owner, 2026-10-15)

"We don't need humanuprise.com live right now … we need mccluster.org to
actually show the World." The company host's root serves the World by the
same mechanics (`workers/mccluster/src/company-site/router.js` on the shared
`workers/mccluster/src/world-host.js`): `/` is `mnet.html` passed through
with the company's head (canonical `https://mccluster.org/`, site name
McCluster Corp, a WebPage node of the company WebSite about the
Organization); `/mnet.html` is a 301 to `/`; the rooms and files ride along
(noindex); `/company` is the company page, which opens the World from its
header; everything else is a 301 to Matthew's site. The bar's
`WORLD_ORIGIN` is `https://mccluster.org/`, so the Globe on Matthew's site
goes to `https://mccluster.org/?view=feed`, carrying a member's sign-in
across. Until the owner routes `mccluster.org/*` to the Worker and narrows
the zone redirect rule (`docs/control-plane/DOMAINS-AND-ENTITIES.md`,
Activation), that rule bounces the link to Matthew's root with the World's
query, and the bar there forwards it on to `mnet.html?view=feed` on his
origin (query and fragment intact), so nothing breaks on the way. Proof:
`workers/mccluster/test/company-site.test.mjs`, and the browser run below
opens `https://mccluster.org/` through the real router, reads the bar and
the head back, walks the 301s, opens `/company`, forwards the bounced link,
and taps the Globe as a signed-in member to arrive signed in.

### The World first, for every member (owner, 2026-10-15)

"Me as a signed in user … I see no globe in the globe section." Reproduced
against the live site: a member whose profile was unfinished (the bootstrap's
`next_step` of `profile`, or `contact`) got the "Finish your profile" form
instead of the World, and the Globe tab led there. Now the World is theirs
like anyone's: the Earth, the strip, every pin and layer, the public posts.
The step waits in a card where the composer would be (`#mnFinishCard`), and
the actions that need it (post, join a mission, connect, the member rooms)
open the form with the reason and a "← Back to the World". A finished
profile lands back on the feed. The contact step still lives on the account
page, opened on purpose from its card, never by a redirect at boot. The
server refuses those actions anyway until the step is done.

### The data layers: flights for everyone, satellites and launches for members (owner, 2026-10-15)

"Let's populate it with shit, man. Let's get it interesting." Three toggles
at the bottom-left of the Earth (`js/action-globe.js`), each a source
Hitman's Halo already uses, served by the one Worker
(`workers/mccluster/src/world-layers.js`), trimmed to what the Earth draws,
cached so a provider sees one request per window however many people look,
and credited on the imagery line while it is on:

- **Flights**, for everyone: OpenSky's snapshot of aircraft in the air (up to
  five thousand points, ten-minute window). While it is on, the line over the
  Earth counts them and carries the owner's one lead, "Fly Vaunt →" (owner:
  "make it simple and shorter"), the same referral link the front page's VR
  wall carries (`https://vauntapi.flyvaunt.com/referral/nuao1K`).
- **Satellites**, for members: CelesTrak's `stations` and `visual` groups
  (about 170 bright, named objects), propagated in the frame with SGP4
  (`vendor/satellite.min.js`, satellite.js 5.0.0, MIT, loaded on first use)
  so they move; the ISS, the Chinese station and Hubble are labelled.
- **Launches**, for members: Launch Library 2's upcoming launches, pinned at
  their pads with a name and a date; the line names the next one.

Members only means the Worker checks the bearer with Supabase (401 without
it); a guest's toggle is locked with a red dot and opens sign-in with the
reason, sending nothing. A provider that is down gives the last good answer,
marked stale, then an honest "unavailable". Licences, for the owner: OpenSky
is non-commercial research data and a live product can need their written
agreement (the seek-first research credentials, when set on the Worker, raise
the budget); CelesTrak asks for citation; The Space Devs allow use with
credit. Proof: `workers/mccluster/test/world-layers.test.mjs`,
`scripts/test/world-first-and-layers.test.mjs`, and the browser run below.

**The missions themselves** are already on production (27 open), but the
Earth pins only the ones a region places: `supabase/pending/
action_globe_demo_pins_v1.sql` inserts three regions and places every open
mission by its campaign, published. It waits for the owner to apply it.

### A creator's perspective (owner, 2026-10-14)

"If they go into music and they select one individual, they should be able to
go to their front page and experience the site from their perspective, just
like they experience the site from my perspective", with the M in the middle.

- Music opens with an **Artists** rail (`js/music-community.js`): McCluster
  first, the house, opening `index.html`; then every active creator, opening
  `music-creator.html?handle=`. A creator's picture is their own avatar or
  their initial; the M is the supplied mark, scaled, on no plate.
- A creator's front page announces itself (`mcc:perspective`,
  `js/music-creator-profile.js`) and the bar keeps that perspective for the
  session (`sessionStorage.mcc_perspective`): the middle cell is the creator
  (round avatar or initial, their first name as the label) and opens their
  front page; held, its wing is **McCluster** (the M as supplied →
  `index.html`) and **Everything**. Standing on Matthew's front door clears
  it: the M is back.
- Nothing is drawn for a creator; a handle is validated before it becomes a
  link; only an https picture is painted.

### Anti-Social — Get Social: one mission, three levels (owner, 2026-10-14)

"Three levels, one Anti-Social mission … connect with one person, connect
with five people, then turn that connection into a collaboration through
Action Network … levels within a single mission, not three separate mission
cards." One card, 1 / 3 → 2 / 3 → 3 / 3; Level 3 is the flagship.

| Level | Do | Proof |
| --- | --- | --- |
| 1 · High Five | Give one person a high five. | A short clip, with permission. |
| 2 · Five High Fives | Give five different people a high five. | One compilation video or short recap. No filming without consent. |
| 3 · Make Something Together | Find another Action Network member, connect through the platform, create something together. | A jointly credited project linked to both profiles. |

How it works (audit and build record:
`docs/action-network/ANTI-SOCIAL-GET-SOCIAL-AUDIT.md`):

- The mission is one row (`a17050c1-…`), with a level table and RPCs from
  the draft migration applied earlier today
  (`supabase/migrations/20261014185154_antisocial_get_social_three_levels_draft.sql`);
  `supabase/migrations/20261015000455_antisocial_get_social_completion_v1.sql` completes it
  and opens it, and waits for production to apply it.
- **Connect through the platform.** Connect on any member's profile (Connect
  → Requested → Connected; Accept / Decline when they asked first), answered
  from the bell too; server RPCs over `network_connections`
  (`request_connection`, `answer_connection`, `withdraw_connection`,
  `connection_with`, `my_connections`); a block reads as member not found.
- **Levels 1 and 2** are submitted from the mission dialog (recap, a clip
  with permission or an https link) and verified by the desk
  (`js/control-room/action-network.js`), one level at a time; the next
  opens when the previous is verified.
- **Level 3 publishes together, in the platform.** Choose a connected
  member, title the work, say its kind, upload it or link to it: the server
  writes one public post credited to both (`publish_antisocial_collaboration`,
  vouched in `action_collaboration_posts`), submits it as the initiator's
  level 3 and tells the partner, whose Level 3 is one tap ("Published with
  you — Confirm as my Level 3"). One desk verification settles the pair:
  both level-3 rows, both assignments, 150 mission points and a 100-point
  collaboration award for each (`review_antisocial_level`,
  `antisocial_settle_level3`).
- **Credited where people see it.** The feed card under a joint post reads
  "Made together · in review" or "Verified collaboration", with both names
  (drawn only for vouched posts, `action_collaboration_cards`); the partner's
  page lists the projects they are credited on; the person view keeps the
  draft's "Verified collaborations" block.
- **Progress everywhere.** The Action Record row reads n / 3 (`action_record`
  carries `levels` and `level_count`); the Missions card reads "One mission,
  three levels · you: n / 3".
- Consent wording ships verbatim in the dialog and above the camera.

Proof: `scripts/test-antisocial-db.sh` applies the real chain to a scratch
Postgres 16 and runs `supabase/tests/antisocial_connections.behaviour.sql`
and `supabase/tests/antisocial_levels.behaviour.sql` as the API roles (join
through the ordinary join, the standard proof route refused, levels 1–2 for
both, publish refused before 1–2 / with a stranger / without a title or the
work, the joint post with both credits, the guest card, the desk refused
until the partner confirms, the partner's one-tap confirm, one review
settling both with the awards, the record at 3 / 3 and 250 points, the
card verified, the mission open). Contract tests:
`scripts/test/antisocial-get-social-completion.test.mjs`. Browser:
`scripts/e2e/anti-social.e2e.mjs` on an iPhone against the fake backend,
24/24: the card lists the three levels before joining, joining opens Level
1 with the consent line, Level 1 and 2 go through `submit_antisocial_level`
with the recap and the link and the list reads awaiting review → verified →
the next level ready, Level 3 opens with the publish-together form and the
way to find a member, Connect on a member's profile asks the server and
reads Requested, a request is answered from the bell and reads Connected,
the partner list is my connections by name and handle, Level 3 publishes
together with partner, title, kind, link and note, the record reads 2 / 3 ·
Awaiting review and the card reads you: 2 / 3, the feed card reads Made
together with both names and the work and is drawn from the server's
vouch, nothing scrolls sideways, and a project published with me is
confirmed as my Level 3 with the same post and reciprocal credit.

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
portrait/landscape and desktop; Post and Share round trips with the exact
requests; the emblem (alone, no words, the complete artwork) and Fund on a mission post and on the mission card, for a
member and a guest, with the funding truth from the campaign's board; pin → strip and narrowed feed; post → globe
without narrowing; Time rewind (the request carries before= a day ago, the
honest empty state, Live brings the feed back); the layers cycle; search
suggestions (pinned and unpinned missions, never a clip job; people;
groups; the full lists); the Clips door; the Live badge;
the bell's count; the account menu (exactly four entries, whose account,
message requests on the avatar); a creator's analytics door and audience
layer, and their absence for a member who is not a creator; signing out to
the guest World; and the guest path (Explore the world, Member posts live
here, the chips, no session sent, public posts only, actions open sign-in and
send nothing). Since 2026-10-15 the run also drives the data layers: a member turns
Flights, Satellites and Launches on, the points and pins are counted, the
line over the Earth reads the counts, the next launch and the Vaunt lead, the
members-only reads carried the session and the public one did not, each
source is credited, and Flights off clears its own; a guest finds Satellites
and Launches locked, a tap opens sign-in with the reason and sends nothing,
and Flights with the Vaunt lead works for them. The door run adds a member
whose profile is unfinished: the World on screen, the step in its card, the
public feed read, the join opening the form with the reason, Back returning
to the World. Since the mark stopped being written out (2026-10-15) the
run also reads the rendered join back on the feed card and on the mission
card: no text, one image, square, the pill at least 44px wide and tall in
the feed, and the whole screen's text free of the mark (121/121 on an
iPhone, an iPad and a desktop). It does not touch production; Worker
authorization is covered by the Worker test suite.

`node scripts/e2e/human-uprise-door.e2e.mjs [outDir]` puts the real host
routers (`workers/mccluster/src/company-site/router.js` for
`https://mccluster.org`, the World's door today; `workers/mccluster/src/
human-uprise/router.js` for `https://humanuprise.com`) in front of the same
checkout in a real Chromium, with Matthew's site as a stub that records
where a cross-site tap lands, and drives, on the company host (2026-10-15):
the World at `https://mccluster.org/` on an iPhone with the company's
canonical, site name and WebPage node, the bar Music | M | Globe with the
Globe lit, the World's files through the host, noindex on the rooms and not
on the root, `/mnet.html` → `/`, `www` → the apex, `/company` as the company
page with its door to the World, `/album.html` → Matthew's site; the house
root forwarding `?view=` to the World on its own origin (query and a carried
fragment intact) while any other page with that query stays put; and the
Globe tab tapped as a signed-in member on Matthew's site landing signed in
on the company host. And on Human Uprise's host: the World
at its own root on an iPhone (this host's canonical and `og:url`, no
`noindex`, the Earth's frame on the same host, the World's files through
this host, `noindex` on the rooms and not on the front door, no sideways
scroll); the bar read back as the browser sees it (Music and the M to
`matthew.mccluster.org`, the Globe at `/?view=feed`, the Globe coin lit);
the 301s (`/mnet.html?view=missions` → `/?view=missions`, `www` → the apex,
`/album.html` → Matthew's site), each recorded from the router and walked;
a tap on Music landing on `matthew.mccluster.org/listen.html`. Then, on the
checkout's own origin, a creator's perspective: Fixture Ana's front page
puts her in the middle cell (her stored picture, round; her first name; her
coin lit), Music keeps her there and shows the Artists rail (McCluster
first with the M as supplied, then each creator with their picture or
initial), McCluster in Music opens the house where the M is back and the
stored perspective is gone, a creator without a picture gets their initial,
and on a desktop the held coin opens her wing with McCluster (the M) beside
Everything.
Then one M Account, every host: a member signed in on the checkout's own
origin taps a page link to `https://humanuprise.com/?view=feed`; the run
reads back that the fragment is gone from the address, that the World's host
exchanged the carried token from its own origin, that Supabase was asked to
turn the one-time magic-link token into a session, that the session stored
on the World's host is the fresh one (not the house's), that the World booted
as a member (composer, member feed with the fresh bearer, bar signed in), and
that the Music tab then carries the fresh token back to Matthew's site in the
fragment; a guest's crossing carries nothing.

## Still open (unchanged by this work)

The #427 release blockers stand: production migration ledger
reconciliation, the route-to-permission matrix, server-validated regional
affiliation, the mission participation and funding journeys, and staging
end-to-end tests. Also: OpenStreetMap's public tile server is not meant for
app-scale traffic. Choose a tile provider with an agreement before launch.
NASA GIBS has no SLA and sends `no-store`; caching its tiles would belong
in the `mccluster` Worker. The creator audience is sampled like the rest of
`my-creator`; an aggregate in the database would make it exact.
