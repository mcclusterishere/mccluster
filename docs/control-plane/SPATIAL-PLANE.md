# Spatial plane — `grok/spatial-plane`

**Do not merge. Do not deploy. Do not touch GitHub Pages.**

This branch is the salvage base for McCluster spatial intelligence. It is not
production. Live `https://api.mccluster.org/v1/geo` is **404** until the house
deploys Worker `mccluster` from a branch it actually wants. CI green on a draft
is not a deploy.

## What this is

McCluster-shaped spatial intelligence on the **one** Worker.

- Namespace: `/v1/geo`
- Public satellite contract: `GET /v1/geo/plane`
- Internal geography: `GET /v1/geo/plane/internal` (house-owner)
- Durable Object: existing `HereTenantAgent` (`geo:ais:mccluster`)
- Database: existing Supabase `zmnhbrjyhxzhkxmhkexs` (PostGIS + facilities
  migrations in this branch are **not applied**)
- Upstream idea: [`bilawalsidhu/gods-eye-view`](https://github.com/bilawalsidhu/gods-eye-view)
  MIT code at `759652207fd1279ece97f0f19af566feb9a82146`
- Upstream data/models are **not** MIT. Planet, OpenSky NC, TeleGeography
  BY-NC-SA, Google News NC stay behind the lane firewall.

The globe is a satellite of `/v1/geo/plane`. It is not the source of truth.
Internal McCluster facilities are not on the public contract.

## What this is not

| Temptation | Status |
|---|---|
| Second Worker | Forbidden |
| `gev-proxy` Edge Function | Out of repo, stub, not in this branch |
| Vercel (`gods-eye-view.vercel.app` is Novalyte) | Forbidden |
| Feature-branch GitHub Pages hijack | Forbidden. `main` still publishes the public site |
| Cesium dump into the Worker | Forbidden. Renderer is never the plane |
| GEV `/api/gbfs` `/api/cctv` mimicry | Forbidden. Sources are McCluster adapters under `/v1/geo/fetch/:source` |
| Overwrite `index.html` | Forbidden |
| Merge to `main` | Forbidden until the house crowns it |
| `body.consumer` self-label | Forbidden. App identity is derived from authentication |

## Honest live surface

Probed, not imagined:

- `GET /v1/geo` → **404**. This branch is not on the live Worker.
- `GET /gev/` → HTML 200, Cesium.js **404**. Pages shell, no viewer.
- `gev-proxy` health exists in Supabase and is not in git.
- PostGIS and `facilities` migrations are in git. They are not applied.

## Hardening (still not mergeable)

1. **Identity-bound firewall.** JWT `app_metadata.mccluster_app` or
   `X-McCluster-App-Token` (mapped by secret `GEO_APP_TOKENS`) resolves a
   `platform_apps` key to a class + capabilities. `body.consumer` is 400
   `consumer_not_accepted`. Whip requesting Planet is 403 *before* the key is
   read, even if the caller is also the house owner.
2. **Public plane is sanitized.** `GET /v1/geo/plane` returns service,
   capabilities, public layers, routes, and lane contract. No Shiloh, SCSU,
   PRIM3, Whip corridors, prize flags, or branch theater.
3. **Internal plane is authenticated.** `GET /v1/geo/plane/internal` is
   house-owner and reads `public.facilities` / live org + Equity Uprise
   projections. Hard-coded Worker constants are gone.
4. **Fetch never persists.** `POST /v1/geo/fetch/:source` is a proxy.
   `POST /v1/geo/ingest/:source` persists when the source policy allows.
5. **Whip is a commercial mobility app.** COMMERCIAL lane requires TRAFFIC or
   MOBILITY, so Whip may use TomTom/AIS where the license allows. It still
   cannot touch SCSU_RESEARCH or INTERNAL house geography.

## Contract

```
GET  /v1/geo                     none            readiness
GET  /v1/geo/plane               none            sanitized satellite contract
GET  /v1/geo/plane/internal      house-owner     facilities, arcs, full catalog
GET  /v1/geo/sources             none            catalog, binding names, never values
GET  /v1/geo/capabilities        none            adapter matrix
POST /v1/geo/fetch/:source       app-identity    never persists
POST /v1/geo/ingest/:source      house-owner     persist only when the source allows
GET  /v1/geo/nearby              house-owner     PostGIS, schema must exist
GET  /v1/geo/bbox                house-owner     PostGIS
GET  /v1/geo/live/ais            house-owner     HereTenantAgent idFromName('geo:ais:mccluster')
```

App identity is one of the registered `platform_apps` keys. Capabilities, not
product nicknames, decide the lane:

| App | Class | Capabilities |
|---|---|---|
| `mccluster-web`, `mccluster-gev` | INTERNAL | VIEWER, POLICY, MOBILITY, TRAFFIC, RESEARCH, INTERNAL |
| `equity-uprise-web` | NONPROFIT_RESEARCH | POLICY |
| `whip-rider-*`, `whip-driver-*`, `whip-rentals-*` | COMMERCIAL | MOBILITY, TRAFFIC |

| Lane | Required capability | Whip? |
|---|---|---|
| `OPEN` | none (identified app) | yes |
| `SCSU_RESEARCH` | RESEARCH | **no** |
| `COMMERCIAL` | TRAFFIC or MOBILITY | **yes** |
| `COMMERCIAL_OR_NONPROFIT` | TRAFFIC, MOBILITY, POLICY, or VIEWER | yes |
| `VIEWER` | VIEWER | no |
| `INTERNAL` | INTERNAL (Equity Uprise docket also allows POLICY) | **no** |

A house owner operating Whip is still Whip if the session is a Whip app. Owner
is not a skeleton key through academic licenses.

## Salvage vs reject

Taken from ChatGPT PR #42, then rewritten:

- `workers/mccluster/src/geo/*` adapters, gateway, store, registry
- AIS on existing `HereTenantAgent`
- PostGIS migrations (in git only; not applied)
- wrangler comments for spatial secret *names*

Rejected:

- `tools/build-gev.sh`
- feature-branch `deploy-pages.yml` force-push of `/gev/`
- `gev-proxy`
- GEV `/api/*` parity
- caller-supplied `consumer`
- public dump of internal McCluster geography
- any claim that this is live

## How a satellite binds

1. `GET /v1/geo/plane` for the public contract
2. House console: `GET /v1/geo/plane/internal` with a house-owner session
3. Honor `lanes` — a Whip client never requests `SCSU_RESEARCH` or `INTERNAL`
4. Fetch live observations through `POST /v1/geo/fetch/:source` as the
   authenticated app. Persist only through `/ingest`
5. Never talk to USGS/Planet/Cesium from the satellite's own origin when the
   Worker should mediate

Until this Worker is deployed, the globe is a satellite of the **contract
shape**, not of production.

## Crown

Keep this branch. Do not merge it onto `main` to "win." If it is crowned:

1. Deploy Worker `mccluster` from this branch as an explicit house order.
2. Set `GEO_APP_TOKENS` and stamp `app_metadata.mccluster_app` on product JWTs.
3. Reconcile production migration lineage, then apply PostGIS + `facilities`.
4. Prove keyless OPEN feeds live, then commercial traffic, then AIS.
5. Take down `/gev/` and `gev-proxy` as a separate, explicit house order.
