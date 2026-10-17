-- Only the nine catalog rows changed by the reset, plus one unrelated held row.
-- The IDs identify the migration's targets; descriptions and people are test data.
-- Applied after the real gamification and private partner-draft migrations.
alter table public.action_missions add column kind text not null default 'civic';
insert into public.action_campaigns(id) values ('equity-uprise-003');
insert into public.action_missions(id,title,status) values
  ('302dcb4e-ca21-4289-b633-9c397985fb9d','Help a person','open'),
  ('368fd75a-77d2-4de0-9722-17020674a914','Write a policy memo','open'),
  ('053cbd0d-6bdb-49c6-bd80-8c5b8be36068','Write a song','open'),
  ('9144bd42-f94a-494e-a17a-a45f9e155f86','Trace the minerals in your phone','open'),
  ('7cfac26a-d757-42b9-803b-970f9d5030a8','File a public comment','open'),
  ('d7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c','Spend with intention','open'),
  ('a17050c1-a551-4c5c-80c1-5a1750c1a001','Anti-Social','open'),
  ('ba803367-057b-4664-902d-58a0cfd62068','Show up to a rally','open'),
  ('49d654e1-dfc8-42aa-a26e-22912ebf8dc6','Recycle one dead device the right way','open');
insert into public.action_missions(id,title,description,status,base_points,updated_at) values
  ('90000000-0000-4000-8000-000000000001','Unrelated held mission','Keep this fixture intact.',
    'paused',317,'2020-01-01T00:00:00Z');
insert into auth.users(id,email) values
  ('11111111-1111-4111-8111-111111111111','member@example.invalid');
insert into public.m_people(id) values ('22222222-2222-4222-8222-222222222222');
insert into public.m_links(user_id,m_uid) values
  ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
insert into public.action_mission_assignments(id,mission_id,user_id,m_uid,status) values
  ('33333333-3333-4333-8333-333333333333','9144bd42-f94a-494e-a17a-a45f9e155f86',
    '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','in_progress');

