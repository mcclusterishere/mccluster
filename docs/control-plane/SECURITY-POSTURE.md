# McCluster security posture — 2026-10-05 re-audit

This is the current security-hardening ledger for Item 8. It records what was
verified against the live Supabase project and what remains open. It is not a
claim that every Supabase advisor row is a vulnerability.

## Production changes already applied

Two production migrations are canonical and are represented in
`supabase/migrations/` by this slice. The grant migration uses existence guards
for two historical production-only helpers so clean source-controlled resets
can replay it without inventing those retired objects:

- `20261005082148_security_reaudit_execute_grants_v1`
  - removes browser execution from the unscoped `kb_search` overload;
  - removes direct client execution from `mnet_follow_admins` and
    `mnet_is_blocked_pair`;
  - removes direct execution from nine trigger functions;
  - leaves the two Mnet admin RPCs available to authenticated callers but not
    anonymous callers;
  - reduces the two public track-ranking views to SELECT-only;
  - pins the two remaining mutable function search paths.
- `20261005082220_security_reaudit_function_bodies_v1`
  - makes `eu_log` SECURITY INVOKER so its table policy is authoritative;
  - prevents `eu_match_fellowships(p_profile)` from using a private third
    party profile's interests, region, or spoken topics. The caller's own
    profile, a public active profile, and service-role matching remain valid.

Live verification after those migrations:

- anonymous-callable SECURITY DEFINER advisor findings: **31 → 20**;
- authenticated SECURITY DEFINER findings: **100 → 88**;
- mutable function search-path findings: **2 → 0**.

The remaining callable SECURITY DEFINER functions are not being treated as
safe merely because they are intentional. Their bodies were reviewed for an
internal caller / ownership / membership gate and should be re-reviewed when
their contracts change.

## Edge Functions with `verify_jwt = false`

Production currently has **27** no-JWT Edge Functions, and the exact same 27
are explicitly declared with `verify_jwt = false` in
`supabase/config.toml`. A CLI redeploy therefore cannot silently change the
gateway posture by relying on an implicit default.

No-JWT does **not** mean no authentication. The relevant compensating controls
fall into four categories:

1. provider-signed webhooks (for example Stripe, Resend/Svix and Google
   Pub/Sub identity);
2. public endpoints whose database effects are bounded by their own validation
   and RLS/RPC contract;
3. one-time / callback flows with signed state or a nonce;
4. internal workers protected by a function secret.

This slice hardens the internal-secret group. The following functions now use
the shared fixed-width `secretMatches` helper instead of ordinary JavaScript
string equality:

- `eu-worker`
- `eu-external-worker`
- `eu-monitor`
- `eu-ddex-worker`
- `eu-crossref-callback`
- the internal branch of `eu-google-workspace`
- `m-oauth-bootstrap` for its bootstrap nonce

The Google Workspace `/push` path remains separate: it verifies Google's
signed identity token before it runs and does not use the internal shared
secret.

`context-core` already had its own bounded token comparison and is unchanged
by this slice.

## Level 3 login

`l3-login` previously queried
`platform_profiles.mccluster_id` with PostgREST `ilike`. A supplied `%`
or `_` therefore had wildcard semantics. The route now rejects values that
do not match the canonical handle shape and uses exact `eq` lookup.

Before the change, production was checked without disclosing any handles:
all **102** populated `platform_profiles.mccluster_id` values match the
accepted character/length shape, so the stricter lookup does not lock out an
existing account.

The route also checked Level 3 app access *before* the password and answered
`403 not_authorized` for an account without access, so a stranger could tell
which usernames exist without knowing any password. Access is now checked only
after a successful password grant. Every stored username is lowercase: the
`platform_assign_mccluster_id` trigger lowercases on write, so the exact `eq`
lookup on the lowercased input finds every account.

## Compensating controls, function by function

No-JWT functions must each have a stated control. `scripts/test/security-reaudit.test.mjs`
fails when `config.toml` gains one that is missing here.

| Function | Why it is public | Compensating control |
|---|---|---|
| `checkout` | anonymous buyers | server-priced offering rows; no browser-chosen price, seller or account |
| `shake-order` | anonymous buyers | server recomputes every cent; open window and capacity enforced; payment re-confirmed with Stripe |
| `pay-now` | legacy, superseded by `checkout` | **retired in code**: every request gets `410` before Stripe is touched. Its `mccluster` / `equity-uprise` branch skipped the provider lookup and minted Checkout sessions on the platform account for any amount and title. Nothing calls it. |
| `stripe-webhook` | provider callback | Stripe signature (`STRIPE_WEBHOOK_SECRET`) |
| `outreach-webhook` | provider callback | Svix signature (`RESEND_WEBHOOK_SECRET`) |
| `inbox` | Meta / Slack callbacks and site chat | HMAC signatures compared in constant time; Meta verify token |
| `eu-converse` | anonymous visitors | a thread answers only to its owner (signed-in profile, or the visitor's `anon_key` on an unclaimed thread); server-side usage limits; fixed agent tools |
| `intake`, `eu-intake` | public forms | fixed org and field set, length caps, per-IP limit / Turnstile; the browser cannot set status, roles or approvals |
| `unsubscribe` | a recipient holding an old email | per-contact unsubscribe token; the only effect is a suppression |
| `domain-check` | anonymous lookup | read-only; registry answer plus the `domain_tlds` price, never charged from here |
| `collect` | anonymous telemetry | the only writer of `events`; IP and user agent observed server-side; a token, when sent, is verified in-function |
| `mnet-track` | anonymous and signed-in activity | token verified in-function when present; unknown source app refused |
| `eu-calendar` | public slots and booking | slots carry no titles or attendees; booking needs the application's hashed capability token; event creation needs an approved `control_approval` |
| `eu-orcid-oauth` | OAuth callback | start is authenticated; the callback consumes one-time state; tokens go to Vault |
| `m-oauth-bootstrap` | one-shot operator bootstrap | secret nonce via `secretMatches`; refuses everything while unset |
| `context-core` | Core server-to-server | `MCCLUSTER_CONTEXT_TOKEN`, digest compare; org and conversation required on every query |
| `social-agent` | phone worker | operator JWT in-function, or the device token compared in constant time |
| `eu-worker`, `eu-external-worker`, `eu-ddex-worker`, `eu-monitor` | cron / internal | `EU_WORKER_SECRET` via `secretMatches` |
| `eu-crossref-callback` | Crossref callback | `CROSSREF_CALLBACK_SECRET` (query or header) via `secretMatches` |
| `eu-google-workspace` | Gmail Pub/Sub and internal calls | `/push`: Google-signed identity token checked for audience and service account; otherwise `EU_GOOGLE_WORKSPACE_SECRET` via `secretMatches` |
| `l3-login` | sign-in | 12 failures per IP per 15 min; exact username shape and `eq` lookup; app access checked after the password |
| `l3-checkout` | anonymous buyers | product price read server-side; checkout created on the seller's connected account |
| `l3-download` | buyers without accounts | **download token**: the Stripe checkout-session id; payment re-verified with Stripe on every request; 300-second signed storage URL; every download logged with a hashed IP |

## Internal signing and nonces

- **Compute nodes → Core.** Every request is signed with the node's Ed25519
  key over method, path, node, timestamp, nonce and body digest. Core refuses a
  reused nonce (`compute_accept_nonce`) with `409 REPLAY_DETECTED`. Code:
  `core/src/compute/signature.mjs`, `core/src/compute/gateway.mjs`.
- **Worker → Core broker.** HMAC over the request with a timestamp and a
  nonce. Core bounds clock skew and keeps a nonce cache.
  Code: `core/src/broker-edge-auth.mjs`.
- **Webhooks.** Each one is verified by its provider's own signature scheme:
  Stripe, Svix/Resend, Meta, Slack and Google OIDC.

## Advisor findings that remain open

The 2026-10-05 security advisor still reports:

- **2 SECURITY DEFINER views**: `v_track_signals` and `v_track_affinity`.
  They intentionally publish aggregate ranking signals from owner-only source
  events. The re-audit removed inherited writes and leaves SELECT only. A
  future migration should replace them with an invoker-safe projection if the
  same public contract can be preserved.
- **2 extensions in `public`**: `vector` and `pg_trgm`. Relocation is a
  schema-migration project because existing functions/operators depend on
  them; do not move them ad hoc.
- **leaked-password protection disabled** in Supabase Auth. This is a project
  setting, not a repository migration, and still needs owner/admin enablement.
- `rls_enabled_no_policy` informational rows. Many of these are intentionally
  service-only tables with browser grants revoked. Each new exposed table must
  still have a real ownership/membership policy rather than relying on this
  pattern by default.

## Remaining Item 8 work

- enable leaked-password protection in Auth;
  ([Supabase guide](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection));
- owner decision: delete the `pay-now` deployment. Its code now refuses every
  request with `410` (the `RETIRED` constant), so this is housekeeping, not
  exposure; the source stays in the repo either way;
- owner decision: reconcile `music-publish-internal`. It is deployed (gateway
  JWT required) but has no source in this repository; commit its source or
  delete it;
- performance: with a cold cache `v_track_signals` takes about 6 s, against
  anon's 3 s statement timeout (about 1 s warm), so the listening room can
  lose its ordering after idle periods. Materialize or index it;
- plan and test `vector` / `pg_trgm` relocation;
- retire or redesign the two SECURITY DEFINER aggregate views if practical;
- rotate long-lived provider/internal credentials on a controlled schedule and
  verify every dependent deployment afterward;
- continue treating every new SECURITY DEFINER function and every
  `verify_jwt=false` function as a security-review trigger.
