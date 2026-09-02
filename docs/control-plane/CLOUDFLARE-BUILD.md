# Cloudflare Worker build (project `mccluster`)

The public website is GitHub Pages. This Cloudflare project only deploys the **Worker**.

If the dashboard Root directory is `/`, Wrangler sees the whole website tree and the build dies.

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

## Why deploy used to fail with error 10064

Worker `mccluster` already has Durable Objects named `HereTenantAgent` from an older deploy.
Cloudflare will not accept a new script unless that class is still **exported** from `src/index.js`.
Changing Root directory alone does not fix it. The class has to be in the code.

Do not run a delete-class migration unless you want those objects wiped.

After this file is on `main`, hit **Retry build**.
