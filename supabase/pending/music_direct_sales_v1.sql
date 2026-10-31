-- music_direct_sales_v1: Matthew McCluster's direct checkout for his own recordings
-- (owner, 2026-10-30: "I definitely need a direct checkout for all the music.").
--
-- The three tables already exist in production (created by hand; brought into Git by
-- supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql).
-- This file makes them safe to sell from:
--
--   offers   : one per catalogue recording (FK to public.music_catalog_objects), price
--              50..50000 cents, the full-quality file only in the PRIVATE bucket
--              mcc-gated-audio under direct-sales/ (its format, derived from the file,
--              is public; the path is not), a per-offer download limit
--              (max_downloads, default 5) and window (download_window_days, default 30),
--              an optional sale window. The public (anon/authenticated) may read ONLY
--              offers on sale now, and only the columns a buy button needs: never the
--              bucket, path or file name.
--   orders   : created pending with the server's stored Checkout Session id, at the
--              offer's price (checked here, not trusted from the caller); the session,
--              amount, currency and offer are immutable; paid only from pending/failed;
--              paid -> refunded is the only way out of paid; a refund revokes the
--              entitlement in the same transaction.
--   entitlements: only for a paid order, offer equal to the order's, the token a
--              server-random uuid (never caller-chosen), limit and expiry snapshotted
--              from the offer at grant time; the count only goes up and never past the
--              limit; a revocation cannot be undone.
--   music_direct_fulfil(): the one writer of "paid" + the entitlement, re-binding the
--              order to the session id, amount and currency it was created with.
--   music_direct_claim_download(): counts one download under a row lock and returns the
--              private object to sign, or why not.
-- orders and entitlements stay service-role only. Every function is service-role only.
--
-- Callers: supabase/functions/music-direct-checkout, music-direct-access, stripe-webhook.
-- Test: scripts/test-music-direct-sales-db.sh (supabase/tests/music_direct_sales.behaviour.sql).
-- Rollback: music_direct_sales_v1.rollback.sql.
-- Existing inactive legacy offers may remain without moving or deleting their bytes.
-- The private-path constraint is NOT VALID only for existing rows; every insert
-- and update must satisfy it, so a legacy offer cannot be reactivated in place.
-- Preflight must reject any ACTIVE offer outside the new private-path contract.
-- Validate the constraint after legacy rows have been repaired through the operator.
-- Pre-check before apply (orders and entitlements must be 0):
--   select count(*) from public.music_direct_offers;
--   select count(*) from public.music_direct_orders;
--   select count(*) from public.music_direct_entitlements;
set local lock_timeout = '5s';

-- Keep rollout fail-closed if sales changed after the read-only preflight.
do $preflight$ begin
  if exists(select 1 from public.music_direct_orders)
     or exists(select 1 from public.music_direct_entitlements) then
    raise exception 'music_direct_rollout_requires_purchase_review';
  end if;
  if exists(select 1 from public.music_direct_offers where active and not (
    asset_bucket = 'mcc-gated-audio'
    and asset_path ~ '^direct-sales/[A-Za-z0-9][A-Za-z0-9/._-]*\.(mp3|m4a|wav|flac)$'
    and position('..' in asset_path)=0 and position('//' in asset_path)=0)) then
    raise exception 'music_direct_rollout_active_legacy_offer';
  end if;
end $preflight$;


-- ------------------------------------------------------------------ offers
alter table public.music_direct_offers
  add column if not exists max_downloads integer not null default 5,
  add column if not exists download_window_days integer not null default 30,
  add column if not exists sale_starts_at timestamptz,
  add column if not exists sale_ends_at timestamptz;

do $c$ begin
  alter table public.music_direct_offers add constraint music_direct_offers_max_downloads_check
    check (max_downloads between 1 and 50);
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.music_direct_offers add constraint music_direct_offers_window_check
    check (download_window_days between 1 and 365);
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.music_direct_offers add constraint music_direct_offers_sale_window_check
    check (sale_starts_at is null or sale_ends_at is null or sale_ends_at > sale_starts_at);
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.music_direct_offers add constraint music_direct_offers_price_max_check
    check (price_cents <= 50000);
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.music_direct_offers add constraint music_direct_offers_private_asset_check
    check (asset_bucket = 'mcc-gated-audio'
       and asset_path ~ '^direct-sales/[A-Za-z0-9][A-Za-z0-9/._-]*\.(mp3|m4a|wav|flac)$'
       and position('..' in asset_path) = 0 and position('//' in asset_path) = 0) not valid;
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.music_direct_offers add constraint music_direct_offers_download_name_check
    check (char_length(download_name) between 1 and 200 and download_name !~ '[/\\]');
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.music_direct_offers add constraint music_direct_offers_title_check
    check (char_length(title) between 1 and 200);
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.music_direct_offers add constraint music_direct_offers_catalog_key_fkey
    foreign key (catalog_key) references public.music_catalog_objects(catalog_key) on update cascade on delete restrict;
exception when duplicate_object then null; end $c$;

-- The format a buyer receives is the private file's own type, delivered unconverted.
-- Derived from asset_path by the database (so it can never disagree with the file),
-- and the only thing about the file the public may read.
alter table public.music_direct_offers
  add column if not exists format text generated always as (lower(substring(asset_path from '\.([A-Za-z0-9]+)$'))) stored;
comment on column public.music_direct_offers.format is
  'Delivered format (mp3, m4a, wav, flac): the private file''s extension, never converted. Public; the path is not.';

comment on column public.music_direct_offers.campaign_key is
  'Legacy, optional: direct sales are not tied to a campaign page. Not read by the functions.';
comment on column public.music_direct_offers.max_downloads is 'Downloads each purchase gets (snapshotted onto the entitlement at grant).';
comment on column public.music_direct_offers.download_window_days is 'Days from purchase in which the downloads can be used (snapshotted onto the entitlement at grant).';

create or replace function public.music_direct_offer_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  new.updated_at := now();
  new.currency := lower(new.currency);
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if new.offer_key <> old.offer_key then raise exception 'music_direct_offer_key_immutable'; end if;
  end if;
  return new;
end $$;
revoke execute on function public.music_direct_offer_guard() from public, anon, authenticated;
drop trigger if exists music_direct_offer_guard_trg on public.music_direct_offers;
create trigger music_direct_offer_guard_trg before insert or update on public.music_direct_offers
  for each row execute function public.music_direct_offer_guard();

-- Public read: offers on sale now, buy-button columns only.
alter table public.music_direct_offers enable row level security;
revoke all on table public.music_direct_offers from public, anon, authenticated;
grant select (offer_key, catalog_key, title, price_cents, currency, format, active, sale_starts_at, sale_ends_at)
  on table public.music_direct_offers to anon, authenticated;
grant all on table public.music_direct_offers to service_role;
drop policy if exists music_direct_offers_public_read on public.music_direct_offers;
create policy music_direct_offers_public_read on public.music_direct_offers
  for select to anon, authenticated
  using (active and (sale_starts_at is null or sale_starts_at <= now()) and (sale_ends_at is null or sale_ends_at > now()));

-- ------------------------------------------------------------------ entitlements: columns first (the order trigger revokes)
alter table public.music_direct_entitlements
  add column if not exists max_downloads integer,
  add column if not exists expires_at timestamptz;

-- ------------------------------------------------------------------ orders
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
revoke execute on function public.music_direct_order_guard() from public, anon, authenticated;
drop trigger if exists music_direct_order_guard_trg on public.music_direct_orders;
create trigger music_direct_order_guard_trg before insert or update on public.music_direct_orders
  for each row execute function public.music_direct_order_guard();

-- A refund (the only way out of paid) revokes the entitlement in the same transaction.
create or replace function public.music_direct_order_revoke()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if old.status = 'paid' and new.status <> 'paid' then
    update public.music_direct_entitlements set revoked_at = now()
     where order_id = new.id and revoked_at is null;
  end if;
  return null;
end $$;
revoke execute on function public.music_direct_order_revoke() from public, anon, authenticated;
drop trigger if exists music_direct_order_revoke_trg on public.music_direct_orders;
create trigger music_direct_order_revoke_trg after update on public.music_direct_orders
  for each row execute function public.music_direct_order_revoke();

alter table public.music_direct_orders enable row level security;
revoke all on table public.music_direct_orders from public, anon, authenticated;
grant all on table public.music_direct_orders to service_role;

-- ------------------------------------------------------------------ entitlements
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
  /* the owner may be generous (more downloads, a later expiry), never take back */
  if new.max_downloads is null or new.max_downloads < old.max_downloads then raise exception 'music_direct_entitlement_limit_shrink'; end if;
  if new.expires_at is null or new.expires_at < old.expires_at then raise exception 'music_direct_entitlement_expiry_shrink'; end if;
  if new.download_count < old.download_count then raise exception 'music_direct_entitlement_count_decrease'; end if;
  if new.download_count > new.max_downloads then raise exception 'music_direct_entitlement_over_limit'; end if;
  return new;
end $$;
revoke execute on function public.music_direct_entitlement_guard() from public, anon, authenticated;
drop trigger if exists music_direct_entitlement_guard_trg on public.music_direct_entitlements;
create trigger music_direct_entitlement_guard_trg before insert or update on public.music_direct_entitlements
  for each row execute function public.music_direct_entitlement_guard();

alter table public.music_direct_entitlements enable row level security;
revoke all on table public.music_direct_entitlements from public, anon, authenticated;
grant all on table public.music_direct_entitlements to service_role;

-- ------------------------------------------------------------------ fulfilment
-- Called after the edge code has checked the Stripe side (platform account, paid,
-- payment mode). Re-binds here: the stored session, amount and currency.
create or replace function public.music_direct_fulfil(
  p_order uuid, p_session text, p_amount_cents integer, p_currency text, p_payment_intent text, p_email text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare o public.music_direct_orders%rowtype; v_newly boolean := false;
begin
  select * into o from public.music_direct_orders where id = p_order for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'order_not_found'); end if;
  if o.stripe_checkout_session_id is distinct from p_session then return jsonb_build_object('ok', false, 'reason', 'session_mismatch'); end if;
  if o.amount_cents is distinct from p_amount_cents then return jsonb_build_object('ok', false, 'reason', 'amount_mismatch'); end if;
  if lower(o.currency) is distinct from lower(coalesce(p_currency, '')) then return jsonb_build_object('ok', false, 'reason', 'currency_mismatch'); end if;
  if o.status in ('pending', 'failed') then
    update public.music_direct_orders
       set status = 'paid',
           stripe_payment_intent_id = coalesce(stripe_payment_intent_id, nullif(p_payment_intent, '')),
           customer_email = coalesce(customer_email, nullif(lower(p_email), ''))
     where id = o.id;
    v_newly := true;
  elsif o.status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'order_not_payable', 'status', o.status);
  end if;
  insert into public.music_direct_entitlements (order_id, offer_key, customer_email)
  values (o.id, o.offer_key, nullif(lower(p_email), ''))
  on conflict (order_id) do nothing;
  return jsonb_build_object('ok', true, 'newly_paid', v_newly, 'order_id', o.id);
end $$;
revoke execute on function public.music_direct_fulfil(uuid, text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.music_direct_fulfil(uuid, text, integer, text, text, text) to service_role;

-- ------------------------------------------------------------------ one download
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
  /* an offer taken off sale still delivers what was bought */
  select * into f from public.music_direct_offers where offer_key = e.offer_key;
  return jsonb_build_object('ok', true, 'title', f.title, 'bucket', f.asset_bucket, 'path', f.asset_path,
    'download_name', f.download_name, 'downloads_left', e.max_downloads - e.download_count - 1, 'expires_at', e.expires_at);
end $$;
revoke execute on function public.music_direct_claim_download(uuid) from public, anon, authenticated;
grant execute on function public.music_direct_claim_download(uuid) to service_role;
