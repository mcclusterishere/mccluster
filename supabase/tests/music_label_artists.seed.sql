-- The people for supabase/tests/music_label_artists.behaviour.sql, written
-- before supabase/pending/music_label_artists_v1.sql is applied (its seed
-- looks the house owner up). Scratch database only.
--   Matthew (the house owner)  auth 00..a1  M 10..a1
--   Stranger                   auth 00..c1  M 10..c1
--   Ana (an ordinary creator)  auth 00..d1  M 10..d1
insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'matthew@example.test'),
  ('00000000-0000-4000-8000-0000000000c1', 'stranger@example.test'),
  ('00000000-0000-4000-8000-0000000000d1', 'ana@example.test');
insert into public.m_people(id) values
  ('10000000-0000-4000-8000-0000000000a1'),
  ('10000000-0000-4000-8000-0000000000c1'),
  ('10000000-0000-4000-8000-0000000000d1');
insert into public.m_auth_user_links(auth_user_id, m_uid, is_primary) values
  ('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', true),
  ('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', true),
  ('00000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', true);
insert into public.orgs(id, slug, name) values ('90000000-0000-4000-8000-000000000001', 'mccluster', 'McCluster Corp');
insert into public.org_members(org_id, profile_id, role) values
  ('90000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'owner'),
  ('90000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'member');
-- Matthew's own artist profile, as the one-click onboarding would have made it
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
insert into public.music_creator_profiles(m_uid, handle, artist_name)
values ('10000000-0000-4000-8000-0000000000a1', 'matthew', 'Matthew McCluster');
select set_config('request.jwt.claims', '{}', false);
