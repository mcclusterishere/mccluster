-- One person, one public presentation, many product facets.
create table if not exists public.identity_presentations (
  m_uid uuid primary key references public.m_people(id) on delete cascade,
  front_page_url text not null default '',
  profile_theme text not null default 'site',
  music_enabled boolean not null default false,
  action_enabled boolean not null default true,
  tagline text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(front_page_url) <= 2048),
  check (char_length(tagline) <= 240)
);
alter table public.identity_presentations enable row level security;
drop policy if exists identity_presentations_public_read on public.identity_presentations;
create policy identity_presentations_public_read on public.identity_presentations for select using (true);
drop policy if exists identity_presentations_owner_insert on public.identity_presentations;
create policy identity_presentations_owner_insert on public.identity_presentations for insert to authenticated with check (m_uid=public.current_m_uid());
drop policy if exists identity_presentations_owner_update on public.identity_presentations;
create policy identity_presentations_owner_update on public.identity_presentations for update to authenticated using (m_uid=public.current_m_uid()) with check (m_uid=public.current_m_uid());
insert into public.identity_presentations(m_uid,front_page_url,music_enabled,action_enabled,tagline)
select np.m_uid,coalesce(nullif(np.website_url,''),nullif(mp.website_url,''),''),(mp.m_uid is not null),true,
 case when mp.m_uid is not null then 'Put your music into action.' else '' end
from public.network_profiles np left join public.music_creator_profiles mp on mp.m_uid=np.m_uid
on conflict (m_uid) do update set front_page_url=case when public.identity_presentations.front_page_url='' then excluded.front_page_url else public.identity_presentations.front_page_url end,
 music_enabled=public.identity_presentations.music_enabled or excluded.music_enabled,updated_at=now();
create or replace view public.identity_public_profiles with (security_invoker=true) as
select np.m_uid,np.mccluster_id,np.display_name,np.headline,np.bio,np.avatar_url,np.banner_url,np.website_url,
 ip.front_page_url,ip.profile_theme,ip.music_enabled,ip.action_enabled,ip.tagline,
 mp.handle as music_handle,mp.artist_name,mp.verification_state as music_verification_state
from public.network_profiles np
left join public.identity_presentations ip on ip.m_uid=np.m_uid
left join public.music_creator_profiles mp on mp.m_uid=np.m_uid and mp.status='active';
grant select on public.identity_presentations,public.identity_public_profiles to anon,authenticated,service_role;