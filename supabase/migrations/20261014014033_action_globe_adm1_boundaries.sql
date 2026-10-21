-- First-level administrative boundary registry; only vetted polygons can resolve a location.
create extension if not exists postgis with schema extensions;
create table if not exists public.action_globe_region_boundaries(
 region_key text primary key references public.action_globe_regions(region_key) on delete cascade,
 geom extensions.geometry(MultiPolygon,4326) not null,
 source_name text not null,source_version text not null,source_license text not null,
 source_url text not null,validated_at timestamptz not null default now(),
 check (extensions.ST_IsValid(geom))
);
create index if not exists action_globe_boundary_gist on public.action_globe_region_boundaries using gist(geom);
alter table public.action_globe_region_boundaries enable row level security;
revoke all on public.action_globe_region_boundaries from public,anon,authenticated;
grant all on public.action_globe_region_boundaries to service_role;
create or replace function public.action_globe_resolve_region(p_lat double precision,p_lon double precision)
returns table(region_key text,region_label text)
language sql stable security definer set search_path=''
as $$
 select r.region_key,r.region_label from public.action_globe_region_boundaries b
 join public.action_globe_regions r on r.region_key=b.region_key
 where p_lat between -90 and 90 and p_lon between -180 and 180
 and extensions.ST_Covers(b.geom,extensions.ST_SetSRID(extensions.ST_MakePoint(p_lon,p_lat),4326))
 order by r.region_key limit 1
$$;
revoke all on function public.action_globe_resolve_region(double precision,double precision) from public,anon,authenticated;
grant execute on function public.action_globe_resolve_region(double precision,double precision) to service_role;
create or replace function public.action_globe_public_boundaries()
returns table(region_key text,region_label text,geometry jsonb)
language sql stable security definer set search_path=''
as $$
 select r.region_key,r.region_label,extensions.ST_AsGeoJSON(extensions.ST_SimplifyPreserveTopology(b.geom,0.04))::jsonb
 from public.action_globe_region_boundaries b join public.action_globe_regions r on r.region_key=b.region_key
$$;
revoke all on function public.action_globe_public_boundaries() from public;
grant execute on function public.action_globe_public_boundaries() to anon,authenticated,service_role;
