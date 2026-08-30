# TARGET STATE: the deployable platform

The smallest durable production system that serves Here + Prayer
Closet + commerce + the Inner Room + a provider-neutral AI layer,
without discarding anything that works today.

## The shape

```
GitHub repo (source of truth, never the runtime)
   │  GitHub Actions: lint → typecheck → test → build → image
   ▼
Container registry (images tagged by commit SHA)
   ▼
Railway project ─ staging env ─┬─ api      (Fastify/TS container)
                 production env┴─ worker   (same image, worker entry)
                                  redis    (managed, queue + cache)
Supabase ──────────────────────── Postgres + Auth + Storage + RLS
GitHub Pages / edge host ──────── static web (unchanged during migration)
Stripe ────────────────────────── payments (webhooks → api)
Shopify ↔ Tapstitch ───────────── fulfillment bridge (Phase 4)
Sentry / provider logs ────────── observability
Resend ────────────────────────── transactional email
```

**Platform choice: Railway** (managed containers, per-service env
vars, staging/production environments, managed Redis, logs,
rollbacks, no cluster to run). The account is already connected.
Google Cloud Run is the documented scale-out alternative. The
Dockerfile is the contract, so moving is a redeploy, not a rewrite.
**Database stays Supabase** (working migrations, RLS, auth, storage;
audit found no blocker), upgraded to Pro before launch for
point-in-time recovery.

## Repository structure (staged, non-destabilizing)

```
/                     the static site stays at root; Pages keeps serving it
/apps/api             Fastify + TypeScript, versioned /api/v1, OpenAPI
/apps/worker          (Phase 1.5) queue consumer, same deps as api
/packages/ai          vendor-neutral AI gateway (no vendor calls outside it)
/packages/commerce    PaymentGateway + FulfillmentProvider contracts
/infrastructure       Dockerfiles, deploy notes
/docs/architecture    this trilogy
```

A full `/apps/web` move happens only when a bundler earns its place;
forcing the static site into a monorepo build now would destabilize a
working release for zero user value.

## Backend ownership (the API becomes the authority)

The API owns auth verification, profiles, catalog, carts, checkout
sessions, orders, payment verification (webhooks), fulfillment
routing, editions/QR activation, scripture metadata, saved
notes/highlights sync, collaborator profiles, admin permissions, AI
requests, notifications, audit logs. The client is never the source
of truth for price, discount, inventory, order status, auth claims,
premium access, fulfillment status, edition authenticity, or AI
authorization. The offerings ledger already enforces the first of
these; the API generalizes the pattern.

## Database domains

Existing migrations 0001 to 0007 keep working. New schemas arrive as
numbered migrations in the same pipeline, grouped by domain:
`identity, catalog, commerce, fulfillment, content, scripture,
engagement, ai, operations`. Core tables per the master brief
(users/profiles/roles, brands/collaborators/seasons/drops,
products/variants/garment_placements/inventory, carts/orders/
payments/fulfillment_jobs/shipments/returns, editions/activations,
scripture_books/chapters/verses, studies/sessions/prayer_prompts,
user_notes/highlights/bookmarks, media_assets, ai_threads/messages/
usage, notifications, audit_events). UUID keys, explicit status
enums, FKs, unique constraints, indexes; soft delete only where
operationally justified. `data/prayer-closet.json` remains the
editorial seed until the catalog tables exist, then becomes an
export of them.

## Contracts (all implemented in /packages, consumed by the api)

- **PaymentGateway**: `createCheckout / verifyWebhook / refund`.
  First adapter: Stripe (exists conceptually in the checkout
  function; moves behind the interface). Possible later:
  ShopifyPaymentGateway. Payment state changes only from verified
  webhooks, never a client "success" message.
- **FulfillmentProvider**: `submitOrder / getOrder / cancelOrder /
  normalizeWebhook`. Adapters: `TapstitchViaShopifyProvider` (no
  public Tapstitch API is assumed; the verified path is their
  Shopify/WooCommerce integration), `ManualMcClusterProvider`,
  `LocalEmbroideryProvider`. Order items snapshot product, artwork
  version, placements, costs ($25 finishing fee where applicable),
  retail price, route, provider order id, tracking. Totals are
  never recomputed from the live catalog.
- **AIProvider**: `generate / stream / embed? / moderate?`.
  Implementations `OpenAIProvider, AnthropicProvider,
  MockAIProvider`, all server-side; the app talks only to
  `AIService`, which enforces: policy check → budget check → route
  (env-driven primary/fallback/model tiers) → timeout → retry with
  backoff → circuit breaker → validated response → usage row
  (provider, model, prompt_version, tokens, cost, latency, status,
  user, thread, request id). No vendor key ever reaches a browser or
  app binary; provider choice changes by env var, not app release.
  No hidden chain-of-thought is stored or requested.

## AI functions (grounded, non-canonical)

Study companion, chapter questions, historical context, drop
explanation, prayer prompts, search help, concierge, support triage,
admin copy. Retrieval comes from approved app data (scripture files,
the ledger, orders); AI is never canonical for scripture text,
price, inventory, orders, shipping, or edition authenticity.

## Jobs, webhooks, media

Worker consumes a Redis (BullMQ) queue: order submission,
fulfillment sync, webhook reconciliation, shipments, email, push,
media processing, QR/certificate generation, indexing, AI batch,
retries, daily reconciliation. Every job: id, type, payload version,
attempts, status, timings, last error, idempotency key; dead-letter
flow for repeat failures. Webhook routes (`/api/v1/webhooks/stripe`,
`…/shopify`; `…/tapstitch` only if a real contract appears) verify
raw-body signatures, persist the event, ack immediately, process
async, support replay. Media lives in object storage (Supabase
Storage now, R2 if egress costs demand) with signed URLs, size/MIME
limits, and versioned artwork (source / production / web preview /
mobile preview / customer download). The official Hitman mark is a
versioned asset, never AI-generated.

## Native strategy

Capacitor is already in the repo for Android with the site bundled in
`www/` (store-compliant, not a remote wrapper). Add the iOS project,
then: Sign in with Apple, Stripe PaymentSheet + Apple Pay for
physical goods (never IAP for garments; digital content stays free
in v1, keeping App Review clean), push (APNs/FCM), Universal/App
Links to `/prayer-closet/*` routes, QR scanner (camera) for edition
activation, secure credential storage, haptics, offline saves. The
"more than a website" bar is met by Prayer Closet's native utility:
QR authentication, push for drops, offline Inner Room, saved
studies.

## Security & observability baseline

HTTPS-only, strict CORS, CSP, secure cookies + CSRF where cookies
appear, zod-validated inputs, parameterized SQL, object-level
authorization, brute-force throttles, least-privilege keys, secret
rotation, dependency + container scanning, audit logging, Supabase
Pro PITR + tested restores, admin MFA. Sentry (API, worker, mobile)
+ structured logs + queue depth, webhook failures, AI spend. Alerts:
payment-without-order, order-not-submitted, missing tracking,
signature failures, stalled queue, DB down, AI budget, error spikes.
Logs never contain passwords, payment details, notes, or prayers.
