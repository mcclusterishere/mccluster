-- Rollback for supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql (applied 2026-11-09).
-- Removes the attempt and version tables, the pins on orders/entitlements, the review
-- view and the reserve/settle functions, and restores the v1 order/entitlement guards
-- and the v1 one-step claim (which reads the LIVE offer and counts before signing: the
-- two audited defects return). The record of which file each order bought is LOST.
-- Run BEFORE music_direct_sales_v1.rollback.sql if both are being rolled back.
set local lock_timeout = '5s';

drop function if exists public.music_direct_claim_download(uuid);
drop function if exists public.music_direct_settle_download(uuid, text);
drop function if exists public.music_direct_reserve_download(uuid, text, integer);
drop function if exists public.music_direct_delivery_refusal(public.music_direct_entitlements);
drop table if exists public.music_direct_download_attempts;
drop trigger if exists music_direct_order_resolve_asset_trg on public.music_direct_orders;
drop function if exists public.music_direct_order_resolve_asset();
drop view if exists public.music_direct_asset_review;
drop trigger if exists music_direct_offer_version_trg on public.music_direct_offers;
drop function if exists public.music_direct_offer_version();
alter table public.music_direct_entitlements drop column if exists asset_version_id;
alter table public.music_direct_orders drop column if exists asset_version_id;
alter table public.music_direct_offers drop column if exists current_version_id;
drop table if exists public.music_direct_asset_versions;
drop function if exists public.music_direct_asset_version_guard();

-- v1 guards, verbatim from 20261031180839_music_direct_sales_v1.sql
create or replace function public.music_direct_order_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_offer public.music_direct_offers%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_offer from public.music_direct_offers where offer_key = new.offer_key;
    if not found then raise exception 'music_direct_offer_missing'; end if;
    if new.status is distinct from 'pending' then raise exception 'music_direct_order_must_start_pending'; end if;
    if coalesce(new.stripe_checkout_session_id, '') !~ '^cs_(test|live)_[A-Za-z0-9]+$' then
      raise exception 'music_direct_order_session_required';
    end if;
    if new.amount_cents is distinct from v_offer.price_cents or lower(new.currency) is distinct from lower(v_offer.currency) then
      raise exception 'music_direct_order_price_mismatch';
    end if;
    new.currency := lower(new.currency);
    new.paid_at := null;
    new.refunded_at := null;
    new.stripe_payment_intent_id := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id or new.offer_key is distinct from old.offer_key
     or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency
     or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
     or new.created_at is distinct from old.created_at then
    raise exception 'music_direct_order_terms_immutable';
  end if;
  if old.stripe_payment_intent_id is not null and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id then
    raise exception 'music_direct_order_payment_immutable';
  end if;
  if old.customer_email is not null then new.customer_email := old.customer_email; end if;
  if new.status is distinct from old.status then
    if not ((old.status in ('pending', 'failed') and new.status in ('paid', 'failed', 'canceled'))
         or (old.status = 'paid' and new.status = 'refunded')) then
      raise exception 'music_direct_order_bad_transition: % -> %', old.status, new.status;
    end if;
  end if;
  if new.status = 'paid' and old.status <> 'paid' then new.paid_at := now(); else new.paid_at := old.paid_at; end if;
  if new.status = 'refunded' and old.status <> 'refunded' then new.refunded_at := now(); else new.refunded_at := old.refunded_at; end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.music_direct_entitlement_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_order public.music_direct_orders%rowtype; v_offer public.music_direct_offers%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_order from public.music_direct_orders where id = new.order_id;
    if not found or v_order.status <> 'paid' then raise exception 'music_direct_entitlement_needs_paid_order'; end if;
    if new.offer_key is distinct from v_order.offer_key then raise exception 'music_direct_entitlement_offer_mismatch'; end if;
    select * into v_offer from public.music_direct_offers where offer_key = v_order.offer_key;
    new.token := gen_random_uuid();
    new.max_downloads := v_offer.max_downloads;
    new.expires_at := now() + make_interval(days => v_offer.download_window_days);
    new.download_count := 0;
    new.last_download_at := null;
    new.revoked_at := null;
    new.created_at := now();
    new.customer_email := coalesce(nullif(lower(new.customer_email), ''), v_order.customer_email);
    return new;
  end if;

  if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.offer_key is distinct from old.offer_key
     or new.token is distinct from old.token or new.created_at is distinct from old.created_at then
    raise exception 'music_direct_entitlement_immutable';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'music_direct_entitlement_revocation_final';
  end if;
  if new.max_downloads is null or new.max_downloads < old.max_downloads then raise exception 'music_direct_entitlement_limit_shrink'; end if;
  if new.expires_at is null or new.expires_at < old.expires_at then raise exception 'music_direct_entitlement_expiry_shrink'; end if;
  if new.download_count < old.download_count then raise exception 'music_direct_entitlement_count_decrease'; end if;
  if new.download_count > new.max_downloads then raise exception 'music_direct_entitlement_over_limit'; end if;
  return new;
end $$;

create or replace function public.music_direct_claim_download(p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare e public.music_direct_entitlements%rowtype; v_status text; f public.music_direct_offers%rowtype;
begin
  select * into e from public.music_direct_entitlements where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if e.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  select status into v_status from public.music_direct_orders where id = e.order_id;
  if v_status is distinct from 'paid' then return jsonb_build_object('ok', false, 'reason', 'not_paid'); end if;
  if e.expires_at is null or e.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if e.max_downloads is null or e.download_count >= e.max_downloads then return jsonb_build_object('ok', false, 'reason', 'download_limit'); end if;
  update public.music_direct_entitlements set download_count = download_count + 1, last_download_at = now() where id = e.id;
  select * into f from public.music_direct_offers where offer_key = e.offer_key;
  return jsonb_build_object('ok', true, 'title', f.title, 'bucket', f.asset_bucket, 'path', f.asset_path,
    'download_name', f.download_name, 'downloads_left', e.max_downloads - e.download_count - 1, 'expires_at', e.expires_at);
end $$;
revoke execute on function public.music_direct_claim_download(uuid) from public, anon, authenticated;
grant execute on function public.music_direct_claim_download(uuid) to service_role;

