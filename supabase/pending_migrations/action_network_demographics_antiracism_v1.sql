-- Sensitive self-identification is private measurement data, never a public profile or eligibility gate.
create table if not exists public.action_member_demographics (
 m_uid uuid primary key references public.m_people(id) on delete cascade,
 race_ethnicity text[] not null default '{}',
 prefer_not_to_say boolean not null default false,
 measurement_consent boolean not null default false,
 updated_at timestamptz not null default now(),
 check (not (prefer_not_to_say and cardinality(race_ethnicity)>0))
);
alter table public.action_member_demographics enable row level security;
create policy "members read own demographics" on public.action_member_demographics for select to authenticated using(m_uid=public.current_m_uid());
create policy "members insert own demographics" on public.action_member_demographics for insert to authenticated with check(m_uid=public.current_m_uid());
create policy "members update own demographics" on public.action_member_demographics for update to authenticated using(m_uid=public.current_m_uid()) with check(m_uid=public.current_m_uid());
grant select,insert,update on public.action_member_demographics to authenticated;

-- Seed universal anti-racism missions. Identity is never an eligibility condition.
insert into public.action_missions(title,description,domain,difficulty,base_points,proof_required,verification_mode,skills,status)
values
('Map who is represented','Choose a local institution, event, board, curriculum, vendor list, or media source. Document who is represented using public information, identify a concrete gap, and post the evidence plus one actionable recommendation.','advocacy',2,140,true,'review',array['research','civic-literacy'],'open'),
('Spend with intention','Support a locally owned business or creator from a historically underrepresented community. Post proof of support and a short note about what you learned. Do not photograph people without permission.','community',1,90,true,'review',array['community','economic-action'],'open'),
('Correct it with sources','Find a racial claim or stereotype you previously encountered. Research it using credible sources and publish a short correction with citations and what changed in your understanding. Do not target or harass an individual.','education',2,130,true,'review',array['research','media-literacy'],'open'),
('Cross the room','Attend a public cultural, civic, educational, or community event outside your usual circle. Post the event artifact or permitted selfie and three things you learned. Never record strangers without consent.','community',2,140,true,'review',array['listening','community'],'open'),
('Change one institutional thing','Identify a concrete racial-equity barrier in a school, workplace, club, business, or public institution. Submit a respectful documented request for a specific change and post the request plus any response, with private information redacted.','advocacy',4,300,true,'review',array['organizing','communication'],'open'),
('Build the shared resource','Create or materially improve a public resource that helps people find anti-racism education, community organizations, minority-owned businesses, reporting channels, or local history. Post the artifact and evidence that it is publicly usable.','creative',3,220,true,'review',array['research','service','creative'],'open'),
('Listen, with permission','Have a voluntary conversation with someone whose racial or cultural experience differs from yours. Ask what they wish people understood. Post only your own reflection unless the other person explicitly consents to being quoted or recorded.','education',2,120,true,'review',array['listening','reflection'],'open'),
('Teach what you verified','Create a short video, graphic, or post explaining one well-sourced piece of racial history or present-day context relevant to your community. Include sources and one optional action viewers can take.','creative',3,200,true,'review',array['education','media-literacy','creative'],'open')
on conflict do nothing;
