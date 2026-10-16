-- Behaviour tests for supabase/pending/whip_driver_application_consent_v1.sql
-- on a scratch database (scripts/test-whip-driver-consent-db.sh). Raises on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
do $$
declare t uuid := (select id from public.tenants where slug = 'whip-equipped');
begin
  -- an application, as the Worker writes it: offline, unverified, consented
  insert into public.drivers(tenant_id, auth_user_id, display_name, license_plate, seats, online, application_consent_at, application_consent_version)
  values (t, gen_random_uuid(), 'Dana Driver', 'AB 123', 4, false, now(), 'whip-driver-application-2026-10-15');
  if (select identity_verified or online from public.drivers where display_name = 'Dana Driver') then
    raise exception 'an application must start offline and unverified';
  end if;
  -- existing rows keep null: no consent is invented
  if (select application_consent_at from public.drivers where id = '00000000-0000-0000-0000-000000000001') is not null then
    raise exception 'the seeded driver must not get a consent it never gave';
  end if;
  begin
    insert into public.drivers(tenant_id, display_name, application_consent_at) values (t, 'No version', now());
    raise exception 'a consent time without a version must fail';
  exception when check_violation then null; end;
  begin
    insert into public.drivers(tenant_id, display_name, application_consent_version) values (t, 'No time', 'whip-driver-application-2026-10-15');
    raise exception 'a version without a time must fail';
  exception when check_violation then null; end;
  begin
    insert into public.drivers(tenant_id, display_name, application_consent_at, application_consent_version) values (t, 'Bad version', now(), 'NOT A VERSION!');
    raise exception 'a malformed version must fail';
  exception when check_violation then null; end;
  -- RLS stays on with no member policies
  if not (select relrowsecurity from pg_class where oid = 'public.drivers'::regclass) then raise exception 'RLS must stay on'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'drivers') then raise exception 'no policies on drivers'; end if;
end $$;
select 'whip driver application consent: ok';
