-- Test-only stand-ins and fixtures for scripts/test-media-recovery-db.sh, applied
-- after supabase/tests/supabase_api_roles.stub.sql and before the media chain.
-- Never applied to a real project.
--
-- public.org_members is all the media spend guard reads
-- (supabase/replay_migrations/20260908102000_media_spend_guard.sql): a paid
-- provider job is refused unless its creator is an owner of its organization.
create table if not exists public.org_members (
  org_id uuid not null,
  profile_id uuid not null,
  role text not null,
  primary key (org_id, profile_id)
);
insert into public.org_members (org_id, profile_id, role) values
  -- the organization the behaviour test works in, its owner and a member who may not spend
  ('123e4567-e89b-42d3-a456-426614174000', '423e4567-e89b-42d3-a456-426614174333', 'owner'),
  ('123e4567-e89b-42d3-a456-426614174000', '523e4567-e89b-42d3-a456-426614174444', 'staff'),
  -- a second organization, for the org binding and the per-organization counts
  ('223e4567-e89b-42d3-a456-426614174000', '623e4567-e89b-42d3-a456-426614174999', 'owner')
on conflict do nothing;
