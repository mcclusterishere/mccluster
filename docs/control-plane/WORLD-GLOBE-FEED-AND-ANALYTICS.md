# The World is the feed: globe-first shell, 60/40 analytics, mission-gated CCTV

Owner direction, 2026-10-15. This file is the inventory taken before the
change and the record of what changed. It sits beside
`docs/action-network/HUMAN-UPRISE-WORLD-FEED.md` (the World screen) and does
not lift any gate in `docs/action-network/EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md`.

Owner's words, as briefed: the globe is the public interface for a logged-out
visitor; for a logged-in member, "remove all the other tabs": the globe
experience is the whole product, "the new feed", and login, profile,
notifications and the rest are reached from the globe. The globe should also
exist on its own, chrome-less: "just zoom in and click on things". The Halo
globe goes into the analytics dashboard. CCTV is for members only after they
are signed in, have given location consent, and have completed a mission;
then (owner correction, same day): "When they come to the website they agree
to the privacy agreement. We get their location. Period." So location consent
is the Privacy Policy acknowledgement (section D). Whip Equipped (owner, same
day): no voter rule; anyone signed in can open it and sign up; rides are not
live yet (section B2).

## A. Inventory (main at 8be51f5, before this change)

### A1. Navigation

| Surface | File | Signed out | Signed in |
|---|---|---|---|
| App bar | `js/tabbar.js` | Music, M, Globe (three columns). Globe goes to `WORLD_ORIGIN` (`https://mccluster.org/?view=feed`) from Matthew's site, `/?view=feed` on a World host. | The same three columns (`paintAuthState` removes any `data-member-tab`). The auth chip links to the World profile. |
| World screen | `mnet.html` + `js/mnet.js` + `css/mnet.css` | Globe (frame) / context strip / public feed. Header: wordmark, search, Sign in, Join from 600px. | Same composition, the member's own feed. Header: search, bell (alerts), avatar menu: View profile, Messages, Settings & account, Sign out. The house bar floats over the feed (`barClearance`). |
| Globe frame | `action-globe.html?embedded=1&surface=network` + `js/action-globe.js` | Earth, public pins, region outlines, Near me, Flights toggle; Satellites and Launches locked. | Same, Satellites and Launches unlocked (Worker checks the bearer, `world-layers.js`). Creator: Your audience. |
| Full world | `action-globe.html?explore=1` | Earth edge to edge, "← World", controls, data toggles, credit, the mission sheet above the bar. | Same. |
| Standalone route | `action-globe.html` (no flag) | Redirects to `mnet.html?view=feed` (keeps `?song=`). | Same. |
| Legacy guest globe | `guest-globe.html` + `js/guest-world.js` | A plain OSM Cesium Earth with "Sign in to unlock data". Only `index.html` references `js/guest-world.js`; `index.html` is not touched here (AGENTS.md rule 3). | Hidden (`guest-world.js` hides the panel when a session exists). |
| PRIM3 nav | `js/prim3-nav.js` | Swaps the M for the PRIM3 tab mark on PRIM3 pages and routes it to `prim3.html`. Not part of the World. | Same. |
| World first (#434) | `js/mnet.js` | — | A member with an unfinished profile still gets the World; the step waits in `#mnFinishCard`. |
| Never globe-less (#435) | `js/mnet.js` | — | A 401 or any bootstrap failure still opens the Earth and the public posts. |
| World hosts | `workers/mccluster/src/world-host.js`, `company-site/router.js`, `human-uprise/router.js` | `mccluster.org/` serves `mnet.html` with the company head (inert until the apex is routed). | Same, with the sign-in handoff. |

Tabs that exist: the bar's three columns. The World has no second tab row
(removed 2026-10-14). The Control Room (`control.html`) has its own operator
rail (Home, AI, Work, Create, Analytics, System, Apps); it is not public
navigation.

### A2. Analytics surfaces

| Surface | Who | What | Data |
|---|---|---|---|
| **Control Room → Analytics** (`control.html#analytics`, `js/control-room/analytics.js`, `css/control-analytics.css`) | House owner / desk. `analytics.html` and `insights.html` send an operator here (`js/owner-control-redirect.js`, `/v1/status` 200). | Tabs Overview, Audience, Adaptive, Content, Identity, Forensics, Setup; one range (24h, 7d, 30d, 90d, All, Custom); property picker. | Supabase RPCs (security invoker over `events_lean`; RLS "only the desk reads it", plus "analytics owners read site events" for a tenant's own site) and owner-only Worker routes. |
| `analytics.html` (`js/analytics-board.js`, `analytics-suite.js`, `analytics-product.js`, `analytics-users.js`, `insights.js`) | A signed-in analytics site owner who is not the operator (tenant websites). | Overview, Traffic, Audience, Content, Identity, Users, Setup. | The same RPCs, scoped to the tenant's `site_id` by RLS. **Unchanged by this work.** |
| `insights.html` | — | Redirect to `control.html#analytics`. | — |
| `creator-landing-analytics.html` | — | Says no verified numbers are connected; not linked (2026-10-14). | None. |
| Member self-service (`js/music-self-analytics.js` on `creator.html`; Your audience on the World globe) | The member, about themselves. | Own listening; a creator's own page views, plays, shares; page views by country. | `/v1/analytics/my-listening`, `/v1/analytics/my-creator` (30 days, sampled, country only, countries under `AUDIENCE_MIN_VIEWS` folded into "elsewhere", unknown disclosed). |
| Collector | Every page (`js/analytics.js`); other websites (`js/mc-analytics.js`, served as `api.mccluster.org/a.js`). | Events: `page_view`, `page_leave`, `scroll_depth`, `click`, `dead_click`, `rage_click`, `exit_intent`, `copy`, `form_start`, `form_submit`, `js_error`, `js_rejection`, `network_change`, `device_power`, `location_permission`, `precise_location`, plus `acquired` once per visit and the media events (`album_play`, `song_start`, `music_*`, `track_*`, …). | `POST /v1/collect` (Worker adds Cloudflare geo headers: country, region, city, latitude/longitude, colo) → `public.events`, copied to `public.events_lean`. GPC / DNT visitors are counted without identifiers. |

**Attribution path.** The collector writes one `acquired` event per visit:
`src` = `utm_source`, else the referrer's hostname (`x.com`, `t.co`, …), else
`direct`; `med` = `utm_medium`, else `referral` / `none`; `cmp` =
`utm_campaign`; it rides on later events as `props.acq`. Identity joins an
account to the device it signed up on and to the last song the device heard
in the 7 days before (`/v1/analytics/identity`).

### A3. Every Control Analytics metric, classified

GLOBE = drawn on the globe; PANEL = panel only; BOTH = a panel card and a
globe layer, synchronized. Geo precision is what the data can support today.

| Metric / card | Source | Filters it honours | Class | Why | Geo precision available | Privacy treatment |
|---|---|---|---|---|---|---|
| Page views, Visitors, Sessions, Events (KPIs) | `analytics_totals` | range, property | PANEL | Totals; the globe's located/unknown split is computed against Page views | country via `analytics_top` | aggregate only |
| Traffic trend (hourly / daily) | `analytics_hourly`, `analytics_daily` | range, property | PANEL | Time series, no place | none | aggregate |
| Acquisition sources (donut) | `analytics_top(source)` | range, property | PANEL | Referrer is not a place | none | aggregate |
| **Geography** (donut, top 12) | `analytics_top(country)` | range, property | **BOTH** | The page-view country layer is the same dimension (top 100) | Country (Cloudflare IP country). Raw events also hold IP-derived region/city/lat/lon, which are approximate and are **not** drawn | Country only; under 5 folded; located vs no-country disclosed; no country without a label point; never 0,0 |
| Page performance | `analytics_page_performance` | range, property | PANEL | Per path | none | aggregate |
| Networks | `analytics_top(network)` | range, property | PANEL | Connection type / ASN org | none | aggregate |
| Music leaderboard, Track detail, Reach vs repeat, Music quick view | `analytics_content` | range, property | PANEL | Per track | none | aggregate |
| Content / media event mix | `analytics_content_events` | range, property, **event type** (readout) | PANEL | Per event name | none | aggregate |
| Conversion funnel | `analytics_funnel` | range (first-party) | PANEL | Stage counts | none | aggregate |
| Acquisition quality, Paths | `analytics_acquisition`, `analytics_paths` | range, property | PANEL | Source / path | none | aggregate |
| Audience science (profiles, signals, affinity, ledger, method) | `/v1/analytics/audience-science` | range | PANEL | Behavioural features, no place | none | owner-only; no ideological or personality labels (unchanged) |
| Adaptive (decisions, policies, experiments) | `/v1/analytics/experience` | range | PANEL | Ledger | none | owner-only |
| **Identity** (accounts, Source → track → account, songs) | `/v1/analytics/identity` | range, **region**, **source** (paths and account list) | **BOTH** | Sign-ups by country is a globe layer | Country at sign-up (IP-derived). The owner-only account card keeps showing city/region/IP as before | Globe: country only, under 5 folded, no-country disclosed. Account details stay in the owner-only card, never on the globe |
| Business (accounts, music plays, sales, bookings) | `/v1/analytics/business` | range | PANEL | Totals | none | owner-only |
| Forensics (sessions, visitors) | `js/control-room/forensics.js` | range | PANEL | Per session | IP-level exists | owner-only; never on the globe |
| Setup (pixel, DNS, pulse) | `analytics_sites`, `events_lean` | property | PANEL | Configuration | none | — |
| Intel events (intel geo aggregate) | `GET /v1/intel/geo` (PR #438, ships switched off) | range (≤ 92 days), layer | GLOBE | Spatial by nature | 1/5/10/30° grid cells × hour/day/week | Cells, never points; k=5 for non-owners server-side, under 5 folded here; located / unknown / suppressed disclosed; honest empty state while switched off |

The access rule does not change: everything above is the operator's (or a
tenant site owner's, on `analytics.html`). Members see only their own
self-service numbers (above).

## B. Globe as the feed

- **Logged out:** unchanged. The globe is already the public front door at
  `https://mccluster.org/` (once the apex is routed) and the World screen at
  `mnet.html?view=feed`; the bar's Globe leads there.
- **The bottom app bar never leaves** (owner correction, 2026-10-15). An
  earlier draft of this change hid the bar for signed-in members on the World
  and the Full world and moved Music into the avatar menu; that is reverted.
  The bar (Music | M | Globe) is on every experience: the World, the Full
  world, just the globe, and the analytics globe's host. Music stays in the
  bar. The World's header (search, bell, avatar menu: View profile, Messages,
  Settings & account, Sign out) is the member's chrome above it.
- **Just the globe:** `action-globe.html?explore=1&chrome=0`. No toggles, no
  controls, no "← World": the Earth, the pins, the mission sheet only once a
  pin is tapped, and the bottom app bar. The imagery credit stays (the
  licences ask for it) at a smaller size. One small corner control and Escape
  bring the chrome back. Reached from the Full world's "Just the globe" pill.
- **Control Room (`control.html`) carries the shared bar now** (owner,
  2026-10-15, section C3: admin first). The shared bar wins on a phone; the
  Control Room's own bottom row becomes a row of rooms under its topbar
  (Home, Work, Create, Analytics, System), hidden on the Analytics surface,
  and from 761px the rail is the navigation as before.
- Not changed: `index.html`; the bar on Matthew's other pages.

### B2. Layers by level (owner, 2026-10-15, second direction)

> **Since 2026-10-21:** every optional layer is owner-only (the release guard), and the house owner's full-screen globe carries
> Hitman's Halo: more layers, visual modes, a telemetry HUD, place search, photoreal 3D and follow. See `HALO-ADMIN-GLOBE.md`.

"Logged-out public: the globe and exactly one free layer. All other layers
and controls stay visible but shaded; clicking a locked one opens the login
prompt." Access is data-driven per level: public / fan / creator-business /
E=Up / fellow / owner. (The "fellow + transport" level and its voter rule
are cancelled, owner 2026-10-15.)

- **The one free layer is Flights.** It is the most open source the World
  already serves without a session (OpenSky's anonymous snapshot through
  `GET /v1/world/layers/flights`). The Earth itself and the admin-approved
  public mission pins are the World's base content, not a data layer, and
  stay public as before.
- **`GET /v1/world/access`** (`workers/mccluster/src/world-access.js`) answers
  `{level, levels, unlocked_layers[], locked_layers[{id, reason, next_step}],
  layers}`, `private, no-store`. Levels come only from what can be verified
  today: *public* (no session), *fan* (a Supabase user), *creator_business*
  (an active `music_creator_profiles` row via `m_auth_user_links`; business
  accounts are a TODO), *owner* (house `org_members` role owner). *eup* and
  *fellow* are named `LADDER_HOOKS` that return false
  until `docs/control-plane/POLICY-FELLOWSHIP-LADDER.md`
  (feat/policy-fellowship-ladder) defines a verifiable rule: no fake grants.
  CCTV is reported with the three checks above, not as a level. The answer
  also carries `approximate_location` (`source: "ip_approximate"`, country,
  region, city and coordinates rounded to 0.1°, from Cloudflare's
  `request.cf`; omitted rather than 0,0; never stored), which "Near me" flies
  to first.

| Layer | Opens at | Today |
|---|---|---|
| Flights | public | The one free layer |
| Satellites, Space missions | fan | As before (Worker checks the bearer) |
| Intel events | fan | `GET /v1/intel/geo` with the member's session (members audience, k=5). The API also serves the public, but only one layer is free. Cells drawn as cells; located / unknown / suppressed and sources on the layer line; switched off today, said honestly. |
| Music | fan | **No source with a real place exists yet** (creator profiles hold no location; the GDELT news ingester has no music topic and its RPCs allow only world, policy, climate, health, technology; listener geography is the owner's private analytics). The toggle says so and draws nothing. Unblocking it needs either a `music` topic added to `public-gdelt-news` and the three media RPC / table allowlists (headline-country pins, coarse and labelled as such), or a creator-supplied, consented home city. |
| CCTV | fan + privacy acknowledged (= location consent) + a completed mission | Section D |
| Your audience | creator_business | As before (the creator's own country counts) |
| Whip Equipped transport | fan (any signed-in member) | **Whip Equipped LLC**, Matthew's separate company, not a McCluster Corp brand: labelled as that company's, no McCluster branding, no mark drawn. Guests see it shaded and are asked to sign in. Opening it says "Whip Equipped rides aren't live yet", offers no ride request, and asks "Are you a driver, or know one? Have them sign up today" with a link to Whip's own Driver app (`https://matthew.mccluster.org/whip/driver/`), noting that signing up is an application and Whip's own checks (licence, insurance, background check, local rideshare rules) decide who drives. Same rule as the ladder's `whip_transport_partner` (`signed_in`, PR #440). The access map carries `service_live: false` and `driver_signup_url`. |

- **The page** (`js/action-globe.js`): every layer toggle is on screen for
  everyone except on the analytics surface; a locked one is shaded with a
  red dot (`is-locked`, `aria-disabled`, `data-lock` = the reason). A guest's
  tap sends `hu:ask-sign-in` (the World's sign-in prompt with the reason and
  a way back; on the Full world, the sign-in line); a member's tap explains
  what unlocks it (the CCTV checklist); Whip Equipped opens its not-live
  sheet. If the access map
  cannot be read, the page applies the same rule from the session alone.
- **Fans and the Action Network:** a signed-in fan already reads the World
  feed and mission activity; joining, posting and proving keep their own
  server-side gates. Nothing changed there.
- **Not done here (remaining):** a music-news filter in the panel / feed (no
  music news is ingested yet, see above).
- **Copy pending the owner:** tagline "Get Your Hu Up!". The owner confirmed
  the direction: it leads with the **dual statement, both meanings
  together**: from a Black perspective, get in the sun, Black is beautiful;
  and in general, Hu Up = a human up to the task. Recorded only; no new
  marketing copy ships in any UI until the owner approves the final
  wording.

## C. The Analytics tab, 60/40

`js/control-room/analytics.js` now mounts a shell once: the globe
(`action-globe.html?embedded=1&surface=analytics`, same origin) and the
panel. Phone first: the globe on top (about half the screen), the panel
stacked under it with a "Hide the panel" fold. From 64rem: about 60% globe /
40% panel, the split one screen tall: the panel scrolls beside the globe, which stays put. The panel's columns now
follow the panel's own width (`@container cra`, the same 36rem / 54rem
steps), so cards stay readable at 40%. The Control Room keeps the analytics
mount between its own repaints (`js/control-room-v2.js`), so the Earth does
not reload on unrelated state changes.

Every existing card, query and meaning is unchanged. New, in the panel:

- **Shared filters:** Layer (Page views by country · Sign-ups by country ·
  Intel events), Region (country), Source,
  Event type, Program / mission (disabled, not in the current reads). The note
  under them says exactly what each applies to; page views cannot be split by
  source or below country with the current reads, and the panel says so.
- **On the globe** card: on the globe / under 5 / no country / total, the
  selected country's value and share, and the ranked list of drawn countries.
- **Selection both ways:** tapping a country on the globe posts
  `hu:analytics-region` to the panel (same-origin, `event.origin` and
  `event.source` checked), which sets the Region filter; tapping a row in the
  On-the-globe list (or choosing a Region) posts `hu:analytics-points` and
  `hu:analytics-select`, and the globe highlights and flies there.
- **Privacy:** country only; under 5 folded; located vs unknown always on
  screen (`located + under 5 + no country = total` for page views); a country
  without a Natural Earth label point (`data/geo/country-label-points.json`)
  is counted as unknown, never placed; no 0,0. The frame fetches nothing:
  it draws what the owner's session already read.
- **Intel events layer, by contract:** `GET /v1/intel/geo?since&until&cell=10&bucket=day`
  (`docs/control-plane/INTEL-TO-MISSION-CANON.md` §5, PR #438, schema
  `mccluster-intel-geo/v1`; the owner's session gives the owner audience).
  The window is clamped to the API's 92 days; cells are summed over time
  buckets and drawn as **cells** (rectangles from `cell_bounds`), never as
  points; cells under 5 are folded in the panel too; `located`,
  `unknown_location`, `suppressed_records` and the attribution list are shown.
  The endpoint ships switched off (`503 intel_schema_not_ready`): the layer
  then says "The intel plane is not switched on yet" and draws nothing.
  Program / mission stays a disabled filter: none of the current reads can
  be sliced by mission.

### C2. The charcoal analytics screen (owner, 2026-10-15, second pass)

Owner: "This is what analytics should aspire to look like, exactly, on
vertical phone. A custom globe of exactly the real globe, segmented like this
(country borders). Charcoal interface. Select the globe, select locations, go
there on the globe to see what analytics exist there; filter everything …
Also repair backend capabilities that aren't seen and get them visualized.
Admin first; push features down to other users later."

- **One globe, drawn in the page.** The iframe of the World's globe is
  replaced by one Cesium widget (`js/control-room/analytics-globe.js`): the
  same Cesium release as the World, but no imagery, no terrain, no ion and so
  no paid map: a charcoal ellipsoid, the Natural Earth 1:110m country
  polygons (`data/geo/country-boundaries-110m.json`, public domain,
  natural-earth-vector v5.1.2, built by `tools/build-country-boundaries.mjs`;
  a neutral file the World can share) with lighter borders and a faint
  graticule. `requestRenderMode` draws only on change; the canvas renders at
  most two device pixels per CSS pixel. The World's `surface=analytics`
  handlers in `js/action-globe.js` are left in place and unused.
- **What it draws** (superseded by C4 on 2026-10-16: no choropleth, no
  glows, no arcs, no legend) was the layer aggregate from section C and
  nothing finer. No point without a label point, never 0,0.
- **One selection.** A tap on a country, the country menu in the floating
  pill, a row in "On the globe", and Clear all set the same state: the globe
  colours and flies (no flight under reduced motion), the tooltip reads
  "United States · 61 page views", the pill counts filters, the summary line
  reads "24 hours · Page views · All sources  Clear", and the cards narrow.
- **Cards** (swipeable, dots; two at a time from 48rem): Reach (page views,
  with Views / Sources / Returning), Sign-ups, Music; Audience (Visitors with
  New vs Returning, Locations with located / under 5 / no country, Networks),
  Journeys, Site health; Action (Missions, Community). Every earlier card,
  query and tab is under **Details**, unchanged.
- **Reads that existed and no screen showed**, now visualized (owner only):

  | Read | What it adds |
  |---|---|
  | `GET /v1/analytics/visitors?limit=1` (`analytics_visitor_list` counts) | returning visitors (more than one session) and new vs returning |
  | `GET /v1/analytics/flows` | sessions, bounce rate, pages per session, top way in |
  | `GET /v1/analytics/errors` | script errors (site vs injected), dead / rage clicks, blocked journeys (incl. `gated_preview_end`) |
  | `rpc/action_mission_stats` | mission joins, in progress, proof submitted, admin-verified, rejected (all time) |
  | `/v1/analytics/business` fields already read but not shown | previews vs full listens vs completions, paid orders, sign-ups per day, confirmed and active members, Human Uprise posts / reactions / follows / profiles |

- **Pending, not applied:** `supabase/pending/analytics_country_v1.sql`
  (`analytics_country_totals`, `analytics_country_series`; security invoker
  over `events_lean`, country only, bots excluded, anon revoked; behaviour
  test `scripts/test-analytics-country-db.sh`). Until it is applied the
  screen shows a country's page views (from `analytics_top`) and says
  "Visitors by country need analytics_country_v1 (written, not applied)";
  the trend stays worldwide and is labelled so.

### C4. Every country and every state, one selection (owner, 2026-10-16)

Owner: "each selected country to be mapped accordingly and each state mapped
accordingly across the countries so that when I'm looking at that individual
place it can show me where on the planet it is when it's selected either from
the console or the globe itself." Then: "a little glow outline of the globe
… I just don't need arcs and other stuff, just modern selection"; "a grey
sphere that only lights up when selected boundaries are selected"; the
boundaries "realistically drawn and proper". State granularity is approved
for the ADMIN analytics view only.

- **A grey sphere.** One soft light from just above-left of the viewer shades
  the sphere toward its limb at every zoom; the glow rim is CSS
  (`--an-rim`). Land is one grey, slightly lighter than the sphere, with
  hairline borders. Nothing unselected is coloured: no choropleth, no dots,
  no arcs, no legend. Values feed only the selected place's label.
- **Accurate geography.** The world is Natural Earth 1:50m Admin 0 Countries
  (242, small islands included) with the large 1:50m lakes cut out of the land
  (`data/geo/country-boundaries-50m.json`, delta-encoded hundredths of a
  degree, `node tools/build-country-boundaries.mjs --scale 50m`). The
  selected country is redrawn at 1:10m: the dissolve of its own 1:10m states,
  so the country edge and its state edges are one line
  (`data/geo/admin1/<CC>.json`, `tools/build-admin1-boundaries.mjs`; the
  10m source is simplified once with mapshaper, topology-preserving, 10%,
  keep-shapes).
- **States and provinces for every country** (Natural Earth 1:10m Admin 1,
  239 country files): fetched only when that country is selected, cached,
  and their lines drawn for that country only. Only `control.html` loads
  `js/control-room/analytics-globe.js`; the public and member globes never
  load these files (names, codes, polygons) or the region read. They draw
  state LINES only, from their own derived files (C5).
- **One selection** `{country, state}`: the location menu (all countries;
  the selected country's states listed under it as "US/US-CT"), the rows,
  Clear and a tap on the globe all go through `pickPlace()`, and the globe is
  told `select({country, state}, fly)`. The selected shape fills with a soft
  `--an-accent` and one crisp bright edge (no wide glow line: it spikes on a
  jagged coast; no pulse); inner state lines are a faint darkened-accent
  hairline; a selected state's country keeps a medium accent edge. The camera
  (0.8 s, eased; a jump under reduced motion) turns a country to face the
  viewer and keeps the WHOLE sphere floating in the stage; only a state that
  would be under about 40 px across is approached, from a 40° angle, so the
  curve of the Earth stays in the top of the view. A small dark-glass label
  shows the name, the parent country for a state, and the page views; a white
  dot marks the label point. A tap on a state of the selected country selects
  the state (again: back to the country); the selected country again clears.
  Clear returns to the world view.
- **State counts, admin only.** Nothing new is collected: `public.events`
  already stores Cloudflare's `region` (name) and, in `edge`, `cf-region-code`
  (both nulled for a Global Privacy Control / Do Not Track visitor).
  `supabase/pending/analytics_region_v1.sql` (written, NOT applied) adds
  `analytics_region_totals(country, since, until, site)`: service_role only,
  regions under 5 page views folded into one row inside the database, no city,
  postal, coordinates or IP. `GET /v1/analytics/regions` (house owner only)
  calls it and folds again. Rows match shapes by code, then name, then Natural
  Earth's grouping (a UK nation over its councils, a French region over its
  departements); a row that matches nothing is counted as unmatched, never
  placed. Until the read is applied the route answers `pending: true` and the
  label and caption say "State counts not collected yet"; the shapes stay
  selectable. Behaviour test: `scripts/test-analytics-region-db.sh`.
- **One accent.** `--an-accent` (css/control-analytics.css) drives every red
  on this screen: the selection, the chart line and area, the bars, the
  active segment (`--an-accent-ruby`), the filter count, Clear and the
  current card dot. The globe reads the same tokens through the browser, so
  the accent swaps from one place.
- **Polish (2026-10-16, second pass).** Land a clear step lighter than the
  sphere; coast and border hairlines a small step lighter than the land, with
  MSAA and FXAA; a smaller header on a phone; the shared bar's "Admin" chip sits
  in the header row on this screen so it never covers a card. The Japan
  sawtooth in the screenshots was the e2e fixture (it alternated 0/1/2 for every
  country but the US), not the chart or the bucketing; the fixture now scales
  the hourly shape to each country's total.
- **Payloads** (bytes, raw / gzip -9): world 1:50m 602,872 / 189,291; a state
  file: US 100,552 / 26,655, Japan 36,784 / 8,539, Germany 15,379 / 4,225,
  Russia (largest) 228,452; all 239 state files together 3.57 MB / 0.91 MB,
  never downloaded together.
- **Attribution.** Made with Natural Earth. Free vector and raster map data
  @ naturalearthdata.com. Public domain ("No permission is needed to use
  Natural Earth"); natural-earth-vector v5.1.2. Recorded in each data file and
  in `data/geo/admin1/index.json`.

### C5. The World globe's borders and states (owner, 2026-10-20)

"The map needs to be clearly defined with clearly defined borders, and even
within the countries clearly defined states within the countries, drawn
accurately." (The same message: "I saw a post in Russia posted somewhere else
on the map.")

- **Countries at 1:10m, US point of view.** `data/geo/world-countries-10m.json`
  (243 countries, Natural Earth `ne_10m_admin_0_countries_usa` simplified to
  10% with mapshaper, delta-encoded hundredths of a degree;
  `tools/build-world-countries.mjs`) replaces the World's 1:110m file, which
  had no shape for 72 countries (Singapore, Hong Kong, Bahrain, Malta, Monaco,
  Andorra …) and put Geneva in France and Windsor in the United States. The US
  view matches the gazetteer GDELT's place names come from, so a Crimea story
  that says "Ukraine" is pinned inside the drawn Ukraine. Drawing a border is
  not a statement on any dispute.
- **Land borders drawn once.** `data/geo/world-borders-10m.json`, the lines two
  countries share; the coastline is the imagery's. They are the map, not
  decoration: they stay while the camera comes down and give way below 700 km,
  where the street map or aerial imagery (with its own borders) is the subject.
  Flags, labels and the US ribbon keep their fade.
- **States, lines only.** `data/geo/world-states/<A2>.json` +
  `index.json` (`tools/build-world-states.mjs`): the edges two states of one
  country share, derived from `data/geo/admin1` (same topology, so a state line
  meets its neighbours exactly). No names, codes or data travel with them.
  Where Natural Earth's first level is a finer unit, the well-known level is
  drawn instead (France's regions, Italy's regions, Spain's communities, the
  Philippines' regions, the UK's four nations …; `GROUP` in the tool). The globe
  fetches a country's lines once the camera is below 7,500 km and the country
  is in view, and always for a selected country. A state goes with the country
  whose drawn shape its label point falls in, unless that point is within half a
  degree of its own country (so Crimea is Ukraine's, but San Marino's
  municipalities stay San Marino's).
- **A state, by double tap** (owner, 2026-10-21: "once you've selected a
  country ... select a state thereafter, but only after selecting the country
  already and double tapping the state").
  - **Data.** `data/geo/world-state-areas/<A2>.json` (same tool, same
    countries as the index) carries each state as a shape with its name. A
    grouped country's state is its group, made of its units' shapes, so the
    shape tapped is the one the lines draw. The globe fetches a country's file
    when the country is selected.
  - **Taps.** With a country selected, a double tap inside it picks the state
    under it: the state is lit and outlined, and the card names it with its
    country. A double tap on the picked state, a single tap inside the country,
    or the card's × goes back to the whole country.
  - **Unchanged.** A single tap with no state picked lets the country go, as
    before, once the 350 ms double-tap gap has passed. A double tap on a
    country not yet selected selects the country only. Taps are timed by their
    own events (`pointerdown`'s `timeStamp`), so a busy frame cannot split a
    double tap in two.
  - **The feed.** The page is told the state with its shape (`hu:country`'s
    `country.state`). The region label reads "State, Country". Member posts
    carry only their country, so they stay. A state of the country already
    loaded does not load the country's feed again.
  - **A place's own news** (owner, 2026-10-21: "Lombardia said ... 60 something
    in the last 24 hours. Where the fuck are the news articles then? ... if you
    click the state level, it should filter all the news from that state").
    - Local no longer filters the world's first page of news.
    - A picked country reads its own stories from `GET /v1/world/news?country=XX`.
      A picked state reads them with `&bbox=west,south,east,north` around its
      shape, and keeps those whose point falls inside the shape.
    - These are the heat map's own rows and window (the last 24 hours, by the
      country each story is placed in). So the count on the card and the list
      under it are the same stories.
    - Load more pages the place.
    - A place with none says "No news from … in the last 24 hours".
- **The news heat map, not pins** (owner, 2026-10-21: "instead of pins on the
  map ... aggregate each mention of a state or country with a heat map of how
  many articles or mentions it has ... so people aren't just needlessly
  searching for tiny pins").
  - **The counts.** `GET /v1/world/news-heat`
    (`workers/mccluster/src/world-news-discovery.js`) counts the last 24 hours
    of stories by the country each one mentions (ISO, from GDELT's FIPS).
    `?country=XX` gives that country's stories as places on a 0.05° grid
    instead.
    - Only counts and rounded places leave the Worker.
    - It reads a page at a time, up to 15,000 stories (`capped` says when there
      were more).
    - It is kept five minutes per data centre.
    - It answers an empty 200 when the database can't.
  - **The globe** (`js/world-countries.js`) shades each country by its count.
    A selected country shows its states instead, counted from those places with
    the state shapes. The card gives the count, and a legend on the globe says
    what the colours mean.
  - **The pins.** There is no pin per story. The one pin left is the story
    whose place a news card sent ("where is this?").
- **The place card** (owner, 2026-10-21: "shouldn't be the full width of the
  top of the screen ... only in the middle ... how many users ... how many
  news articles ... how many posts from users").
  - **Where.** In the World the page draws it (`#mnPlaceCard`, `js/mnet.js`
    `paintPlaceCard`), centred under the bar, at most 300px wide and two rows
    tall. The globe's own card is hidden there. The corner buttons and the Live
    badge step down below it together; the headline hides while the card is
    over it. The × lets the state or the country go.
  - **The three counts** (`statsFor` in `js/world-countries.js`; a state shows
    its news, and its members for the house owner). A dash means not known yet.
    - **News · 24 h**: the heat map's count for the country, or the state's.
    - **Posts**: public, top-level member posts placed in the country
      (`network_posts.country_code`), counted by the same `news-heat` call as
      `posts`. It is `null`, so a dash, until place scope is on
      (`supabase/migrations/20261021173729_world_place_scope_v1.sql`, applied, and
      `WORLD_PLACE_SCOPE_ENABLED=true`). It reads up to 5,000 placed posts; more
      than that answers `null` too, never a part passed off as the count (an
      aggregate in the database is the next step at that size). A day with no
      stories still carries the posts: the globe takes any good answer, and
      only shading shows the legend.
    - **Members** (owner, 2026-10-21: "It should just count how many people
      have logged in with an account from that IP region. Make it exact down to
      the state. So you can filter state versus country in that way of how many
      user accounts"). `GET /v1/world/members`
      (`workers/mccluster/src/world-members.js`) counts accounts by the IP place
      of their latest signed-in visit, once each, over the last 400 days.
      - **Source.** `public.world_member_regions()`
        (`supabase/pending/world_member_regions_v1.sql`, service role only)
        reads what `public.events` already holds: Cloudflare's country, region
        code and coordinates for the visit. Nothing new is collected. A Global
        Privacy Control or Do Not Track visit has no account and no
        coordinates, so it is never counted. Bots and deleted accounts are not
        counted.
      - **The house owner** (the session checked with Supabase and
        `org_members`) gets every country's exact count, the total, and the
        places rounded to hundredths of a degree with their region code. The
        globe counts each state from those: a region code that names a state
        (US + CT is US-CT) counts there, and any other place counts in the
        state shape it falls in (Italy's regions, England, Kenya's provinces).
        A picked state shows its members on the card.
      - **Everyone else** gets the countries with five or more and nothing
        finer. A smaller country reads `<5`; a state shows no members count.
        This keeps the floor the public count has always had.
      - **Before the function is applied** the route answers `unavailable` and
        the card shows a dash. The old count
        (`action_globe_public_regions`, built from
        `action_globe_member_regions`, which nothing writes to) is no longer
        read for the card. It still places mission pins.
      - **Coverage.** Location capture started on 2026-09-27. An account last
        seen before then is counted on its next visit.
- **One heat scale for the World and Analytics** (`js/heat-scale.js`; owner, of
  Analytics: "lackluster ... the shading isn't dynamic enough").
  - **What changed.** The old shading was value ÷ the largest value,
    square-rooted, so one big country pushed every other one into the bottom
    fifth.
  - **The level now.** A value's level is half its rank among the places that
    have any, and half its size on a log scale. Ties share a level, and the
    least is faint but never invisible. A place with none has no level and is
    never filled.
  - **The World's ramp** is semantic heat: crimson through orange to pale
    gold, rising in lightness at every stop. It also runs from nearly clear to
    solid (owner, 2026-10-21: "If there's no news about a region, it should be
    no color ... It should be going no color to color").
    - The least news is a breath of red.
    - The most is unmistakable.
    - The legend bar shows the same see-through ramp.
  - **Analytics' ramp** runs from the land's own grey straight to the accent's
    full red, with no paler tint past it (owner, 2026-10-21: "things that are
    not doing well should be gray, the same color as a globe, and things that
    are having more shit going on should be red"). Its legend bar is the same
    two stops in CSS.

### C3. The owner's five-tab bar (admin first)

For the house owner only (`GET /v1/status`, the Control Room's own owner
check, remembered for ten minutes in this tab's `sessionStorage`, tied to the
signed-in user), `js/tabbar.js` widens the bar to Play (the player), Home
(`control.html#home`: the Control Room is the admin back end), the M
(`assets/img/m-mark.png` as supplied, scaled, no plate), Analytics
(`control.html#analytics`) and Globe. Everyone else keeps Music | M | Globe.
Wings (held press) do not open on the five-tab bar.

**Integration point** for other bar add-ons (the member Desk tab, PR #457):
the dock carries `appbar--admin` and body `data-appbar-admin`; an add-on that
would add a sixth column checks
`if (dock.classList.contains("appbar--admin")) return null;` and lives under
Home instead (the Control Room's account menu links the Desk:
`mnet.html?view=feed&desk`). The `mcc:appbar-admin` event fires on change.

## D. Mission-gated CCTV

Worker module `workers/mccluster/src/world-cctv.js`, routed from
`src/index.js` after the World layers (the OPTIONS preflight is answered
first, as for every core route).

| Route | Who | Answer |
|---|---|---|
| `GET /v1/world/cctv/eligibility` | anyone | `{eligible, checks:{signed_in, privacy_acknowledged, mission_completed}, reason, privacy_version, privacy_url, approximate_location, missions_url}` |
| `GET /v1/world/cctv/sources` | eligible | Halo's camera records, trimmed to public fields; positionless or 0,0 cameras dropped and counted. |
| `GET /v1/world/cctv/frame/:id` | eligible | One live snapshot, only if Halo marks it `x-cctv-source: upstream-image` and it is a raster image. Street View and synthetic fallbacks: `502 no_live_frame`. Passes `content-type`, `x-cctv-source`, `x-cctv-provider` (from the record if Halo omits it), `x-cctv-captured-at`, `last-modified`, adds `x-cctv-retrieved-at`, `x-cctv-upstream-date`, `x-cctv-license`. |

- **The three checks, on every request** (no per-member cache; Halo's
  contract, `docs/AUTH-BOUNDARY.md` on hitmans-halo PR #23):
  1. *signed_in*: Supabase `auth/v1/user` accepts the bearer.
  2. *privacy_acknowledged* (**location consent is the privacy
     acknowledgement**, owner 2026-10-15). The member's own Supabase auth
     record (`user_metadata`) has `privacy_policy_version` equal to the
     current version (`2026-10-19`: `PRIVACY_VERSION` in `world-cctv.js`,
     `VERSION` in `js/live-content.js`, `MCC_PRIVACY_REQUIRED_VERSION` in
     `js/analytics.js`; a test pins all three) and a parseable
     `privacy_acknowledged_at`. Where it lives: the join flow writes both
     fields at sign-up (`js/action.js`). Production on 2026-10-15: 110 auth
     users, 33 with the current version on record. The site-entry notice
     (`js/live-content.js`, `mcc_privacy_ack`) is browser storage and a
     cookie the Worker does not read, so on its own it does not count here.
     Agreeing to that notice while signed in also writes the same two fields
     to the member's record (owner, 2026-10-20: the notice is shown once per
     version, on any McCluster host); the other members record theirs with
     one tap on the CCTV lock ("I agree to the Privacy Policy"), which writes
     the same two fields to their own record with their own session (`PUT
     /auth/v1/user`). `privacy.html` already discloses the automatic
     IP-derived country/region/city and that precise device location is read
     only when the browser permission is granted. The separate
     `world_location_consents` table, its pending SQL and the
     `POST`/`DELETE /v1/world/location-consent` routes are removed.
     **Which location:** the IP-derived approximate location Cloudflare
     attaches to the request (`request.cf`), never stored; precise GPS only
     through the browser's own permission prompt, which browsers enforce and
     this code does not try to get around.
  3. *mission_completed*: **the one predicate, identical to PR #444's
     `public.action_member_verified_mission_count()`** in
     `supabase/pending/mission_admin_approval_v1.sql`: a verified assignment
     on a mission that is not a clip,
     `where a.user_id = p_user and a.status = 'verified' and coalesce(m.kind, 'civic') <> 'clip'`.
     The Worker reads it through PostgREST as an inner join
     (`select=id,action_missions!inner(kind)&action_missions.or=(kind.is.null,kind.neq.clip)`);
     `world_cctv_eligibility.behaviour.sql` copies the same WHERE clause and
     proves a verified clip does not count. An assignment becomes `verified`
     only when an admin reviews its proof (`review_action_proof`; never one's
     own proof; no auto-verify path). **Production had 0 verified
     assignments on 2026-10-15, so no member qualifies today.**
- **Nothing for anyone not eligible:** 401 / 403 with the reason and the
  checks; Halo is never called on their behalf. Every response is
  `cache-control: private, no-store`, `vary: origin, authorization`.
- **Halo, server to server:** `HALO_API_BASE` (default
  `https://prime.mccluster.org`, https only) with `x-halo-internal` from the
  secret `HALO_INTERNAL_TOKEN` (name only; Halo requires 32+ characters). The
  member's bearer is never forwarded. No secret: 503 `halo_not_configured`
  after the eligibility check. A Cloudflare service binding was not used: it
  needs the Halo Worker's service name and a deploy-time config change.
  Halo is fetched with `redirect: 'manual'` (workerd rejects the `error`
  mode, which would have made every eligible request a 502); any 3xx is a
  typed failure, `502 halo_redirect`, and is never followed. A test runs the
  route under Workers fetch semantics (`test/support/workers-fetch-semantics.mjs`),
  and `test/world-ion.test.mjs` scans every Worker source file for the
  `error` mode (the two Seek First adapters are listed as pending PR #441).
- **Frames in the browser:** an `<img>` cannot send `Authorization`, so the
  page reads the frame with `fetch()` and the bearer and shows it from a
  `blob:` object URL, revoked when the sheet closes. No token or signed
  parameter ever rides in a URL.
- **Rate limits:** per member, per isolate, sliding minute: eligibility 30,
  sources 6, frames 60 (`429` with `retry-after`). Best
  effort: Workers spread load across isolates. The camera catalogue (not
  per-member data) is held in isolate memory for 60 s.
- **Globe UI** (`js/action-globe.js`, `ctlCctv`): shaded for guests (a tap
  asks them to sign in; nothing is fetched), hidden only on the analytics
  surface, locked (red dot) for a member who is not eligible.
  The lock opens a sheet with the three requirements, ✓ / ✕ each, and a way
  to meet each: Sign in, "I agree to the Privacy Policy" (records the
  acknowledgement on the member's own record; no position is sent), Find a
  mission (`mnet.html?view=missions`).
  Unlocked, the cameras are green points; a tap opens the live snapshot with
  provider, captured, retrieved, media type and licence, labelled "Live
  snapshot", or "No live frame from this camera right now. Nothing is shown
  in its place."

## Tests

- `workers/mccluster/test/world-cctv.test.mjs`: the eligibility matrix (each
  check failing alone: no privacy record, an older version, no time, no
  verified non-clip mission), no location-consent route, the privacy
  version pinned to the site gate, Workers fetch semantics and a Halo
  redirect refused,
  no leak (no list, no frame, no Halo call) for every failing case, the
  internal header and no forwarded bearer, `HALO_API_BASE`, missing secret,
  live frame headers, Street View and synthetic refused, unknown and
  malformed ids, rate limit, eligibility re-checked on every request, Halo 401 mapped without
  leaking, blob-URL rendering.
- `supabase/tests/world_cctv_eligibility.behaviour.sql` via
  `scripts/test-world-cctv-db.sh` on a scratch Postgres: the mission
  definition through the real `review_action_proof`, the clip exclusion,
  and that no `world_location_consents` table exists.
- `workers/mccluster/test/world-access.test.mjs`: one free layer for a
  guest, every other layer listed locked with a reason and next step, fan /
  creator / owner from records, CCTV reasons, the ladder hooks grant nothing,
  Whip Equipped open to any member (not live, driver sign-up link, Whip
  Equipped LLC only, no voter rule), the approximate location (never 0,0).
- `scripts/test/world-globe-feed-analytics.test.mjs`: the geo aggregate
  (suppression, unknown, totals add up, no 0,0), the sign-up layer with the
  source filter, Intel events by contract (cells, switched-off state), the 60/40 shell and filters, globe
  first, just the globe, the CCTV UI contract, mobile-first CSS.

## Pending the owner

1. Set the secret `HALO_INTERNAL_TOKEN` (the same 32+ character value) on the
   `mccluster` Worker and on Halo's Worker; optionally `HALO_API_BASE`.
2. Nothing to apply for location consent: it is the privacy acknowledgement
   already on members' auth records. CCTV still needs an admin-verified,
   non-clip mission (none in production on 2026-10-15).
3. Deploy the Worker and Pages; route the apex (`DOMAINS-AND-ENTITIES.md`).
4. Approve or replace the tagline candidate "Get Your Hu Up!" before any
   copy ships; supply the ladder rules (E=Up, fellow) and pick
   the Music layer's geo source (above).
5. Decide: should the Control Room carry the shared bottom app bar on a
   phone, where it already has its own bottom navigation? Should Anti-Social level
   completions (no proof row) count as a completed mission for CCTV?
6. Apply `supabase/pending/analytics_country_v1.sql` (visitors and trend by
   country on the analytics screen); until then the screen says it is not
   applied.
7. Apply `supabase/pending/analytics_region_v1.sql` (page views by state
   on the admin analytics globe); until then the globe says "State counts
   not collected yet" and states stay selectable.
8. Licences for live camera feeds stay as recorded in Halo's
   `DATA_SOURCES.md`; restricted feeds (NYC DOT) must stay off.
