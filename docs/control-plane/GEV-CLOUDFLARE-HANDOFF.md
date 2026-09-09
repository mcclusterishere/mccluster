# GEV / Cloudflare handoff for Claude

## User intent (authoritative)

- God's Eye View (GEV) is **not** a replacement for any public McCluster page.
- The existing public-facing site at `matthew.mccluster.org` must remain visually and behaviorally unchanged.
- GEV is an **internal/backend operations and spatial-intelligence surface only**. Do not add public navigation to it and do not expose it as a public product page.
- Prefer an authenticated internal route/host protected with Cloudflare Access (or the existing backend auth boundary), not an unauthenticated Pages route.
- Preserve upstream attribution/licenses and the pinned upstream source unless deliberately upgraded and re-audited.

## Upstream source

Pinned source used for the current prototype:

- Repo: `bilawalsidhu/gods-eye-view`
- Commit: `759652207fd1279ece97f0f19af566feb9a82146`

The current public prototype was built from the real upstream application, not a visual imitation. It was temporarily published under `/gev/` for validation, but the user has now clarified that this surface must be backend/internal only.

## Current McCluster backend work

Branch / PR:

- Branch: `feature/gev-spatial-intelligence`
- PR: #42 `Bootstrap GEV spatial intelligence data layer`

Relevant components already implemented/tested on that branch:

- `workers/` McCluster control-plane additions for spatial intelligence and the existing `HereTenantAgent` Durable Object.
- PostGIS-oriented spatial intelligence migrations.
- Worker contracts and Supabase reset CI have passed on the repaired branch head.
- A Supabase Edge Function named `gev-proxy` is ACTIVE in project `zmnhbrjyhxzhkxmhkexs` (Here), used as a temporary broker for several keyless/server-side feeds.

Do **not** blindly apply the entire feature-branch migration tail to production Supabase. Production migration history does not cleanly map to every late branch migration. Reconcile the exact production lineage first.

## Why the current `/gev/` prototype appears stuck on a loading screen

The temporary Pages build injected this runtime promise in the generated HTML:

```js
window.__MCCLUSTER_GEV_RUNTIME_CONFIG__ = fetch(/* Supabase gev-proxy runtime-config */)
```

But the pinned upstream `src/main.js` still reads provider credentials synchronously from Vite build-time variables:

```js
const cesiumToken = import.meta.env.CESIUM_ION_TOKEN;
const googleApiKey = import.meta.env.GOOGLE_MAPS_API_KEY;
```

So the current runtime-config shim is not a complete credential integration. It must be moved into the application boot path (or a real config module) and awaited before map initialization. Do not treat the static HTML shim as finished architecture.

The loading cover is only dismissed after initialization reaches the `Promise.all(...).finally(...)` block in upstream `src/main.js`. Any thrown or indefinitely pending startup dependency before that point leaves the user on the loading/error cover. Reproduce with browser devtools and capture the first console/network failure before changing code.

## Cloudflare work Claude should own

Claude has the Cloudflare access needed to complete this part. Please:

1. **Internalize the viewer**
   - Host the GEV frontend on an internal/backend route or dedicated internal hostname.
   - Protect it with Cloudflare Access or the existing backend authentication/authorization model.
   - Do not link it from public pages.
   - Do not change `matthew.mccluster.org` public homepage/content/design.

2. **Run the real server-side GEV broker on Cloudflare**
   - Use the canonical McCluster Worker / `HereTenantAgent` rather than creating a competing control plane.
   - Preserve existing routes and Whip/API behavior.
   - Keep provider secrets server-side.
   - Use an allowlisted route table; do not create an arbitrary open proxy.

3. **Complete persistent AIS**
   - Wire `AISSTREAM_API_KEY` through the existing Worker/Durable Object path.
   - Maintain the persistent AISStream WebSocket in the Durable Object / appropriate long-lived Cloudflare primitive.
   - Return the response shape expected by upstream `src/data/aisLiveVessels.js`.
   - Add reconnect/backoff, stale-state handling, and rate/usage guardrails.

4. **Finish upstream API parity needed by enabled UI controls**
   - `/api/gbfs/...` for bikeshare with strict upstream URL allowlisting.
   - `/api/cctv/*` for the public/authorized CCTV catalogs and media already modeled by upstream.
   - `/api/military-installations` only as mapped/public installation context; no person tracking, face recognition, or individualized surveillance.
   - Preserve source attribution and licensing metadata.

5. **Fix application boot/runtime configuration correctly**
   - Replace the temporary HTML fetch monkey-patch with an application-level config loader.
   - Await runtime provider config before constructing the initial map stack.
   - Support graceful keyless fallback when Google/Cesium keys are absent.
   - A missing optional feed/key must degrade that layer only; it must not leave the entire application behind the loading cover.
   - Add a bounded startup timeout and visible diagnostic state for truly fatal initialization errors.

6. **Provider bindings / secrets**
   Wire the existing expected names where applicable:
   - `GOOGLE_MAPS_API_KEY`
   - `CESIUM_ION_TOKEN`
   - `AISSTREAM_API_KEY`
   - `FIRMS_MAP_KEY`
   - `TOMTOM_API_KEY`
   - `OPENSKY_CLIENT_ID`
   - `OPENSKY_CLIENT_SECRET`
   - `OPENAI_API_KEY`
   - optional `LL2_API_TOKEN`

7. **Validation before declaring done**
   - Browser test the internal GEV surface from a cold session.
   - Confirm the loading cover clears.
   - Confirm the globe renders without paid keys using the keyless fallback.
   - Confirm keyed Google/Cesium mode activates when credentials are present.
   - Confirm enabled keyless layers return data without 404s.
   - Confirm keyed-but-missing layers show a local unavailable/key-required state instead of breaking boot.
   - Confirm AIS survives reconnects and stale sessions.
   - Confirm `matthew.mccluster.org/` is unchanged before/after deployment.

## Public site invariant

The GitHub Pages deployment on `main` force-publishes only the web root after stripping internals. Keep that public pipeline separate from GEV. The backend/internal GEV deployment must not modify the public `index.html`, album pages, public assets, or navigation.

## Cleanup

Once the internal Cloudflare-hosted GEV is verified, remove/avoid any unauthenticated public `/gev/` artifact and temporary runtime monkey-patch. The public Pages tree should contain only the intended public site.