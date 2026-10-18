-- Whip Equipped LLC — reviewed, pending-only, no production application.
-- Keep service-role-only access to operational details. Nothing here grants
-- the right to operate transportation network services in any jurisdiction.
begin;
alter table public.drivers
  add column if not exists approval_status text not null default 'pending',
  add column if not exists compliance_verified boolean not null default false,
  add column if not exists license_expires_at timestamptz,
  add column if not exists insurance_expires_at timestamptz,
  add column if not exists screening_expires_at timestamptz,
  add column if not exists application_consent_at timestamptz,
  add column if not exists application_consent_version text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid;
do $$
begin
  if not exists(select 1 from pg_constraint where conname='whip_driver_application_consent_v1') then
    alter table public.drivers add constraint whip_driver_application_consent_v1
      check((application_consent_at is null and application_consent_version is null)
        or (application_consent_at is not null and application_consent_version='whip-driver-application-v1'));
  end if;
  if not exists(select 1 from pg_constraint where conname='whip_driver_approval_valid_v1') then
    alter table public.drivers add constraint whip_driver_approval_valid_v1
      check(approval_status in ('pending','approved','rejected','suspended')
        and (approval_status <> 'approved' or
        (compliance_verified and reviewed_at is not null and reviewed_by is not null
        and license_expires_at>reviewed_at and insurance_expires_at>reviewed_at and screening_expires_at>reviewed_at)));
  end if;
end $$;

create table if not exists public.whip_booking_keys (
  id uuid primary key default gen_random_uuid(),
  rider_auth_user_id uuid not null,
  tenant_id uuid not null references public.tenants(id),
  key_sha256 text not null check(length(key_sha256)=64),
  ride_id uuid not null unique references public.rides(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(rider_auth_user_id,key_sha256)
);
alter table public.whip_booking_keys enable row level security;
revoke all on public.whip_booking_keys from public,anon,authenticated;
grant select,insert on public.whip_booking_keys to service_role;

create table if not exists public.whip_driver_review_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  driver_id uuid not null references public.drivers(id),
  reviewer_auth_user_id uuid not null,
  previous_status text not null,
  next_status text not null,
  evidence_reference text not null,
  reviewed_at timestamptz not null default now()
);
alter table public.whip_driver_review_log enable row level security;
revoke all on public.whip_driver_review_log from public,anon,authenticated;
grant select,insert on public.whip_driver_review_log to service_role;

-- One driver can handle one active passenger trip; no parallel acceptance.
create unique index if not exists whip_driver_single_active_ride_v1
  on public.rides(driver_id)
  where driver_id is not null and status in ('ACCEPTED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','VERIFIED','IN_PROGRESS');

create or replace function public.whip_submit_booked_request(
  p_tenant_id uuid, p_rider_id uuid, p_pickup_label text, p_pickup_lat double precision,
  p_pickup_lng double precision, p_dropoff_label text, p_dropoff_lat double precision,
  p_dropoff_lng double precision, p_fare_cents integer, p_platform_fee_cents integer,
  p_miles numeric, p_minutes integer, p_booking_key text)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
  v_key text;
  v_prior public.rides%rowtype;
  v_ride public.rides%rowtype;
begin
  -- Called only by the authenticated Worker after validating the HMAC-signed
  -- commercial quote. Never grant direct authenticated/anon execution.
  if p_tenant_id is null or p_rider_id is null or
     (select slug from public.tenants where id=p_tenant_id) <> 'whip-equipped' then
    raise exception 'unsupported mobility operator';
  end if;
  if length(p_booking_key)<16 or length(p_booking_key)>80 or
     p_booking_key !~ '^[A-Za-z0-9_-]+$' then raise exception 'bad idempotency key'; end if;
  if length(trim(p_pickup_label))<3 or length(p_pickup_label)>200 or
     length(trim(p_dropoff_label))<3 or length(p_dropoff_label)>200 or
     p_pickup_lat is null or p_dropoff_lat is null or p_pickup_lng is null or p_dropoff_lng is null or
     abs(p_pickup_lat)>90 or abs(p_dropoff_lat)>90 or abs(p_pickup_lng)>180 or abs(p_dropoff_lng)>180 or
     p_fare_cents not between 100 and 1000000 or p_platform_fee_cents not between 0 and p_fare_cents or
     p_miles not between 0.1 and 310 or p_minutes not between 1 and 2000 then
    raise exception 'invalid ride quote';
  end if;
  v_key=encode(extensions.digest(p_booking_key,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_rider_id::text||':'||v_key,0));
  select ride.* into v_prior from public.whip_booking_keys k
    join public.rides ride on ride.id=k.ride_id
    where k.rider_auth_user_id=p_rider_id and k.key_sha256=v_key;
  if found then
    return pg_catalog.jsonb_build_object('ride',to_jsonb(v_prior),'reused',true);
  end if;
  insert into public.rides(tenant_id,rider_id,rider_name,status,pickup_label,pickup_lat,pickup_lng,
       dropoff_label,dropoff_lat,dropoff_lng,miles,minutes,ride_tier,fare_cents,platform_fee_cents,payment_status)
    values(p_tenant_id,p_rider_id::text,'Rider','REQUESTED',p_pickup_label,p_pickup_lat,p_pickup_lng,
       p_dropoff_label,p_dropoff_lat,p_dropoff_lng,p_miles,p_minutes,'WE Standard',p_fare_cents,p_platform_fee_cents,'unpaid')
    returning * into v_ride;
  insert into public.whip_booking_keys(rider_auth_user_id,tenant_id,key_sha256,ride_id)
    values(p_rider_id,p_tenant_id,v_key,v_ride.id);
  return pg_catalog.jsonb_build_object('ride',to_jsonb(v_ride),'reused',false);
end $fn$;
revoke all on function public.whip_submit_booked_request(
  uuid,uuid,text,double precision,double precision,text,double precision,double precision,integer,integer,numeric,integer,text)
  from public,anon,authenticated;
grant execute on function public.whip_submit_booked_request(
  uuid,uuid,text,double precision,double precision,text,double precision,double precision,integer,integer,numeric,integer,text)
  to service_role;

create or replace function public.whip_accept_authorized_ride(p_driver_id uuid,p_ride_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_driver public.drivers%rowtype; v_ride public.rides%rowtype;
begin
  select * into v_driver from public.drivers where id=p_driver_id for update;
  if not found or v_driver.approval_status<>'approved' or not v_driver.compliance_verified or
     v_driver.license_expires_at<=now() or v_driver.insurance_expires_at<=now() or
     v_driver.screening_expires_at<=now() or
     v_driver.license_expires_at is null or v_driver.insurance_expires_at is null or
     v_driver.screening_expires_at is null or v_driver.online is not true or
     v_driver.last_seen_at<now()-interval '2 minutes' or v_driver.last_seen_at is null then
    return null;
  end if;
  if exists(select 1 from public.rides where driver_id=p_driver_id
    and status in ('ACCEPTED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','VERIFIED','IN_PROGRESS')) then return null;end if;
  update public.rides set status='ACCEPTED',driver_id=v_driver.id,accepted_at=now(),updated_at=now(),
    driver_name=v_driver.display_name,driver_vehicle=concat_ws(' ',v_driver.vehicle_color,v_driver.vehicle_make,v_driver.vehicle_model),
    driver_plate=v_driver.license_plate,driver_rating=v_driver.rating
    where id=p_ride_id and tenant_id=v_driver.tenant_id and status='REQUESTED'
      and payment_status in ('authorized','paid')
    returning * into v_ride;
  if not found then return null;end if;
  return pg_catalog.jsonb_build_object('ride',to_jsonb(v_ride));
exception when unique_violation then
  return null;
end $fn$;
revoke all on function public.whip_accept_authorized_ride(uuid,uuid) from public,anon,authenticated;
grant execute on function public.whip_accept_authorized_ride(uuid,uuid) to service_role;

create or replace function public.whip_review_driver(
  p_tenant_id uuid,p_driver_id uuid,p_reviewer_id uuid,p_action text,p_evidence_reference text,
  p_license_expires_at timestamptz default null,p_insurance_expires_at timestamptz default null,
  p_screening_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare d public.drivers%rowtype; v_original text;
begin
  if not exists(select 1 from public.operator_members
      where tenant_id=p_tenant_id and auth_user_id=p_reviewer_id::text
        and role in ('owner','admin')) then raise exception 'reviewer not authorized';end if;
  if p_action not in ('approved','rejected','suspended') or length(trim(p_evidence_reference))<20 or
    length(p_evidence_reference)>200 then raise exception 'review requires a documented decision';end if;
  select * into d from public.drivers where id=p_driver_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'driver not found';end if;
  if d.auth_user_id=p_reviewer_id then raise exception 'self-approval not permitted';end if;
  if p_action='approved' and (p_license_expires_at is null or p_insurance_expires_at is null
    or p_screening_expires_at is null or p_license_expires_at<=now() or
    p_insurance_expires_at<=now() or p_screening_expires_at<=now())
    then raise exception 'all checks and expiration dates must be independently verified';end if;
  v_original=d.approval_status;
  update public.drivers set approval_status=p_action,
    compliance_verified=p_action='approved',online=false,reviewed_at=now(),reviewed_by=p_reviewer_id,
    license_expires_at=case when p_action='approved' then p_license_expires_at else null end,
    insurance_expires_at=case when p_action='approved' then p_insurance_expires_at else null end,
    screening_expires_at=case when p_action='approved' then p_screening_expires_at else null end
    where id=p_driver_id;
  insert into public.whip_driver_review_log(tenant_id,driver_id,reviewer_auth_user_id,previous_status,next_status,evidence_reference)
    values(p_tenant_id,p_driver_id,p_reviewer_id,v_original,p_action,p_evidence_reference);
  return pg_catalog.jsonb_build_object('driver_id',p_driver_id,'status',p_action,'online',false);
end $fn$;
revoke all on function public.whip_review_driver(uuid,uuid,uuid,text,text,timestamptz,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.whip_review_driver(uuid,uuid,uuid,text,text,timestamptz,timestamptz,timestamptz)
  to service_role;
commit;
