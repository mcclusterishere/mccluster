# HERE Cloudflare edge and tenant agent

This package is the first Cloudflare-native layer for HERE. It puts tenant-owned knowledge in R2, gives each tenant a durable Cloudflare Agent instance, and isolates retrieval in a separate AI Search instance per tenant.

It does **not** move the 10-building operational ledger into a cloud-only database. Building nodes remain local-first. It also does not expose physical controls, network-device changes, domain purchasing, or payment changes to the agent.

## What ships here

- `TENANT_CONTENT` R2 binding using the `mccluster-assets` bucket
- per-tenant object prefix: `tenants/{tenantId}/knowledge/**`
- per-tenant AI Search instance: `tenant-{tenantId}`
- durable `HereTenantAgent` state on SQLite-backed Durable Objects
- authenticated document ingestion, search, answer, and agent routes
- public `/llms.txt`, `/.well-known/llms.txt`, and capability catalog
- explicit capability denials for building actuation and money-moving operations

## Account activation order

1. In Cloudflare, open **Storage & databases → R2 → Overview** and complete the R2 subscription checkout. R2 includes a free monthly allowance, but checkout is a billing action and must be completed by the account owner.
2. Create a **Standard** bucket named `mccluster-assets`.
3. In **AI → AI Search**, create the first R2-backed instance against that bucket once. Cloudflare creates the account-level service token used for R2 indexing. A temporary instance is sufficient; tenant instances are provisioned by this Worker afterward.
4. Copy `.dev.vars.example` to `.dev.vars` locally and generate a long random `EDGE_ADMIN_TOKEN`. Never commit the value.
5. Authenticate Wrangler, set the production secret, and deploy:

   ```sh
   npx wrangler login
   npx wrangler secret put EDGE_ADMIN_TOKEN
   npm run deploy:dry
   npm run deploy
   ```

6. Add `agents.mccluster.org` as a Worker custom domain only after `mccluster.org` is active in the same Cloudflare account.

The existing Node platform can continue generating S3-compatible R2 presigned upload URLs during migration. Its `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` are separate server-side credentials; the Worker binding itself does not need those keys.

## Routes

- `GET /health`
- `GET /llms.txt`
- `GET /.well-known/llms.txt`
- `GET /v1/agent/catalog`
- `PUT /v1/tenants/{tenantId}/knowledge/{path}`
- `POST /v1/tenants/{tenantId}/search/provision`
- `POST /v1/tenants/{tenantId}/search` with `{ "query": "...", "mode": "search" | "answer" }`
- `/api/agents/here-tenant-agent/{tenantId}` for the authenticated Agents SDK route

All tenant routes require `Authorization: Bearer $EDGE_ADMIN_TOKEN`.

## Migration sequence

1. Deploy this edge/R2/agent layer while the current Node/PostgreSQL platform remains the system of record.
2. Put public site traffic and the platform API behind Cloudflare DNS, CDN, WAF, Turnstile, and an edge gateway.
3. Move suitable stateless API routes into Workers. Connect Workers to the existing PostgreSQL database through Hyperdrive rather than rewriting the schema into D1.
4. Move static site delivery to Workers Assets or Pages.
5. Keep building ledgers and safety boundaries local; synchronize approved events only.

## Verification

```sh
npm install --no-audit --no-fund
npm test
npm run check
npm run deploy:dry
```
