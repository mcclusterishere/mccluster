# The World feed and public missions: owner direction of 2026-11-17

Status, 2026-11-20: the recovered implementation was merged in #818 and deployed at
`95db84602d8edef4e4a0143833f37ab3e67d91f7`. The Drawdown credit correction was then applied as
`20261120061538_action_mission_drawdown_credit_fallback`, followed by publication as
`20261120061714_action_mission_drawdown_publish`. All 125 missions are published: 125 open missions,
zero website quotations or quotation credits, and all 43 assessment citations retained. The source page
remains draft; this release records no permission attestation for it.

This brief retains the original owner direction and build log. Older branch, deployment and pending-state
statements in the historical log are superseded by the dated production updates here and the current
release records. Environmental activation is tracked separately in `WORLD-ENVIRONMENT.md`.

## The owner's words (2026-11-17)

- "Right now, let's just deal with the globe in the repository. I need it functional as far as like the globe
  itself. I need the missions like from project … drawdown … I need all those missions. Import. … we need them on
  the globe for the signed out users so people can just go look at the missions, sign in, get that user flow. And I
  want you to also like finish productizing the site." The site is the mccluster.org World.
- "I think the missions should low key just be placed in the newsfeed instead of having that Tinder swipe tab. …
  I don't like it. But having the missions as like just another post in the newsfeed, not a big, large post, just
  the same size post as all the other [posts]."
- "whenever you click on a country, when you click on America, you should be able to say, see X amount of news,
  X amount of missions, and [so on]."
- "it should be another tab called the equity uprise tab. That's on the feed, like not in the center on the globe
  section as a tab, but on the feed section under the globe, like there's just that scrolling tab thing you can
  like drag left and right."
- "Should start on everything, but you can individualize it to select mission feed. So it starts on everything
  with all that stuff combined, the missions, the feed, the news, all that in its own like one tab."
- "the equity uprise is definitely that nomenclature … the logo, the PNG logo that is there, put that on that tab,
  but don't make it ugly … Just keep it as is."
- "that whole environmental justice panel behind the E=up button is a [joke]. Needs to be fixed."
- "Project Drawdown gave us specific explicit permission already." "Just credit them."

## What this supersedes

| Earlier rule | Now |
| --- | --- |
| `AGENTS.md`, owner 2026-11-07: the public modes are News feed and Environmental Justice; general Missions stay owner-only | Missions are public, as posts in the World feed. Travel stays owner-only (the owner did not mention it). |
| `MISSION-RESET-DOCKET-516R.md`, owner 2026-10-17: the Missions tab shows one card at a time; left passes, right accepts | The swipe deck is removed. |
| Owner 2026-11-07: the E=UP logo is a mode button in the centre of the globe | The E=UP logo is a tab in the feed's scrolling tab strip; the Environmental Justice panel lives behind that tab. |
| Owner 2026-10-19: the strip reads Local, Global, Live, News, People; "Global is everything" | The default tab is labelled Everything (same `global` key) and the strip gains the Equity Uprise tab. |
| Owner 2026-11-17: the strip reads Local · Everything (key `global`) · the Equity Uprise tab · Live · News · People | Owner 2026-11-18: the row reads Local · the Equity Uprise tab · Global · Live · News · People. The whole stream is labelled Global again (same `global` key, still chosen on load), and a signed-out visitor sees nothing above the row. |
| PR #726, owner 2026-11-03: the explorer's mission feed and pin detail are owner-only (`css/globe-games.css`) | Mission pins, their detail and their join are public. The games controls stay owner-only. |
| data/missions/drawdown/README.md, 2026-11-17: Drawdown's name "appears only in credit lines" | 2026-11-19, a default adopted pending Matthew's confirmation: also as the heading of Project Drawdown's source page in the World and on its door in each Drawdown mission's dialog, only to identify the source. The logo still appears nowhere and nothing implies endorsement. |

## The target

1. **The feed's row** (`#mnFeedScope`, the row under the globe: one drag-scrolling row on the phone and the stacked tablet;
   on the split desktop, 1000px and wider, it wraps onto a second line so every tab sits inside it), in the owner's order of 2026-11-18:
   Local · Equity Uprise (key `equity`) · Global (key `global`, pressed on load) · Live · News · People, and nothing
   above it for a signed-out visitor. There is no separate Environment tab: the environmental globe lives in the
   Equity Uprise tab (owner, 2026-11-17, latest decision below).
2. **The Equity Uprise tab** shows the owner-supplied PNG only: `assets/img/equity-uprise-mark-white.png` on a dark
   ground, `assets/img/equity-uprise-mark.png` on a light (daylight) ground. Choosing a supplied variant is not
   recolouring. Scale proportionally to the strip's icon size; no plate, filter, crop or visible words. Its
   accessible name is "Equity Uprise". (`AGENTS.md`, "THE LOGOS ARE NOT YOURS TO DRAW".)
3. **Global** (labelled Everything from 2026-11-17 to 2026-11-18) combines member posts, news and missions in one
   stream. Missions are interleaved at a modest ratio (no more than one mission per few other items), each mission
   at most once per page.
4. **The Equity Uprise tab** holds the missions and the environmental globe together. Selecting it turns the
   globe into the environmental globe (item 11) and the feed into mission posts and environmental observation
   posts, interleaved by time, each clearly typed (an observation is never presented as a mission or as its
   cause). The Environmental Justice panel (source health, filters, list and 2D fallbacks) sits at the top of the
   tab.
5. **A mission post** is the same size and shape as any post (`mn__post-card`): a header with the mission's kind
   and domain (never the brand written out), the title, the description clamped like a post body, one meta line
   (difficulty and points), a compact source line for sourced missions that opens the full credit, and the
   post's action row. The join is the Equity Uprise emblem alone (accessible name "Join this mission"), as on the
   rest of the World; a Details action opens the mission dialog. No hero, no stack, no swipe.
6. **The mission dialog** works for a signed-out visitor: full description, proof hint and safety line, the
   `about` quotation with `about_credit` beneath it when present, the full `credit_line`, and Join. A guest's Join
   asks them to sign in or create an account and keeps `?mission=<id>`, so they return to that mission.
7. **The swipe deck is gone**: `.hu-mission-preview`, `#huMissionList`, `#mnWorldEup`, `js/mission-swipe-deck.js`,
   its styles and `scripts/e2e/mission-swipe.e2e.mjs`. The "Open missions" block that filled a short feed is
   replaced by the mission posts.
8. **The centre mode bar** loses the Missions and E=UP buttons. A signed-out visitor or member sees no centre
   mode bar. The house owner keeps Travel beside the feed.
9. **The country card** (`#mnPlaceCard`) shows real counts: news in the last 24 hours, missions, posts and
   members. A country's missions are the open missions pinned there plus the open missions that can be done
   anywhere. Picking a country turns the feed to Local, which lists that country's posts, news and missions.
10. **The globe** shows mission pins to everyone (no `missions=0`). A pin exists only where the owner placed a
    mission; a mission that can be done anywhere has no pin. Production has no pins today.
11. **The environmental globe** (in the Equity Uprise tab): its layers on the same globe, drawn in proportion to
    the geography and magnitudes the sources report, never as uniform dots (see "The environmental globe" below),
    and the Environmental Justice panel, which reads clearly by day and by night, shows each source's health and
    last success, says plainly when its sources are unavailable instead of showing a broken state, and lists
    official reports (NWS, NASA EONET, USGS, NOAA NHC, and the public-safe additions the owner asked for on
    2026-11-17) with their source, timestamps, coverage and links. A report is not evidence of exposure or
    injustice and is never labelled so. The abandoned branch `codex/equity-environment-always-visible-20261109`
    (`a47f9a31`) is salvaged where it helps.
    State (2026-11-17, slice G1): source on this branch; the panel's side (health rows per source and per globe layer, the
    honest line, daylight, the tour and 2D controls, the message spine) is verified with fixtures at 390, 820 and 1280
    (`scripts/e2e/world-environment.mjs`) and by `node --test`; the globe's own layers are lane L1 of the same slice with
    their own suite; the integration pass of the same evening ran the page and the real frame together with fixtures at 390,
    820 and 1280 (`scripts/e2e/environment-world.e2e.mjs`; `WORLD-ENVIRONMENT.md`, "The integration pass"); not merged, not
    deployed; production answers 503 until the owner enables the module.
13. **Environmental observation posts**: each environmental event appears in the feed as a post from the system
    (a system author such as "Environmental desk" with a plain icon, never a person and never the logo), the
    same size and shape as any post, stamped with the time the event was recorded (local time and how long ago;
    sorted by it). A source that gives no event time says so and is ordered by its retrieval time, labelled as
    such. Each post: what was observed, where, the measured facts the source gives (magnitude and depth;
    sensor and radiative power; acres; severity, certainty and urgency; wind), the source and its link, coverage
    and status, and "Show on globe". All of them appear in the Equity Uprise tab; significant ones (for example
    an M4.5+ earthquake, a Severe or Extreme NWS warning, an active NHC storm, a large fire perimeter) also appear
    in Global at a low ratio. Thousands of fire detections are never thousands of posts: they are summarised
    per area. One post per event; a source update edits that post ("Updated" time), never duplicates it.
    State (2026-11-17, slice G1): source on this branch (`js/world-environment-posts.js`, `js/mnet.js`, the panel's
    `mcc:world-environment-events`); verified with fixtures at 390, 820 and 1280 (`scripts/e2e/world-environment.mjs`: the
    posts typed and stamped with the recorded time, the retrieval time labelled when the source gives none, one in six in
    Global, with the missions by time in the Equity Uprise tab, fires summarised per 1-degree area, Show on globe, zero
    posts under 503 and 404) and by `scripts/test/world-environment-posts.test.mjs`; the significance line is M5.5 or a
    ShakeMap for USGS (the design's constant; this item's M4.5 example is one constant away); the integration pass verified the
    posts, Show on globe and the tab's order by time against the real frame (`scripts/e2e/environment-world.e2e.mjs`); not
    merged, not deployed.
12. **Sign in and return**: from a mission post, the dialog, a pin, a shared link or the bar's Sign in chip, a
    guest who signs in (or creates an account and confirms it) comes back to that mission, and Join sends exactly
    one `join_action_mission`.

Mobile first (`AGENTS.md`, hard rule 14): designed at 390 px, verified at 390, 820 and 1280 with
`scrollWidth === clientWidth`.

## Mission data

- `data/missions/drawdown/missions.json`: 125 missions written for this site from Project Drawdown's Explorer and
  its CC BY 4.0 assessment records. `README.md` there holds the credit and display rules.
- Production `public.action_missions` has no column for a proof hint, a safety line or a credit
  (`proof_required` is a boolean). These live in a new table, `public.action_mission_details`
  (one row per mission: catalog, slug, proof hint, safety note, credit line, about, about credit, source URL,
  licence name and URL, DOI), readable by anyone exactly when its mission is (open, paused or closed), written
  only by the service role. The page tolerates its absence.
- Anonymous visitors read open missions through the existing policy "public reads open missions" (open, paused
  and closed rows).

## Production steps (owner approval of the exact SQL, each on its own)

1. Decouple joining from pins (`join_scope`, default `anywhere`), extracted from
   `supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql`. No pin may be written before it:
   before it any pin row made its mission unjoinable for everyone. Applied on 2026-11-17 (ledger version `20261117222809`,
   `supabase/migrations/20261117222809_action_globe_join_scope_v1.sql`).
2. Create `public.action_mission_details` and import all 125 Drawdown missions (owner, evening of 2026-11-17: "do
   it"; generated SQL, idempotent). Applied on 2026-11-18: the details table is
   `supabase/migrations/20261118021521_action_mission_details.sql` and the import its seven parts, `20261118034753` to
   `20261118035654` (production ledger 376 at that initial import); the missions entered as drafts.
3. Correct the public credits, then publish (status `open`). Applied on 2026-11-20, after the new feed shipped:
   `supabase/migrations/20261120061538_action_mission_drawdown_credit_fallback.sql`, then
   `supabase/migrations/20261120061714_action_mission_drawdown_publish.sql`. All 125 are open, with zero website
   quotations and all 43 assessment citations preserved. The frozen import and reviewed publication keep their exact bytes.
4. Place pins the owner chooses.
5. The Environmental Justice module: `eup_module_policy_v1.sql` (applied on 2026-11-17, now
   `supabase/migrations/20261117144103_eup_module_policy_v1.sql`), then `20261107120000_world_environment_v1.sql`
   (`PROMOTION-ORDER.md`), then the environment module's policy row.
6. Supabase Auth: confirm `https://mccluster.org/**` is in the Redirect URLs (dashboard). Done: the owner confirmed on
   2026-11-18 that the Redirect URLs include `https://mccluster.org/**`.
7. `WORLD_PLACE_SCOPE_ENABLED = "true"` in `workers/mccluster/wrangler.toml`, deployed with the rest, once the public-only
   feed QA its comment names has passed (its SQL, `20261021173729_world_place_scope_v1`, is applied).

## Owner decisions (2026-11-17, answered in session)

- **Joining a mission** keeps today's rule: a new member completes the three profile pages (legal name, mailing
  address, phone), then joins instantly through `join_action_mission`. No application step for now.
- **First visit**: the full-screen "Privacy before entry" wall on the World becomes the existing banner mode
  (`<meta name="mcc-privacy-notice" content="banner">`), so the globe and the missions show at once. Analytics stay
  off until the visitor agrees, as before.
  State (2026-11-18): source on this branch, not merged or deployed. `mnet.html` carries the meta in its head before
  `js/live-content.js`, so the World at each of its doors (`mnet.html`, `https://mccluster.org/`, `https://humanuprise.com/`,
  a shared `?mission=` link) opens with the bar and no wall; nothing is recorded, no device id is set and every track call
  is a no-op until the visitor agrees, and agreeing takes effect in place, recording from the next page view. The other
  house pages keep the wall.
  Review fixes (2026-11-18, LDR-F1, F2 and F4): the World is the house itself, not a document page, so its head also
  carries `<meta name="mcc-privacy-notice-seen" content="answered">` and its bar counts only once it is answered ("I agree
  & continue", "Not now" or Escape), the rule the wall kept and the one `privacy.html#entry-notice` already states for
  every page that is not a document ("Leaving without answering is not an answer, so the next page asks again"). Until an
  answer nothing is recorded, not even that the bar was seen, so the published policy describes the World as it is with no
  new words. A document page's bar still counts as soon as it is shown. A shared `?mission=` link opens its mission in a
  modal sheet, which makes the rest of the page inert: the waiting bar is the last thing inside that sheet, answerable,
  below "Take this mission" and the close button, and goes back along the bottom when the sheet closes (it used to wait
  under the sheet, out of reach, and was recorded as seen anyway, so a visitor who left from the mission was never shown
  the notice again). Wherever the shared bottom bar is drawn (`body.has-appbar`), the notice sits just above it, so every
  tab stays in reach at every width (on the World it covered all three tabs at 390 and 820); the rule is the notice's own,
  so the document pages' bar sits above the bottom bar too.
  Proof: `scripts/test/world-privacy-banner.test.mjs` (root suite; it runs the notice against each door's served head)
  and `scripts/e2e/world-first-visit.e2e.mjs` (editorial CI suite
  `world-first-visit`), with nothing stored first, at 390, 820 and 1280 by night and 390 by day: the globe with its pins
  and the mission posts at once, the tab and a mission's Details answering with the bar up, every tab of the bottom bar
  answering with the bar up, nothing recorded while the bar waits, no analytics request until agreement, and the next
  page view recording; at 390 a shared mission link shows the bar inside the mission's sheet with the bar's answers, "Take
  this mission" and the close button all in reach, leaving from there leaves the next page (the house's front page) asking
  with its wall, and Escape in the bar answers "Not now" with the mission still open; the last mission post in the feed
  scrolls clear of the bar (while the bar waits, the feed ends that much later, `css/mnet.css`). Against the files as they
  were before the review fixes, 9 of the root test's 12 cases fail and the browser suite fails 14 of its 83 checks (nothing
  recorded and the bottom bar in reach, at every width; every shared-mission check about the bar). Open PR #760
  (2026-11-05, "Agree & continue or Go back") removes the banner mode from `js/live-content.js` for every page; merged as
  it stands it would put the wall back on the World, and the root test above fails until the two are reconciled. This
  decision is the later one.
- **"Get Your Hu Up!"** is removed from the World's sign-in panel and the `/company` footer, and from anywhere else
  it is public.
  State (2026-11-18): removed on this branch from `action/index.html`, `heal-the-3rd-world.html`, `mccluster-corp.html`,
  the member desk (`js/member-desk.js`, with its now unused `.hu-desk__k` rule) and the `/company` footer
  (`data/seo/company-site.json`, regenerated by `tools/build-company-site.mjs`), each sentence left as it was, no tagline
  in its place. `scripts/test/retired-tagline.test.mjs` scans every file the Pages deploy publishes and the Worker's
  source, generated `/company` pages included; the sign-in panel (`#mnSignedOut`) is the sign-in redesign's, which carries
  the same decision. Dated records keep it. Review fix (2026-11-18, LDR-F5): the guard leaves that panel out only as it
  stood on 2026-11-18 (its sha256 is pinned in the test); any change to the panel, the redesign landing or one more line
  in the old panel, ends the exception and the panel is read like the rest of the page. The review's probe (a new line
  with the tagline inside the panel) passed the old guard and fails this one.
  Verification (2026-11-18): the redesigned door (`docs/design/WORLD-SIGN-IN-DOOR.md`) carries no such line, so the
  exception had ended; its code and the pinned sha256 are now removed from the test, which reads `mnet.html` whole and
  proves the tagline is refused anywhere on the World (in the door, the onboarding pages, the feed, a dialog, the head,
  an attribute). With the pinned exception still in the test, the old panel put back byte for byte passed the guard; it
  now fails it.

## Owner decisions later on 2026-11-17 (the environmental globe)

The owner asked for the Environmental Justice globe to become "a compelling, real-data experience … not a
generic collection of flashing icons", truthful about every source, and "Add a clear environmental entry and
preserve the existing design identity." "Keep observations separate from Project Drawdown-informed actions and
fictional PRIM3 missions." Answered in session:

- **Entry (superseded the same hour, see below)**: a labelled "Environment" tab was chosen first.
- **Shipping**: the environmental work ships with this branch, together with the feed work, once both are verified.
- **Production**: the owner approved applying `supabase/pending/eup_module_policy_v1.sql`. It was applied on
  2026-11-17 as migration `20261117144103_eup_module_policy_v1`; production stored it byte for byte (MD5
  `1f1daee2582fd0a6f3a659350a07491e`, 26,070 bytes; ledger 366 to 367 rows; recorded 2026-11-18 as `supabase/migrations/20261117144103_eup_module_policy_v1.sql`, ledger 376). It creates no policy row: the owner
  installs and enables the `environment` module in Control (System, E=Up, Overview, Modules). Until then
  `GET /v1/world/environment` keeps answering 503 `module_policy_unavailable`, as designed.
- Owner-only Halo routes stay owner-only; the public globe grows only through the narrowly scoped public bridge,
  behind the same module policy. Illustrative animation is labelled as such; nothing is fabricated.

## Owner decision, latest on 2026-11-17 (supersedes the Environment tab)

The owner's words: "missions, the E equals up should actually be in the same thing … the E equals up and this
environmental globe thing should be in the same like tab", "the environmental globe updates should be updates like
as posts from the admin system, like from the system, like it would look like posts just like on the news feed",
"obviously what time the event was recorded", "make the cinematic experience way more cinematic and like beautiful
versus just a bunch of … icons flashing", "make the visuals proportionate to the geographical data we are
collecting, not just … dots on the board."

So: one Equity Uprise tab for missions and the environmental globe (target items 1, 4 and 11), environmental
events as system posts stamped with their recorded time (item 13), and the globe below.

## Owner decisions, evening of 2026-11-17 (the three open questions)

Asked after W1, W2 and D1: publish all 125 Drawdown missions or a subset; Local or Everything on load once
`WORLD_PLACE_SCOPE_ENABLED` is on; the clip-campaign door and the Live room's action blocks back for everyone or
owner-only. The owner: "1 do it 2 start with the country their IP address is showing and 3 keep them mine for
right now."

- **All 125 missions are published.** The owner's decision was completed on 2026-11-20 after the feed deployment.
  The original join scope, details table and seven import parts remain recorded under their production versions.
  The credit correction (`supabase/migrations/20261120061538_action_mission_drawdown_credit_fallback.sql`) removed
  unverified website quotations and permission claims before the publication
  (`supabase/migrations/20261120061714_action_mission_drawdown_publish.sql`) opened the full catalog. Production
  verification found 125 open missions, zero website quotations, and all 43 assessment citations intact.
- **On load, the country the visitor's IP address shows.** That is the 2026-10-20 release contract
  (`docs/action-network/WORLD-REGION-FEED-RELEASE.md`): with the flag on, the feed opens on Local for the country
  Cloudflare reads at the edge (`request.cf.country`, through `/v1/world/place-scope`), which `js/mnet.js` already
  does (`state.placeScope.home`); an unknown edge country stays on Everything (labelled Global again since
  2026-11-18); no GPS, no user-supplied location, nothing stored. The flag turns on at deploy time (production step
  7). Still in force from 2026-10-20 unless the owner says otherwise: a signed-out visitor cannot hop to another
  country without signing in, which now also covers that country's mission and news counts.
- **The clip-campaign door and the Live room's action blocks stay owner-only** ("keep them mine for right now"):
  `hu-travel-off` keeps holding them with Travel; nothing changes.

## Owner decision, 2026-11-18 (the feed's row)

The owner, looking at the live World as a signed-out visitor (the live site still serves build `fc1986ec`, which shows
everyone the old centre mode bar, Travel · Missions · News feed · E=UP, above the scope row): "I'm seeing like the
non-logged out view. There's still that news feed, then the equity up E equals up tab. When in reality, I wanted that E
equals up tab next to local, global, live news people. Do you know what I'm saying? And it's still as a logged out user,
news feed, then the equity up tab. There should be no tabs from news feed to E equals up. It should just be local, equity
up, global, live news people."

- **The row** (`#mnFeedScope`) reads Local · the Equity Uprise tab · Global · Live · News · People. The Equity Uprise tab
  is the supplied mark as it is (white by night, the supplied dark mark by day, named "Equity Uprise", never written out).
  Everything is labelled Global again (owner, 2026-10-19: "Global is everything"); the key stays `global` and the start
  rule is unchanged: Global on load, or Local for the visitor's IP country once `WORLD_PLACE_SCOPE_ENABLED` is on
  (evening of 2026-11-17); `?feed=equity` opens the Equity Uprise tab. The arrow keys walk the row in this order.
- **Nothing above the row for a signed-out visitor**: no centre mode bar, and no "News feed" or "E=UP" written anywhere on
  the World. The house owner's own signed-in mode bar (Travel, News feed) is unchanged.
- State (2026-11-18): source on this branch (`mnet.html`, `js/mnet.js`; no CSS change: the row keeps its 44px pills,
  its own sideways scroll and its pressed red by night and by day). Verified with fixtures, nothing live:
  `scripts/test/world-mission-posts.test.mjs` holds the row as shipped (names, keys, Global chosen on load),
  `FEED_SCOPES`, the start rule and the arrow keys, and fails on the old row;
  `scripts/e2e/world-missions-guest.e2e.mjs` (238 of 238 checks) shows a guest, at 390, 820 and 1280 by night and at
  390 by day, the row in this order with Global and then the Equity Uprise tab chosen, in view and marked, every tab
  44px or more, no mode bar, no control before the row, no "News feed" or "E=UP" on the page or in the globe frame,
  and no sideways scroll; at each width by night the arrow keys, Home and End walk the row in this order; the house
  owner's persona still gets Travel and News feed in the centre bar. That suite's Equity Uprise tab check now also
  counts the environmental observation posts the tab has listed since slice G1 (its one fixture report is one post
  there). The World suites whose titles now say Global pass as they are: `scripts/e2e/world-environment.mjs`,
  `scripts/e2e/environment-world.e2e.mjs` (163 checks), `scripts/e2e/world-screen.e2e.mjs` editorial on the phone (186
  checks, the editorial row check and the arrow-key step among them) and `scripts/e2e/docket-cohort-showcase.e2e.mjs`
  (56 checks). Not merged, not deployed: the live site keeps showing the old bar until the owner approves a deploy.
- Second review (2026-11-18, `css/human-uprise-editorial.css`): the tabs are form controls at `max(16px,1em)` (they were
  14px; AGENTS.md hard rule 14, the reading the Environmental Justice panel's buttons already follow), and on the split desktop
  (1000px and wider) the row wraps onto a second line, so every tab sits inside it (at 1280 the sixth tab, People, sat past the
  row's edge in the 491px feed column with no sign that the row scrolls). The phone and the stacked tablet keep one dragging
  row; at 820 the six tabs still fit on it. `scripts/e2e/world-missions-guest.e2e.mjs` checks every tab at 16px or more at each
  width and, from 1000px, every tab inside the row's box.

## Owner request, 2026-11-19 (Project Drawdown's page in the World)

The owner asked for a profile of Project Drawdown on this site where people can "go look at … their ecosystem, but from
our website, not leaving our website", "just making a profile for them on our website", and to "credit them". He called
it "their own corporate account, like business account on here". What this work builds, each part a default adopted
pending Matthew's confirmation (the record is `docs/control-plane/WORLD-MISSION-SOURCES.md`): a public source page that
McCluster Corp makes and keeps, not an account. Project Drawdown has not asked for or agreed to an account here, its
Terms of Use forbid using another's name to impersonate it, and the repository's precedent for a third party's named
page is a page with no account (`docs/control-plane/VAUNT-PROJECT-PAGE.md`). No one signs in as Project Drawdown, and it
posts nothing.

He said "they're the ones who have created all those missions for the environments". The record: the missions were written
by this site from Project Drawdown's climate solutions; the wording is original (`data/missions/drawdown/README.md`, "Where
the content comes from"). The page says so, and its public word for Project Drawdown's role is Source.

The owner handles any message to Project Drawdown outside this repository; no agent of this work sends, drafts, schedules
or records one.

## The environmental globe

Truth first, then beauty. Every visual encodes a real quantity from the source and says which; nothing flashes.

- **Earthquakes (USGS)**: where USGS publishes a ShakeMap, its intensity (MMI) contours, coloured by intensity,
  labelled measured and modelled shaking from USGS. Otherwise a disc whose area grows with the energy the
  magnitude implies, coloured by depth and labelled "size shows magnitude, not the area affected". The last 24
  hours can be replayed in order of recorded time. One restrained ripple on the selected quake only, labelled
  illustrative, never a recording of shaking; built as one primitive whose material animates, never by
  rebuilding ground geometry each frame (Halo's notes record the frame-rate regression that caused).
- **Fires (NASA FIRMS, NIFC WFIGS)**: each satellite detection at its true footprint (about 375 m for VIIRS)
  when close, coloured by radiative power, with its sensor and detection time; summarised by area when far,
  sized by the summed radiative power. A detection is not a confirmed fire or perimeter. WFIGS perimeters as
  their actual polygons with their acres and dates; malformed rings are dropped, never closed by guesswork.
- **Alerts (NWS)**: the alert's own polygon, tinted by severity; zone-only alerts stay in the list, never placed.
- **Natural events (NASA EONET)**: the reported geometry; a storm's successive reported points as its track.
- **Tropical cyclones (NOAA NHC)**: the reported centre, and published track or wind-field geometry only where
  NHC publishes it; nothing inferred.
- **Coastal water levels (NOAA CO-OPS)**: station columns whose height shows the observed water level against
  the station's datum (preliminary data labelled), never as ocean currents.
- **Ocean currents and satellite orbits**: only after a verified product and licence; currents only from real
  U/V vectors with their model or observation time and depth; orbits labelled predicted with their epoch.
- **Cinematic**: smooth, interruptible camera moves between these scenes, a tour that pauses, soft fades instead
  of blinking, the atmosphere and night side of the Earth; no automatic motion under reduced motion; a list and
  a 2D view for anyone who cannot use the 3D globe. Every selection shows source, recorded time, retrieval time,
  coverage and status. Render on demand; benchmark at phone and desktop sizes. The music preference is never
  touched.

## Build queue

| Slice | What | State |
| --- | --- | --- |
| W1 | Law, missions public, Travel owner-only, swipe deck and centre buttons removed, Equity Uprise tab, Everything label, guest deep links | done (`d8667ac1`; law `3f638709`; router test `23b06393`): `hu-travel-off` holds Travel alone (the house owner keeps Travel and News feed; the clip-campaign door and the Live room's action blocks stay with it); missions public in the feed, the globe frame, the expanded globe and the explorer (the PR #726 gate keeps Games only); swipe deck, Missions mode and centre E=UP removed; strip Local · Everything · Equity Uprise tab (supplied marks, arrow keys, mouse drag) with `#wePanel` at the top, the Docket 516R series, and a plain empty mission feed until W2 (`missionFeedHtml`, `acceptWorldMission`); guest `?mission=`, `?view=missions`, All missions, `?feed=equity`; `/mnet.html?mission=` keeps its query through the 301; `scripts/e2e/world-missions-guest.e2e.mjs` in the editorial CI matrix. Decided (owner, evening of 2026-11-17): with `WORLD_PLACE_SCOPE_ENABLED` on, a visitor opens on Local for the country the IP address shows, as the 2026-10-20 release contract already has it |
| W2 | Mission posts in Everything and the Equity Uprise tab, the dialog's credits, country card counts, Local missions | done (`8f933ba9`; source report `29851ea2`): every open mission is a post (`mn__post-card`: kind and field, difficulty and points, title, description clamped to two lines, a source line that opens the dialog at its credit, the supplied emblem alone as Join, Details, Share copying `?mission=` on this origin); Everything puts one mission after every three other items, newest first, each once, the rest up to the page of 20; the Equity Uprise tab lists every open mission 20 at a time with Load more; the dialog shows the proof hint, the safety line, the `about` quotation with `about_credit` beneath it and the full `credit_line` with its links; a post's Join is `acceptWorldMission` (a guest keeps `?mission=`, a member gets exactly one `join_action_mission`); `#mnPlaceCard` counts news (24 h), missions, posts and members in its two rows, a country's missions being the open missions pinned there plus the ones pinned nowhere (a state: pinned inside its shape), and Local lists them with the place's news (its member posts only once `WORLD_PLACE_SCOPE_ENABLED` is on: until then Local says how many member posts the card counts that it cannot show); `action_mission_details` is read once per mission and a 404 or `PGRST205` is remembered for the session (`live-callers.json` `pending_only`); `#wePanel` stays hidden until its source answers and the tab shows one honest line while `/v1/world/environment` is unavailable. Pure parts `js/world-mission-posts.js` (`scripts/test/world-mission-posts.test.mjs`); `scripts/e2e/world-missions-guest.e2e.mjs` extended at 390, 820 and 1280. The review of `bb9a1108` (11 findings) is fixed on this branch: R1 the Worker flow test runs on the page as it ships and R6 a guest is asked to sign in only for an open mission (`b80ddb15`); R2 the posts never wait on the missions (`MISSION_GRACE` after the news at most); R3 a failed missions read offers Try again and is read again when the tab is chosen again; R4 a country tapped on the Equity Uprise tab narrows the tab to the place's missions under the panel instead of leaving it, and Everything or News come back when the country is let go; R5 Escape closes the dialog as × does and takes `?mission=` out of the address; R7 a key's click on a tab is never swallowed after a drag; R8 the source line sits in the head's second line and the post's rules are tightened, so every mission post is within the ordinary posts' range of heights at 390, 820 and 1280 (the e2e holds them to the tallest post plus 8 px; at 360 a two-line title reaches 240 px against a tallest post of 233); R9 the Environmental Justice panel reads 4.5:1 or better by day (`css/daylight.css`); R10 this cell and Local's own line about the member posts the card counts; R11 escaping tests for the post and the dialog, hostile rows and a member's denied, malformed and in-flight joins in the e2e. Open: environmental observation posts (target 13) are not in the stream; the pin card's Join (`#mnWorldFocusJoin`) still asks a guest to sign in without keeping `?mission=` (W4); "pinned nowhere" stands for "can be done anywhere" until `join_scope` is applied; world-screen `news-member` "the strip opens on the latest mission" fails on `9d117739` as well (not in the CI matrix) |
| D1 | Mission SQL: join scope, mission details table, catalog import generator and its tests | done: reviewed SQL with rollbacks (`PROMOTION-ORDER.md` section 10), `tools/build-mission-import.mjs`, `scripts/test/mission-import.test.mjs`, native proof (100 checks) and `scripts/test-mission-pins-db.sh` passed on PostgreSQL 16.15 and 17.7 (production runs 17.6). Review fixes in: 10.1 and its rollback refuse over the whole pins file, the import rollback locks the two references without a foreign key before it counts, every header says to apply as postgres (`apply_migration`), the catalog carries the README's credit display rule, the publish proof keeps a draft outside the catalog a draft. Initially applied with the owner's approval (ledger 376 on 2026-11-18, `PROMOTION-ORDER.md` section 10): the join scope on 2026-11-17 (`20261117222809`), the details table (`supabase/migrations/20261118021521_action_mission_details.sql`) and the import's seven parts (`20261118034753` to `20261118035654`) on 2026-11-18, each promoted to `supabase/migrations/`; the credit correction (`supabase/migrations/20261120061538_action_mission_drawdown_credit_fallback.sql`) and publication (`supabase/migrations/20261120061714_action_mission_drawdown_publish.sql`) were applied on 2026-11-20, leaving all 125 missions open with zero website quotations and all 43 assessment citations intact. The details table is live, so it is no longer in `live-callers.json` `pending_only` |
| W3 | Environmental Justice panel (salvage, daylight, honest unavailable state, browser acceptance) and its production SQL bundle | in progress, as slice G1 lane L2 (2026-11-17; `WORLD-ENVIRONMENT.md`, "The environmental globe, slice G1"): the panel speaks to the one globe in a fixed order (`hu:environment-layers` before the pins, layers off then the pins-off object last on destroy; local patch `G1-PANEL` in `vendor/equity-uprise/product-source.lock.json`), shows per-source health rows for the feed and for the globe's layer states (status, reason in plain words, Retrieved and Last success with how long ago, coverage, attribution, licence, link), the tour and 2D controls, a globe-only selection card with the item's own time labelled, reads the feed once at mount and hands it to the page as `mcc:world-environment-events` (with the gate's code when it refused); observation posts by "Environmental desk" (`js/world-environment-posts.js`, pure and tested) in the Equity Uprise tab with the missions by time and the significant ones in Everything one in six, fires summarised per 1-degree area; the panel's palette as tokens with the day's values in `css/daylight.css` (every measured pair 5.4:1 or better); the honest line and zero posts under 503 and 404. Verified with fixtures only: `node --test` of the lane's suites (115 passed) and `scripts/e2e/world-environment.mjs` at 390, 820 and 1280. Source on this branch: not merged, not deployed; production still answers 503 until the owner enables the module; the production SQL bundle is unchanged and pending (step 5). The globe's own layers are lane L1 of the same slice; the integration pass of the same evening ran the page and the real frame together with fixtures at 390, 820 and 1280 (`scripts/e2e/environment-world.e2e.mjs`, CI suite `environment-world`; `WORLD-ENVIRONMENT.md`, "The integration pass") and fixed three seams on the way (the autostart lost before the frame booted; a ShakeMap's significance never reaching the tour queue; a refused layer reported unavailable after the gate's policy state) and guarded a Cesium 1.131 camera edge that stopped the render loop. The review of the slice at `fe0d53b2` (2026-11-18, twelve findings, four major) is fixed on this branch with a test per finding that fails without its fix (`WORLD-ENVIRONMENT.md`, "Review fixes"): the tour queue follows a significance change, the policy gate's race, the record that speaks for a layer named by id with every record rendered in the panel (the readings' 19:56, never the station catalogue's 08:00), the autostart re-armed by `hu:globe-ready`, the 16 px buttons, no repaint for unchanged words, a pick id per polygon, `via` and the `env-build` hold in the contract, the feed terms carried with the pins instead of a client copy, the Play/Pause toggle, the Cesium camera guard; the trailer-less merge `c7db9b53` is recorded, not rewritten. The release polish of 2026-11-18 (`WORLD-ENVIRONMENT.md`, "Release polish") makes the news tint step aside in the Equity Uprise tab, opens the observation list on two rows with "Show all N observations" and no card for the tour's scenes, and keeps the event Show on globe chose from Global. Its review (five findings, `WORLD-ENVIRONMENT.md`, "Review of the release polish") gives the card back to a scene the visitor steps to with Next or Previous while the tour is not playing and holds the open list still, each fix with a test that fails without it. Still not merged, not deployed, no production answer involved |
| W4 | Sign in and return from every mission entry, with an end-to-end suite | not started |
| W5 | The globe itself: absent-RPC 404s, render resilience and idle cost, keyboard zoom, other globe entries | not started |
| W6 | Productize: public brand sweep, site defects (CMS key, editor gate, null prices, capsule overlap) | not started |
