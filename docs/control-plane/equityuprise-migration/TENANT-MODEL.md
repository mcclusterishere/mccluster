# Equity Uprise as the top-level owner: tenant model

The repository already decided this and half built it. This page lines the pieces up; nothing here changes them.

## What already exists

1. **The one record** `data/seo/domain-architecture.json`: `platform.origin` is `https://mccluster.org` today and
   `platform.next.origin` is `https://equityuprise.com` (stage F, SPEC-PLATFORM 2.10). `tenants.matthew` is
   matthew.mccluster.org. `tools/build-site-hosts.mjs` generates the Worker, client and edge-function host tables
   from it.
2. **The host router** `workers/mccluster/src/platform/router.js` inside Worker `mccluster`.
   `workers/mccluster/test/platform-router.test.mjs` already rewrites the record to
   `platform.origin = https://equityuprise.com` and proves every path still resolves (stage F3).
3. **The ownership data model, live in production**
   (`supabase/migrations/20261114015120_equity_uprise_platform_registry.sql`):
   `orgs.equity-uprise` is the platform (`eu_platform_registry`), `eu_platform_tenants` holds
   `equity-uprise` (kind platform), `mccluster` (kind organization) and one artist tenant per music creator;
   apps and modules bind to tenants (`eu_platform_app_bindings`, `eu_platform_module_bindings`).

## The target shape

```
Equity Uprise (owner, platform)            equityuprise.com            every platform page, the World at /
 ├─ McCluster Corp (organization tenant)    mccluster.org               /company and /news/; other paths 301 to the owner
 │   └─ Matthew McCluster / McCluster       matthew.mccluster.org       his profile and profile-only pages (unchanged)
 ├─ artist tenants (one per creator)        paths on the owner          /artist pages, later custom hostnames
 └─ legacy doors                            humanuprise.com, www.*      301 to the owner, path and query kept
```

## What is missing, and what this branch adds (all inert)

| Gap | Staged here | Promotes to |
| --- | --- | --- |
| Which hostnames belong to which tenant | `staging/tenants.json` | doors/tenants entries in the one record; optionally rows in `proposed/eu_platform_tenant_hosts_v1.sql` |
| A reviewable host to tenant decision table | `staging/worker/router.mjs` + `router.test.mjs` (5 passing tests) | already implemented by `platform/router.js` once the record flips; kept separate on purpose |
| An equityuprise.com front door | `staging/site/index.html` (invite-only fellowship, Cohort 01 2025 and Cohort 2026, tenant houses) | the platform's root, or replaced by the landing page PR when it lands |
| Local preview | `staging/serve.mjs` (`node docs/control-plane/equityuprise-migration/staging/serve.mjs 8917`) | none; local only |

Everything lives under `docs/`, which `deploy-pages.yml` strips before publishing, has no wrangler config and no
route, so nothing here can ship by accident.

## Why the door entries are not in the one record yet

Adding `equityuprise.com` and `www` as inert doors to `data/seo/domain-architecture.json` was tried on this branch
and reverted: the generator adds both hosts to `site_hosts`, `site_origins`, `world_hosts` and `frame_ancestors`,
which changes the measured security headers byte for byte and fails 10 tests that pin the 2026-11-23 measurements
(platform-p1, router P0, supabase-function-returns, collect, halo). That is the right change at F0, made together
with updating those measurements, not in a read-only phase. The exact entries are in `proposed/doors-f0.json`.

## Same repo, not a separate one

A separate repository would duplicate the static tree, the generator, the router and the auth and tenant tables, and
the record says one platform. Stage F is a value flip plus DNS in this repo, so the work belongs here.
