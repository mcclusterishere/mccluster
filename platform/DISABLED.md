# Disabled legacy platform backend

This directory is historical reference only.

It was `@mccluster/here-platform`: an Express + PostgreSQL service (tenants, sites, CMS, domains, Stripe onboarding, Gemini intake, Forge jobs), a Google OAuth cookie-session server under `auth/`, a Twilio messaging server under `messages/`, and the distributed building-node / control-plane experiment under `src/` and `sql/`. Nothing deploys it: none of its routes exist in the Worker, and its `platform_*` tables are not the Supabase data plane. It is exactly the second auth stack and second database that `AGENTS.md` hard rule 1 forbids.

The only McCluster backend is `workers/mccluster`, deployed as the Cloudflare Worker `mccluster`, with Supabase project `zmnhbrjyhxzhkxmhkexs` as the one database and identity plane. Do not deploy, start, containerize, migrate, or reconnect this service. Its Railway config and systemd units were removed, and every runtime script in `package.json`, `auth/package.json` and `messages/package.json` intentionally fails closed (`DISABLED`). `workers/mccluster/test/control-plane-invariants.test.mjs` enforces this.

If useful logic remains here, port it into `workers/mccluster` behind the existing auth, billing, tenancy, and audit boundaries rather than reviving this service. The client tenancy and connected-revenue rail this service sketched already live in `workers/mccluster/src/connect.js` and `supabase/replay_migrations/0055_client_connect.sql`.

`cloudflare-edge/` is a separately archived predecessor of the Worker; see `cloudflare-edge/DISABLED.md`.
