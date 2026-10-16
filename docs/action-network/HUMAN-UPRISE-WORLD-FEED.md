# Human Uprise — the world is the feed

Owner direction, 2026-10-14: the Action Network is now **Human Uprise**, and
its home is the globe. This file records what that means in the shipped code.
It does not lift any release gate in `EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md`.

## Name

- Public product name: **Human Uprise** (formerly the Uprise Action Network /
  Action Network). The entity graph keeps both old names as `alternateName`
  and the stable `@id` (`mnet.html#uprise-action-network`) does not move.
- Equity Uprise runs on Human Uprise as a program and remains its own
  McCluster Corp public-interest project. Per the owner’s 2026-10-14 copy
  update, "A McCluster Corp program" sits under the Human Uprise wordmark.
  The profile form uses the equation "Hu=Up" and the heading "Profile".
  The owner-supplied Equity Uprise mark remains unchanged.
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
is the Full world ("Full world ↗"): the Earth edge to edge, on its own page
(see below); `?embedded=1` stays as a frame.

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
  also fades in on its own below ~900 km unless Cesium ion's aerial imagery
  is there; see "The Earth up close" below). All NASA imagery is public
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
- **Feed:** the feed is the feed (owner, 2026-10-15: the All · Missions ·
  Music · Photos & video row "shouldn't even be a toggle. Just let the
  screen be."), steel cards, picture as a right-hand thumbnail with a 1/n
  badge that opens all of them on tap, share, save. A post that carries a mission shows it as a red **Mission
  attached** banner with the emblem, Fund, its public counts and Locate on globe
  (server-vouched, as before).
- **Time rewind** is tucked away (owner, 2026-10-15: "that button is
  taking up too much space … it doesn't have anything to do with
  anything"). The panel, its script and styles are gone; the server's
  `before=` paging still exists for the feed's own cursor. Git history
  (PR #434 and before) keeps the control if it is ever wanted back.
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
**Full world** (owner, 2026-10-15: "if they click the world, it'll allow them
to see that in a full pane, right? Without the whole 30, 40, whatever rule"):
`html.globe-explore`, the Earth filling the viewport, the World's chrome at
home (no Map/Missions switch, no tool row, no story feed, no banner). What
floats: "← World" top left (`mnet.html?view=feed`), the controls on the
right, the data toggles on the left, the credit, and the chosen mission in a
sheet on the app bar (`#deck`, compact until a pin is chosen; the join leads
into the World's mission dialog, where the sign-in and finish gates live).
The script measures the bar and the sheet (`--hu-bar-h`, `--hu-sheet-h`) so
the toggles, the controls and the credit lift above both. There is no parent
page to tell, so `tell()` also paints the layer line on the page itself
(`#exploreLine`, the World's own words, the same Vaunt lead) and a guest's
locked layer says so there with a way to sign in. Mobile first; wider screens
only narrow and centre the sheet.

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
| Clips | A door at the top of the feed with the real terms from `clip_campaigns_open`, shown only while campaigns are open (the tabs it used to sit under are gone). Clips are paid work, not posts, so they are not a feed filter |
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
profile lands back on the feed. The server refuses those actions anyway until
the step is done.

### The owner's five, on the screenshots (owner, 2026-10-15)

After seeing the iteration's renders the owner asked for five changes:

1. **The whole screen.** "It's blacked out instead of allowing the feed to
   go all the way down to the bottom of the screen … the bar should have
   shit behind it." `sizeWorld()` used to stop the World at the bar's top,
   leaving a band of page background under the feed with the bar floating
   in it. Now `barClearance()` measures the bar (its layout bottom plus
   height plus 10px, as `--mn-bar-clear`) and the World takes the full
   viewport: the feed runs to the bottom edge under the floating bar and
   carries that clearance as its own bottom padding so the last post still
   scrolls clear. The desktop grid's context strip and the onboarding
   (`.mn__onboard`, now `min-height` to the viewport, the page's reserved
   padding dropped while a gate is up) get the same treatment.
2. **Phones from anywhere.** "The phone saved as plus one only is bad
   because we're gonna have users from all over the world." The phone field
   is a country-code cell (`#mnDial`) and the number: the code is filled
   from the country given on page 2 (`DIAL_CODES` / `dialFor`, about a
   hundred names) and is the member's to change; `normalizePhone(dial, raw)`
   never assumes +1: a number typed with its own `+` stands as typed, the
   trunk 0 most countries drop is dropped (Italy keeps it), E.164 is 8 to 15
   digits, and without a code nothing is saved.
3. **Time rewind tucked away.** The panel is gone (above).
4. **The mark without its white tile.** "Cut the white part out so it's its
   own logo instead of that white part looking different from Fund, Locate
   and Post … keep the dark part." `assets/img/equity-uprise-mark.png` is the
   supplied artwork with every white pixel made transparent and every dark
   pixel exactly as supplied (the anti-aliased rim keeps the mark's own
   navy at partial alpha); same 160×160 canvas, nothing cropped, nothing
   drawn, nothing recoloured. The join button (`.mn__world-go--eup`,
   `.mn__primary--eup`) is now the same glass as its neighbours instead of
   white; the header mark uses the same file. The original webp stays for
   the pages that use it on light ground. Note for the owner: navy on dark
   glass reads darker than the white icons beside it; a lighter variant is
   the owner's to supply (rule 10: never recolour).
5. **No filter row.** The All · Missions · Music · Photos & video tabs are
   gone (above); the Clips door shows on its own while campaigns are open.

### Benji Chase and the missing globe (owner, 2026-10-15)

"When I'm logged in as Benji Chase … I'm still having the issue of not
seeing the globe." Proven on the live site: the API answered the browser's
CORS preflight for every `/v1/mnet` route with 401 (the handler checked the
session before the method, and a preflight never carries the session), so
the browser refused every signed-in member's World call ("Failed to
fetch"). The World page then fell back to `showSignedInLoadError`, which
showed the app shell without ever opening the feed view: no Earth, and its
own message hidden inside the hidden view. Guests were untouched (no
session, no preflight). The browser tests fake the API at the network
layer, which skips real preflights, so they never saw it. The Worker fix is
its own PR (`workers/mccluster/src/preflight.js`, #436). This page now
never goes globe-less whatever fails:

- **The API refuses the session (401):** the session is let go
  (`letSessionGo`), the member is a guest, and one card where the composer
  would be says "Your sign-in ended." with "Sign in again →" (the guest card
  beside it steps aside).
- **Anything else** (the network, a server error, a session that could not
  be checked): the session stays, the World opens with the Earth and the
  public posts, and the card says "Your feed didn't load." with "Try again →"
  and "Sign in again". Posting, joining and the member rooms wait on the
  card; Try again re-runs the bootstrap and the member's own feed returns.

`scripts/e2e/world-screen.e2e.mjs` drives all three (a bootstrap that fails
once, a 401, an unverifiable session) and checks the Earth is up in each.

### The mark, white (owner, 2026-10-15)

"Make the actual … sign white. Just paint it white for me."
`assets/img/equity-uprise-mark-white.png` is the tile-less mark's own shape
and alpha with every visible pixel white; nothing traced, cropped or added.
It is the join on the strip and on mission posts, and the header mark, on
the World's dark grounds. The owner's request is recorded with the logo
rule in `AGENTS.md`, so it stays.

### The onboarding, three pages (owner, 2026-10-15)

"That user flow needs to be easier and more beautiful … three pages that look
all sexy … you put in this, that, that, boom, it all verifies." The form in
`#mnProfileGate` is now one form in three steps, each saved on its own, in
the reference's look (dark brushed steel, one red, a big sentence-case
headline with a red period, tall rounded fields with an icon cell and a
state at the right, one red pill with the arrow in a darker circle, a lock
note under it):

1. **Make it yours.** Username (checked as it is typed: the pattern here,
   the name at `GET /v1/mnet/people/<handle>`, where a person nobody can find
   is free and gets the green check) and display name; "About you" rides
   along collapsed, optional and private. Saves the public profile
   (`PATCH /v1/mnet/profile`).
2. **Where to reach you.** Full legal name and mailing address, private,
   written through `js/fan-intake.js` to `fan_profiles` (the only writer of
   that table). This is the `contact` step the bootstrap requires; it used
   to live on the account page and open from the card by a redirect.
3. **Lock it in.** Phone (normalised to E.164), the account email read-only,
   and a password (optional, at least 8 characters). "Enter the World"
   re-reads the bootstrap and lands on the feed with the card gone and the
   composer back.

A steps bar (`#mnSteps`, 1 / 3) and "← Back a step" carry the member through;
"You can update this anytime." sits under the pill. Editing an existing
profile is the same form on one page (`showStep(0)`: the public details and
the password together). The header's mark is the supplied Equity Uprise
artwork alone, the plate it sat on removed (CLAUDE.md rule 10). Evidence:
`scripts/e2e/human-uprise-door.e2e.mjs` walks the three pages in a real
Chromium (`onboarding-{1,2,3}-iphone.png`): a taken name told as typed, a
free one checked green, an empty address refused, the address saved to
`fan_profiles`, the phone saved as `+12035550100`, the password set, the feed
now the member's own, nothing scrolling sideways at 390.

### The Earth up close: Cesium ion (owner, 2026-10-15)

"So the cesium globe itself isn't available?" Then: "I added an ion, cesium
ion key to the McCluster worker." The World's Earth was CesiumJS already,
drawing NASA's imagery with no ion. Now, when the Worker holds a Cesium ion
token, the same Earth draws from ion as the camera comes down, **for
signed-in members only** (`js/action-globe.js`, "THE EARTH UP CLOSE"):

- **Members only.** ion's assets are account-backed (metered, and paid
  beyond the plan's quota), and the owner's rule for the public is the globe
  plus one free layer, with the paid map data for signed-in members. A
  logged-out page never asks the Worker's ion route (not even the status)
  and never reaches Cesium ion: its Earth is NASA's (GIBS), with the
  OpenStreetMap street map below 900 km. Everything below is a member's
  Earth.

- **Far out, nothing changes.** NASA's lit Earth, the night lights and the
  cloud, exactly as before. No aerial imagery is even asked for above
  3,000 km.
- **Terrain.** Cesium World Terrain (ion asset 1) is under everything. It
  is built before it is used, so the Earth appears once, with its ground;
  if it has not arrived within 2.5 s the Earth draws on the flat ellipsoid
  and stays flat for that visit (no swap under the visitor). Vertex normals
  stay off: with them Cesium switches off the day and night blend and the
  night lights would cover the day side.
- **Aerial imagery.** From 3,000 km down, Bing Maps Aerial with Labels
  (asset 3) eases in over NASA's day, whole by 1,200 km, while the cloud and
  the night lights ease out (Black Marble is opaque and Cesium's day and
  night blend does not fade with height, so on the night side it would
  otherwise cover the ground at every height). If an asset fails, the next is
  tried once: Bing Maps Aerial (2), then Sentinel-2 (3954); if all fail,
  the Earth is NASA's and the street map takes over below 900 km as
  before. While the aerial imagery is there, the street map no longer
  takes over on its own; it stays one tap away on the Layers button.
- **Buildings.** Cesium OSM Buildings (96188) below 50 km, only on the
  Earth look and only when Cesium World Terrain is under them (their
  heights are the terrain's; on the flat fallback they would float over
  high cities and sink into low ones); the Night and Street looks hide ion's layers, and the way
  home (the World button) hides them again.
- **Credit.** Cesium's own credit display moves onto the imagery line
  (`creditContainer`): the Cesium ion logo, then "Data attribution", which
  opens the full list (Bing, the terrain's sources, NASA). It shows only
  while the World draws from ion. On a phone that list fills the frame and
  its close button can sit under the World page's header, so a tap anywhere
  on it closes it.
- **Nothing else waits.** The layout, the data toggles and the mission data
  start before the status answers; only the Earth itself waits for it.

**The token never reaches a browser.** CesiumJS asks
`${Ion.defaultServer}v1/assets/{id}/endpoint` for every ion asset. A
member's page clears Cesium's built-in token (expired anyway) and points
`Ion.defaultServer` at the Worker,
`https://api.mccluster.org/v1/world/ion/`
(`workers/mccluster/src/world-ion.js`), as a `Cesium.Resource` carrying the
member's Supabase session in an `Authorization` header, never in a URL.
In CesiumJS 1.131 `CesiumTerrainProvider.fromIonAssetId` and
`Cesium3DTileset.fromIonAssetId` take no `server` option, so the header has
to ride on `Ion.defaultServer`: every asset-endpoint request is derived from
it and copies its headers and its `retryCallback`. The session rotates; when
the Worker refuses a stale one (401) the request is retried with the newest
session in the browser, once per change. With none, or on a 403, 429 or 503,
ion steps aside for the page and the Earth is NASA's again, with one console
line and no request loop. Signing out in another tab does the same; signing
in brings ion on the next load. The asset tokens ion hands back ride only to
ion's asset host; the member's session never does. The Worker asks ion for that
endpoint with the account's token in a header and passes ion's answer
through: it carries a token for that one asset that ion lets live about an
hour, the only token a browser ever holds. Tiles go straight from ion to
the browser; when the asset token runs out, CesiumJS asks the Worker again.

- `GET /v1/world/ion` is public and says whether the World has ion
  (`available`, with `members_only: true`), which binding holds the token
  (`binding`) and the asset ids. A member's page asks this first and does
  nothing with ion when it is off; a logged-out page does not ask.
- `GET /v1/world/ion/v1/assets/{id}/endpoint` is **members only**. In order:
  only the five assets above (any other id is a 404); only the ecosystem's
  own origins (the CORS allowlist, checked on `Origin`, a 403 otherwise);
  a per-IP brake; then a signed-in member, the bearer checked with Supabase
  exactly as the members' data layers check it (`bearerUser`,
  `world-layers.js`), a 401 without one; then a per-member brake. `Origin`
  is set at will by any non-browser client, so it is an extra check, never
  the gate. The brakes (120 requests per IP and 60 per member in 10
  minutes, a 429 with `retry-after`) live in the isolate's memory: per data
  centre and per isolate, reset with the isolate, a brake on scripted abuse
  rather than an exact quota; the IP brake runs before the Supabase check so
  a flood of bad bearers is not a flood of Supabase calls. Each ion answer
  is kept per data centre for 20 minutes, so ion's API sees a few calls an
  hour whatever the traffic; while ion is down a kept answer under 45
  minutes old still serves, and only to members. Answers go back `private`,
  varying on `Origin` and `Authorization`. Anything else is a plain 404,
  403, 401, 429, 503 (no token) or 502 (ion refused), never the token.
- **Owner actions, not done by this code:** restrict the ion token's scope
  to exactly these five assets (1, 3, 2, 3954, 96188) in the Cesium ion
  dashboard, so a leaked token reaches nothing else; turn on ion usage
  alerts; confirm the ion plan permits this use (the free Community plan is
  for personal and non-commercial use).
- The binding is `CESIUM_ION_TOKEN`, the name the spatial console and
  Hitman's Halo use. `CESIUM_ION_ACCESS_TOKEN`, `CESIUM_ION_KEY`,
  `CESIUM_ION_API_KEY` and `CESIUM_TOKEN` are read too, so a token saved
  under a near name works; the status says which one was found. The
  spatial console (`/v1/seek-first/viewer/config`, owner-only) reads the
  token the same way.

**`redirect: 'manual'`, not `'error'`.** The Workers runtime accepts only
`follow` or `manual` and throws on `error`, so a fetch written with
`redirect: 'error'` never leaves the Worker. The ion route uses `manual`
(a 3xx becomes a 502, and the token never follows a redirect). The same
fix lands in `workers/mccluster/src/world-layers.js`: the World's flights,
satellites and launches had answered "unavailable" in production since
they shipped, because every provider fetch threw before it was sent.
Verified in workerd itself (the route answers ion's JSON, a redirect is a
502 with the token kept, flights load).

Verified by `workers/mccluster/test/world-ion.test.mjs`,
`scripts/test/world-ion-globe.test.mjs` and, in a real browser with CesiumJS
1.131, `scripts/e2e/world-ion.e2e.mjs` (logged out: zero requests to the
ion route, `api.cesium.com` or `assets.ion.cesium.com`; a member whose
session the Worker refuses: ion steps aside once, no loop; a session
rotating mid-visit; ion off with a slow status; ion on
at phone and desktop width; the night side; every asset failing; a terrain
that answers late, with no buildings on the flat fallback; the World page's
frame and its credits panel), with stand-ins for ion's tile hosts. The other World e2e fakes
answer the status with ion off.

### World news from GDELT, ingested by us (owner, 2026-10-15)

"GDELT news as the feed ... And our shit is sprinkled into that. At a ratio
to like one news shit from them. But like, we gotta ingest it so it's still
from us." Then: "I want you to ingest the GDELT immediately ... we need a
database change."

**Whose store, and which news path is live.** ChatGPT built the news store
in #432: `media_news_articles`, `media_news_sources`, `media_ingestion_runs`
and the headline-country trigger (`20261014023548` and the migrations before
it), the `public-gdelt-news` Edge Function, which reads GDELT's DOC 2.0
search API by topic, and `world-news.html` with `js/world-news.js`, which
read the anon view `media_public_world_feed`. That path has never held a
row: it has had no authenticated scheduler since `75937783`, and the DOC API
answers 429 by source IP (`docs/control-plane/SEEK-FIRST-CLOUDFLARE-HANDOFF.md`).
The World's news fills the same store from GDELT's GKG files instead, as rows
marked `ingestion_provider = 'gdelt_gkg_v2'` beside #432's `gdelt_doc_v2`,
and changes nothing of #432's except one guard line in the trigger. The two
paths do not see each other's rows: `/v1/world/news` reads only GKG rows,
and `world-news.html`, the view and `media_public_cached_news` read only DOC
rows, so they stay empty. Retiring them, or pointing `world-news.html` at
`/v1/world/news`, is the owner's call. The Candidate Labs importer
(`media_outlets`, `media_articles`, clusters, assessments;
`CANDIDATE-LABS-NEWS-TRANSPARENCY.md`) is a different thing and stays
pending.

**What GDELT is and allows.** The GDELT Project indexes the world's online
news. Its terms allow unlimited commercial use and rehosting of its data,
with one condition: every use cites GDELT and links to
https://www.gdeltproject.org/. The articles stay their publishers': we keep
metadata only (title, link, publisher, time, the place an article mentions),
every headline links out, and no article text or publisher image is shown.

**Ingest** (`workers/mccluster/src/world-news.js`, the Worker's five-minute
cron, off until `WORLD_NEWS_INGEST_ENABLED` is `"true"` in
`workers/mccluster/wrangler.toml`; it stays `"false"` until the SQL below is
applied, and while it is off the cron makes no request at all). GDELT tells
heavy users to read its 15-minute Global Knowledge Graph files rather than
search, and those carry each article's places with coordinates.

- Each tick reads `lastupdate.txt` and takes at most two files it has not
  read (the newest, then the hour before it, so a gap fills itself), each
  claimed in `media_gdelt_files` so it is read once. GDELT's own host
  answers 404 for its newest files for up to an hour; the file then comes
  from GDELT's Cloud Storage mirror. Redirects follow `lib/safe-fetch.js`,
  only between those two hosts. A failed file is released for the next
  tick; at most three are tried a tick.
- The file is inflated as a stream: about 0.2 to 0.5 s of CPU and 11 MB of
  memory a file (the Worker allows 30 s and 128 MB). A kept field is copied
  out of its record, because V8 keeps a whole multi-kilobyte record alive
  behind a slice of it; without the copy a file held about 60 MB.
- Screened: web articles only, untranslated, a real headline, English, no
  press-release wires, stock-ticker mills or digests, nothing graphic (an
  always-out set of GDELT themes, plus violent themes only when the headline
  is graphic too), at most 72 hours old, one copy of a syndicated story (the
  same headline from another station, in the same file or within 72 hours
  of one already kept), three per publisher, about 100 a file, cities before
  states before countries. On real files 1,100 to 1,700 rows give 100, every
  one with a place.
- One place per article: the place it mentions most, narrowed to the city
  it mentions most inside that country or state. That is where an article
  mentions a place, never a verified event location. A country's name is
  often an adjective in GDELT ("Australian"), so a country keeps its
  centroid but no label. Its country code is GDELT's FIPS 10-4 (`UK`, `GM`,
  `AS`), stored as `location_country_fips`, not ISO 3166.
- Written through `media_ingest_gdelt_gkg` as the service role; a week is
  kept (`media_news_prune`, hourly). `topic_keys` stays `{}` on these rows:
  #432's `media_public_cached_news` is granted to anon and keyed on it, so a
  tagged row would be published to anon.

**Serve.** `GET /v1/world/news?limit=20&before=` is the news stream, newest
first, with an opaque cursor (a whole file shares one time, so the cursor is
time and id), read as the service role from our tables only, kept a minute
per data centre, GDELT credited in every answer, and 200 with nothing
(`unavailable: true`) when the database cannot.

**The database change** (`supabase/pending/world_gdelt_gkg_news_v1.sql`,
pending): six columns on `media_news_articles` (the file, the place's type
and FIPS country, tone, the sharing image, kept for later and not shown,
and the story key that finds a syndicated copy), a feed index and a story
index, `media_gdelt_files` (the GKG counterpart of #432's
`media_gdelt_state`), and six service-role functions (claim, release,
ingest, the news page, the places for the globe layer to come, prune). The
headline-country trigger cleared every row's location before it looked at
the title; GKG rows now keep their own. Nothing is granted to `anon` or
`authenticated`: the World reads news only through the Worker. To turn the
news on: promote the file with the steps in `supabase/pending/README.md`,
then set `WORLD_NEWS_INGEST_ENABLED = "true"`.

**In the feed** (`js/mnet.js`). The World feed reads the news beside the
posts, for a guest and a member alike, as a bare public GET with no session:
news is free for everyone. A pinned post comes first, then one member post
to one news item (`FEED_NEWS_PER_POST = 1`, the owner's ratio; ChatGPT's
issue #418 asked for a clipping-first feed, and the owner's later words set
this ratio, kept as one constant so it can be retuned); when one runs out
the other carries on, and Load more pages whichever has more. A news card
wears the World's card (`data-news-id`, never `data-post-id`): the
publisher, how long ago, the place it mentions, and the headline out to the
publisher in a new tab. Words only: no pictures and no publisher marks. A
card with a place has "On the Earth", which turns the globe to it
(`hu:focus-place`, checked again in the frame). "World news from The GDELT
Project", linked, sits over the feed whenever a news card is shown: that is
GDELT's condition. A mission picked on the Earth narrows the feed to its
posts and the news steps aside; search matches headlines, publishers and
places. A news read that fails, or answers `unavailable` while the SQL is
pending, leaves the posts as they were.

**On the Earth, later.** The globe's News layer (the places in the last
day's news, counted) joins `world-layers.js` and #442's layer access map
once #442 lands. Whether it is free like Flights or for members is the
owner's call; since `/v1/world/news` already carries every item's place,
members-only on the globe would be a display rule, not a data one.

Verified by `workers/mccluster/test/world-news.test.mjs` (20, including the
off switch and a whole tick under workerd's fetch rules),
`scripts/test/world-news-feed.test.mjs`, `scripts/test-world-news-db.sh`
(#432's five migrations and the pending file, applied twice to a scratch
Postgres 16: #432's headline rule still pins its own rows on both tables,
GKG rows keep their place and FIPS country with no topic, one copy of a
syndicated story, claims and release, the cursor reaching every row once,
prune touching GKG rows only, nothing reachable by anon or authenticated,
and anon's `media_public_cached_news` still seeing only DOC rows), a real
GDELT file parsed and written through the real function (100 of 100 saved,
all with coordinates), and the World's e2e (`scripts/e2e/world-screen.e2e.mjs`:
the one-for-one interleave for a guest and a member, the credit, the
link-outs, "On the Earth", Load more on both streams, a failing news read
leaving the posts intact, and 390 px with no sideways scroll).

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
without narrowing; no Time rewind panel and no filter row on the screen
(since 2026-10-15); the layers cycle; search
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
in the `mccluster` Worker. Cesium ion's Community plan is for eligible
personal and non-commercial use and has quotas; a public World draws on the
account's streaming quota for every visitor who zooms in, so the ion plan
should match the World's use before launch. The ion layers are now for
signed-in members only, which bounds that draw to members; the plan,
the token's asset scope and usage alerts are still the owner's to set. The creator audience is sampled like the rest of
`my-creator`; an aggregate in the database would make it exact.
