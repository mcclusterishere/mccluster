-- Regional public impact projection. Replaces the earlier city-level display contract.
-- Canonical membership identity remains m_people.id; never expose member coordinates.
create table if not exists public.action_globe_regions (
 region_key text primary key,
 country_code text not null check (country_code ~ '^[A-Z]{2}$'),
 subdivision_code text not null,
 region_label text not null,
 centroid_lat double precision not null check (centroid_lat between -90 and 90),
 centroid_lon double precision not null check (centroid_lon between -180 and 180),
 updated_at timestamptz not null default now(),
 unique(country_code,subdivision_code)
);
create table if not exists public.action_globe_member_regions (
 m_uid uuid primary key references public.m_people(id) on delete cascade,
 region_key text not null references public.action_globe_regions(region_key),
 consented_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.action_globe_mission_regions (
 mission_id uuid primary key references public.action_missions(id) on delete cascade,
 region_key text not null references public.action_globe_regions(region_key),
 published boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.action_globe_regions enable row level security;
alter table public.action_globe_member_regions enable row level security;
alter table public.action_globe_mission_regions enable row level security;
revoke all on public.action_globe_regions,public.action_globe_member_regions,public.action_globe_mission_regions from public,anon,authenticated;
grant all on public.action_globe_regions,public.action_globe_member_regions,public.action_globe_mission_regions to service_role;

-- Public counts require a minimum cohort. All location coordinates are regional centroids.
-- Distinct doers are counted by verified assignments in that region.
create or replace function public.action_globe_public_regions()
returns table(region_key text,region_label text,country_code text,latitude double precision,longitude double precision,member_count bigint,doer_count bigint,verified_actions bigint,completed_missions bigint,rank_in_country bigint)
language sql stable security definer set search_path = ''
as $$
with members as (
 select r.region_key,r.region_label,r.country_code,r.centroid_lat,r.centroid_lon,count(m.m_uid)::bigint as member_count
 from public.action_globe_regions r join public.action_globe_member_regions m on m.region_key=r.region_key
 group by r.region_key,r.region_label,r.country_code,r.centroid_lat,r.centroid_lon
 having count(m.m_uid)>=5
), activity as (
 select m.region_key,
 count(distinct a.m_uid)::bigint as doer_count,
 count(a.id)::bigint as verified_actions,
 count(distinct a.mission_id)::bigint as completed_missions
 from public.action_globe_member_regions m
 join public.action_mission_assignments a on a.m_uid=m.m_uid and a.verified_at is not null
 group by m.region_key
), scored as (
 select m.*,coalesce(a.doer_count,0)::bigint as doer_count,
 coalesce(a.verified_actions,0)::bigint as verified_actions,
 coalesce(a.completed_missions,0)::bigint as completed_missions
 from members m left join activity a on a.region_key=m.region_key
)
select s.region_key,s.region_label,s.country_code,s.centroid_lat,s.centroid_lon,
s.member_count,s.doer_count,s.verified_actions,s.completed_missions,
dense_rank() over (partition by s.country_code order by s.verified_actions desc,s.completed_missions desc)::bigint
from scored s
$$;
create or replace function public.action_globe_public_region_missions()
returns table(mission_id uuid,title text,description text,action_path text,region_key text,region_label text,latitude double precision,longitude double precision)
language sql stable security definer set search_path = ''
as $$
select m.id,m.title,m.description,
(case when m.kind='clip' then 'amplify' when m.domain='creative' then 'create' when m.domain in ('community','mutual_aid','advocacy') then 'show_up' else 'explore' end),
r.region_key,r.region_label,r.centroid_lat,r.centroid_lon
from public.action_globe_mission_regions p
join public.action_missions m on m.id=p.mission_id
join public.action_globe_regions r on r.region_key=p.region_key
where p.published and m.status='open'
$$;
revoke all on function public.action_globe_public_regions(),public.action_globe_public_region_missions() from public;
grant execute on function public.action_globe_public_regions(),public.action_globe_public_region_missions() to anon,authenticated,service_role;
comment on function public.action_globe_public_regions() is 'Region-only aggregates; suppressed below five consenting members; verified assignment counts are not raw media posts.';
