// The platform's commission on a creator music licence sale.
//
// One server-side number. The creator never sets it: the offer row's
// platform_fee_bps is not read here (a creator could write it before
// supabase/pending/music_release_payment_integrity_v1.sql pinned it), and the
// database's public.music_platform_fee_bps() returns the same constant, which
// public.music_order_guard() enforces on every music_orders row.
// scripts/test/music-payment-integrity.test.mjs holds the two equal.
export const MUSIC_PLATFORM_FEE_BPS = 1500;

export function musicPlatformFee(priceCents: number): { platformFeeCents: number; creatorNetCents: number } {
  if (!Number.isSafeInteger(priceCents) || priceCents < 1) throw new Error("invalid_price");
  const platformFeeCents = Math.round(priceCents * MUSIC_PLATFORM_FEE_BPS / 10000);
  return { platformFeeCents, creatorNetCents: priceCents - platformFeeCents };
}
