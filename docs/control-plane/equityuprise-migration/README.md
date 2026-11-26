# equityuprise.com: WordPress.com to Cloudflare (phase 1: discovery and staging)

Branch `infra/equityuprise-cloudflare-stage-f0-20261125`. Nothing live changed: no DNS, nameserver, registrar,
WordPress, Cloudflare, Worker, Pages, Supabase or production change, and nothing deploys from this folder
(`docs/` is stripped from the published site; there is no wrangler config here).

- `DISCOVERY.md`: registrar, DNS, email (none), hosting, content and Cloudflare readiness, measured 2026-11-25.
- `TENANT-MODEL.md`: Equity Uprise as the owner, McCluster Corp and Matthew as tenants, using what production
  already has.
- `CUTOVER-PLAN.md`: exact records, order, rollback, what Matthew signs in to, zero downtime.
- `staging/`: tenant registry, host router skeleton with tests, staged front door, local preview server.
- `proposed/`: the F0 door entries and an optional tenant hosts table, both unapplied.
- `screenshots/`: before (live WordPress.com placeholder) and after (staged preview), desktop 1440 and phone 390.

Run the staging tests: `node --test docs/control-plane/equityuprise-migration/staging/worker/router.test.mjs`
Preview locally: `node docs/control-plane/equityuprise-migration/staging/serve.mjs 8917`, then open
http://localhost:8917/ (the platform pages show no live data locally).
