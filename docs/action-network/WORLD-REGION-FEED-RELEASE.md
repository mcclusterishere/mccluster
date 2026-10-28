# World regional feed — release contract (19 October 2026)

**Status: pre-release / off by default.** This slice adds a country-level public feed without a second social network. It sits behind `WORLD_PLACE_SCOPE_ENABLED=false`. Never switch it on until the pending SQL has been applied and verified.

## Geographic semantics

- `network_posts.country_code`: **user-selected ISO 3166-1 alpha-2 public association**, not detected location. Null means unplaced; private/group posts never appear in country discovery.
- `media_news_articles.location_country_fips`: GDELT place *mention*, converted with the checked GeoNames crosswalk. Never describe it as a verified incident location. Unmapped country is excluded.
- `network_live_sessions.country_code`: **host-selected** country for a video broadcast. In the live studio the host ticks "Show this broadcast in <country>'s feed" (offered only for the country on the globe, unticked by default); `POST /v1/mnet/live` accepts `country_code` only with the flag on. Never inferred from IP; existing broadcasts are not placed.
- Visitor's default: `request.cf.country` at Cloudflare only; no GPS request, no server-side geo persistence, no trusting user-supplied location headers. Explicit globe selection replaces it. Unknown edge country stays global.
- `/v1/world/place-scope`: public status and coarse country. `/v1/world/region-feed?country=US`: public region feed, keyset cursors independently for posts and news. The first page also carries `lives`: broadcasts on air now (heartbeat within two minutes) that their host placed in that country, projected to id, title, room kind, category, start time and the host's public name. No stream URL or host id leaves the Worker. The Local feed shows them as a "Live in <country>" row above the posts and news; watching one takes signing in, as Live does everywhere. A member's tap opens that broadcast by its id (`GET /v1/mnet/live/directory?id=`), not by searching the newest fifty worldwide; one that has ended says so on its card.

## Signed-out visitors stay in their region (owner, 2026-10-20)

"If they're logged out and their IP address says somewhere, that's where they're gonna go … they can't region hop unless they're logged in." With the flag on, a signed-out visitor's feed opens on Local for the country `request.cf.country` gives. Tapping another country outside Travel asks them to sign in ("Sign in to explore posts, news and conversations in other regions.") and puts the globe back on their country; letting the country go also returns there. Travel (directions) is unaffected, and the Global chip remains the existing all-public feed. Members hop freely.

The Worker holds the rule, not only the page: `/v1/world/region-feed` answers a request without a member's session for the connection's country only, and refuses any other country with 403 `{ sign_in: true, home }` before it reads anything. No country read from the connection means no country without a session. The page sends a member's session with the request (the preflight is answered in `world-region-feed.js`), and the answer is `private` with `vary: authorization`, so no shared cache can hand a member's country to a visitor. Conversations (audio rooms, #547) enforce the same rule on the server. A VPN can move a visitor's country: the lock is the owner's regional scope, not identity. E2E: `editorial-visitor-region` in `scripts/e2e/world-screen.e2e.mjs`.

## Privacy and access invariants

Only top-level published **public** posts from **public** author profiles, no group/private/deleted/reply rows. Posts are projected and media assets are locked until the existing authorized asset path: the feed carries a count (`media_locked`), never an asset id. A visitor is asked to sign in; a member taps "Show these photos and videos", which loads that post through the authorized `GET /v1/mnet/posts/:id` and draws its media. Share, Save and mission taps find a country feed's posts as they find the main feed's. Service-role reads do not authorize expanding visibility. Caller country does not create a country tag on someone else's post. No auto-tagging from IP. Tag only if the author explicitly chooses a country and chooses public visibility.

## Release sequence

1. Applied: `supabase/migrations/20261021173729_world_place_scope_v1.sql` went through the ledger workflow on 2026-10-21 (the pending copy was removed 2026-10-27).
2. Verify public/nonpublic posts and globe country news classification against Supabase; test both guest and member endpoints on staging.
3. Verify feed page cursors, empty results, user-selected region, off-flag behavior, GPC and iPhone layout.
4. Coordinate privacy-policy re-acknowledgement if any new capture/placement policy is introduced; do not turn on audio rooms with this flag.
5. Set `WORLD_PLACE_SCOPE_ENABLED=true` in reviewed Wrangler vars, deploy Worker, smoke-test live, monitor errors; rollback by returning the flag to false.

**Not in this slice:** multi-speaker audio rooms (Cloudflare Realtime SFU) are #547, with their own migration, credentials, explicit mic consent, visitor rules and moderation controls; its room list already follows the country on the globe.
