# The World feed and public missions: owner direction of 2026-11-17

Status: build brief and resume point. Work happens on `claude/new-session-83ken5`; nothing here is merged,
deployed or applied to the production database. Every production step at the end needs the owner's approval of
the exact change.

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
| PR #726, owner 2026-11-03: the explorer's mission feed and pin detail are owner-only (`css/globe-games.css`) | Mission pins, their detail and their join are public. The games controls stay owner-only. |

## The target

1. **The feed strip** (`#mnFeedScope`, the drag-scrolling row under the globe): Local · Everything (key `global`,
   pressed on load) · Equity Uprise (key `equity`) · Live · News · People. There is no separate Environment tab:
   the environmental globe lives in the Equity Uprise tab (owner, 2026-11-17, latest decision below).
2. **The Equity Uprise tab** shows the owner-supplied PNG only: `assets/img/equity-uprise-mark-white.png` on a dark
   ground, `assets/img/equity-uprise-mark.png` on a light (daylight) ground. Choosing a supplied variant is not
   recolouring. Scale proportionally to the strip's icon size; no plate, filter, crop or visible words. Its
   accessible name is "Equity Uprise". (`AGENTS.md`, "THE LOGOS ARE NOT YOURS TO DRAW".)
3. **Everything** combines member posts, news and missions in one stream. Missions are interleaved at a modest
   ratio (no more than one mission per few other items), each mission at most once per page.
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
    their own suite; not merged, not deployed; production answers 503 until the owner enables the module.
13. **Environmental observation posts**: each environmental event appears in the feed as a post from the system
    (a system author such as "Environmental desk" with a plain icon, never a person and never the logo), the
    same size and shape as any post, stamped with the time the event was recorded (local time and how long ago;
    sorted by it). A source that gives no event time says so and is ordered by its retrieval time, labelled as
    such. Each post: what was observed, where, the measured facts the source gives (magnitude and depth;
    sensor and radiative power; acres; severity, certainty and urgency; wind), the source and its link, coverage
    and status, and "Show on globe". All of them appear in the Equity Uprise tab; significant ones (for example
    an M4.5+ earthquake, a Severe or Extreme NWS warning, an active NHC storm, a large fire perimeter) also appear
    in Everything at a low ratio. Thousands of fire detections are never thousands of posts: they are summarised
    per area. One post per event; a source update edits that post ("Updated" time), never duplicates it.
    State (2026-11-17, slice G1): source on this branch (`js/world-environment-posts.js`, `js/mnet.js`, the panel's
    `mcc:world-environment-events`); verified with fixtures at 390, 820 and 1280 (`scripts/e2e/world-environment.mjs`: the
    posts typed and stamped with the recorded time, the retrieval time labelled when the source gives none, one in six in
    Everything, with the missions by time in the Equity Uprise tab, fires summarised per 1-degree area, Show on globe, zero
    posts under 503 and 404) and by `scripts/test/world-environment-posts.test.mjs`; the significance line is M5.5 or a
    ShakeMap for USGS (the design's constant; this item's M4.5 example is one constant away); not merged, not deployed.
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
   today any pin row makes its mission unjoinable for everyone.
2. Create `public.action_mission_details` and import all 125 Drawdown missions (owner, evening of 2026-11-17: "do
   it"; generated SQL, idempotent).
3. Publish them (status `open`).
4. Place pins the owner chooses.
5. The Environmental Justice module: `eup_module_policy_v1.sql`, then `20261107120000_world_environment_v1.sql`
   (`PROMOTION-ORDER.md`), then the environment module's policy row.
6. Supabase Auth: confirm `https://mccluster.org/**` is in the Redirect URLs (dashboard).
7. `WORLD_PLACE_SCOPE_ENABLED = "true"` in `workers/mccluster/wrangler.toml`, deployed with the rest, once the public-only
   feed QA its comment names has passed (its SQL, `20261021173729_world_place_scope_v1`, is applied).

## Owner decisions (2026-11-17, answered in session)

- **Joining a mission** keeps today's rule: a new member completes the three profile pages (legal name, mailing
  address, phone), then joins instantly through `join_action_mission`. No application step for now.
- **First visit**: the full-screen "Privacy before entry" wall on the World becomes the existing banner mode
  (`<meta name="mcc-privacy-notice" content="banner">`), so the globe and the missions show at once. Analytics stay
  off until the visitor agrees, as before.
- **"Get Your Hu Up!"** is removed from the World's sign-in panel and the `/company` footer, and from anywhere else
  it is public.

## Owner decisions later on 2026-11-17 (the environmental globe)

The owner asked for the Environmental Justice globe to become "a compelling, real-data experience … not a
generic collection of flashing icons", truthful about every source, and "Add a clear environmental entry and
preserve the existing design identity." "Keep observations separate from Project Drawdown-informed actions and
fictional PRIM3 missions." Answered in session:

- **Entry (superseded the same hour, see below)**: a labelled "Environment" tab was chosen first.
- **Shipping**: the environmental work ships with this branch, together with the feed work, once both are verified.
- **Production**: the owner approved applying `supabase/pending/eup_module_policy_v1.sql`. It was applied on
  2026-11-17 as migration `20261117144103_eup_module_policy_v1`; production stored it byte for byte (MD5
  `1f1daee2582fd0a6f3a659350a07491e`, 26,070 bytes; ledger 366 to 367 rows). It creates no policy row: the owner
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

- **All 125 missions are published.** Production steps 2 and 3 carry the whole catalog: the four files of
  `supabase/pending/PROMOTION-ORDER.md` section 10 are the exact change, each applied on its own after its pre-apply
  reads, in order, with its rollback beside it.
- **On load, the country the visitor's IP address shows.** That is the 2026-10-20 release contract
  (`docs/action-network/WORLD-REGION-FEED-RELEASE.md`): with the flag on, the feed opens on Local for the country
  Cloudflare reads at the edge (`request.cf.country`, through `/v1/world/place-scope`), which `js/mnet.js` already
  does (`state.placeScope.home`); an unknown edge country stays on Everything; no GPS, no user-supplied location,
  nothing stored. The flag turns on at deploy time (production step 7). Still in force from 2026-10-20 unless the
  owner says otherwise: a signed-out visitor cannot hop to another country without signing in, which now also
  covers that country's mission and news counts.
- **The clip-campaign door and the Live room's action blocks stay owner-only** ("keep them mine for right now"):
  `hu-travel-off` keeps holding them with Travel; nothing changes.

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
| D1 | Pending SQL: join scope, mission details table, catalog import generator and its tests | done: four pending files with rollbacks (`PROMOTION-ORDER.md` section 10), `tools/build-mission-import.mjs`, `scripts/test/mission-import.test.mjs`, native proof (100 checks) and `scripts/test-mission-pins-db.sh` passed on PostgreSQL 16.15 and 17.7 (production runs 17.6). Review fixes in: 10.1 and its rollback refuse over the whole pins file, the import rollback locks the two references without a foreign key before it counts, every header says to apply as postgres (`apply_migration`), the catalog carries the README's credit display rule, the publish proof keeps a draft outside the catalog a draft. Nothing applied. Whoever first names `action_mission_details` in shipped code adds it to `live-callers.json` `pending_only` |
| W3 | Environmental Justice panel (salvage, daylight, honest unavailable state, browser acceptance) and its production SQL bundle | in progress, as slice G1 lane L2 (2026-11-17; `WORLD-ENVIRONMENT.md`, "The environmental globe, slice G1"): the panel speaks to the one globe in a fixed order (`hu:environment-layers` before the pins, layers off then the pins-off object last on destroy; local patch `G1-PANEL` in `vendor/equity-uprise/product-source.lock.json`), shows per-source health rows for the feed and for the globe's layer states (status, reason in plain words, Retrieved and Last success with how long ago, coverage, attribution, licence, link), the tour and 2D controls, a globe-only selection card with the item's own time labelled, reads the feed once at mount and hands it to the page as `mcc:world-environment-events` (with the gate's code when it refused); observation posts by "Environmental desk" (`js/world-environment-posts.js`, pure and tested) in the Equity Uprise tab with the missions by time and the significant ones in Everything one in six, fires summarised per 1-degree area; the panel's palette as tokens with the day's values in `css/daylight.css` (every measured pair 5.4:1 or better); the honest line and zero posts under 503 and 404. Verified with fixtures only: `node --test` of the lane's suites (115 passed) and `scripts/e2e/world-environment.mjs` at 390, 820 and 1280. Source on this branch: not merged, not deployed; production still answers 503 until the owner enables the module; the production SQL bundle is unchanged and pending (step 5). The globe's own layers are lane L1 of the same slice |
| W4 | Sign in and return from every mission entry, with an end-to-end suite | not started |
| W5 | The globe itself: absent-RPC 404s, render resilience and idle cost, keyboard zoom, other globe entries | not started |
| W6 | Productize: public brand sweep, site defects (CMS key, editor gate, null prices, capsule overlap) | not started |
