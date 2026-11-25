-- Rollback for supabase/pending/music_direct_sales_v1.sql. Removes the guards, the
-- fulfilment and download functions, the public read policy and the added columns,
-- returning the three tables to the shape production had before (service role only).
-- The per-entitlement limit/expiry record is LOST. The functions music-direct-checkout,
-- music-direct-access and stripe-webhook (direct-sale branch) then fail closed: redeploy
-- or disable them first if the rollback is meant to keep selling.
set local lock_timeout = '5s';

drop function if exists public.music_direct_claim_download(uuid);
drop function if exists public.music_direct_fulfil(uuid, text, integer, text, text, text);

drop trigger if exists music_direct_entitlement_guard_trg on public.music_direct_entitlements;
drop function if exists public.music_direct_entitlement_guard();
drop trigger if exists music_direct_order_revoke_trg on public.music_direct_orders;
drop function if exists public.music_direct_order_revoke();
drop trigger if exists music_direct_order_guard_trg on public.music_direct_orders;
drop function if exists public.music_direct_order_guard();
drop trigger if exists music_direct_offer_guard_trg on public.music_direct_offers;
drop function if exists public.music_direct_offer_guard();

drop policy if exists music_direct_offers_public_read on public.music_direct_offers;
revoke all on table public.music_direct_offers from public, anon, authenticated;
grant all on table public.music_direct_offers to service_role;

alter table public.music_direct_offers
  drop constraint if exists music_direct_offers_max_downloads_check,
  drop constraint if exists music_direct_offers_window_check,
  drop constraint if exists music_direct_offers_sale_window_check,
  drop constraint if exists music_direct_offers_price_max_check,
  drop constraint if exists music_direct_offers_private_asset_check,
  drop constraint if exists music_direct_offers_download_name_check,
  drop constraint if exists music_direct_offers_title_check,
  drop constraint if exists music_direct_offers_catalog_key_fkey,
  drop column if exists format,
  drop column if exists max_downloads,
  drop column if exists download_window_days,
  drop column if exists sale_starts_at,
  drop column if exists sale_ends_at;
comment on column public.music_direct_offers.campaign_key is null;

alter table public.music_direct_entitlements
  drop column if exists max_downloads,
  drop column if exists expires_at;
