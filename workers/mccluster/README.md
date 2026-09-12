# Worker `mccluster`

There is one Cloudflare Worker. Its name is `mccluster`.

Do not create a Cloudflare Worker named `mccluster-core`; that name is not in the dashboard. McCluster Core is separately the canonical OVH persistent execution plane. Worker `mccluster` may securely dispatch durable work to it under `docs/control-plane/MCCLUSTER-CORE.md`.

- Public site: `matthew.mccluster.org` (static)
- API Worker name: `mccluster`
- API URL: `https://api.mccluster.org`
- Code: `workers/mccluster/src/index.js`
- Data: Supabase `zmnhbrjyhxzhkxmhkexs`
