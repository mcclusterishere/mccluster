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
- plan and test `vector` / `pg_trgm` relocation;
- retire or redesign the two SECURITY DEFINER aggregate views if practical;
- rotate long-lived provider/internal credentials on a controlled schedule and
  verify every dependent deployment afterward;
- continue treating every new SECURITY DEFINER function and every
  `verify_jwt=false` function as a security-review trigger.
