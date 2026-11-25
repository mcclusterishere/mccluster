-- music_direct_asset_versions_v1: the file a buyer paid for, pinned; downloads that are
-- counted only when a URL was actually issued.
--
-- Repairs two defects found by the 2026-11-09 deep audit (COM-1, COM-2):
--
--   COM-1  music_direct_claim_download() read the offer's CURRENT asset_path, so an
--          owner edit of the offer (a new upload, a retitle) changed what an OLD paid
--          entitlement delivered. Now every offer write records an immutable
--          music_direct_asset_versions row (bucket, path, download name, title) and the
--          offer points at its current one; an order snapshots that version id at
--          insert, the entitlement inherits it from the order, and delivery reads the
--          version row, never the offer. Edits change only future sales.
--   COM-2  the count went up in the same statement that returned the path, before the
--          edge handler signed the URL, so a Storage signing failure burned a slot and
--          the decrement guard (rightly) blocked compensation. Now a download is an
--          ATTEMPT: music_direct_reserve_download() holds capacity for a short window
--          and returns what to sign; music_direct_settle_download() either counts it
--          ('issued', once a signed URL exists) or releases it ('released'). The same
--          attempt key returns the same attempt, so an uncertain client retry does not
--          take a second slot. download_count still only goes up, and only through
--          settlement; the entitlement guard is unchanged.
--
-- Backfill of orders placed before this file: an order gets its offer's current version
-- only when the offer has NOT been edited since the order was created
-- (offers.updated_at <= orders.created_at), which is the only reliable evidence this
-- schema holds. Any other paid order stays unresolved: its downloads refuse with
-- 'asset_unresolved' and it is listed in public.music_direct_asset_review for the owner
-- to resolve by hand (one allowed write of asset_version_id from null). Nothing is
-- silently assigned today's file.
--
-- Depends on 20261031180839_music_direct_sales_v1.sql (applied in production). Applying
-- that file AGAIN after this one would restore its older order/entitlement guards and
-- claim function; re-apply this file after it if that is ever done.
-- Safe to re-run. Rollback: supabase/pending/music_direct_asset_versions_v1.rollback.sql.
-- Test: scripts/test-music-direct-sales-db.sh (supabase/tests/music_direct_asset_versions.behaviour.sql).
set local lock_timeout = '5s';
lock table public.music_direct_offers, public.music_direct_orders,
  public.music_direct_entitlements in access exclusive mode;
-- This rollout was authorized for a verified empty order ledger. Abort if a sale
-- arrived after preflight; normal idempotent reapplication remains supported.
do $$ begin
  if to_regclass('public.music_direct_asset_versions') is null
     and exists (select 1 from public.music_direct_orders) then
    raise exception 'commerce_rollout_orders_changed';
  end if;
end $$;

-- ------------------------------------------------------------------ versions
create table if not exists public.music_direct_asset_versions (
  id uuid primary key default gen_random_uuid(),
  offer_key text not null references public.music_direct_offers(offer_key) on update cascade on delete cascade,
  asset_bucket text not null,
  asset_path text not null,
  download_name text not null,
  title text not null,
  format text generated always as (lower(substring(asset_path from '\.([A-Za-z0-9]+)$'))) stored,
  created_at timestamptz not null default now(),
  constraint music_direct_asset_versions_identity_key unique (offer_key, asset_bucket, asset_path, download_name, title)
);
comment on table public.music_direct_asset_versions is
  'Immutable record of each file/title an offer has sold under. Orders and entitlements pin one; delivery reads it, never the live offer.';
alter table public.music_direct_asset_versions enable row level security;
revoke all on table public.music_direct_asset_versions from public, anon, authenticated;
grant all on table public.music_direct_asset_versions to service_role;

create or replace function public.music_direct_asset_version_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then raise exception 'music_direct_asset_version_immutable'; end if;
  new.created_at := now();
  return new;
end $$;
revoke execute on function public.music_direct_asset_version_guard() from public, anon, authenticated;
drop trigger if exists music_direct_asset_version_guard_trg on public.music_direct_asset_versions;
create trigger music_direct_asset_version_guard_trg before insert or update on public.music_direct_asset_versions
  for each row execute function public.music_direct_asset_version_guard();

alter table public.music_direct_offers
  add column if not exists current_version_id uuid references public.music_direct_asset_versions(id) on delete restrict;
comment on column public.music_direct_offers.current_version_id is
  'The version new orders will pin (set by music_direct_offer_version_trg from the row''s own file/title).';

-- Every offer write has a version row for what it now sells; the offer points at it.
create or replace function public.music_direct_offer_version()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid;
begin
  select id into v_id from public.music_direct_asset_versions
   where offer_key = new.offer_key and asset_bucket = new.asset_bucket and asset_path = new.asset_path
     and download_name = new.download_name and title = new.title;
  if v_id is null then
    insert into public.music_direct_asset_versions(offer_key, asset_bucket, asset_path, download_name, title)
    values (new.offer_key, new.asset_bucket, new.asset_path, new.download_name, new.title)
    returning id into v_id;
  end if;
  if new.current_version_id is distinct from v_id then
    update public.music_direct_offers set current_version_id = v_id where offer_key = new.offer_key;
  end if;
  return null;
end $$;
revoke execute on function public.music_direct_offer_version() from public, anon, authenticated;
drop trigger if exists music_direct_offer_version_trg on public.music_direct_offers;
create trigger music_direct_offer_version_trg after insert or update on public.music_direct_offers
  for each row execute function public.music_direct_offer_version();

-- ------------------------------------------------------------------ pin on orders and entitlements
alter table public.music_direct_orders
  add column if not exists asset_version_id uuid references public.music_direct_asset_versions(id) on delete restrict;
alter table public.music_direct_entitlements
  add column if not exists asset_version_id uuid references public.music_direct_asset_versions(id) on delete restrict;
comment on column public.music_direct_orders.asset_version_id is
  'The exact file/title this order bought. Set at insert from the offer; null only on a pre-2026-11-09 order with no reliable evidence (owner resolves once).';

-- Existing offers get their version rows and pointers BEFORE any backfill touches
-- offers.updated_at (the offer guard bumps it on every write).
insert into public.music_direct_asset_versions(offer_key, asset_bucket, asset_path, download_name, title)
select distinct f.offer_key, f.asset_bucket, f.asset_path, f.download_name, f.title
  from public.music_direct_orders o join public.music_direct_offers f on f.offer_key = o.offer_key
 where o.asset_version_id is null and f.updated_at <= o.created_at
on conflict (offer_key, asset_bucket, asset_path, download_name, title) do nothing;
update public.music_direct_orders o
   set asset_version_id = v.id
  from public.music_direct_offers f
  join public.music_direct_asset_versions v
    on v.offer_key = f.offer_key and v.asset_bucket = f.asset_bucket and v.asset_path = f.asset_path
   and v.download_name = f.download_name and v.title = f.title
 where f.offer_key = o.offer_key and o.asset_version_id is null and f.updated_at <= o.created_at;
update public.music_direct_entitlements e
   set asset_version_id = o.asset_version_id
  from public.music_direct_orders o
 where o.id = e.order_id and e.asset_version_id is null and o.asset_version_id is not null;
-- current pointers for every offer, written directly: an UPDATE through the row would
-- re-check music_direct_offers_private_asset_check (NOT VALID), which a legacy inactive
-- offer fails by design. Such an offer keeps a version (for its old orders) but no
-- pointer, so no new order can be placed on it.
insert into public.music_direct_asset_versions(offer_key, asset_bucket, asset_path, download_name, title)
select offer_key, asset_bucket, asset_path, download_name, title from public.music_direct_offers
on conflict (offer_key, asset_bucket, asset_path, download_name, title) do nothing;
alter table public.music_direct_offers disable trigger music_direct_offer_guard_trg;
alter table public.music_direct_offers disable trigger music_direct_offer_version_trg;
update public.music_direct_offers f
   set current_version_id = v.id
  from public.music_direct_asset_versions v
 where v.offer_key = f.offer_key and v.asset_bucket = f.asset_bucket and v.asset_path = f.asset_path
   and v.download_name = f.download_name and v.title = f.title
   and f.current_version_id is distinct from v.id
   and f.asset_bucket = 'mcc-gated-audio'
   and f.asset_path ~ '^direct-sales/[A-Za-z0-9][A-Za-z0-9/._-]*\.(mp3|m4a|wav|flac)$'
   and position('..' in f.asset_path) = 0 and position('//' in f.asset_path) = 0;
alter table public.music_direct_offers enable trigger music_direct_offer_guard_trg;
alter table public.music_direct_offers enable trigger music_direct_offer_version_trg;

-- Paid orders this schema cannot pin with evidence: the owner's review list.
create or replace view public.music_direct_asset_review with (security_invoker = true) as
  select o.id as order_id, o.offer_key, o.status, o.created_at, o.paid_at, o.customer_email,
         f.updated_at as offer_updated_at, f.asset_path as offer_current_path, f.current_version_id as offer_current_version_id,
         e.id as entitlement_id, e.download_count
    from public.music_direct_orders o
    join public.music_direct_offers f on f.offer_key = o.offer_key
    left join public.music_direct_entitlements e on e.order_id = o.id
   where o.asset_version_id is null and o.status in ('pending', 'failed', 'paid');
revoke all on public.music_direct_asset_review from public, anon, authenticated;
grant select on public.music_direct_asset_review to service_role;

-- orders: snapshot the offer's current version at insert; one allowed null -> value later.
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
    if v_offer.current_version_id is null then raise exception 'music_direct_offer_version_missing'; end if;
    new.asset_version_id := v_offer.current_version_id;
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
  if old.asset_version_id is not null and new.asset_version_id is distinct from old.asset_version_id then
    raise exception 'music_direct_order_asset_immutable';
  end if;
  if new.asset_version_id is not null and old.asset_version_id is null
     and not exists (select 1 from public.music_direct_asset_versions where id = new.asset_version_id and offer_key = new.offer_key) then
    raise exception 'music_direct_order_asset_offer_mismatch';
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

-- an owner resolution on the order flows to its entitlement
create or replace function public.music_direct_order_resolve_asset()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if old.asset_version_id is null and new.asset_version_id is not null then
    update public.music_direct_entitlements set asset_version_id = new.asset_version_id
     where order_id = new.id and asset_version_id is null;
  end if;
  return null;
end $$;
revoke execute on function public.music_direct_order_resolve_asset() from public, anon, authenticated;
drop trigger if exists music_direct_order_resolve_asset_trg on public.music_direct_orders;
create trigger music_direct_order_resolve_asset_trg after update on public.music_direct_orders
  for each row execute function public.music_direct_order_resolve_asset();

-- entitlements: inherit the order's pin; never change it once set.
create or replace function public.music_direct_entitlement_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_order public.music_direct_orders%rowtype; v_offer public.music_direct_offers%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_order from public.music_direct_orders where id = new.order_id;
    if not found or v_order.status <> 'paid' then raise exception 'music_direct_entitlement_needs_paid_order'; end if;
    if new.offer_key is distinct from v_order.offer_key then raise exception 'music_direct_entitlement_offer_mismatch'; end if;
    select * into v_offer from public.music_direct_offers where offer_key = v_order.offer_key;
    new.asset_version_id := v_order.asset_version_id;
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
  if old.asset_version_id is not null and new.asset_version_id is distinct from old.asset_version_id then
    raise exception 'music_direct_entitlement_asset_immutable';
  end if;
  if new.asset_version_id is not null and old.asset_version_id is null
     and new.asset_version_id is distinct from (select asset_version_id from public.music_direct_orders where id = new.order_id) then
    raise exception 'music_direct_entitlement_asset_order_mismatch';
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

-- ------------------------------------------------------------------ download attempts
create table if not exists public.music_direct_download_attempts (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null references public.music_direct_entitlements(id) on delete cascade,
  asset_version_id uuid not null references public.music_direct_asset_versions(id) on delete restrict,
  attempt_key text check (attempt_key ~ '^[A-Za-z0-9._-]{8,80}$'),
  state text not null default 'reserved' check (state in ('reserved', 'issued', 'released')),
  reserved_at timestamptz not null default now(),
  reservation_expires_at timestamptz not null,
  issued_at timestamptz,
  released_at timestamptz,
  constraint music_direct_download_attempts_key_key unique (entitlement_id, attempt_key)
);
comment on table public.music_direct_download_attempts is
  'One row per download attempt: reserved (capacity held, nothing counted), issued (a signed URL was returned; counted), released (signing failed; nothing counted).';
create index if not exists music_direct_download_attempts_open_idx
  on public.music_direct_download_attempts (entitlement_id) where state = 'reserved';
alter table public.music_direct_download_attempts enable row level security;
revoke all on table public.music_direct_download_attempts from public, anon, authenticated;
grant all on table public.music_direct_download_attempts to service_role;

create or replace function public.music_direct_download_attempt_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'reserved' then raise exception 'music_direct_attempt_must_start_reserved'; end if;
    new.reserved_at := now();
    new.issued_at := null;
    new.released_at := null;
    return new;
  end if;
  if new.id is distinct from old.id or new.entitlement_id is distinct from old.entitlement_id
     or new.asset_version_id is distinct from old.asset_version_id or new.attempt_key is distinct from old.attempt_key
     or new.reserved_at is distinct from old.reserved_at then
    raise exception 'music_direct_attempt_immutable';
  end if;
  if old.state <> 'reserved' and new.state is distinct from old.state then
    raise exception 'music_direct_attempt_final: %', old.state;
  end if;
  if new.state = 'issued' and old.state = 'reserved' then new.issued_at := now(); end if;
  if new.state = 'released' and old.state = 'reserved' then new.released_at := now(); end if;
  return new;
end $$;
revoke execute on function public.music_direct_download_attempt_guard() from public, anon, authenticated;
drop trigger if exists music_direct_download_attempt_guard_trg on public.music_direct_download_attempts;
create trigger music_direct_download_attempt_guard_trg before insert or update on public.music_direct_download_attempts
  for each row execute function public.music_direct_download_attempt_guard();

-- What an entitlement is allowed to deliver, under its row lock. Returns the version
-- row too, so callers sign what was bought.
create or replace function public.music_direct_delivery_refusal(e public.music_direct_entitlements)
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_status text;
begin
  if e.revoked_at is not null then return 'revoked'; end if;
  select status into v_status from public.music_direct_orders where id = e.order_id;
  if v_status is distinct from 'paid' then return 'not_paid'; end if;
  if e.expires_at is null or e.expires_at <= now() then return 'expired'; end if;
  if e.asset_version_id is null then return 'asset_unresolved'; end if;
  return null;
end $$;
revoke execute on function public.music_direct_delivery_refusal(public.music_direct_entitlements) from public, anon, authenticated;

-- Hold one download. The same (token, attempt_key) returns the same attempt while it is
-- reserved or already issued (a client retry after a lost response), never a second slot.
create or replace function public.music_direct_reserve_download(p_token uuid, p_attempt_key text default null, p_hold_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare e public.music_direct_entitlements%rowtype; v public.music_direct_asset_versions%rowtype;
        a public.music_direct_download_attempts%rowtype; v_refusal text; v_held integer; v_hold integer;
begin
  v_hold := least(greatest(coalesce(p_hold_seconds, 120), 10), 900);
  select * into e from public.music_direct_entitlements where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_refusal := public.music_direct_delivery_refusal(e);
  if v_refusal is not null then return jsonb_build_object('ok', false, 'reason', v_refusal); end if;
  select * into v from public.music_direct_asset_versions where id = e.asset_version_id;

  if p_attempt_key is not null then
    select * into a from public.music_direct_download_attempts where entitlement_id = e.id and attempt_key = p_attempt_key;
    if found then
      -- Lost-response retries are bounded by the signed URL lifetime, not the whole entitlement.
      if (a.state = 'issued' and a.issued_at > now() - interval '300 seconds')
         or (a.state = 'reserved' and a.reservation_expires_at > now()) then
        return jsonb_build_object('ok', true, 'attempt_id', a.id, 'state', a.state, 'replay', true,
          'title', v.title, 'bucket', v.asset_bucket, 'path', v.asset_path, 'download_name', v.download_name,
          'downloads_left', e.max_downloads - e.download_count - case when a.state = 'reserved' then 1 else 0 end, 'expires_at', e.expires_at);
      end if;
      /* released, or a reservation that lapsed: the key is spent, the client must start a new attempt */
      return jsonb_build_object('ok', false, 'reason', 'attempt_spent', 'attempt_id', a.id, 'state', a.state);
    end if;
  end if;

  /* lapsed holds no longer count */
  update public.music_direct_download_attempts set state = 'released'
   where entitlement_id = e.id and state = 'reserved' and reservation_expires_at <= now();
  select count(*) into v_held from public.music_direct_download_attempts where entitlement_id = e.id and state = 'reserved';
  if e.max_downloads is null or e.download_count + v_held >= e.max_downloads then
    return jsonb_build_object('ok', false, 'reason', 'download_limit');
  end if;
  insert into public.music_direct_download_attempts(entitlement_id, asset_version_id, attempt_key, reservation_expires_at)
  values (e.id, e.asset_version_id, p_attempt_key, now() + make_interval(secs => v_hold))
  returning * into a;
  return jsonb_build_object('ok', true, 'attempt_id', a.id, 'state', a.state, 'replay', false,
    'title', v.title, 'bucket', v.asset_bucket, 'path', v.asset_path, 'download_name', v.download_name,
    'downloads_left', e.max_downloads - e.download_count - 1, 'expires_at', e.expires_at);
end $$;
revoke execute on function public.music_direct_reserve_download(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.music_direct_reserve_download(uuid, text, integer) to service_role;

-- Settle a reserved attempt: 'issued' counts the download (a signed URL exists);
-- 'released' gives the capacity back (signing failed). Idempotent on the same outcome;
-- an issued attempt can never be released, and vice versa.
create or replace function public.music_direct_settle_download(p_attempt uuid, p_outcome text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare a public.music_direct_download_attempts%rowtype; e public.music_direct_entitlements%rowtype;
        v_entitlement uuid; v_refusal text;
begin
  if p_outcome is null or p_outcome not in ('issued', 'released') then return jsonb_build_object('ok', false, 'reason', 'bad_outcome'); end if;
  -- Reserve and settle always lock entitlement BEFORE attempt, including cleanup.
  -- Read the immutable parent id without a lock, then re-read the attempt under both locks.
  select entitlement_id into v_entitlement from public.music_direct_download_attempts where id = p_attempt;
  if not found then return jsonb_build_object('ok', false, 'reason', 'attempt_not_found'); end if;
  select * into e from public.music_direct_entitlements where id = v_entitlement for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'attempt_not_found'); end if;
  select * into a from public.music_direct_download_attempts where id = p_attempt for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'attempt_not_found'); end if;
  -- Signing happens outside the transaction. Recheck eligibility at the delivery commit.
  if p_outcome = 'issued' then
    v_refusal := public.music_direct_delivery_refusal(e);
    if v_refusal is not null then
      if a.state = 'reserved' then
        update public.music_direct_download_attempts set state = 'released' where id = a.id;
      end if;
      return jsonb_build_object('ok', false, 'reason', v_refusal);
    end if;
    if a.state = 'issued' and a.issued_at <= now() - interval '300 seconds' then
      return jsonb_build_object('ok', false, 'reason', 'attempt_spent', 'state', a.state);
    end if;
    if a.state = 'reserved' and a.reservation_expires_at <= now() then
      update public.music_direct_download_attempts set state = 'released' where id = a.id;
      return jsonb_build_object('ok', false, 'reason', 'attempt_spent', 'state', 'released');
    end if;
  end if;
  if a.state = p_outcome then
    return jsonb_build_object('ok', true, 'state', a.state, 'replay', true, 'downloads_left', e.max_downloads - e.download_count);
  end if;
  if a.state <> 'reserved' then return jsonb_build_object('ok', false, 'reason', 'attempt_final', 'state', a.state); end if;
  if p_outcome = 'issued' then
    /* the entitlement guard refuses a count past the limit: a lapsed hold that lost its slot fails here, closed */
    update public.music_direct_entitlements set download_count = download_count + 1, last_download_at = now() where id = e.id
      returning * into e;
  end if;
  update public.music_direct_download_attempts set state = p_outcome where id = a.id;
  return jsonb_build_object('ok', true, 'state', p_outcome, 'replay', false, 'downloads_left', e.max_downloads - e.download_count);
end $$;
revoke execute on function public.music_direct_settle_download(uuid, text) from public, anon, authenticated;
grant execute on function public.music_direct_settle_download(uuid, text) to service_role;

-- Legacy one-step claim (reserve + count in one statement), now version-pinned. Kept for
-- callers that cannot settle; music-direct-access uses reserve/settle instead.
create or replace function public.music_direct_claim_download(p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb; s jsonb;
begin
  r := public.music_direct_reserve_download(p_token, null, 10);
  if not (r->>'ok')::boolean then return r; end if;
  s := public.music_direct_settle_download((r->>'attempt_id')::uuid, 'issued');
  if not (s->>'ok')::boolean then return s; end if;
  return (r - 'replay' - 'state') || jsonb_build_object('downloads_left', s->'downloads_left');
end $$;
revoke execute on function public.music_direct_claim_download(uuid) from public, anon, authenticated;
grant execute on function public.music_direct_claim_download(uuid) to service_role;

