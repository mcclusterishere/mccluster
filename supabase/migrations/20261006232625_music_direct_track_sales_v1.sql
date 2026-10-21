-- Historical production migration registration (2026-10-14).
-- Supabase production records 20261006232625_music_direct_track_sales_v1 as applied.
-- Its original DDL is not present in this repository. DO NOT invent or replay DDL.
-- This migration is a historical anchor, NOT a reconstruction of music sales schema.
-- Existing installations must retain their music sales objects and data.
-- Fresh bootstraps may omit historical music-sales objects; music sales tests
-- must separately validate required schema. This is not full schema parity.
DO $historical_music_sales$
BEGIN
  IF to_regclass('public.music_direct_orders') IS NULL THEN
    RAISE NOTICE 'Historical music sales table absent on clean bootstrap; original DDL unavailable; skipping anchor';
  END IF;
END
$historical_music_sales$;
