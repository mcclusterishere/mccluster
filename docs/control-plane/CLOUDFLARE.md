# Cloudflare — how this repo is supposed to ship

Two properties. They are not the same build.

| Property | Cloudflare thing | Git | Domain |
| --- | --- | --- | --- |
| Public site | **Pages** (preferred) or the existing CNAME | this repo, static HTML at repo root | `matthew.mccluster.org` (apex `mccluster.org` aliases it) |
| API | Worker **`mccluster-core`** | `workers/mccluster-core` | `api.mccluster.org` |

## Why Git checks were failing in 0 seconds

Cloudflare Workers Builds was linked to this repo as project **`mccluster`**. That check dies instantly when:

1. There is no Wrangler config in the **Root directory** the dashboard uses, or
2. The `name` in that file does not equal the Worker name on the dashboard.

Root `wrangler.toml` / `wrangler.jsonc` now declare `name = "mccluster"` and `main = "workers/mccluster-core/src/index.js"`. They do **not** set `[assets]` — this tree is hundreds of MB of 3D / LiDAR and must not be uploaded as Workers Assets.

`workers/mccluster-core/wrangler.toml` stays `name = "mccluster-core"`. That is the API Worker. Do not rename it to `mccluster`.

## Dashboard clicks (do this once)

1. Workers & Pages → **mccluster**
   - Root directory: **`/`** (repository root), not `workers/mccluster-core`
   - Worker name: **`mccluster`** (matches root wrangler)
   - Do not enable Workers Assets on `.`
2. If `mccluster` was meant to be the **public HTML site**, create/use a **Pages** project on the same repo instead, output = repo root (or the existing GitHub Pages + CNAME). Keep the Worker Git integration only if you actually want a Worker named `mccluster`.
3. Worker **`mccluster-core`**: root directory `workers/mccluster-core`, name `mccluster-core`. Route `api.mccluster.org/*` when DNS is ready.
4. Secrets stay in the dashboard (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`). Never git.

## DNS

`CNAME` in this repo is already `matthew.mccluster.org`. Apex `mccluster.org` should CNAME/redirect onto that property, not a second site.
