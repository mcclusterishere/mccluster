# Live websites

These hosts ship from **this repo**: `mcclusterishere/mccluster`.

| Host | What it is |
| --- | --- |
| `https://matthew.mccluster.org` | Matthew McCluster's property (GitHub Pages from this repo) |
| `https://mccluster.org` | McCluster Corp's property: a different site and entity. Today a Cloudflare redirect rule 301s it to the personal host; once routed, Worker `mccluster` serves the company pages by host. See `DOMAINS-AND-ENTITIES.md`. |
| `https://api.mccluster.org` | Worker `mccluster` |

`mcclusterishere/Here` is the old website repo. It must not publish any of those hosts.

## How publish works

Push to `main` in `mccluster` runs `.github/workflows/deploy-pages.yml`.
That workflow stamps cache-busting versions, strips internals, and force-pushes the public web root to the `gh-pages` branch.

GitHub Pages / Cloudflare for these domains must point at **mccluster**, not Here.

## Dashboard (one-time)

1. GitHub → `mcclusterishere/mccluster` → Settings → Pages → source `gh-pages` → custom domain `matthew.mccluster.org`
2. GitHub → `mcclusterishere/Here` → Settings → Pages → off (no custom domain)
3. Cloudflare → project `mccluster` → Git repo `mcclusterishere/mccluster`
4. Cloudflare DNS: `matthew` is a DNS-only CNAME to GitHub Pages. The apex `mccluster.org` is McCluster Corp's property, routed to Worker `mccluster` (activation steps in `DOMAINS-AND-ENTITIES.md`). `api` stays on Worker `mccluster`.
