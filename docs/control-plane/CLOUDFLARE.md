# Cloudflare

There is **one** Worker. Its name is `mccluster`.

| Property | Cloudflare thing | Git | Domain |
| --- | --- | --- | --- |
| Public site | Pages / CNAME | static HTML at repo root | `matthew.mccluster.org` |
| API | Worker **`mccluster`** | `workers/mccluster` | `api.mccluster.org` |

Do not create `mccluster-core`. That name is not in the dashboard and must not appear in new docs or wrangler files.

Root `wrangler.toml` and `workers/mccluster/wrangler.toml` both use `name = "mccluster"`.
Do not upload the whole git tree as Workers Assets.

Secrets stay in the Cloudflare dashboard. Never git.
