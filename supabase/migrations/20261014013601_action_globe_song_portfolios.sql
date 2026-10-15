-- Curated link between catalog song titles and approved public regional missions.
-- Avoid title matching as authority: admin must explicitly approve a song association.
create table if not exists public.action_globe_song_missions (
 mission_id uuid primary key references public.action_missions(id) on delete cascade,
 song_title text not null check (char_length(song_title) between 1 and 200),
 album_slug text,
 approved_at timestamptz not null default now()
);
alter table public.action_globe_song_missions enable row level security;
revoke all on public.action_globe_song_missions from public,anon,authenticated;
grant all on public.action_globe_song_missions to service_role;
drop function if exists public.action_globe_public_region_missions();
create function public.action_globe_public_region_missions()
returns table(mission_id uuid,title text,description text,action_path text,region_key text,region_label text,latitude double precision,longitude double precision,song_title text)
language sql stable security definer set search_path = ''
as $$
select m.id,m.title,m.description,
(case when m.kind='clip' then 'amplify' when m.domain='creative' then 'create' when m.domain in ('community','mutual_aid','advocacy') then 'show_up' else 'explore' end),
r.region_key,r.region_label,r.centroid_lat,r.centroid_lon,s.song_title
from public.action_globe_mission_regions p
join public.action_missions m on m.id=p.mission_id
join public.action_globe_regions r on r.region_key=p.region_key
left join public.action_globe_song_missions s on s.mission_id=m.id
where p.published and m.status='open'
$$;
revoke all on function public.action_globe_public_region_missions() from public;
grant execute on function public.action_globe_public_region_missions() to anon,authenticated,service_role;
