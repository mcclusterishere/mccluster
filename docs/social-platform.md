# The Social Desk platform: phase-2 spec (written, not built)

The $400 tier sells the **service** today: clients send content, the desk
posts it across their platforms and hands them a posting plan. This doc is
the bill for the **self-serve platform** behind it: post to every feed from
the client console, Hootsuite-style, run from the McCluster backend, so
it's costed before it's promised in writing anywhere public.

## What it is

From `console.html`, a client on the social tier composes once (video +
caption + when) and the backend publishes to their connected accounts:
Instagram, Facebook, TikTok, YouTube, X, LinkedIn. Per-client connections,
per-client tokens, full audit trail. The desk can post on their behalf from
the same rails (that's the $400 service running on the platform instead of
by hand).

## The honest constraints, before any code

1. **"API keys per person" is really OAuth per person.** Clients must never
   paste passwords or raw API keys into the site. Each platform connection
   is an OAuth flow: the client clicks "Connect Instagram," approves on the
   platform, and the backend stores the resulting token, encrypted, server
   side, per client. The standing law applies: no vendor credential ever
   reaches the browser; the browser only ever holds the client's session.
2. **The platforms gate publishing behind app review.**
   - **Meta (IG + FB):** a Meta developer app with `instagram_content_publish`
     etc. requires **App Review + Business Verification** of McCluster Corp.
     Weeks, not days. (The FB developer connector on this account is the
     door into that.)
   - **TikTok:** Content Posting API needs an approved developer app; drafts
     post easily, direct-publish is gated.
   - **YouTube:** Data API upload quota starts tiny (~6 uploads/day per
     project) until a quota increase is granted.
   - **X:** paid API tier for posting at any real volume.
   - **LinkedIn:** Marketing Developer Platform approval.
   Sequencing: **Meta first** (most clients live there), TikTok second,
   the rest as demand shows.
3. **This is a backend product.** Tokens, scheduling, retries, and media
   processing cannot live on GitHub Pages. It runs on `apps/api` (Fastify,
   already scaffolded) deployed on Railway + Supabase for storage:
   `social_connections` (client ↔ platform ↔ encrypted token),
   `social_posts` (media ref, caption, per-platform status), a scheduler
   worker, and webhook receivers for token refresh/revocation.
4. **Media storage:** Supabase Storage buckets per client for uploads; the
   worker transcodes/validates per-platform specs before publish.

## The build order, when it's time

1. Meta developer app → Business Verification → App Review (start this
   EARLY; it's the long pole and it's paperwork, not code).
2. `apps/api` on Railway: OAuth callback routes, token vault (encrypted at
   rest, service-role only), `social_connections` + `social_posts` tables
   with the same RLS law as `site_requests`.
3. Console: "Connected accounts" card (connect/disconnect per platform) +
   a composer (upload → caption → schedule) for social-tier clients.
4. Desk side: the operator posts on a client's behalf through the same
   rails, every post logged, client-visible.
5. Then TikTok, YouTube, X, LinkedIn connectors behind the same interface
   (one `SocialProvider` contract, mirroring the `AIProvider` pattern in
   `packages/ai`, so no platform becomes a structural dependency).

## What the sales surfaces may say meanwhile

"Multi-platform publishing run through the studio's system" (true: the
desk runs it) and "first in line for the self-serve posting console as it
ships" (true: this doc). Nothing that promises client-facing self-serve
publishing **today**.
