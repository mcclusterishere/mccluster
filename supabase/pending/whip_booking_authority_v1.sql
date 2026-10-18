-- Whip Equipped LLC booking authority v1. PENDING REVIEW; do not apply
-- automatically. Whip operates as a separate company in the shared platform.
-- This migration never enables live ride dispatch by itself.
-- Existing public.drivers, public.tenants and public.rides from 0037 are reused.
begin;

create table if not exists public.whip_driver_clearances (
  driver_id uuid primary key references public.drivers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  approval_status text not null default 'pending'
    check (approval_status in ('pending','approved','rejected','suspended')),
  approved_by_auth_user_id uuid,
  approved_at timestamptz,
  identity_checked_at timestamptz,
  background_checked_at timestamptz,
  local_authority_checked_at timestamptz,
  insurance_expires_at timestamptz,
  license_expires_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint whip_driver_clearance_approval_complete check (
    approval_status <> 'approved' or (
      approved_by_auth_user_id is not null and approved_at is not null
      and identity_checked_at is not null and background_checked_at is not null
      and local_authority_checked_at is not null
      and insurance_expires_at is not null and license_expires_at is not null
      and revoked_at is null
    )
  )
);
create index if not exists whip_driver_clearance_tenant_active_idx
  on public.whip_driver_clearances (tenant_id, approval_status, revoked_at);
alter table public.whip_driver_clearances enable row level security;
revoke all on public.whip_driver_clearances from public, anon, authenticated;
grant select, insert, update, delete on public.whip_driver_clearances to service_role;

create table if not exists public.whip_booking_idempotency (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  rider_auth_user_id uuid not null,
  request_id uuid not null,
  quote_id uuid not null,
  ride_id uuid not null unique references public.rides(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (tenant_id, rider_auth_user_id, request_id),
  unique (tenant_id, rider_auth_user_id, quote_id)
);
alter table public.whip_booking_idempotency enable row level security;
revoke all on public.whip_booking_idempotency from public, anon, authenticated;
grant select, insert, update, delete on public.whip_booking_idempotency to service_role;

-- Service-only transactional reservation. The Worker authenticates the JWT,
-- verifies the quote MAC and supplies fare/coordinates from its own signed
-- payload; the function adds replay protection and requires live cleared
-- drivers before an unpaid REQUESTED record is created. No side effects to
-- Stripe are performed inside the SQL transaction.
create or replace function public.whip_reserve_booking_v1(
  p_tenant_id uuid,
  p_rider_auth_user_id uuid,
  p_request_id uuid,
  p_quote_id uuid,
  p_pickup_label text,
  p_pickup_lon double precision,
  p_pickup_lat double precision,
  p_dropoff_label text,
  p_dropoff_lon double precision,
  p_dropoff_lat double precision,
  p_miles numeric,
  p_minutes integer,
  p_fare_cents integer,
  p_platform_fee_cents integer,
  p_ride_tier text default 'WE Standard'
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous record;
  v_ride public.rides%rowtype;
begin
  if p_tenant_id is null or p_rider_auth_user_id is null or
     p_request_id is null or p_quote_id is null then
    raise exception 'invalid_booking_identity' using errcode='22023';
  end if;
  if p_pickup_label is null or char_length(btrim(p_pickup_label)) not between 1 and 160 or
     p_dropoff_label is null or char_length(btrim(p_dropoff_label)) not between 1 and 160 or
     p_pickup_lon is null or p_pickup_lat is null or p_dropoff_lon is null or p_dropoff_lat is null or
     abs(p_pickup_lon)>180 or abs(p_dropoff_lon)>180 or
     abs(p_pickup_lat)>90 or abs(p_dropoff_lat)>90 or
     p_miles is null or p_miles<=0 or p_miles>200 or
     p_minutes is null or p_minutes<1 or p_minutes>360 or
     p_fare_cents is null or p_fare_cents<1 or p_fare_cents>150000 or
     p_platform_fee_cents is null or p_platform_fee_cents<0 or p_platform_fee_cents>p_fare_cents or
     p_ride_tier <> 'WE Standard' then
    raise exception 'invalid_booking_payload' using errcode='22023';
  end if;

  -- Serializes concurrent idempotent requests from the same verified rider.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':' || p_rider_auth_user_id::text, 0)
  );
  select id.quote_id, id.ride_id
    into v_previous
    from public.whip_booking_idempotency id
    where id.tenant_id=p_tenant_id
      and id.rider_auth_user_id=p_rider_auth_user_id
      and id.request_id=p_request_id;
  if found then
    if v_previous.quote_id <> p_quote_id then
      raise exception 'idempotency_key_reused' using errcode='23505';
    end if;
    select * into v_ride from public.rides where id=v_previous.ride_id;
    if not found then raise exception 'booking_missing' using errcode='P0002'; end if;
    return pg_catalog.jsonb_build_object('ride',pg_catalog.to_jsonb(v_ride),'reused',true);
  end if;

  if exists (
    select 1 from public.whip_booking_idempotency id
    where id.tenant_id=p_tenant_id and id.rider_auth_user_id=p_rider_auth_user_id and id.quote_id=p_quote_id
  ) then
    raise exception 'quote_already_used' using errcode='23505';
  end if;

  if exists (
    select 1 from public.rides prior
    where prior.rider_id=p_rider_auth_user_id::text
      and prior.status not in ('CANCELED','COMPLETED')
      and prior.requested_at>pg_catalog.now()-interval '1 day'
  ) then
    raise exception 'active_booking_exists' using errcode='P0001';
  end if;

  if not exists (
    select 1
    from public.drivers driver
    join public.whip_driver_clearances c on c.driver_id=driver.id and c.tenant_id=driver.tenant_id
    where driver.tenant_id=p_tenant_id and driver.online=true
      and driver.last_seen_at>pg_catalog.now()-interval '2 minutes'
      and c.approval_status='approved' and c.approved_at is not null
      and c.revoked_at is null and c.insurance_expires_at>pg_catalog.now()
      and c.license_expires_at>pg_catalog.now()
      and not exists (
        select 1 from public.rides other
        where other.driver_id=driver.id
          and other.status in ('ACCEPTED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','VERIFIED','IN_PROGRESS')
      )
  ) then
    raise exception 'no_cleared_drivers' using errcode='P0001';
  end if;

  insert into public.rides (
    tenant_id,rider_id,status,pickup_label,pickup_lat,pickup_lng,
    dropoff_label,dropoff_lat,dropoff_lng,miles,minutes,ride_tier,
    fare_cents,platform_fee_cents,payment_status,pickup_pin
  ) values (
    p_tenant_id,p_rider_auth_user_id::text,'REQUESTED',p_pickup_label,p_pickup_lat,p_pickup_lon,
    p_dropoff_label,p_dropoff_lat,p_dropoff_lon,p_miles,p_minutes,p_ride_tier,
    p_fare_cents,p_platform_fee_cents,'unpaid',
    substr(replace(pg_catalog.gen_random_uuid()::text,'-',''),1,6)
  ) returning * into v_ride;

  insert into public.whip_booking_idempotency (
    tenant_id,rider_auth_user_id,request_id,quote_id,ride_id
  ) values (p_tenant_id,p_rider_auth_user_id,p_request_id,p_quote_id,v_ride.id);

  return pg_catalog.jsonb_build_object('ride',pg_catalog.to_jsonb(v_ride),'reused',false);
end;
$$;
revoke all on function public.whip_reserve_booking_v1(
uuid,uuid,uuid,uuid,text,double precision,double precision,text,double precision,double precision,numeric,integer,integer,integer,text
) from public,anon,authenticated;
grant execute on function public.whip_reserve_booking_v1(
uuid,uuid,uuid,uuid,text,double precision,double precision,text,double precision,double precision,numeric,integer,integer,integer,text
) to service_role;
commit;
