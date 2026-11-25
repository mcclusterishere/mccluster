# Direct music sales migration — 2026-10-31

Applied to `zmnhbrjyhxzhkxmhkexs` with Supabase apply_migration: `20261031180839_music_direct_sales_v1`. Promoted SQL matches the recorded statement byte for byte. Ledger and Core drift contract: 355 migrations; SHA-256 `1bcd0b6d4bf143c0b4b9917d8a5a2994e8be5ffcf3f75eb2c94a06d85f75eecd`.

Preflight: zero orders, entitlements and active offers. The inactive legacy offer remains intact. No campaigns, missions, drafts, offers or media were deleted.

Post-apply: four guards installed; anon cannot select asset_path or execute download RPC; service_role can execute it. The direct-sales advisor finding is informational RLS-with-no-public-policy for private tables. Snapshot committed. Manifest affected rows regenerated from an isolated database whose baseline direct-sales rows matched the existing reset manifest; CI verifies the full reset.

Validation: 1,321 JS and 7 Python tests, isolated database apply twice, fulfilment/session/price binding, role access, refunds, limits, rollback/reapply and inactive legacy preservation pass. Production schema differences outside this migration remain; this is not a claim of zero overall schema drift.

## Remaining work

PR #678 must pass CI and deploy the checkout, access and webhook code. Do not reapply the old pending path. No cleanup of campaigns or missions is required for this migration.

Production has no active sale offers or direct-sales private files. The catalog has 20 tracks across eight existing albums; creator_tracks is empty and Storage has no uploads after 2026-10-29 at inspection. The owner reports two new albums: their names and upload locations remain unidentified. They want both track and whole-album purchases; v1 provides individual-recording checkout only. Album bundles require their own purchase-to-track entitlement contract. Prices, private masters and sandbox purchase/download/refund proof remain outstanding. No live charge was made.

Merch schema, leaked-password protection and Stripe business details are separate tasks, not completed by this migration.
