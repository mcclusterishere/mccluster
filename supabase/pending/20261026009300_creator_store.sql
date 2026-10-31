-- Staged only. Fixed-price USD goods/services; Stripe remains payment authority.
create table public.creator_products(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.orgs(id),
 title text not null check(length(trim(title)) between 1 and 120),
 description text not null default '' check(length(description)<=4000),
 kind text not null check(kind in ('physical','service')),
 amount_cents integer not null check(amount_cents between 50 and 1000000),
 currency text not null default 'usd' check(currency='usd'),
 status text not null default 'draft' check(status in ('draft','live','archived')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.creator_store_orders(
 id uuid primary key,product_id uuid not null references public.creator_products(id),org_id uuid not null references public.orgs(id),
 title text not null,kind text not null,amount_cents integer not null,currency text not null,
 livemode boolean not null default false,refunded_cents integer not null default 0 check(refunded_cents between 0 and amount_cents),
 stripe_account_id text not null,checkout_session_id text unique,payment_intent_id text unique,
 status text not null default 'pending' check(status in ('pending','paid','fulfilled','payment_review','partially_refunded','refunded')),
 buyer_email text,shipping_details jsonb,access_hash text not null,
 fulfillment_note text not null default '' check(length(fulfillment_note)<=2000),
 paid_at timestamptz,fulfilled_at timestamptz,created_at timestamptz not null default now()
);
create table public.creator_store_events(event_id text primary key,order_id uuid not null references public.creator_store_orders(id),created_at timestamptz not null default now());
alter table public.creator_products enable row level security;
alter table public.creator_store_orders enable row level security;
alter table public.creator_store_events enable row level security;
revoke all on public.creator_products,public.creator_store_orders,public.creator_store_events from public,anon,authenticated;
grant all on public.creator_products,public.creator_store_orders,public.creator_store_events to service_role;
create index creator_products_org on public.creator_products(org_id,created_at);
create index creator_store_orders_org on public.creator_store_orders(org_id,created_at);

create or replace function public.reserve_creator_store_order(p_id uuid,p_product uuid,p_access_hash text,p_livemode boolean)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare product public.creator_products;rail public.org_stripe_accounts; existing public.creator_store_orders;
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 if p_id is null or p_access_hash is null or p_access_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid checkout request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into existing from public.creator_store_orders where id=p_id;
 if found then
  if existing.livemode is distinct from p_livemode or existing.product_id<>p_product or existing.access_hash<>p_access_hash then raise exception 'checkout request conflict'; end if;
  if existing.created_at<now()-interval '23 hours' then raise exception 'checkout request expired'; end if;
  if existing.status<>'pending' then return to_jsonb(existing); end if;
 end if;
 select * into product from public.creator_products where id=p_product and status='live' for share;
 if not found then raise exception 'product unavailable'; end if;
 if not exists(select 1 from public.creator_billing_subscriptions where org_id=product.org_id and status='active' and current_period_end>now()) then raise exception 'seller plan inactive'; end if;
 select * into rail from public.org_stripe_accounts where org_id=product.org_id and livemode=p_livemode and charges_enabled and payouts_enabled and details_submitted and stripe_account_id is not null;
 if not found then raise exception 'seller payments unavailable'; end if;
 if existing.id is not null then
  if rail.stripe_account_id<>existing.stripe_account_id then raise exception 'seller payment account changed'; end if;
  return to_jsonb(existing);
 end if;
 insert into public.creator_store_orders(id,product_id,org_id,title,kind,amount_cents,currency,stripe_account_id,access_hash,livemode)
 values(p_id,product.id,product.org_id,product.title,product.kind,product.amount_cents,product.currency,rail.stripe_account_id,p_access_hash,p_livemode) returning * into existing;
 return to_jsonb(existing);
end $$;

create or replace function public.record_creator_store_payment(p_event text,p_order uuid,p_session text,p_account text,p_intent text,p_amount integer,p_currency text,p_email text,p_shipping jsonb,p_paid_at timestamptz,p_livemode boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare target public.creator_store_orders; prior uuid;
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 select * into target from public.creator_store_orders where id=p_order for update;
 if not found then raise exception 'unknown order'; end if;
 select order_id into prior from public.creator_store_events where event_id=p_event;
 if found then
  if prior<>p_order then raise exception 'event reuse'; end if;
  return jsonb_build_object('status',target.status,'duplicate',true);
 end if;
 if p_livemode is distinct from target.livemode or p_intent is null or p_intent !~ '^pi_[A-Za-z0-9]+$' or (target.payment_intent_id is not null and target.payment_intent_id<>p_intent) or p_session is null or p_account is distinct from target.stripe_account_id or p_amount is distinct from target.amount_cents or p_currency is distinct from target.currency or target.checkout_session_id is distinct from p_session then raise exception 'payment does not match immutable order'; end if;
 update public.creator_store_orders set checkout_session_id=p_session,payment_intent_id=p_intent,status=case when status='pending' then 'paid' else status end,buyer_email=left(p_email,320),shipping_details=p_shipping,paid_at=coalesce(paid_at,p_paid_at) where id=p_order;
 insert into public.creator_store_events(event_id,order_id) values(p_event,p_order);
 return jsonb_build_object('status',case when target.status='pending' then 'paid' else target.status end,'duplicate',false);
end $$;
revoke all on function public.reserve_creator_store_order(uuid,uuid,text,boolean),public.record_creator_store_payment(text,uuid,text,text,text,integer,text,text,jsonb,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.reserve_creator_store_order(uuid,uuid,text,boolean),public.record_creator_store_payment(text,uuid,text,text,text,integer,text,text,jsonb,timestamptz,boolean) to service_role;

-- Record dashboard/provider refunds without initiating money movement.
create or replace function public.record_creator_store_refund(p_event text,p_order uuid,p_account text,p_charge text,p_intent text,p_amount integer,p_refunded integer,p_currency text,p_livemode boolean default false)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare target public.creator_store_orders;
begin
 if current_user <> 'service_role' then raise exception 'service role required'; end if;
 select * into target from public.creator_store_orders where id=p_order for update;
 if not found then raise exception 'unknown order'; end if;
 if p_livemode is distinct from target.livemode or target.payment_intent_id is null or p_intent is distinct from target.payment_intent_id or p_account is distinct from target.stripe_account_id or p_amount is distinct from target.amount_cents or p_currency is distinct from target.currency or p_refunded is null or p_refunded<0 or p_refunded>p_amount or p_charge is null then raise exception 'refund mismatch'; end if;
 if exists(select 1 from public.creator_store_events where event_id=p_event and order_id=p_order) then return false; end if;
 update public.creator_store_orders set refunded_cents=greatest(refunded_cents,p_refunded),status=case when greatest(refunded_cents,p_refunded)=p_amount then 'refunded' when greatest(refunded_cents,p_refunded)>0 then 'partially_refunded' else status end where id=p_order;
 insert into public.creator_store_events(event_id,order_id) values(p_event,p_order);
 return true;
end $$;
revoke all on function public.record_creator_store_refund(text,uuid,text,text,text,integer,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.record_creator_store_refund(text,uuid,text,text,text,integer,integer,text,boolean) to service_role;
