# Cloudflare

There is **one** Worker. Its name is `mccluster`.

| Property | Cloudflare thing | Git | Domain |
| --- | --- | --- | --- |
| Public site | Pages / CNAME | static HTML at repo root | `matthew.mccluster.org` |
| API | Worker **`mccluster`** | `workers/mccluster` | `api.mccluster.org` |

Do not create a Cloudflare Worker or Wrangler service named `mccluster-core`. That name is not in the dashboard and must not appear as a Worker name. **McCluster Core** is separately registered as the OVH persistent execution plane in `MCCLUSTER-CORE.md`; Cloudflare may securely route authenticated work to it.

Root `wrangler.toml` and `workers/mccluster/wrangler.toml` both use `name = "mccluster"`.
Do not upload the whole git tree as Workers Assets.

Secrets stay in the Cloudflare dashboard. Never git.
