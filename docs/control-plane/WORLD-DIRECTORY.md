# World directory: bounded owner opt-in catalog

Pending review and integration; no production schema or listings have been created.

## Existing records inspected

- `workers/mccluster/src/platform-api.js` `/v1/mnet/discover` calls the existing
  `mnet_discover` RPC for people, not business/project catalogs.
- `supabase/migrations/20260920071811_mnet_real_network_v1.sql:279` defines that
  people search. It requires `network_profiles.visibility='public'` and
  `discoverable=true`. The new directory preserves both settings.
- `platform-api.js` group detail reads `action_campaigns` tied to groups. This
  does not establish a general customer-owned campaign publishing contract.
- `workers/mccluster/src/world-events.js` adapts NOAA/NASA natural events, not
  customer-created events. No source is scraped or misrepresented as a customer.
- `member_fronts` and `managed_projects` already establish customer ownership,
  published/private configurations and takedown. Directory records reference
  these existing pages and recheck their ownership/publication on every read.

## Supported path

`world-discover.html` shows real opt-in business, service and project listings.
Owners use **Manage my listings**, select one of their existing pages, classify
it, add a description/category, and choose online-only or explicitly public
locality/service-area labels. Listing opt-in and consent are explicit. Saving a
listing cannot publish its page or change profile visibility. Owners can edit,
stop listing, or remove their own listings. Duplicate source/type combinations
return a recoverable conflict instead of silently overwriting.

No arbitrary destination URL is accepted: links derive from the owned page.
Public results retain source kind/key and owner-provided provenance, without auth
IDs, M Account IDs, draft content, personal coordinates or inferred geography.
Online-only records cannot retain location/service-area labels. Coordinates are
not collected; a city string must never become a fabricated map point.

Events and campaigns are returned as explicitly unavailable capability types.
There are no sample production rows, external scraping, inferred business claims,
checkout actions or event attendance promises in this milestone.

## Integration contract

Mount `handleWorldDirectory` from `workers/mccluster/src/world-directory.js` in
canonical Worker routing under `/v1/world-directory` (including `/me`).

- GET `/v1/world-directory?q=&type=&category=&location=&online=`: public results;
  all filters optional. `q` matches all normalized words via generated simple
  tsvector; location matches explicit locality/service-area text, case-insensitive.
  `online` accepts `true` or `false`. No sort-by-distance claim is made.
- GET `/v1/world-directory/me`: authenticated owner's listings and source pages.
- POST `/v1/world-directory/me`: create, or update by owned listing `id`.
- DELETE `/v1/world-directory/me` body `{id}`: owner-scoped removal.

Public queries inspect up to 100 filtered candidates (101 fetched to indicate
truncation), then revalidate public/discoverable profiles and source publication,
removal and ownership in batched queries. Responses disclose truncation; UI asks
for narrower filters. This is a bounded initial catalog, not exhaustive search
or ranked recommendations. Owner source/listing controls are capped at 100.
Missing schema/service errors return 503 and clear results; no fake empty-success
state is shown. Endpoints return `private, no-store` to avoid retaining removed
or newly private entities in HTTP caches.

World integration: add local link `world-discover.html` labelled **Businesses,
services & projects** to existing World discovery. The social/composer agent added this link to `#mnDiscoverView` in `mnet.html`
in commit `2a985ed5` for root integration. Root may also link the customer
hub. Page accepts `?location=<encoded explicit region label>` if a future existing
World selection offers such a label; this does not authorize reading visitor IP,
coordinates or silently changing a member's location. No globe code is changed.

## Schema and verification

`supabase/pending/world_directory_v1.sql`: service-only table, forced RLS,
revoked anon/authenticated access, unique per owner/source/type, source/location
constraints, generated search vector with partial GIN index, owner/filter/recent
indexes. No triggers, SECURITY DEFINER RPCs, new credentials or external service.

Checked official Supabase full-text guidance:
https://supabase.com/docs/guides/database/full-text-search

Tests (fixtures only):

```
node --test workers/mccluster/test/world-directory.test.mjs
PGLITE_DIR=<node_modules> node scripts/test-world-directory-db.mjs
PLAYWRIGHT_DIR=<node_modules> node scripts/e2e/world-directory.e2e.mjs
```

API tests cover two-owner read/edit/delete isolation, source ownership, private and
nondiscoverable profiles, source removal/unpublish/reassignment, search filters,
consent, coordinate/URL rejection, duplicate recovery and missing schema.
PGlite checks actual full-text matching, indexes, role denial and constraints.
Browser uses real handler with fixture storage/auth; covers owner creation, public
search and links, privacy changes, account switching, outages, 390/1440 overflow
and uncaught errors. Screenshot: `/tmp/world-directory-proof/phone.png`.
Router mounting, real Supabase provisioning and production discovery remain
unverified until separately approved integration/deployment. This task creates no
live listings, posts, accounts or notifications.
