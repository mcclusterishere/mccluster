# MIGRATION PLAN: the master report

The one report the infrastructure brief demands, item by item.
Companions: `current-state.md` (the audit), `target-state.md` (the
architecture). Nothing here is destructive; GitHub Pages keeps
serving the site through the whole migration.

## 1 and 2 · Repository architecture & cloud platform

Static vanilla-JS frontend + Supabase serverless backend (full audit
in current-state.md). **Recommended platform: Railway.** Managed
containers with staging/production environments, managed Redis,
per-service env vars, rollbacks, and the account is already
connected. Trade-offs: Cloud Run is cheaper at true scale and
scales to zero, but adds GCP IAM/registry ceremony; Render is
comparable to Railway with slower cold operations; Fly is superb but
more hands-on. The Dockerfile keeps the exit door open. Moving
targets later is a redeploy, not a rewrite.

## 3 and 4 · Backend language & database

**TypeScript + Fastify**: matches the JavaScript house, minimal
ceremony, first-class schema validation, OpenAPI generation, fast
cold starts. NestJS adds structure this codebase doesn't need yet.
**Database: Supabase Postgres stays** (working migrations pipeline,
RLS, auth, storage; no blocker found). Upgrade to Pro before launch
for PITR. Environments: local (supabase CLI or docker Postgres),
staging (new Supabase project), production (current project), each
with separate credentials.

## 5 · Commerce decision

**Stripe remains the authority.** The offering-driven, server-priced
checkout already matches the brief's non-negotiables. The
`PaymentGateway` interface wraps it; Apple Pay arrives via Stripe
PaymentSheet in the Capacitor shell. Physical garments never touch
Apple IAP; digital scripture/studies stay free in v1 so no IAP
question arises at review.

## 6 · Tapstitch integration path

No public Tapstitch API is assumed (none is documented). Verified
path: **Tapstitch's Shopify integration**. A minimal Shopify store
becomes the fulfillment bridge (`TapstitchViaShopifyProvider`),
with `ManualMcClusterProvider` (collab sets, inserts) and
`LocalEmbroideryProvider` (finished editions, +$25 ledger fee) beside
it. If Tapstitch account access reveals a real API/webhook contract,
a direct adapter replaces the bridge without touching order code.

## 7 · Native packaging path

**Capacitor**: the Android shell already exists in-repo
(`build-android.yml` bundles the site into `www/`; store-compliant).
Add the iOS project on a Mac/CI Mac runner, wire Sign in with Apple,
PaymentSheet, push, Universal Links, QR scanner. TestFlight before
App Review. (Fixed in this pass: the Android staging step and the
Pages stamper both missed `tracks/` and `closet/`.)

## 8 · AI abstraction design

`/packages/ai` (scaffolded in this pass): `AIProvider` contract
(generate/stream/embed?/moderate?), `AIService` router with
env-driven primary/fallback + model tiers, timeout, retry with
backoff, circuit breaker, per-user + platform budget hooks, usage
records, mock provider for tests. OpenAI and Anthropic adapters are
server-side stubs behind the interface; no vendor call exists
outside the package; no key ever ships to a client. Full design in
target-state.md.

## 9 · Security risks (ranked)

1. **No backups/PITR on Supabase Free**: upgrade to Pro at launch;
   until then, scheduled `pg_dump` via Actions is the stopgap.
2. Anonymous-insert tables (`leads`, `events`) throttled only
   client-side. Add API-side rate limits when traffic moves over.
3. localStorage sessions (XSS-reachable, no cross-subdomain);
   retired by the shared-accounts redesign (HTTP-only cookies).
4. No CSP/security headers on Pages: meta-CSP short-term; real
   headers when the edge host arrives.
5. No audit log on owner/admin actions: `audit_events` table + API
   middleware.
6. Zero automated tests. CI lands in this pass; coverage grows with
   each API route.
7. Secret hygiene is currently good (no live secrets in Git; Stripe
   key in function vault). Keep it that way; scan on every PR.

## 10 · Migration sequence (maps to brief phases)

| Phase | What ships | Gate |
|---|---|---|
| 0 | This report | none |
| 1 | `apps/api` on Railway staging + CI + health checks + Sentry | Railway env vars set |
| 1.5 | Worker + Redis queue | Railway Redis |
| 2 | Prayer Closet data layer: catalog migrations, ledger import, admin API | staging DB |
| 3 | Cart/checkout in API, Stripe webhooks verified + idempotent, orders | Stripe live keys |
| 4 | Shopify↔Tapstitch bridge, finished-edition workflow, tracking | Shopify + Tapstitch accounts |
| 5 | AI gateway live behind budgets + grounded closet assistant | provider API keys |
| 6 | iOS Capacitor project, push, universal links, QR, TestFlight | Apple Developer |
| 7 | Privacy review, account deletion, metadata, review notes, submission | all above |

Every phase is additive; the static site and current checkout keep
working until each replacement is verified in staging.

## 11 · Estimated recurring infrastructure cost (monthly)

| Service | 100 MAU | 1,000 MAU | 10,000 MAU |
|---|---|---|---|
| Railway (api + worker + Redis) | $5 to $10 | $25 to $45 | $100 to $200 |
| Supabase | $0 (Free) | $25 (Pro) | $75 to $150 (Pro + compute) |
| Sentry | $0 | $0 to $26 | $26 to $80 |
| Resend | $0 | $20 | $20 to $90 |
| Storage/CDN (R2 if needed) | $0 | $0 to $10 | $10 to $30 |
| **Total** | **~$5 to $10** | **~$70 to $125** | **~$230 to $550** |

One-time/annual: Apple Developer $99/yr, Google Play $25 once,
Shopify Basic ~$29 to $39/mo only once the fulfillment bridge is needed
(Phase 4). AI spend is usage-priced and capped by the gateway's
budget env vars, not open-ended.

## 12 · Exact files added/modified (this pass)

Added: `docs/architecture/{current-state,target-state,migration-plan}.md`,
`apps/api/**` (Fastify TS service: config, server, health,
/api/v1/status, tests, Dockerfile), `packages/ai/**` (contract,
service, mock/openai/anthropic providers, tests),
`packages/commerce/**` (PaymentGateway + FulfillmentProvider
contracts + order-snapshot types), `.github/workflows/ci.yml`.
Modified: `.github/workflows/deploy-pages.yml` (stamp all page
directories), `.github/workflows/build-android.yml` (stage walls/
tracks/ closet/ into the shell). Nothing at the site root changed.

## 13 · Exact environment variables (server-side only)

```
NODE_ENV, APP_ENV(staging|production), PORT, ALLOWED_ORIGINS
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
STRIPE_SK, STRIPE_WEBHOOK_SECRET
REDIS_URL
RESEND_API_KEY, SENTRY_DSN
AI_PRIMARY_PROVIDER, AI_FALLBACK_PROVIDER, AI_DEFAULT_MODEL,
AI_FAST_MODEL, AI_REASONING_MODEL, AI_MAX_OUTPUT_TOKENS,
AI_DAILY_USER_BUDGET, AI_MONTHLY_PLATFORM_BUDGET,
OPENAI_API_KEY, ANTHROPIC_API_KEY
(Phase 4) SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SHOPIFY_WEBHOOK_SECRET
(Phase 6) APNS_*, FCM_* via push abstraction
```

GitHub Actions secrets: `SUPABASE_DB_URL` (unlocks the dormant
migration workflow), later `RAILWAY_TOKEN` for deploys.

## 14 · Exact App Store blockers

1. No Apple Developer Program enrollment ($99/yr): blocks everything.
2. No iOS Capacitor project (Android only today).
3. No in-app account deletion (Guideline 5.1.1(v)): required.
4. No privacy policy / terms / support URLs.
5. No privacy nutrition-label data map (`docs/release/privacy-data-map.md` to write).
6. Sign in with Apple: required only if a third-party login (e.g.
   Google) ships; email-only login avoids it in v1.
7. Push entitlements + APNs not configured.
8. No Universal Links (apple-app-site-association) on the domain.
9. "More than a website" bar: the shell must wire native utility
   (QR scan, push, offline saves) before submission, not after.
10. No production API URL yet (Phase 1 output).
11. Demo account + review notes not yet written.
12. Export-compliance answer (standard HTTPS-only: exempt).

## 15 · Work that can begin immediately (no external credentials)

Everything in item 12: done in this pass. Next credential-free
work: catalog schema migrations (they sit dormant until
`SUPABASE_DB_URL` exists), worker scaffold, account-deletion flow
design, privacy data map, OpenAPI spec generation, meta-CSP.

## 16 · Credentials/accounts McCluster must obtain

| Need | For | When |
|---|---|---|
| Set `SUPABASE_DB_URL` repo secret | migrations pipeline wakes up | now |
| Railway project + `RAILWAY_TOKEN` | staging/production deploys | Phase 1 |
| Supabase Pro upgrade | backups/PITR | before launch |
| Stripe live keys + webhook secret | commerce | Phase 3 |
| Apple Pay merchant ID + domain verification | PaymentSheet | Phase 3/6 |
| Shopify store + Tapstitch app connection | fulfillment bridge | Phase 4 |
| OpenAI and/or Anthropic API keys | AI gateway | Phase 5 |
| Apple Developer Program | iOS/TestFlight | Phase 6 |
| Google Play Console ($25) | Android release | Phase 6 |
| Sentry org + DSNs, Resend domain | observability, email | Phases 1 and 2 |

## Non-negotiables, restated as checks

Repo = code truth only · Pages ≠ app runtime · no vendor call outside
`/packages/ai` · no secret in client or Git · no client-controlled
price/inventory/payment status · every webhook verified + idempotent ·
physical goods on normal payments, digital kept free in v1 · native
app must out-value a wrapper · every infra decision documented and
reversible · staging before production · smallest durable system wins.
