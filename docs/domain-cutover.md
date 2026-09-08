# matthew.mccluster.org cutover status

**Status: complete.**

`matthew.mccluster.org` is the canonical public site for this repository. The
repository `CNAME` and production links already point there. This document is
now a status record, not an execution runbook.

## Control law

- Do **not** change `CNAME` back to `here.mccluster.org` as a repair step.
- Do **not** tell agents that the rename or DNS cutover is pending.
- Treat `here.mccluster.org` as a legacy hostname only. If it remains reachable,
  it should redirect to the equivalent path on `matthew.mccluster.org`.
- Keep `matthew.mccluster.org` in Supabase Auth redirect configuration and any
  payment/OAuth return-url configuration that relies on the canonical site.
- `mccluster.org` may remain an alias/entry point, but application canonicals
  should resolve to `matthew.mccluster.org` unless a product has its own domain.

## Deployment source

The public site ships from `mcclusterishere/mccluster`:

1. changes land on `main`;
2. `.github/workflows/deploy-pages.yml` strips repository internals from the
   publish tree;
3. the workflow force-updates `gh-pages`;
4. GitHub Pages serves the configured `CNAME`.

The Cloudflare control Worker is the single Worker named `mccluster`. Its
canonical source/config lives under `workers/mccluster`. The repository-root
Wrangler file is a fail-safe mirror so a root-directory deployment cannot
silently select a legacy core-only entrypoint.

## Historical cutover details

The previous version of this file contained the pre-cutover DNS, certificate,
Supabase, Stripe, redirect, and Search Console checklist. Git history is the
record if those historical steps are ever needed for audit purposes. They are
**not current instructions** and should not be replayed against production.
