# Cloudflare Worker build (project `mccluster`)

The public website is GitHub Pages. This Cloudflare project only deploys the **Worker**.

## Settings that work

In Cloudflare → Workers & Pages → `mccluster` → Settings → Build:

| Field | Value |
| --- | --- |
| Git repository | `mcclusterishere/mccluster` |
| Branch | `main` |
| **Root directory** | `workers/mccluster` |
| Build command | *(leave empty)* |
| **Deploy command** | `npx wrangler deploy` |
| Build watch paths | `workers/mccluster/**` |

Do not set an assets / static directory.
Do not point this project at `Here`.
Do not create a Worker named `mccluster-core`.

## Do not click Retry on an old red build

Retry rebuilds the **same old commit**. That is why the log keeps saying `HereTenantAgent` is missing and why upload stays `7.89 KiB` with only three env vars.

To pick up the fix:

1. Wait until GitHub `mccluster` `main` shows the commit that adds `workers/mccluster/src/here-tenant-agent.js`.
2. In Cloudflare → Worker `mccluster` → Deployments, start a **new** production deploy of **latest `main`**. Do not Retry the failed 08:11 / 08:12 / 08:18 jobs.
3. The good log must show a Durable Object binding named `HereTenantAgent`, not only the three environment variables.

## Why error 10064 happens

Worker `mccluster` already has Durable Objects named `HereTenantAgent`.
The uploaded JavaScript must `export class HereTenantAgent`.
That class lives in `workers/mccluster/src/here-tenant-agent.js` and is re-exported from `src/index.js`.

Do not run a delete-class migration unless you want those objects wiped.
