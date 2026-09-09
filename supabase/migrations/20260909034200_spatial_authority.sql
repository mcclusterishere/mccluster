-- Spatial authority: identity-bound house geography.
--
-- Public GET /v1/geo/plane must not return McCluster facilities. Those live
-- in public.facilities (visibility=internal) and are served only from
-- GET /v1/geo/plane/internal after house-owner auth.
--
-- Seed rows are bootstrap until CRM / org settings / EU dockets carry
-- authoritative coordinates. They are table data, not Worker constants.

insert into public.geo_sources (
  source_key, name, source_class, lane, transport, persistence_policy,
  capabilities, credential_bindings, optional_credential_bindings, upstream_url, attribution
)
values
  ('house','McCluster house sites','INTERNAL','INTERNAL','http','persistent',array['facilities','control-plane','digital-twin'],array[]::text[],array[]::text[],null,'McCluster house INTERNAL'),
  ('equity_uprise','Equity Uprise policy nodes','INTERNAL','INTERNAL','http','persistent',array['policy','environmental-justice','federal-awards-docket'],array[]::text[],array[]::text[],null,'Equity Uprise / McCluster INTERNAL'),
  ('scsu_docket','SCSU research docket','INTERNAL','INTERNAL','http','persistent',array['academic-program','research-sites'],array[]::text[],array[]::text[],null,'McCluster / SCSU research program INTERNAL')
on conflict (source_key) do update set
  name = excluded.name,
  source_class = excluded.source_class,
  lane = excluded.lane,
  persistence_policy = excluded.persistence_policy,
  capabilities = excluded.capabilities,
  attribution = excluded.attribution,
  updated_at = now();

insert into public.platform_apps (app_key, name, product_family, kind, public_url)
values ('mccluster-gev','McCluster spatial plane','mccluster','web','https://api.mccluster.org/v1/geo/plane')
on conflict (app_key) do update set
  name = excluded.name,
  product_family = excluded.product_family,
  kind = excluded.kind,
  public_url = excluded.public_url,
  updated_at = now();

create table if not exists public.facilities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  facility_key text not null,
  name text not null,
  kind text not null default 'facility',
  source_key text references public.geo_sources(source_key) on delete set null,
  city text,
  region text,
  country text not null default 'US',
  lat double precision,
  lon double precision,
  location extensions.geography(Point, 4326),
  visibility text not null default 'internal'
    check (visibility in ('public', 'internal', 'private')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, facility_key),
  check (
    lat is null
    or lon is null
    or (lat >= -90 and lat <= 90 and lon >= -180 and lon <= 180)
  )
);

create index if not exists facilities_org_source_idx
  on public.facilities (org_id, source_key, visibility);
create index if not exists facilities_location_gix
  on public.facilities using gist (location);

create or replace function private.facilities_sync_location()
returns trigger
language plpgsql
as $$
begin
  if new.lat is not null and new.lon is not null then
    new.location := extensions.st_setsrid(extensions.st_makepoint(new.lon, new.lat), 4326)::extensions.geography;
  else
    new.location := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists facilities_sync_location on public.facilities;
create trigger facilities_sync_location
before insert or update of lat, lon on public.facilities
for each row execute function private.facilities_sync_location();

create table if not exists public.facility_links (
  org_id uuid not null references public.orgs(id) on delete cascade,
  source_facility_key text not null,
  target_facility_key text not null,
  relationship_type text not null default 'arc',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (org_id, source_facility_key, target_facility_key, relationship_type),
  check (source_facility_key <> target_facility_key)
);

do $$
declare
  t text;
begin
  foreach t in array array['facilities', 'facility_links']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

insert into public.facilities (
  org_id, facility_key, name, kind, source_key, city, region, lat, lon, visibility, metadata
)
select
  o.id,
  seed.facility_key,
  seed.name,
  seed.kind,
  seed.source_key,
  seed.city,
  seed.region,
  seed.lat,
  seed.lon,
  'internal',
  seed.metadata
from public.orgs o
cross join (
  values
    ('house','Control plane','studio','house','Bridgeport','CT',41.1865,-73.1956,'{"detail":"Worker mccluster. One API. HereTenantAgent stays exported.","sources":["house","overpass","open_meteo"]}'::jsonb),
    ('shiloh','Shiloh Church BPT','building','house','Bridgeport','CT',41.179,-73.189,'{"detail":"Faith / facilities digital twin. Same entity model, access-controlled.","sources":["house","overpass"]}'::jsonb),
    ('ne-ops','NE operations','operations','house','Everett','MA',42.4084,-71.0525,'{"detail":"House operations node. Consumes the plane. Does not own it.","sources":["house","open_meteo","nhtsa"]}'::jsonb),
    ('site0','PRIM3 Site 0','building','house','Lower Colorado','AZ',34.48,-114.34,'{"detail":"3D twin consumes spatial APIs. The renderer is never the source of truth.","sources":["house","overpass","open_meteo","usgs"]}'::jsonb),
    ('eu-dc','Equity Uprise · federal','policy','equity_uprise','Washington','DC',38.9072,-77.0369,'{"detail":"Canonical publish vs external distribute.","sources":["equity_uprise","usaspending","grants_gov","census","bls","fred"]}'::jsonb),
    ('eu-atl','Equity Uprise · South','policy','equity_uprise','Atlanta','GA',33.749,-84.388,'{"detail":"EPA facilities, TRI, air and water.","sources":["equity_uprise","epa","census","gdelt"]}'::jsonb),
    ('scsu','SCSU research lane','campus','scsu_docket','New Haven','CT',41.3327,-72.947,'{"detail":"Academic-only Planet and OpenSky.","sources":["scsu_docket","planet_research","opensky_research"]}'::jsonb),
    ('eia-hou','Energy docket','policy','equity_uprise','Houston','TX',29.7604,-95.3698,'{"detail":"EIA generation, demand, and grid flows.","sources":["equity_uprise","eia","epa"]}'::jsonb),
    ('midwest','Midwest docket','policy','equity_uprise','Detroit','MI',42.3314,-83.0458,'{"detail":"Labor, housing, and federal awards as observations.","sources":["equity_uprise","bls","census","usaspending","fred"]}'::jsonb),
    ('whip-bos','Whip · NE corridor','mobility','house','Boston','MA',42.3601,-71.0589,'{"detail":"Aggregated mobility only. Individual rider histories are not public intelligence.","sources":["nhtsa","tomtom","open_meteo"]}'::jsonb),
    ('whip-nyc','Whip · NY corridor','mobility','house','New York','NY',40.7128,-74.006,'{"detail":"Traffic and hazards as transient observations.","sources":["nhtsa","tomtom"]}'::jsonb)
) as seed(facility_key, name, kind, source_key, city, region, lat, lon, metadata)
where o.slug = 'mccluster'
on conflict (org_id, facility_key) do update set
  name = excluded.name,
  kind = excluded.kind,
  source_key = excluded.source_key,
  city = excluded.city,
  region = excluded.region,
  lat = excluded.lat,
  lon = excluded.lon,
  visibility = excluded.visibility,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.facility_links (org_id, source_facility_key, target_facility_key, relationship_type)
select o.id, seed.src, seed.dst, 'arc'
from public.orgs o
cross join (
  values
    ('eu-dc','eu-atl'),
    ('eu-dc','eia-hou'),
    ('eu-dc','scsu'),
    ('eu-dc','midwest'),
    ('house','eu-dc'),
    ('house','scsu'),
    ('whip-bos','whip-nyc'),
    ('ne-ops','whip-bos'),
    ('house','site0')
) as seed(src, dst)
where o.slug = 'mccluster'
on conflict do nothing;
