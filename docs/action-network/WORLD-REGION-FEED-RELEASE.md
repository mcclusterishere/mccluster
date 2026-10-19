# World regional feed — release contract (19 October 2026)

**Status: pre-release / off by default.** This slice adds a country-level public feed without a second social network. It sits behind `WORLD_PLACE_SCOPE_ENABLED=false`. Never switch it on until the pending SQL has been applied and verified.

## Geographic semantics

- `network_posts.country_code`: **user-selected ISO 3166-1 alpha-2 public association**, not detected location. Null means unplaced; private/group posts never appear in country discovery.
- `media_news_articles.location_country_fips`: GDELT place *mention*, converted with the checked GeoNames crosswalk. Never describe it as a verified incident location. Unmapped country is excluded.
- `network_live_sessions.country_code`: reserved metadata for a future opt-in audio/video-room filter. Existing live streams are not silently placed.
- Visitor's default: `request.cf.country` at Cloudflare only; no GPS request, no server-side geo persistence, no trusting user-supplied location headers. Explicit globe selection replaces it. Unknown edge country stays global.
- `/v1/world/place-scope`: public status and coarse country. `/v1/world/region-feed?country=US`: public region feed, keyset cursors independently for posts and news.

## Privacy and access invariants

Only top-level published **public** posts from **public** author profiles, no group/private/deleted/reply rows. Posts are projected and media assets are locked until the existing authorized asset path; service-role reads do not authorize expanding visibility. Caller country does not create a country tag on someone else's post. No auto-tagging from IP. Tag only if the author explicitly chooses a country and chooses public visibility.

## Release sequence

1. Apply `supabase/pending/20261019222500_world_place_scope_v1.sql` through the approved ledger workflow, not a dashboard paste by surprise.
2. Verify public/nonpublic posts and globe country news classification against Supabase; test both guest and member endpoints on staging.
3. Verify feed page cursors, empty results, user-selected region, off-flag behavior, GPC and iPhone layout.
4. Coordinate privacy-policy re-acknowledgement if any new capture/placement policy is introduced; do not turn on audio rooms with this flag.
5. Set `WORLD_PLACE_SCOPE_ENABLED=true` in reviewed Wrangler vars, deploy Worker, smoke-test live, monitor errors; rollback by returning the flag to false.

**Not yet provided by this slice:** multi-speaker Cloudflare Realtime SFU audio transport and verified live-room country filtering. Those require their own PR and migration, credentials, explicit mic consent and abuse/moderation controls.
