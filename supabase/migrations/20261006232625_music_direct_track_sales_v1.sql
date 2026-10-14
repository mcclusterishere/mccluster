-- Historical production migration registration (2026-10-14).
-- Supabase production records 20261006232625_music_direct_track_sales_v1 as applied.
-- Its original DDL is not present in this repository. DO NOT invent or replay DDL.
-- This migration is a historical anchor, NOT a reconstruction of music sales schema.
-- Existing installations must retain their music sales objects and data.
-- Fresh database bootstraps MUST separately establish the original schema baseline;
-- this file does not provide it and must not be interpreted as end-to-end parity.
DO $historical_music_sales$
BEGIN
  IF to_regclass('public.music_direct_orders') IS NULL THEN
    RAISE EXCEPTION 'Missing music_direct_orders: restore verified historical music sales schema before continuing';
  END IF;
END
$historical_music_sales$;
