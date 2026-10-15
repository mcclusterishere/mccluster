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
are signed in, have given location consent, and have completed a mission.

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
- **Logged in:** on the World (`mnet.html`, every view), a signed-in member
  has **no bar**. `js/mnet.js sizeWorld()` sets `html.mn-globe-only`; the
  house stylesheet (`css/style.css`) hides `.appbar` and the auth chip under
  it, so the house still styles its own bar. The World's header is the
  chrome: search, the bell (notifications), the avatar menu (View profile,
  Messages = inbox, Settings & account = login and the M Account, **Music**,
  Sign out). Music was a bar column, so its door moves into the menu rather
  than disappearing. The bar's clearance is measured after the class is set,
  so the feed runs to the bottom edge. Guests keep the bar.
- **Just the globe:** `action-globe.html?explore=1&chrome=0`. No bar, no
  toggles, no controls, no "← World": the Earth, the pins, and the mission
  sheet only once a pin is tapped. The imagery credit stays (the licences ask
  for it) at a smaller size. One small corner control and Escape bring the
  chrome back. Reached from the Full world's "Just the globe" pill.
- Not changed: `index.html`; the bar on Matthew's other pages (Music | M |
  Globe for everyone). Whether a signed-in member should lose Music and M on
  every page of Matthew's property is a product decision for the owner
  (below).

### B2. Layers by level (owner, 2026-10-15, second direction)

"Logged-out public: the globe and exactly one free layer. All other layers
and controls stay visible but shaded; clicking a locked one opens the login
prompt." Access is data-driven per level: public / fan / creator-business /
E=Up / fellow / fellow + transport / owner.

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
  accounts are a TODO), *owner* (house `org_members` role owner). *eup*,
  *fellow* and *fellow_transport* are named `LADDER_HOOKS` that return false
  until `docs/control-plane/POLICY-FELLOWSHIP-LADDER.md`
  (feat/policy-fellowship-ladder) defines a verifiable rule: no fake grants.
  CCTV is reported with the three checks above, not as a level.

| Layer | Opens at | Today |
|---|---|---|
| Flights | public | The one free layer |
| Satellites, Space missions | fan | As before (Worker checks the bearer) |
| Intel events | fan | `GET /v1/intel/geo` with the member's session (members audience, k=5). The API also serves the public, but only one layer is free. Cells drawn as cells; located / unknown / suppressed and sources on the layer line; switched off today, said honestly. |
| Music | fan | **No source with a real place exists yet** (creator profiles hold no location; the GDELT news ingester has no music topic and its RPCs allow only world, policy, climate, health, technology; listener geography is the owner's private analytics). The toggle says so and draws nothing. Unblocking it needs either a `music` topic added to `public-gdelt-news` and the three media RPC / table allowlists (headline-country pins, coarse and labelled as such), or a creator-supplied, consented home city. |
| CCTV | fan + location consent + a completed mission | Section D |
| Your audience | creator_business | As before (the creator's own country counts) |
| Transport | fellow + transport | **Whip Equipped LLC**, Matthew's separate company, not a McCluster Corp brand: labelled as that company's, no McCluster branding, no mark drawn. Locked for everyone, owner included: the fellow + voter-registration rule ships disabled pending counsel. |

- **The page** (`js/action-globe.js`): every layer toggle is on screen for
  everyone except on the analytics surface; a locked one is shaded with a
  red dot (`is-locked`, `aria-disabled`, `data-lock` = the reason). A guest's
  tap sends `hu:ask-sign-in` (the World's sign-in prompt with the reason and
  a way back; on the Full world, the sign-in line); a member's tap explains
  what unlocks it (the CCTV checklist, the transport note). If the access map
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

## D. Mission-gated CCTV

Worker module `workers/mccluster/src/world-cctv.js`, routed from
`src/index.js` after the World layers (the OPTIONS preflight is answered
first, as for every core route).

| Route | Who | Answer |
|---|---|---|
| `GET /v1/world/cctv/eligibility` | anyone | `{eligible, checks:{signed_in, location_consent, mission_completed}, reason, consent_store, missions_url}` |
| `POST /v1/world/location-consent` | member | Records an opt-in. Body must say `browser_permission: "granted"` (the page sends it only after the browser granted geolocation from the member's own tap). Stores the decision, never a position. |
| `DELETE /v1/world/location-consent` | member | Withdraws it (`revoked_at`). |
| `GET /v1/world/cctv/sources` | eligible | Halo's camera records, trimmed to public fields; positionless or 0,0 cameras dropped and counted. |
| `GET /v1/world/cctv/frame/:id` | eligible | One live snapshot, only if Halo marks it `x-cctv-source: upstream-image` and it is a raster image. Street View and synthetic fallbacks: `502 no_live_frame`. Passes `content-type`, `x-cctv-source`, `x-cctv-provider` (from the record if Halo omits it), `x-cctv-captured-at`, `last-modified`, adds `x-cctv-retrieved-at`, `x-cctv-upstream-date`, `x-cctv-license`. |

- **The three checks, on every request** (no per-member cache; Halo's
  contract, `docs/AUTH-BOUNDARY.md` on hitmans-halo PR #23):
  1. *signed_in*: Supabase `auth/v1/user` accepts the bearer.
  2. *location_consent*: `public.world_location_consents` row granted and
     not revoked. **No server-side consent record existed before**: the
     browser permission was only an analytics event (`location_permission`).
     The table is defined minimally in
     `supabase/pending/world_location_consent_v1.sql` (decision only, no
     coordinate column; service role writes; members read their own) and is
     **not applied**. Until it is, the check is false for everyone and the
     answer says `consent_store: "pending"`.
  3. *mission_completed*: **the one canonical definition, shared with the
     fellowship ladder (PR #440):** the member has at least one
     `public.action_mission_assignments` row with `status = 'verified'`. An
     assignment becomes `verified` exactly when its `action_proofs` row is
     reviewed `verified` (`review_action_proof`: admin-only, never one's own
     proof); `action_network_fellowship_v1` counts completions the same
     way. **Production had 0 verified assignments (and 0 action_proofs rows)
     on 2026-10-15, so no member qualifies today.** The rule is not loosened;
     the lock says "You have no verified mission yet. Join one, send its
     proof, and it counts once a reviewer verifies it."
- **Nothing for anyone not eligible:** 401 / 403 with the reason and the
  checks; Halo is never called on their behalf. Every response is
  `cache-control: private, no-store`, `vary: origin, authorization`.
- **Halo, server to server:** `HALO_API_BASE` (default
  `https://prime.mccluster.org`, https only) with `x-halo-internal` from the
  secret `HALO_INTERNAL_TOKEN` (name only; Halo requires 32+ characters). The
  member's bearer is never forwarded. No secret: 503 `halo_not_configured`
  after the eligibility check. A Cloudflare service binding was not used: it
  needs the Halo Worker's service name and a deploy-time config change.
- **Frames in the browser:** an `<img>` cannot send `Authorization`, so the
  page reads the frame with `fetch()` and the bearer and shows it from a
  `blob:` object URL, revoked when the sheet closes. No token or signed
  parameter ever rides in a URL.
- **Rate limits:** per member, per isolate, sliding minute: eligibility 30,
  sources 6, frames 60, consent writes 10 (`429` with `retry-after`). Best
  effort: Workers spread load across isolates. The camera catalogue (not
  per-member data) is held in isolate memory for 60 s.
- **Globe UI** (`js/action-globe.js`, `ctlCctv`): shaded for guests (a tap
  asks them to sign in; nothing is fetched), hidden only on the analytics
  surface, locked (red dot) for a member who is not eligible.
  The lock opens a sheet with the three requirements, ✓ / ✕ each, and a way
  to meet each: Sign in, Share my location (browser prompt, then the consent
  write; withdraw link once given), Find a mission (`mnet.html?view=missions`).
  Unlocked, the cameras are green points; a tap opens the live snapshot with
  provider, captured, retrieved, media type and licence, labelled "Live
  snapshot", or "No live frame from this camera right now. Nothing is shown
  in its place."

## Tests

- `workers/mccluster/test/world-cctv.test.mjs`: the eligibility matrix (each
  check failing alone, consent withdrawn, consent store not applied, pending
  or rejected proof, proof approved but assignment not verified, clip-only),
  no leak (no list, no frame, no Halo call) for every failing case, the
  internal header and no forwarded bearer, `HALO_API_BASE`, missing secret,
  live frame headers, Street View and synthetic refused, unknown and
  malformed ids, rate limit, consent write and withdrawal (no position
  stored), eligibility re-checked on every request, Halo 401 mapped without
  leaking, blob-URL rendering.
- `supabase/tests/world_cctv_eligibility.behaviour.sql` via
  `scripts/test-world-cctv-db.sh` on a scratch Postgres: the mission
  definition through the real `review_action_proof`, consent RLS.
- `workers/mccluster/test/world-access.test.mjs`: one free layer for a
  guest, every other layer listed locked with a reason and next step, fan /
  creator / owner from records, CCTV reasons, the ladder hooks grant nothing,
  transport locked even for the owner.
- `scripts/test/world-globe-feed-analytics.test.mjs`: the geo aggregate
  (suppression, unknown, totals add up, no 0,0), the sign-up layer with the
  source filter, Intel events by contract (cells, switched-off state), the 60/40 shell and filters, globe
  first, just the globe, the CCTV UI contract, mobile-first CSS.

## Pending the owner

1. Set the secret `HALO_INTERNAL_TOKEN` (the same 32+ character value) on the
   `mccluster` Worker and on Halo's Worker; optionally `HALO_API_BASE`.
2. Apply `supabase/pending/world_location_consent_v1.sql` (then promote per
   `supabase/pending/README.md`). Until then no member can unlock CCTV.
3. Deploy the Worker and Pages; route the apex (`DOMAINS-AND-ENTITIES.md`).
4. Approve or replace the tagline candidate "Get Your Hu Up!" before any
   copy ships; supply the ladder rules (E=Up, fellow, transport) and pick
   the Music layer's geo source (above).
5. Decide: should a signed-in member lose the bar on every page of
   Matthew's property, not only on the World? Should Anti-Social level
   completions (no proof row) count as a completed mission for CCTV?
6. Licences for live camera feeds stay as recorded in Halo's
   `DATA_SOURCES.md`; restricted feeds (NYC DOT) must stay off.
