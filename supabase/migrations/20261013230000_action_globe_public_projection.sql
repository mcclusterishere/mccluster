-- Public globe projection. No personal locations, precise addresses, or privileged Halo feeds.
create table if not exists public.action_globe_cities (
 city_key text primary key,
 city_label text not null,
 country_code text not null check (country_code ~ '^[A-Z]{2}$'),
 latitude double precision not null check (latitude between -90 and 90),
 longitude double precision not null check (longitude between -180 and 180),
 updated_at timestamptz not null default now()
);
create table if not exists public.action_globe_member_cities (
 m_uid uuid primary key references public.m_people(id) on delete cascade,
 city_key text not null references public.action_globe_cities(city_key),
 consented_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
-- Service-side verified city assignment only; clients cannot insert or inspect members.
alter table public.action_globe_cities enable row level security;
alter table public.action_globe_member_cities enable row level security;
revoke all on public.action_globe_cities,public.action_globe_member_cities from public,anon,authenticated;
grant select,insert,update,delete on public.action_globe_cities,public.action_globe_member_cities to service_role;

create table if not exists public.action_globe_mission_pins (
 mission_id uuid primary key references public.action_missions(id) on delete cascade,
 city_key text references public.action_globe_cities(city_key),
 public_label text not null,
 latitude double precision not null check (latitude between -90 and 90),
 longitude double precision not null check (longitude between -180 and 180),
 published boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.action_globe_mission_pins enable row level security;
revoke all on public.action_globe_mission_pins from public,anon,authenticated;
grant all on public.action_globe_mission_pins to service_role;

-- Aggregate-only public output. Suppress counts below five to reduce reidentification.
create or replace function public.action_globe_public_cities()
returns table(city_key text,city_label text,country_code text,latitude double precision,longitude double precision,member_count bigint)
language sql stable security definer set search_path = ''
as $$
 select c.city_key,c.city_label,c.country_code,c.latitude,c.longitude,count(m.m_uid)::bigint
 from public.action_globe_cities c join public.action_globe_member_cities m on m.city_key=c.city_key
 group by c.city_key,c.city_label,c.country_code,c.latitude,c.longitude
 having count(m.m_uid)>=5
$$;
create or replace function public.action_globe_public_missions()
returns table(mission_id uuid,title text,description text,action_path text,city_label text,latitude double precision,longitude double precision)
language sql stable security definer set search_path = ''
as $$
 select m.id,m.title,m.description,m.action_path,p.public_label,p.latitude,p.longitude
 from public.action_globe_mission_pins p join public.action_missions m on m.id=p.mission_id
 where p.published and m.status='open'
$$;
revoke all on function public.action_globe_public_cities(),public.action_globe_public_missions() from public;
grant execute on function public.action_globe_public_cities(),public.action_globe_public_missions() to anon,authenticated,service_role;
comment on function public.action_globe_public_cities() is 'Consenting members only; returns cities with five or more members, never identities.';
