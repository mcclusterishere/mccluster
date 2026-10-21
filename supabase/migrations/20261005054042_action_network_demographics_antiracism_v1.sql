-- Private demographic measurement + deterministic universal anti-racism missions.
-- Applied to production 2026-10-05. Sensitive self-identification is never a
-- public profile or eligibility condition.
create table if not exists public.action_member_demographics (
 m_uid uuid primary key references public.m_people(id) on delete cascade,
 race_ethnicity text[] not null default '{}',
 prefer_not_to_say boolean not null default false,
 measurement_consent boolean not null default false,
 updated_at timestamptz not null default now(),
 check (not (prefer_not_to_say and cardinality(race_ethnicity)>0))
);
alter table public.action_member_demographics enable row level security;
alter table public.action_member_demographics force row level security;
drop policy if exists "members read own demographics" on public.action_member_demographics;
create policy "members read own demographics" on public.action_member_demographics for select to authenticated using(m_uid=public.current_m_uid());
drop policy if exists "members insert own demographics" on public.action_member_demographics;
create policy "members insert own demographics" on public.action_member_demographics for insert to authenticated with check(m_uid=public.current_m_uid());
drop policy if exists "members update own demographics" on public.action_member_demographics;
create policy "members update own demographics" on public.action_member_demographics for update to authenticated using(m_uid=public.current_m_uid()) with check(m_uid=public.current_m_uid());
revoke all on public.action_member_demographics from public, anon, authenticated;
grant select,insert,update on public.action_member_demographics to authenticated;
grant all on public.action_member_demographics to service_role;

insert into public.action_missions
(id,campaign_id,title,description,domain,difficulty,base_points,proof_required,verification_mode,skills,status)
values
('5276f3b8-61fe-5363-8690-80d98a88878b',null,'Map who is represented','Choose a local institution, event, board, curriculum, vendor list, or media source. Document who is represented using public information, identify a concrete gap, and post the evidence plus one actionable recommendation.','advocacy',2,140,true,'review',array['research','civic-literacy'],'open'),
('d7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c',null,'Spend with intention','Support a locally owned business or creator from a historically underrepresented community. Post proof of support and a short note about what you learned. Do not photograph people without permission.','community',1,90,true,'review',array['community','economic-action'],'open'),
('3467cf5e-9b43-515c-a8bd-8f96c30f7421',null,'Correct it with sources','Find a racial claim or stereotype you previously encountered. Research it using credible sources and publish a short correction with citations and what changed in your understanding. Do not target or harass an individual.','education',2,130,true,'review',array['research','media-literacy'],'open'),
('e83aaa5e-2e44-53e4-9ffc-6eb92f457096',null,'Cross the room','Attend a public cultural, civic, educational, or community event outside your usual circle. Post the event artifact or permitted selfie and three things you learned. Never record strangers without consent.','community',2,140,true,'review',array['listening','community'],'open'),
('015273ce-fddb-5e5f-95fe-f610d28f44ff',null,'Change one institutional thing','Identify a concrete racial-equity barrier in a school, workplace, club, business, or public institution. Submit a respectful documented request for a specific change and post the request plus any response, with private information redacted.','advocacy',4,300,true,'review',array['organizing','communication'],'open'),
('a4333d6f-52a6-511a-b957-fb4f21916b88',null,'Build the shared resource','Create or materially improve a public resource that helps people find anti-racism education, community organizations, minority-owned businesses, reporting channels, or local history. Post the artifact and evidence that it is publicly usable.','creative',3,220,true,'review',array['research','service','creative'],'open'),
('ed2e7ae0-32d7-5a8e-b70a-c0f7b7958265',null,'Listen, with permission','Have a voluntary conversation with someone whose racial or cultural experience differs from yours. Ask what they wish people understood. Post only your own reflection unless the other person explicitly consents to being quoted or recorded.','education',2,120,true,'review',array['listening','reflection'],'open'),
('4c57292e-7835-5d29-b1ac-7de53e5bbb81',null,'Trace your own community history','Choose one racial, ethnic, or cultural community you identify with or want to understand. Document a local person, place, policy, or event from its history using sources, then post what you learned and why it matters now.','education',2,150,true,'review',array['history','research','reflection'],'open'),
('a195dc51-5593-5640-b51c-836850c3babf',null,'Audit your own circle','Without naming or photographing anyone, examine the voices, creators, vendors, experts, or organizations you regularly choose. Post an anonymized tally, one gap you noticed, and one concrete change you will test.','education',2,130,true,'review',array['reflection','research'],'open'),
('8830ae39-4033-5131-98e6-d590a6481f25',null,'Make an introduction across communities','With permission, connect two people, groups, creators, businesses, or organizations from different communities who could genuinely help each other. Post what connection you made and the intended shared outcome; redact private contact information.','community',3,200,true,'review',array['community','collaboration'],'open'),
('4872dbe5-bafe-5464-986c-622941927ba7',null,'Fix the resource list','Find a public resource list, reading list, vendor list, curriculum, event lineup, or directory that has a clear representation gap. Propose or contribute sourced additions and post the before/after artifact or documented request.','advocacy',3,210,true,'review',array['research','organizing'],'open'),
('51587300-5442-5708-8ccb-13bb4145d7b0',null,'Teach what you verified','Create a short video, graphic, or post explaining one well-sourced piece of racial history or present-day context relevant to your community. Include sources and one optional action viewers can take.','creative',3,200,true,'review',array['education','media-literacy','creative'],'open')
on conflict (id) do update set
 title=excluded.title,description=excluded.description,domain=excluded.domain,difficulty=excluded.difficulty,
 base_points=excluded.base_points,proof_required=excluded.proof_required,verification_mode=excluded.verification_mode,
 skills=excluded.skills,status=excluded.status,updated_at=now();
