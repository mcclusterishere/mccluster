# mccluster-core

This is the only API Worker in the house.

- Public site: `matthew.mccluster.org` (static)
- API: this Worker, `api.mccluster.org`
- Data: Supabase `zmnhbrjyhxzhkxmhkexs`
- Whip Equipped rider / driver / rentals call `/api/*` here. They do not ship their own Worker.

## Worker rules used here

- Compatibility date current, `nodejs_compat` on
- Logs and traces on before production
- Secrets only via `wrangler secret put`
- CORS allowlist (no `*`)
- Structured JSON error logs
- Product APIs live under `src/whip/`

## Local

```bash
cd workers/mccluster-core
npx wrangler types
npx wrangler dev
```
