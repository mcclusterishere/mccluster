# Running the Worker on our own metal

`src/` is not modified and must not be. This directory imports
`src/entry-platform.js` and calls its default export exactly as Cloudflare
does — `fetch(request, env, ctx)`. One source, two hosts.

That is the whole basis of the migration: the plan is to run both in
parallel and compare, and a comparison between the real Worker and a
hand-ported copy would prove nothing.

## What Cloudflare provides that this has to supply

| | Cloudflare | Here |
|---|---|---|
| `cloudflare:workers` | built in | `shims/cloudflare-workers.mjs`, via a loader hook |
| `.html` imports as text | `[[rules]] type = "Text"` | the same rule, in `loader.mjs` |
| Durable Object | global, single-instance | in-process + `node:sqlite` |
| R2 `SEEK_FIRST_ARCHIVE` | object store | `shims/r2.mjs`, filesystem |
| `request.cf` geo | free on the request | MaxMind GeoLite2, `shims/geo.mjs` |
| cron `*/5` | `[triggers]` | a timer in `server.mjs` |
| `caches.default` | built in | nothing — the one caller already guards with `typeof caches !== 'undefined'` |
| rate limiting | — | nothing — it was always backed by Supabase |

## The two that are not faithful, and what it costs

**The Durable Object is single-instance per process, not globally.** That
is a property of Cloudflare's placement, not of an API, and no shim
recreates it. Run **one** host process. Two behind a load balancer would
each hold their own copy of the Seek First agent and diverge silently.
Moving that state into Postgres is the prerequisite for scaling out.

**R2 was replicated; a directory on one VPS is not.** `/var/lib/mccluster`
is now yours to back up. `scripts/mail/backup-mail.sh` does **not** cover
it — that backs up the mail store only.

## Running it

```sh
node --import ./host/register.mjs host/server.mjs
```

`--import ./host/register.mjs` is not optional. It installs the loader
hooks, and without them `src/here-tenant-agent.js` fails to import
`cloudflare:workers` and the **entire** module graph fails — not just the
Durable Object part, but the 95% of the API that never touches one.

Environment: everything in `wrangler.toml`'s `[vars]`, plus every
`wrangler secret`. Missing secrets do not crash it — the Worker fails
closed per-route, which is correct but means a half-configured host
answers differently from production. See below.

## Parity

```sh
PARITY_A=https://api.mccluster.org PARITY_B=http://127.0.0.1:8788 \
  node host/parity.mjs
```

It probes unauthenticated GETs only — pointing a comparison harness at
authenticated or mutating routes means writing to production twice and
calling the mess parity. The authenticated surface still needs a real
client exercised against B before any cutover.

**A worked example of it earning its keep:** on its first run against a
host with no Supabase secrets, `/v1/does-not-exist` returned `404` from
Cloudflare and `503 "McCluster is not configured"` here. Not a code
difference — the same code failing closed earlier because the config was
absent. Exactly the class of difference that looks like nothing in a log
and like an outage to a caller.

## Deploying

`deploy/mccluster-api.service` and `deploy/nginx-api.conf`.

The systemd hardening is not boilerplate. A Worker has no filesystem and
no ambient authority; a bug that was harmless inside an isolate is not
harmless on a box that also holds the mail. `ProtectSystem=strict` with a
single `ReadWritePaths=/var/lib/mccluster` gets most of that back.

Secrets go in `/etc/mccluster/api.env`, mode 0600, owned by root — not in
the unit, which is world-readable and printed by `systemctl cat`.
