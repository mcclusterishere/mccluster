-- Rollback for supabase/pending/merch_marketplace_v1.sql.
-- Drops the merch marketplace tables, functions and guards. The
-- marketplace-media bucket is removed only when it is empty (Storage keeps
-- the objects otherwise; delete them through the Storage API first).
-- The seller orgs, their org_members and org_stripe_accounts rows are left
-- in place: they are ordinary Client Connect tenants and may hold a real
-- Stripe account. Paid orders are evidence: export them before running this.

drop function if exists public.marketplace_order_by_token(text);
drop function if exists public.marketplace_order_seller_update(uuid, uuid, text, text, text, uuid);
drop function if exists public.marketplace_order_record_refund(jsonb);
drop function if exists public.marketplace_order_mark_paid(jsonb);
drop function if exists public.marketplace_order_release(uuid, text);
drop function if exists public.marketplace_order_attach_session(uuid, text);
drop function if exists public.marketplace_order_create(uuid, uuid, integer, boolean, text);
drop function if exists public.marketplace_listing_set_removed(uuid, uuid, boolean, text);
drop function if exists public.marketplace_listing_request_publish(uuid, uuid);
drop function if exists public.marketplace_seller_set_status(uuid, text, uuid, text);
drop function if exists public.marketplace_seller_apply(uuid, text, text, text, boolean);
drop function if exists public.marketplace_public_listings(text, uuid);

drop table if exists public.marketplace_orders cascade;
drop table if exists public.marketplace_variants cascade;
drop table if exists public.marketplace_listings cascade;
drop table if exists public.marketplace_assets cascade;
drop table if exists public.marketplace_seller_providers cascade;
drop table if exists public.marketplace_sellers cascade;

drop function if exists public.marketplace_order_no_delete();
drop function if exists public.marketplace_order_guard();
drop function if exists public.marketplace_variant_guard();
drop function if exists public.marketplace_listing_guard();
drop function if exists public.marketplace_seller_guard();
drop function if exists public.marketplace_listing_visible(uuid);
drop function if exists public.marketplace_rail_ready(uuid, boolean);
drop function if exists public.marketplace_audit(uuid, uuid, text, text, text, jsonb);
drop function if exists public.marketplace_privileged();
drop function if exists public.marketplace_platform_fee_cents(integer);
drop function if exists public.marketplace_platform_fee_bps();

delete from storage.buckets b
 where b.id = 'marketplace-media'
   and not exists (select 1 from storage.objects o where o.bucket_id = 'marketplace-media');
