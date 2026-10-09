# Creator billing production database checkpoint — 2026-10-09

Applied via connected Supabase migration API to project `zmnhbrjyhxzhkxmhkexs`:

- `creator_billing_subscriptions_v1` from `supabase/migrations/pending/20261009170000_creator_billing_subscriptions.sql`
- `creator_published_sites_v1` from `supabase/migrations/pending/20261009173000_creator_published_sites.sql`

Both returned success. Follow-up table listing confirmed `creator_billing_subscriptions`, `creator_billing_events`, and `creator_published_sites` exist with RLS enabled and zero rows.

**Do not reapply these migrations.** Reconcile the repository migration ledger against the actual remote versions before promoting the files out of `pending/`. No test subscriptions or production entitlements were inserted.

## Remaining launch gates

1. CI must pass on the newest Creator Studio changes.
2. Configure matching Stripe **test-mode** products/prices and Worker secrets. Keep live-mode checkout disabled.
3. Configure a test-mode webhook destination and signing secret; verify valid, invalid, replayed and out-of-order events.
4. Confirm service-role-only RPC access and verify a genuine paid subscription provisions exactly one workspace.
5. Confirm cancellation/payment failure blocks publishing and public delivery, and confirm one tenant cannot access another tenant's content.
6. Verify production deployment and routes. The backend may not be deployed simply because migrations succeeded.

Security note: public-site HTML is intentionally text-only. The platform must not accept arbitrary HTML or scripts.
