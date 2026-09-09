# Spatial plane — prize branch `grok/spatial-plane`

**Do not merge. Do not deploy. Do not touch GitHub Pages.**

This branch is Grok's prize piece. It is not production. Live
`https://api.mccluster.org/v1/geo` is **404** until the house deploys Worker
`mccluster` from a branch it actually wants. CI green on a draft is not a
deploy.

## What this is

McCluster-shaped spatial intelligence on the **one** Worker.

- Namespace: `/v1/geo`
- Satellite contract: `GET /v1/geo/plane`
- Durable Object: existing `HereTenantAgent` (`geo:ais:mccluster`)
- Database: existing Supabase `zmnhbrjyhxzhkxmhkexs` (PostGIS migrations in
  this branch are **not applied**)
- Upstream idea: [`bilawalsidhu/gods-eye-view`](https://github.com/bilawalsidhu/gods-eye-view)
  MIT code at `759652207fd1279ece97f0f19af566feb9a82146`
- Upstream data/models are **not** MIT. Planet, OpenSky NC, TeleGeography
  BY-NC-SA, Google News NC stay behind the lane firewall.

The globe is a satellite of `/v1/geo/plane`. It is not the source of truth.

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

## Honest live surface (2026-09-09)

Probed, not imagined:

- `GET /v1/geo` → **404**. ChatGPT PR #42 is not on the live Worker.
- `GET /gev/` → HTML 200, Cesium.js **404**. Pages shell, no viewer.
- `gev-proxy` health exists in Supabase and is not in git. USGS/adsb/opensky
  paths `route_not_implemented`. Keys all false.
- ChatGPT said finished because CI was green on a draft. That is not
  production.
- Claude's `GEV-CLOUDFLARE-HANDOFF.md` asks to internalize the Cesium app and
  clone GEV `/api/*`. That is the wrong shape.

## How Grok outshines both

ChatGPT salvaged the right module (adapters + PostGIS + AIS on the existing
DO) and then fought the plane: Pages publish from a feature branch,
`build-gev.sh`, out-of-repo proxy, lanes as **labels**. The registry wrote
`SCSU_RESEARCH`. Nothing threw when Whip asked for Planet.

Claude wrote a handoff that wants GEV API parity, Cloudflare Access around a
Cesium boot, and `OPENAI_API_KEY` in the spatial namespace.

This branch:

1. **Lane firewall in code.** `workers/mccluster/src/geo/lanes.js` runs in
   `executeProvider` *before* credentials. Whip + `planet_research` is 403
   `lane_forbidden` even if the key is present. Tests prove it.
2. **House INTERNAL sources GEV never had.** `house`, `equity_uprise`,
   `scsu_docket` are McCluster geography — Bridgeport, Shiloh, Equity Uprise
   dockets, SCSU — not a USGS clone.
3. **`GET /v1/geo/plane`.** The satellite contract a globe binds to: sites,
   arcs, lanes, forbidden list, routes. Public. No secrets. `do_not_merge: true`.
4. **Catalog tells the truth.** `/v1` lists `/v1/geo` and `/v1/geo/plane`.
   ChatGPT shipped adapters and left the envelope catalog blind.
5. **Worker route before `configured()`.** Health and the plane stay reachable
   while secrets are being assembled. Same wiring ChatGPT tested for, plus
   the plane.
6. **No Pages, no proxy, no Cesium, no Vercel.** AIS stays on
   `export class HereTenantAgent`. There is no second class.

## Contract

```
GET  /v1/geo                 none            readiness
GET  /v1/geo/plane           none            satellite contract
GET  /v1/geo/sources         none            catalog, binding names, never values
GET  /v1/geo/capabilities    none            adapter matrix
POST /v1/geo/fetch/:source   house-owner     body.consumer required on restricted lanes
POST /v1/geo/ingest/:source  house-owner     persist only when the source allows
GET  /v1/geo/nearby          house-owner     PostGIS, schema must exist
GET  /v1/geo/bbox            house-owner     PostGIS
GET  /v1/geo/live/ais        house-owner     HereTenantAgent idFromName('geo:ais:mccluster')
```

`body.consumer` is one of `house | policy | mobility | viewer | whip`.
Default `house`. Restricted lanes:

| Lane | Allowed | Whip? |
|---|---|---|
| `OPEN` | all | yes |
| `SCSU_RESEARCH` | house, policy | **no** |
| `COMMERCIAL` | house, mobility, viewer | no |
| `COMMERCIAL_OR_NONPROFIT` | house, policy, mobility, viewer | no |
| `VIEWER` | house, viewer | no |
| `INTERNAL` | house, policy | **no** |

A house owner operating Whip still has to pass `consumer: "whip"`. Owner is
not a skeleton key through academic licenses.

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
- any claim that this is live

## How a satellite binds

1. `GET /v1/geo/plane`
2. Draw `sites` and `arcs`
3. Honor `lanes` — a Whip client never requests `SCSU_RESEARCH` or `INTERNAL`
4. Fetch live observations through `POST /v1/geo/fetch/:source` as house-owner
   with `consumer` set to the satellite that will see the rows
5. Never talk to USGS/Planet/Cesium from the satellite's own origin when the
   Worker should mediate

Until this Worker is deployed, the globe in the Grok preview is a satellite of
the **contract shape**, not of production. USGS 4.5+ quakes on that globe are
the public OPEN feed so the visual plane is not a screenshot of a 404.

## Crown

Keep this branch. Do not merge it onto `main` to "win." If it is crowned,
deploy Worker `mccluster` from it, apply PostGIS through the real migration
path after reconciling production lineage, and take down `/gev/` and
`gev-proxy` as a separate, explicit house order.
