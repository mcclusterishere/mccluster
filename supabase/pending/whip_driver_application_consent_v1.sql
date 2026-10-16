-- WHIP EQUIPPED DRIVER APPLICATION CONSENT v1 (PENDING: not applied in production).
--
-- Owner, 2026-10-15: "People should be able to sign up to Whip Equipped real
-- quick ... if you know a driver, or you are a driver, have them sign up
-- today." Whip Equipped LLC is Matthew McCluster's separate company; these
-- are its own tables (supabase/replay_migrations/0037_whip_mobility.sql).
--
-- A driver sign-up is an APPLICATION: a public.drivers row with online =
-- false and identity_verified = false, exactly as the existing handler
-- creates one. It needs one thing the schema did not hold: the applicant's
-- consent. Two nullable columns, nothing else:
--   application_consent_at       when the applicant agreed
--   application_consent_version  which consent text they agreed to
--                                (workers/mccluster/src/whip/launch-gate.js DRIVER_CONSENT_VERSION)
-- The Worker (POST /api/drivers/me) writes both with the row and refuses
-- (503 driver_signup_not_ready) until these columns exist, so no
-- application is ever saved without its consent. Existing rows (the seeded
-- demo driver and the one production driver) keep null: no consent is
-- invented for them. Nothing here approves anyone; Whip's own checks
-- (identity, licence, insurance, background check, local TNC rules) do.
--
-- RLS is unchanged (on, no anon/authenticated policies; the Worker uses the
-- service role). Idempotent.
--
-- ROLLBACK: supabase/pending/whip_driver_application_consent_v1.rollback.sql
-- (drops the check and the two columns; recorded consents are lost, so
-- export them first).

alter table public.drivers add column if not exists application_consent_at timestamptz;
alter table public.drivers add column if not exists application_consent_version text;
alter table public.drivers drop constraint if exists drivers_application_consent_check;
alter table public.drivers add constraint drivers_application_consent_check check (
  (application_consent_at is null and application_consent_version is null)
  or (application_consent_at is not null and application_consent_version is not null and application_consent_version ~ '^[a-z0-9][a-z0-9._-]{2,59}$')
);
comment on column public.drivers.application_consent_at is 'When the applicant agreed to the Whip Equipped driver application consent (POST /api/drivers/me). Not approval.';
comment on column public.drivers.application_consent_version is 'Which consent text the applicant agreed to (launch-gate.js DRIVER_CONSENT_VERSION).';
