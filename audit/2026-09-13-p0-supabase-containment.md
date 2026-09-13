# Sprint P0 — Supabase / Control-Plane Containment

Date: 2026-09-13

This record captures verified containment work performed against the two connected Supabase projects and the source-control reconciliation for the canonical McCluster control plane. No secret values are included.

## Project boundary

- Canonical control-plane project: `Here` (`zmnhbrjyhxzhkxmhkexs`). The repository's `supabase/config.toml` points here.
- Legacy/secondary project: `fxbkvcrfbbcmrrupdcjt`. Its changes are recorded under `supabase/legacy/...` and are intentionally outside the canonical migration chain.

## Verified live changes — legacy project

### Privileged RPC surface

- Anonymous-callable SECURITY DEFINER functions: **84 -> 19**.
- Authenticated-callable SECURITY DEFINER functions: **84 -> 67**. The remaining authenticated functions were not removed mechanically because many are legitimate signed-in application RPCs.
- 13 SECURITY DEFINER trigger functions had direct client execution revoked while their trigger bindings remained intact.
- Internal/scheduled helpers `notify`, `snapshot_all`, `stake_sweep`, and `rls_auto_enable` had direct Data API execution removed.
- Signed-in/admin RPCs had PostgreSQL's ambient `PUBLIC` EXECUTE replaced with explicit `authenticated` and `service_role` grants.

### Search-path hardening

- Mutable-function-search-path findings: **8 -> 0**.
- `fund_uid`, `game_price`, `is_earned_reason`, `is_mcc_admin`, `n_log`, `ticker_price`, `touch_updated_at`, and `vault_uid` were pinned to trusted schemas.
- Direct client execution of trigger helper `touch_updated_at` was removed.

### Sensitive backend-only tables

Client table privileges were removed from six RLS-enabled/no-policy tables while `service_role` retained CRUD access:

- `deal_payments`
- `member_oauth`
- `mtoken_ledger_legacy`
- `play_pulses`
- `push_config`
- `rights_splits`

This makes their existing deny-by-RLS posture explicit at the GRANT layer and reduces future accidental-exposure risk.

## Verified live changes — Here control plane

### Anonymous SECURITY DEFINER surface

- Anonymous-callable SECURITY DEFINER functions: **13 -> 4**.
- Anonymous execution was removed from nine identity/role/membership or authenticated-matching helpers while `authenticated` and `service_role` execution was retained:
  - `current_m_uid`
  - `eu_is_admin`
  - `eu_is_staff`
  - `eu_match_fellowships`
  - `eu_role`
  - `inbox_is_staff`
  - `is_org_member`
  - `is_org_owner`
  - `shake_is_crew`
- Four deliberate anonymous read APIs remain public: `l3_public_products`, `l3_public_storefront`, `music_pulse`, and `play_counts`.

### Sensitive backend-only tables

Client CRUD privileges were removed from:

- `identity_verifications`
- `l3_owner_invites`
- `stripe_events`

Verification showed anon/authenticated CRUD privileges false and `service_role` CRUD privileges true after the change.

## Edge-function review completed in this slice

- `stripe-webhook`: unauthenticated gateway mode is compensated by Stripe signature verification and idempotency handling.
- `l3-login`: intentionally anonymous credential exchange with CORS allowlisting, membership checks, and per-IP rate limiting.
- `l3-download`: currently treats the Stripe Checkout session ID as a bearer credential, then verifies payment/entitlement and emits a short-lived signed URL. This should move to a one-time entitlement/download token in a later hardening wave.
- `eu-worker`: uses a dedicated worker secret plus approval/request-hash checks for higher-risk actions. Replay-resistant HMAC/nonce semantics remain a follow-up.
- `eu-calendar`: mixed public Turnstile-protected intake and authenticated capability-controlled operations; not safe to convert wholesale to gateway JWT enforcement.

## Intentionally not changed yet

### SECURITY DEFINER views in Here

The following four advisor errors were inspected but not mechanically converted to `security_invoker`:

- `eu_counts`
- `eu_profiles_public`
- `eu_perspectives_public`
- `shake_open_window`

They intentionally expose sanitized/aggregated public projections while their base tables have stricter RLS. A blind conversion would either break intended public behavior or force wider base-table access. The correct fix is an explicit public projection/API boundary rather than a flag flip.

### Remaining legacy anonymous RPCs

Nineteen legacy SECURITY DEFINER functions remain anonymous-callable pending per-function contract/caller review. They were not mass-revoked because several appear to be public reads or telemetry endpoints.

### RLS-enabled/no-policy inventory

The broad no-policy findings were not mass-modified. Only tables with clear backend-only/sensitive semantics and verified privilege posture were changed in this P0 slice.

### Leaked-password protection

Leaked-password protection remains disabled on both projects. The currently exposed Supabase connector does not provide an Auth settings mutation action, so this has **not** been represented as fixed.

## Source-control reconciliation

- Canonical replayable migration: `supabase/migrations/20260913174500_p0_control_plane_containment.sql`.
- Legacy project record: `supabase/legacy/fxbkvcrfbbcmrrupdcjt/20260913_p0_containment.sql`.
- The legacy file is deliberately outside `supabase/migrations` to prevent it from replaying against `Here`.

## P0 follow-up queue

1. Replace the four SECURITY DEFINER public views with explicit safe projection/API contracts.
2. Review the remaining 19 legacy anonymous SECURITY DEFINER functions against real caller contracts and logs before additional revocation.
3. Complete the `verify_jwt=false` endpoint matrix with compensating-control evidence for every function.
4. Replace bearer-like download session IDs with one-time, scoped, short-lived entitlement tokens.
5. Add replay protection / signed request semantics to internal worker-style endpoints where appropriate.
6. Enable leaked-password protection through an authorized Auth settings surface when available.
7. Rotate any historically exposed credentials associated with retired/legacy systems; do not record credential material in Git.
8. Continue advisor reruns after each containment wave and record before/after counts.

## Runtime scope limitation

This P0 record covers connected GitHub and Supabase surfaces. It does not claim Kubernetes/host/network runtime hardening; cluster runtime evidence requires direct infrastructure access and is a separate audit lane.
