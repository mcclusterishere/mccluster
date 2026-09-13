create table if not exists public.api_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  consumer_id uuid not null references public.api_consumers(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  product_key text not null references public.api_products(product_key),
  endpoint text not null,
  method text not null,
  reserved_units bigint not null check (reserved_units >= 0),
  settled_units bigint,
  status text not null default 'reserved' check (status in ('reserved','settled','released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.api_usage_reservations enable row level security;
revoke all on public.api_usage_reservations from anon, authenticated;
grant all on public.api_usage_reservations to service_role;

create index if not exists api_usage_reservations_consumer_idx on public.api_usage_reservations(consumer_id, created_at desc);
create index if not exists api_usage_reservations_key_idx on public.api_usage_reservations(api_key_id, created_at desc);

create or replace function public.api_reserve_usage(
  p_request_id text,
  p_consumer_id uuid,
  p_api_key_id uuid,
  p_product_key text,
  p_endpoint text,
  p_method text,
  p_units bigint default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(reservation_id uuid, reserved_units bigint, balance_after_reservation bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_units bigint;
  v_balance bigint;
  v_existing public.api_usage_reservations%rowtype;
  v_id uuid;
begin
  if p_request_id is null or length(p_request_id) < 8 then raise exception 'invalid request id'; end if;
  if p_consumer_id is null or p_api_key_id is null then raise exception 'consumer and api key required'; end if;
  if p_product_key is null or p_endpoint is null or p_method is null then raise exception 'metering identity required'; end if;

  select coalesce(p_units, ap.default_unit_cost) into v_units
  from public.api_products ap
  where ap.product_key = p_product_key and ap.enabled = true;
  if v_units is null or v_units <= 0 then raise exception 'invalid or disabled api product'; end if;

  perform pg_advisory_xact_lock(hashtextextended('api-usage:' || p_request_id, 0));
  select * into v_existing from public.api_usage_reservations where request_id = p_request_id for update;
  if found then
    if v_existing.consumer_id is distinct from p_consumer_id
       or v_existing.api_key_id is distinct from p_api_key_id
       or v_existing.product_key is distinct from p_product_key
       or v_existing.endpoint is distinct from p_endpoint
       or v_existing.method is distinct from upper(p_method) then
      raise exception 'idempotency key conflict';
    end if;
    select public.api_credit_balance(p_consumer_id) into v_balance;
    return query select v_existing.id, v_existing.reserved_units, v_balance;
    return;
  end if;

  if not exists (
    select 1 from public.api_keys k
    where k.id = p_api_key_id and k.consumer_id = p_consumer_id and k.status = 'active'
      and (k.expires_at is null or k.expires_at > now())
  ) then raise exception 'api key not active for consumer'; end if;

  perform pg_advisory_xact_lock(hashtextextended('api-consumer:' || p_consumer_id::text, 0));
  select public.api_credit_balance(p_consumer_id) into v_balance;
  if v_balance < v_units then raise exception 'insufficient credits'; end if;

  insert into public.api_credit_ledger(consumer_id, delta, reason, reference_type, reference_id, metadata)
  values(p_consumer_id, -v_units, 'api_usage_reservation', 'api_usage', p_request_id, jsonb_build_object('product_key',p_product_key,'endpoint',p_endpoint));

  insert into public.api_usage_reservations(request_id,consumer_id,api_key_id,product_key,endpoint,method,reserved_units,metadata)
  values(p_request_id,p_consumer_id,p_api_key_id,p_product_key,p_endpoint,upper(p_method),v_units,coalesce(p_metadata,'{}'::jsonb))
  returning id into v_id;

  select public.api_credit_balance(p_consumer_id) into v_balance;
  return query select v_id, v_units, v_balance;
end;
$function$;

create or replace function public.api_settle_usage(
  p_request_id text,
  p_status_code integer,
  p_actual_units bigint default null,
  p_latency_ms integer default null,
  p_source_app_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_release boolean default false
)
returns table(charged_units bigint, released_units bigint, balance_after_settlement bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_res public.api_usage_reservations%rowtype;
  v_actual bigint;
  v_release bigint;
  v_extra bigint;
  v_balance bigint;
begin
  select * into v_res from public.api_usage_reservations where request_id = p_request_id for update;
  if not found then raise exception 'usage reservation not found'; end if;

  if v_res.status <> 'reserved' then
    select public.api_credit_balance(v_res.consumer_id) into v_balance;
    return query select coalesce(v_res.settled_units,0),0,v_balance;
    return;
  end if;

  if p_release then v_actual := 0;
  else v_actual := greatest(0, coalesce(p_actual_units, v_res.reserved_units)); end if;

  perform pg_advisory_xact_lock(hashtextextended('api-consumer:' || v_res.consumer_id::text, 0));

  if v_actual > v_res.reserved_units then
    v_extra := v_actual - v_res.reserved_units;
    select public.api_credit_balance(v_res.consumer_id) into v_balance;
    if v_balance < v_extra then raise exception 'insufficient credits to settle'; end if;
    insert into public.api_credit_ledger(consumer_id,delta,reason,reference_type,reference_id,metadata)
    values(v_res.consumer_id,-v_extra,'api_usage_settlement_overage','api_usage',p_request_id,jsonb_build_object('product_key',v_res.product_key));
  else
    v_release := v_res.reserved_units - v_actual;
    if v_release > 0 then
      insert into public.api_credit_ledger(consumer_id,delta,reason,reference_type,reference_id,metadata)
      values(v_res.consumer_id,v_release,'api_usage_reservation_release','api_usage',p_request_id,jsonb_build_object('product_key',v_res.product_key));
    end if;
  end if;

  insert into public.api_usage_events(consumer_id,api_key_id,product_key,endpoint,method,units,request_id,status_code,latency_ms,source_app_id,metadata)
  values(v_res.consumer_id,v_res.api_key_id,v_res.product_key,v_res.endpoint,v_res.method,v_actual,p_request_id,p_status_code,p_latency_ms,p_source_app_id,coalesce(p_metadata,'{}'::jsonb));

  update public.api_usage_reservations
  set settled_units=v_actual,status=case when p_release then 'released' else 'settled' end,settled_at=now(),metadata=metadata||coalesce(p_metadata,'{}'::jsonb)
  where id=v_res.id;

  select public.api_credit_balance(v_res.consumer_id) into v_balance;
  return query select v_actual,coalesce(v_release,0),v_balance;
end;
$function$;

revoke execute on function public.api_reserve_usage(text,uuid,uuid,text,text,text,bigint,jsonb) from public, anon, authenticated;
revoke execute on function public.api_settle_usage(text,integer,bigint,integer,uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.api_reserve_usage(text,uuid,uuid,text,text,text,bigint,jsonb) to service_role;
grant execute on function public.api_settle_usage(text,integer,bigint,integer,uuid,jsonb,boolean) to service_role;
