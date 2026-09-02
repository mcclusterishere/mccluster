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

After you save Root directory, hit **Retry build**.
