-- Rollback for whip_driver_application_consent_v1.sql. Export recorded consents first:
--   select id, auth_user_id, application_consent_at, application_consent_version from public.drivers
--   where application_consent_at is not null;
-- Deploy the previous Worker first (the current one refuses driver sign-up without these columns).
alter table public.drivers drop constraint if exists drivers_application_consent_check;
alter table public.drivers drop column if exists application_consent_version;
alter table public.drivers drop column if exists application_consent_at;
