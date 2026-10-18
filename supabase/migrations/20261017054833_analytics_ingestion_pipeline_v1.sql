-- Forward reconciliation of the existing spatial schema. Historical replay files remain unchanged.
-- Re-runnable on replay databases; no public or authenticated data access.


-- Reconciles 20260909034000_spatial_intelligence.sql

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table if not exists public.seek_first_sources (
  source_key text primary key,
  name text not null,
  source_class text not null,
  lane text not null,
  transport text not null default 'http',
  persistence_policy text not null default 'persistent'
    check (persistence_policy in ('persistent', 'transient', 'none')),
  capabilities text[] not null default '{}',
  credential_bindings text[] not null default '{}',
  optional_credential_bindings text[] not null default '{}',
  upstream_url text,
  attribution text,
  terms_url text,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.seek_first_source_entitlements (
  org_id uuid not null references public.orgs(id) on delete cascade,
  source_key text not null references public.seek_first_sources(source_key) on delete cascade,
  enabled boolean not null default true,
  lane text not null,
  commercial_use boolean not null default false,
  public_display boolean not null default false,
  redistribution boolean not null default false,
  persistence_allowed boolean not null default false,
  terms_acknowledged_at timestamptz,
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  primary key (org_id, source_key)
);

create table if not exists public.seek_first_layers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  layer_key text not null,
  name text not null,
  source_key text references public.seek_first_sources(source_key) on delete set null,
  layer_type text not null default 'entity',
  enabled boolean not null default true,
  style jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, layer_key)
);

create table if not exists public.seek_first_entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  source_key text not null references public.seek_first_sources(source_key) on delete restrict,
  external_id text not null,
  entity_type text not null,
  name text,
  location extensions.geography(Point, 4326),
  footprint extensions.geometry(Geometry, 4326),
  properties jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  source_url text,
  observed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, source_key, external_id)
);

create index if not exists seek_first_entities_location_gix
  on public.seek_first_entities using gist (location);
create index if not exists seek_first_entities_footprint_gix
  on public.seek_first_entities using gist (footprint);
create index if not exists seek_first_entities_org_type_idx
  on public.seek_first_entities (org_id, entity_type, last_seen_at desc);
create index if not exists seek_first_entities_org_source_idx
  on public.seek_first_entities (org_id, source_key, last_seen_at desc);

create table if not exists public.seek_first_observations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_id uuid references public.seek_first_entities(id) on delete cascade,
  source_key text not null references public.seek_first_sources(source_key) on delete restrict,
  external_id text,
  observation_type text not null,
  metric text,
  value_number double precision,
  value_text text,
  unit text,
  location extensions.geography(Point, 4326),
  observed_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists seek_first_observations_location_gix
  on public.seek_first_observations using gist (location);
create index if not exists seek_first_observations_entity_time_idx
  on public.seek_first_observations (entity_id, observed_at desc);
create index if not exists seek_first_observations_org_source_time_idx
  on public.seek_first_observations (org_id, source_key, observed_at desc);

create table if not exists public.seek_first_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  source_key text not null references public.seek_first_sources(source_key) on delete restrict,
  external_id text not null,
  event_type text not null,
  name text,
  location extensions.geography(Point, 4326),
  footprint extensions.geometry(Geometry, 4326),
  severity double precision,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  observed_at timestamptz not null default now(),
  properties jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, source_key, external_id)
);

create index if not exists seek_first_events_location_gix
  on public.seek_first_events using gist (location);
create index if not exists seek_first_events_footprint_gix
  on public.seek_first_events using gist (footprint);
create index if not exists seek_first_events_org_type_time_idx
  on public.seek_first_events (org_id, event_type, observed_at desc);

create table if not exists public.seek_first_relationships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  source_entity_id uuid not null references public.seek_first_entities(id) on delete cascade,
  target_entity_id uuid not null references public.seek_first_entities(id) on delete cascade,
  relationship_type text not null,
  source_key text references public.seek_first_sources(source_key) on delete set null,
  confidence double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  valid_from timestamptz,
  valid_to timestamptz,
  properties jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_entity_id <> target_entity_id),
  unique (org_id, source_entity_id, target_entity_id, relationship_type)
);

create index if not exists seek_first_relationships_source_idx
  on public.seek_first_relationships (org_id, source_entity_id, relationship_type);
create index if not exists seek_first_relationships_target_idx
  on public.seek_first_relationships (org_id, target_entity_id, relationship_type);

create table if not exists public.seek_first_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_key text not null,
  name text not null,
  description text,
  area_of_interest extensions.geometry(Geometry, 4326),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, project_key)
);

create index if not exists seek_first_projects_aoi_gix
  on public.seek_first_projects using gist (area_of_interest);

create table if not exists public.seek_first_project_entities (
  project_id uuid not null references public.seek_first_projects(id) on delete cascade,
  entity_id uuid not null references public.seek_first_entities(id) on delete cascade,
  role text,
  metadata jsonb not null default '{}'::jsonb,
  added_at timestamptz not null default now(),
  primary key (project_id, entity_id)
);

create table if not exists public.seek_first_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  source_key text not null references public.seek_first_sources(source_key) on delete restrict,
  operation text not null,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  request_fingerprint text,
  records_seen integer not null default 0,
  records_written integer not null default 0,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists seek_first_ingestion_runs_org_source_idx
  on public.seek_first_ingestion_runs (org_id, source_key, started_at desc);

create table if not exists public.seek_first_derived_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_id uuid references public.seek_first_entities(id) on delete cascade,
  project_id uuid references public.seek_first_projects(id) on delete cascade,
  metric_key text not null,
  value_number double precision,
  value_text text,
  unit text,
  window_start timestamptz,
  window_end timestamptz,
  methodology jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

create index if not exists seek_first_derived_metrics_entity_idx
  on public.seek_first_derived_metrics (org_id, entity_id, metric_key, computed_at desc);

create table if not exists public.seek_first_alert_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  source_key text references public.seek_first_sources(source_key) on delete set null,
  event_type text,
  area_of_interest extensions.geometry(Geometry, 4326),
  condition jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seek_first_alert_rules_aoi_gix
  on public.seek_first_alert_rules using gist (area_of_interest);

create table if not exists public.seek_first_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  rule_id uuid references public.seek_first_alert_rules(id) on delete set null,
  event_id uuid references public.seek_first_events(id) on delete set null,
  status text not null default 'open',
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  triggered_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists seek_first_alerts_org_status_idx
  on public.seek_first_alerts (org_id, status, triggered_at desc);

create or replace function public.seek_first_nearby(
  p_org uuid,
  p_lat double precision,
  p_lon double precision,
  p_radius_m double precision default 5000,
  p_limit integer default 100,
  p_source text default null,
  p_entity_type text default null
)
returns table (
  id uuid,
  source_key text,
  external_id text,
  entity_type text,
  name text,
  lat double precision,
  lon double precision,
  distance_m double precision,
  properties jsonb,
  observed_at timestamptz,
  last_seen_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id,
    e.source_key,
    e.external_id,
    e.entity_type,
    e.name,
    extensions.st_y(e.location::extensions.geometry) as lat,
    extensions.st_x(e.location::extensions.geometry) as lon,
    extensions.st_distance(
      e.location,
      extensions.st_point(p_lon, p_lat, 4326)::extensions.geography
    ) as distance_m,
    e.properties,
    e.observed_at,
    e.last_seen_at
  from public.seek_first_entities e
  where e.org_id = p_org
    and e.location is not null
    and (p_source is null or e.source_key = p_source)
    and (p_entity_type is null or e.entity_type = p_entity_type)
    and extensions.st_dwithin(
      e.location,
      extensions.st_point(p_lon, p_lat, 4326)::extensions.geography,
      greatest(0, least(coalesce(p_radius_m, 5000), 1000000))
    )
  order by e.location operator(extensions.<->)
    extensions.st_point(p_lon, p_lat, 4326)::extensions.geography
  limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;

create or replace function public.seek_first_bbox(
  p_org uuid,
  p_min_lat double precision,
  p_min_lon double precision,
  p_max_lat double precision,
  p_max_lon double precision,
  p_limit integer default 500,
  p_source text default null
)
returns table (
  id uuid,
  source_key text,
  external_id text,
  entity_type text,
  name text,
  lat double precision,
  lon double precision,
  properties jsonb,
  observed_at timestamptz,
  last_seen_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id,
    e.source_key,
    e.external_id,
    e.entity_type,
    e.name,
    extensions.st_y(e.location::extensions.geometry) as lat,
    extensions.st_x(e.location::extensions.geometry) as lon,
    e.properties,
    e.observed_at,
    e.last_seen_at
  from public.seek_first_entities e
  where e.org_id = p_org
    and e.location is not null
    and (p_source is null or e.source_key = p_source)
    and e.location::extensions.geometry OPERATOR(extensions.&&) extensions.st_makeenvelope(
      p_min_lon, p_min_lat, p_max_lon, p_max_lat, 4326
    )
  order by e.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

create or replace function public.seek_first_events_nearby(
  p_org uuid,
  p_lat double precision,
  p_lon double precision,
  p_radius_m double precision default 25000,
  p_limit integer default 100,
  p_source text default null,
  p_event_type text default null
)
returns table (
  id uuid,
  source_key text,
  external_id text,
  event_type text,
  name text,
  lat double precision,
  lon double precision,
  distance_m double precision,
  severity double precision,
  status text,
  observed_at timestamptz,
  properties jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id,
    e.source_key,
    e.external_id,
    e.event_type,
    e.name,
    extensions.st_y(e.location::extensions.geometry) as lat,
    extensions.st_x(e.location::extensions.geometry) as lon,
    extensions.st_distance(
      e.location,
      extensions.st_point(p_lon, p_lat, 4326)::extensions.geography
    ) as distance_m,
    e.severity,
    e.status,
    e.observed_at,
    e.properties
  from public.seek_first_events e
  where e.org_id = p_org
    and e.location is not null
    and (p_source is null or e.source_key = p_source)
    and (p_event_type is null or e.event_type = p_event_type)
    and extensions.st_dwithin(
      e.location,
      extensions.st_point(p_lon, p_lat, 4326)::extensions.geography,
      greatest(0, least(coalesce(p_radius_m, 25000), 2000000))
    )
  order by e.location operator(extensions.<->)
    extensions.st_point(p_lon, p_lat, 4326)::extensions.geography
  limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'seek_first_sources',
    'seek_first_source_entitlements',
    'seek_first_layers',
    'seek_first_entities',
    'seek_first_observations',
    'seek_first_events',
    'seek_first_relationships',
    'seek_first_projects',
    'seek_first_project_entities',
    'seek_first_ingestion_runs',
    'seek_first_derived_metrics',
    'seek_first_alert_rules',
    'seek_first_alerts'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

revoke all on function public.seek_first_nearby(uuid,double precision,double precision,double precision,integer,text,text) from public, anon, authenticated;
revoke all on function public.seek_first_bbox(uuid,double precision,double precision,double precision,double precision,integer,text) from public, anon, authenticated;
revoke all on function public.seek_first_events_nearby(uuid,double precision,double precision,double precision,integer,text,text) from public, anon, authenticated;
grant execute on function public.seek_first_nearby(uuid,double precision,double precision,double precision,integer,text,text) to service_role;
grant execute on function public.seek_first_bbox(uuid,double precision,double precision,double precision,double precision,integer,text) to service_role;
grant execute on function public.seek_first_events_nearby(uuid,double precision,double precision,double precision,integer,text,text) to service_role;

insert into public.seek_first_sources (
  source_key, name, source_class, lane, transport, persistence_policy,
  capabilities, credential_bindings, optional_credential_bindings, upstream_url, attribution
)
values
  ('census','U.S. Census Data API','PUBLIC_OPEN','OPEN','http','persistent',array['demographics','housing','commuting','business'],array['CENSUS_API_KEY'],array[]::text[],'https://api.census.gov',null),
  ('eia','U.S. Energy Information Administration','PUBLIC_OPEN','OPEN','http','persistent',array['electricity','generation','demand','prices','grid-flows'],array['EIA_API_KEY'],array[]::text[],'https://api.eia.gov',null),
  ('data_commons','Data Commons','PUBLIC_OPEN','OPEN','http','persistent',array['knowledge-graph','statistics','place-variables'],array['DATA_COMMONS_API_KEY'],array[]::text[],'https://api.datacommons.org',null),
  ('bls','Bureau of Labor Statistics','PUBLIC_OPEN','OPEN','http','persistent',array['labor','wages','employment','prices'],array['BLS_API_KEY'],array[]::text[],'https://api.bls.gov',null),
  ('fred','Federal Reserve Economic Data','PUBLIC_OPEN','OPEN','http','persistent',array['macroeconomics','regional-economics','housing','finance'],array['FRED_API_KEY'],array[]::text[],'https://api.stlouisfed.org',null),
  ('usaspending','USAspending','PUBLIC_OPEN','OPEN','http','persistent',array['federal-awards','contracts','grants','recipients'],array[]::text[],array[]::text[],'https://api.usaspending.gov',null),
  ('grants_gov','Grants.gov','PUBLIC_OPEN','OPEN','http','persistent',array['grant-opportunities','agencies'],array[]::text[],array[]::text[],'https://api.grants.gov',null),
  ('epa','U.S. Environmental Protection Agency','PUBLIC_OPEN','OPEN','http','persistent',array['facilities','air','water','tri','compliance'],array[]::text[],array[]::text[],'https://data.epa.gov',null),
  ('usgs','U.S. Geological Survey','PUBLIC_OPEN','OPEN','http','persistent',array['earthquakes','geology','hazards'],array[]::text[],array[]::text[],'https://earthquake.usgs.gov','Data courtesy of the U.S. Geological Survey'),
  ('open_meteo','Open-Meteo','PUBLIC_OPEN','OPEN','http','persistent',array['weather','forecast','historical-weather'],array[]::text[],array[]::text[],'https://api.open-meteo.com','Weather data by Open-Meteo.com'),
  ('nhtsa','National Highway Traffic Safety Administration','PUBLIC_OPEN','OPEN','http','persistent',array['vehicle-safety','recalls','complaints','crashes'],array[]::text[],array[]::text[],'https://api.nhtsa.gov',null),
  ('celestrak','CelesTrak','PUBLIC_OPEN','OPEN','http','persistent',array['satellite-orbits'],array[]::text[],array[]::text[],'https://celestrak.org','CelesTrak (celestrak.org), Dr. T.S. Kelso'),
  ('overpass','OpenStreetMap Overpass','PUBLIC_OPEN','OPEN','http','persistent',array['roads','infrastructure','military-installations','poi'],array[]::text[],array[]::text[],'https://overpass-api.de/api','© OpenStreetMap contributors'),
  ('adsb_lol','ADSB.lol','PUBLIC_OPEN','OPEN','http','persistent',array['aircraft','military-aircraft','aircraft-traces'],array[]::text[],array[]::text[],'https://api.adsb.lol','adsb.lol contributors — ODbL 1.0'),
  ('launch_library2','Launch Library 2','PUBLIC_OPEN','OPEN','http','persistent',array['launches','missions','pads','spaceflight-events'],array[]::text[],array['LL2_API_TOKEN'],'https://ll.thespacedevs.com','Launch Library 2 — The Space Devs'),
  ('radio_browser','Radio Browser','PUBLIC_OPEN','OPEN','http','persistent',array['radio-stations','station-tags'],array[]::text[],array[]::text[],'https://all.api.radio-browser.info','Radio Browser'),
  ('reearth_terrain','Re:Earth Terrain / Mapterhorn','PUBLIC_OPEN','OPEN','http','persistent',array['terrain','height'],array[]::text[],array[]::text[],'https://terrain.reearth.land','Re:Earth Terrain / Mapterhorn (CC BY 4.0)'),
  ('gbfs','General Bikeshare Feed Specification','PUBLIC_OPEN','OPEN','http','persistent',array['bikeshare','stations','vehicle-availability'],array[]::text[],array[]::text[],'provider-specific','Per-feed operator attribution required'),
  ('cctv','Public Traffic Camera Catalogs','PUBLIC_OPEN','OPEN','http','transient',array['traffic-cameras','public-camera-catalog'],array[]::text[],array[]::text[],'provider-specific','Per-camera provider attribution required'),
  ('nominatim','OpenStreetMap Nominatim','PUBLIC_OPEN','OPEN','http','transient',array['reverse-geocoding','place-labels'],array[]::text[],array[]::text[],'https://nominatim.openstreetmap.org','© OpenStreetMap contributors'),
  ('gdelt','GDELT Project DOC 2.0','PUBLIC_OPEN','OPEN','http','transient',array['regional-news','events','headlines'],array[]::text[],array[]::text[],'https://api.gdeltproject.org','GDELT Project'),
  ('nasa_firms','NASA FIRMS Active Fires','PUBLIC_OPEN','OPEN','http','persistent',array['active-fires','thermal-anomalies'],array['FIRMS_MAP_KEY'],array[]::text[],'https://firms.modaps.eosdis.nasa.gov','NASA FIRMS'),
  ('copernicus','Copernicus Data Space Ecosystem','PUBLIC_OPEN','OPEN','http','persistent',array['sentinel-imagery','stac','earth-observation'],array['COPERNICUS_CLIENT_ID','COPERNICUS_CLIENT_SECRET'],array[]::text[],'https://catalogue.dataspace.copernicus.eu',null),
  ('planet_research','Planet Education & Research','ACADEMIC','SCSU_RESEARCH','http','persistent',array['planet-scope','change-detection','earth-observation'],array['PLANET_RESEARCH_API_KEY'],array[]::text[],'https://api.planet.com',null),
  ('opensky_research','OpenSky Network Research','ACADEMIC','SCSU_RESEARCH','http','transient',array['aircraft','flight-history'],array['OPENSKY_CLIENT_ID','OPENSKY_CLIENT_SECRET'],array[]::text[],'https://opensky-network.org','OpenSky Network'),
  ('tomtom','TomTom Traffic','COMMERCIAL','COMMERCIAL','http','transient',array['traffic','flow-segments','flow-tiles','routing'],array['TOMTOM_API_KEY'],array[]::text[],'https://api.tomtom.com','Traffic flow data © TomTom'),
  ('aisstream','AISStream','COMMERCIAL','COMMERCIAL','websocket','transient',array['vessels','ais'],array['AISSTREAM_API_KEY'],array[]::text[],'wss://stream.aisstream.io','AISStream.io'),
  ('mapbox','Mapbox','COMMERCIAL','COMMERCIAL_OR_NONPROFIT','http','transient',array['maps','tiles','routing','geocoding'],array['MAPBOX_ACCESS_TOKEN'],array[]::text[],'https://api.mapbox.com',null),
  ('google_maps','Google Maps Platform','COMMERCIAL','COMMERCIAL_OR_NONPROFIT','http','none',array['maps','places','geocoding','3d-tiles'],array['GOOGLE_MAPS_API_KEY'],array[]::text[],'https://maps.googleapis.com','Google Maps'),
  ('cesium_ion','Cesium ion','COMMERCIAL','VIEWER','http','none',array['3d-tiles','terrain','viewer-assets'],array['CESIUM_ION_TOKEN'],array[]::text[],'https://api.cesium.com','Cesium ion')
on conflict (source_key) do update set
  name = excluded.name,
  source_class = excluded.source_class,
  lane = excluded.lane,
  transport = excluded.transport,
  persistence_policy = excluded.persistence_policy,
  capabilities = excluded.capabilities,
  credential_bindings = excluded.credential_bindings,
  optional_credential_bindings = excluded.optional_credential_bindings,
  upstream_url = excluded.upstream_url,
  attribution = excluded.attribution,
  updated_at = now();

-- Reconciles 20260909034100_spatial_observation_idempotency.sql
create unique index if not exists seek_first_observations_external_uidx
  on public.seek_first_observations (org_id, source_key, external_id);

-- Reconciles 20260909040000_spatial_entity_history.sql

create table if not exists public.seek_first_entity_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_id uuid not null references public.seek_first_entities(id) on delete cascade,
  revision integer not null,
  change_type text not null check (change_type in ('created', 'updated')),
  source_key text not null,
  external_id text,
  name text,
  entity_type text,
  location extensions.geography(Point, 4326),
  footprint extensions.geometry(Geometry, 4326),
  properties jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  source_url text,
  observed_at timestamptz,
  recorded_at timestamptz not null default now()
);

create index if not exists seek_first_entity_revisions_entity_idx
  on public.seek_first_entity_revisions (entity_id, recorded_at desc, revision desc);
create index if not exists seek_first_entity_revisions_org_time_idx
  on public.seek_first_entity_revisions (org_id, recorded_at desc);
create index if not exists seek_first_entity_revisions_location_gix
  on public.seek_first_entity_revisions using gist (location);


create or replace function public.seek_first_entities_record_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_revision integer;
  change text;
begin
  if tg_op = 'UPDATE' then
    if new.name is not distinct from old.name
      and new.entity_type is not distinct from old.entity_type
      and new.source_url is not distinct from old.source_url
      and new.properties is not distinct from old.properties
      and extensions.st_asewkb(new.location::extensions.geometry)
          is not distinct from extensions.st_asewkb(old.location::extensions.geometry)
      and extensions.st_asewkb(new.footprint)
          is not distinct from extensions.st_asewkb(old.footprint)
    then
      return new;
    end if;
    change := 'updated';
  else
    change := 'created';
  end if;

  select coalesce(max(r.revision), 0) + 1
    into next_revision
    from public.seek_first_entity_revisions r
   where r.entity_id = new.id;

  insert into public.seek_first_entity_revisions (
    org_id, entity_id, revision, change_type, source_key, external_id,
    name, entity_type, location, footprint, properties, provenance,
    source_url, observed_at
  )
  values (
    new.org_id, new.id, next_revision, change, new.source_key, new.external_id,
    new.name, new.entity_type, new.location, new.footprint, new.properties,
    new.provenance, new.source_url, new.observed_at
  );

  return new;
end;
$$;

drop trigger if exists seek_first_entities_revision_trg on public.seek_first_entities;
create trigger seek_first_entities_revision_trg
  after insert or update on public.seek_first_entities
  for each row execute function public.seek_first_entities_record_revision();


create or replace function public.seek_first_timeline(
  p_org uuid,
  p_lat double precision,
  p_lon double precision,
  p_radius_m double precision default 25000,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 200,
  p_source text default null
)
returns table (
  kind text,
  id uuid,
  entity_id uuid,
  source_key text,
  label text,
  detail text,
  lat double precision,
  lon double precision,
  distance_m double precision,
  occurred_at timestamptz,
  properties jsonb,
  provenance jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with origin as (
    select extensions.st_point(p_lon, p_lat, 4326)::extensions.geography as g,
           greatest(0, least(coalesce(p_radius_m, 25000), 2000000)) as radius
  ),
  window_bounds as (
    select coalesce(p_from, '-infinity'::timestamptz) as lo,
           coalesce(p_to, 'infinity'::timestamptz) as hi
  ),
  revisions as (
    select
      'entity_revision'::text as kind,
      r.id,
      r.entity_id,
      r.source_key,
      coalesce(r.name, r.entity_type) as label,
      r.change_type as detail,
      r.location,
      coalesce(r.observed_at, r.recorded_at) as occurred_at,
      r.properties,
      r.provenance
    from public.seek_first_entity_revisions r, origin o, window_bounds w
    where r.org_id = p_org
      and r.location is not null
      and (p_source is null or r.source_key = p_source)
      and coalesce(r.observed_at, r.recorded_at) between w.lo and w.hi
      and extensions.st_dwithin(r.location, o.g, o.radius)
  ),
  events as (
    select
      'event'::text as kind,
      e.id,
      null::uuid as entity_id,
      e.source_key,
      coalesce(e.name, e.event_type) as label,
      e.event_type as detail,
      e.location,
      e.observed_at as occurred_at,
      e.properties,
      e.provenance
    from public.seek_first_events e, origin o, window_bounds w
    where e.org_id = p_org
      and e.location is not null
      and (p_source is null or e.source_key = p_source)
      and e.observed_at between w.lo and w.hi
      and extensions.st_dwithin(e.location, o.g, o.radius)
  ),
  observations as (
    select
      'observation'::text as kind,
      b.id,
      b.entity_id,
      b.source_key,
      coalesce(b.metric, b.observation_type) as label,
      coalesce(b.value_text, b.value_number::text) as detail,
      b.location,
      b.observed_at as occurred_at,
      b.payload as properties,
      b.provenance
    from public.seek_first_observations b, origin o, window_bounds w
    where b.org_id = p_org
      and b.location is not null
      and (p_source is null or b.source_key = p_source)
      and b.observed_at between w.lo and w.hi
      and extensions.st_dwithin(b.location, o.g, o.radius)
  ),
  merged as (
    select * from revisions
    union all select * from events
    union all select * from observations
  )
  select
    m.kind,
    m.id,
    m.entity_id,
    m.source_key,
    m.label,
    m.detail,
    extensions.st_y(m.location::extensions.geometry) as lat,
    extensions.st_x(m.location::extensions.geometry) as lon,
    extensions.st_distance(m.location, o.g) as distance_m,
    m.occurred_at,
    m.properties,
    m.provenance
  from merged m, origin o
  order by m.occurred_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 2000));
$$;

alter table public.seek_first_entity_revisions enable row level security;
revoke all on table public.seek_first_entity_revisions from anon, authenticated;
grant select, insert, update, delete on table public.seek_first_entity_revisions to service_role;

revoke all on function public.seek_first_timeline(uuid,double precision,double precision,double precision,timestamptz,timestamptz,integer,text) from public, anon, authenticated;
grant execute on function public.seek_first_timeline(uuid,double precision,double precision,double precision,timestamptz,timestamptz,integer,text) to service_role;
revoke all on function public.seek_first_entities_record_revision() from public, anon, authenticated;
grant execute on function public.seek_first_entities_record_revision() to service_role;

-- Reconciles 20260910230000_spatial_bitemporal_and_resolution.sql

create table if not exists public.seek_first_beliefs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_id uuid references public.seek_first_entities(id) on delete cascade,

  source_key text not null,
  external_id text,
  predicate text not null,
  value jsonb not null default '{}'::jsonb,
  location extensions.geography(Point, 4326),

  valid_from timestamptz not null,
  valid_to timestamptz,

  recorded_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references public.seek_first_beliefs(id) on delete set null,

  archive_key text,
  archive_sha256 text,
  source_url text,
  licence_id text,
  source_class text,
  provenance jsonb not null default '{}'::jsonb,

  constraint seek_first_beliefs_valid_order check (valid_to is null or valid_to > valid_from),
  constraint seek_first_beliefs_superseded_order check (superseded_at is null or superseded_at >= recorded_at),
  constraint seek_first_beliefs_sha check (archive_sha256 is null or archive_sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists seek_first_beliefs_bitemporal_idx
  on public.seek_first_beliefs (org_id, entity_id, recorded_at desc, valid_from desc);
create index if not exists seek_first_beliefs_current_idx
  on public.seek_first_beliefs (org_id, predicate, valid_from desc)
  where superseded_at is null;
create index if not exists seek_first_beliefs_location_gix
  on public.seek_first_beliefs using gist (location);
create index if not exists seek_first_beliefs_archive_idx
  on public.seek_first_beliefs (archive_key)
  where archive_key is not null;

alter table public.seek_first_beliefs enable row level security;


create or replace function public.seek_first_as_of(
  p_org uuid,
  p_known_at timestamptz default now(),
  p_valid_at timestamptz default now(),
  p_entity uuid default null,
  p_predicate text default null,
  p_limit integer default 500
)
returns table (
  id uuid,
  entity_id uuid,
  source_key text,
  predicate text,
  value jsonb,
  valid_from timestamptz,
  valid_to timestamptz,
  recorded_at timestamptz,
  archive_key text,
  licence_id text,
  source_class text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.id, b.entity_id, b.source_key, b.predicate, b.value,
         b.valid_from, b.valid_to, b.recorded_at,
         b.archive_key, b.licence_id, b.source_class
    from public.seek_first_beliefs b
   where b.org_id = p_org
     and b.recorded_at <= p_known_at
     and (b.superseded_at is null or b.superseded_at > p_known_at)
     and b.valid_from <= p_valid_at
     and (b.valid_to is null or b.valid_to > p_valid_at)
     and (p_entity is null or b.entity_id = p_entity)
     and (p_predicate is null or b.predicate = p_predicate)
   order by b.valid_from desc, b.recorded_at desc
   limit greatest(1, least(coalesce(p_limit, 500), 5000));
$$;


create or replace function public.seek_first_supersede_belief(
  p_belief uuid,
  p_replacement uuid,
  p_known_at timestamptz default now()
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.seek_first_beliefs
     set superseded_at = p_known_at,
         superseded_by = p_replacement
   where id = p_belief
     and superseded_at is null;
$$;


create table if not exists public.seek_first_entity_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  canonical_entity_id uuid not null references public.seek_first_entities(id) on delete cascade,
  member_entity_id uuid not null references public.seek_first_entities(id) on delete cascade,

  match_method text not null check (match_method in (
    'exact_external_id', 'shared_identifier', 'spatial_temporal', 'name_similarity', 'manual'
  )),
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  evidence jsonb not null default '{}'::jsonb,

  decided_by text not null default 'system',
  decided_at timestamptz not null default now(),
  retracted_at timestamptz,

  constraint seek_first_entity_links_distinct check (canonical_entity_id <> member_entity_id)
);

create unique index if not exists seek_first_entity_links_live_uidx
  on public.seek_first_entity_links (org_id, canonical_entity_id, member_entity_id)
  where retracted_at is null;
create index if not exists seek_first_entity_links_member_idx
  on public.seek_first_entity_links (org_id, member_entity_id)
  where retracted_at is null;

alter table public.seek_first_entity_links enable row level security;


create or replace function public.seek_first_resolved_members(
  p_org uuid,
  p_canonical uuid,
  p_min_confidence numeric default 0.5
)
returns table (
  member_entity_id uuid,
  match_method text,
  confidence numeric,
  decided_by text,
  decided_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.member_entity_id, l.match_method, l.confidence, l.decided_by, l.decided_at
    from public.seek_first_entity_links l
   where l.org_id = p_org
     and l.canonical_entity_id = p_canonical
     and l.retracted_at is null
     and (l.match_method = 'manual' or l.confidence >= coalesce(p_min_confidence, 0.5))
   order by (l.match_method = 'manual') desc, l.confidence desc, l.decided_at desc;
$$;

-- Reconciles 20260910234500_spatial_governance_and_audit.sql

create table if not exists public.seek_first_jurisdiction_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,

  jurisdiction text not null,
  display_name text,

  retention_days integer not null default 7 check (retention_days > 0 and retention_days <= 3650),

  permitted_purposes text[] not null default '{}',
  prohibited_purposes text[] not null default '{}',

  permitted_agencies text[] not null default '{}',
  external_sharing_enabled boolean not null default false,
  external_sharing_expires_at timestamptz,

  enabled boolean not null default true,

  adopted_by text,
  adopted_at timestamptz not null default now(),
  policy_version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists seek_first_jurisdiction_policies_uidx
  on public.seek_first_jurisdiction_policies (org_id, lower(jurisdiction));

alter table public.seek_first_jurisdiction_policies enable row level security;


create table if not exists public.seek_first_policy_amendments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  policy_id uuid not null references public.seek_first_jurisdiction_policies(id) on delete cascade,

  from_version integer not null,
  to_version integer not null,
  changed jsonb not null default '{}'::jsonb,
  rationale text,

  amended_by text not null,
  amended_at timestamptz not null default now()
);

create index if not exists seek_first_policy_amendments_policy_idx
  on public.seek_first_policy_amendments (org_id, policy_id, amended_at desc);

alter table public.seek_first_policy_amendments enable row level security;


create table if not exists public.seek_first_query_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,

  jurisdiction text not null,
  sequence bigint not null,

  purpose text not null,
  authority text not null,
  requesting_agency text not null,
  requested_by text not null,
  case_reference text,
  note text,

  decision text not null check (decision in ('allow', 'deny')),
  reason text not null,

  source_key text,
  operation text,
  query_fingerprint text,
  record_count integer,

  policy_version integer,
  retention_deadline timestamptz,

  occurred_at timestamptz not null default now(),
  previous_hash text not null,
  entry_hash text not null
);

create unique index if not exists seek_first_query_audit_seq_uidx
  on public.seek_first_query_audit (org_id, jurisdiction, sequence);
create unique index if not exists seek_first_query_audit_hash_uidx
  on public.seek_first_query_audit (entry_hash);
create index if not exists seek_first_query_audit_case_idx
  on public.seek_first_query_audit (org_id, jurisdiction, case_reference)
  where case_reference is not null;
create index if not exists seek_first_query_audit_agency_idx
  on public.seek_first_query_audit (org_id, jurisdiction, requesting_agency, occurred_at desc);
create index if not exists seek_first_query_audit_denied_idx
  on public.seek_first_query_audit (org_id, jurisdiction, occurred_at desc)
  where decision = 'deny';

alter table public.seek_first_query_audit enable row level security;


create or replace function public.seek_first_query_audit_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'seek_first_query_audit is append-only (attempted %)', tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists seek_first_query_audit_no_update on public.seek_first_query_audit;
create trigger seek_first_query_audit_no_update
  before update or delete on public.seek_first_query_audit
  for each row execute function public.seek_first_query_audit_is_append_only();


create or replace function public.seek_first_audit_head(p_org uuid, p_jurisdiction text)
returns table (sequence bigint, entry_hash text)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(max(a.sequence), -1)::bigint,
         coalesce(
           (select a2.entry_hash
              from public.seek_first_query_audit a2
             where a2.org_id = p_org
               and lower(a2.jurisdiction) = lower(p_jurisdiction)
             order by a2.sequence desc
             limit 1),
           'seek-first:audit:genesis')
    from public.seek_first_query_audit a
   where a.org_id = p_org
     and lower(a.jurisdiction) = lower(p_jurisdiction);
$$;


create or replace function public.seek_first_transparency_report(
  p_org uuid,
  p_jurisdiction text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  requesting_agency text,
  purpose text,
  decision text,
  reason text,
  queries bigint,
  distinct_cases bigint,
  first_at timestamptz,
  last_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.requesting_agency,
         a.purpose,
         a.decision,
         a.reason,
         count(*)::bigint,
         count(distinct a.case_reference)::bigint,
         min(a.occurred_at),
         max(a.occurred_at)
    from public.seek_first_query_audit a
   where a.org_id = p_org
     and lower(a.jurisdiction) = lower(p_jurisdiction)
     and a.occurred_at >= p_from
     and a.occurred_at < p_to
   group by a.requesting_agency, a.purpose, a.decision, a.reason
   order by count(*) desc;
$$;


create or replace function public.seek_first_retention_overage(p_org uuid, p_jurisdiction text)
returns table (source_key text, rows_over bigint, oldest_observed_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  with policy as (
    select p.retention_days
      from public.seek_first_jurisdiction_policies p
     where p.org_id = p_org
       and lower(p.jurisdiction) = lower(p_jurisdiction)
     limit 1
  )
  select o.source_key,
         count(*)::bigint,
         min(o.observed_at)
    from public.seek_first_observations o, policy
   where o.org_id = p_org
     and o.observed_at < now() - make_interval(days => policy.retention_days)
   group by o.source_key
   order by count(*) desc;
$$;


-- Explicit privileges for ALL spatial tables and RPCs, including the later history/governance additions.
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname='public' and tablename like 'seek\_first\_%' escape '\' loop
    execute format('alter table public.%I enable row level security',r.tablename);
    execute format('revoke all on table public.%I from public, anon, authenticated',r.tablename);
    execute format('grant select, insert, update, delete on table public.%I to service_role',r.tablename);
  end loop;
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'seek\_first\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated',r.signature);
    execute format('grant execute on function %s to service_role',r.signature);
  end loop;
end $$;

-- Missing/unavailable provider measurements are unknown, never manufactured zeros.


alter table public.social_metric_snapshots alter column views drop not null;

alter table public.social_metric_snapshots alter column reach drop not null;

alter table public.social_metric_snapshots alter column likes drop not null;

alter table public.social_metric_snapshots alter column comments drop not null;

alter table public.social_metric_snapshots alter column shares drop not null;

alter table public.social_metric_snapshots alter column saves drop not null;

alter table public.social_metric_snapshots alter column follows drop not null;

alter table public.social_metric_snapshots alter column profile_visits drop not null;

alter table public.social_metric_snapshots alter column dms drop not null;

alter table public.social_metric_snapshots alter column leads drop not null;

alter table public.social_metric_snapshots alter column watch_time_seconds drop not null;

alter table public.social_metric_snapshots alter column avg_watch_time_seconds drop not null;


-- Read-only media discovery uses the existing scheduler and canonical accounts.
alter table public.social_accounts
  add column if not exists media_discovery_cursor text,
  add column if not exists next_media_discovery_at timestamptz not null default now(),
  add column if not exists last_media_discovery_at timestamptz,
  add column if not exists media_discovery_error text,
  add column if not exists provider_metrics jsonb;
create index if not exists social_accounts_media_discovery_due_idx
  on public.social_accounts(next_media_discovery_at) where platform='instagram' and status='connected';
create or replace function public.claim_instagram_discovery_accounts(p_limit integer default 5)
returns setof public.social_accounts language sql security invoker set search_path='' as $$
  with due as (
    select id from public.social_accounts
    where platform='instagram' and status='connected' and next_media_discovery_at <= now()
    order by next_media_discovery_at, id for update skip locked
    limit greatest(1,least(coalesce(p_limit,5),10))
  )
  update public.social_accounts a set next_media_discovery_at=now()+interval '10 minutes'
  from due where a.id=due.id returning a.*;
$$;
revoke all on function public.claim_instagram_discovery_accounts(integer) from public,anon,authenticated;
grant execute on function public.claim_instagram_discovery_accounts(integer) to service_role;

-- Imported historical posts get one initial measurement; recent posts keep refreshing.
create or replace function public.claim_social_insight_posts(p_limit integer default 25)
returns setof public.social_posts language sql security invoker set search_path='' as $$
  with due as (
    select p.id from public.social_posts p join public.social_accounts a on a.id=p.account_id and a.org_id=p.org_id
    where a.platform='instagram' and a.status='connected' and p.external_media_id is not null
      and (p.last_insights_synced_at is null or p.published_at >= now()-interval '7 days')
      and p.next_insights_sync_at <= now()
    order by p.next_insights_sync_at,p.published_at,p.id for update of p skip locked
    limit greatest(1,least(coalesce(p_limit,25),100))
  ) update public.social_posts p set next_insights_sync_at=now()+interval '10 minutes',updated_at=now()
    from due where p.id=due.id returning p.*;
$$;
revoke all on function public.claim_social_insight_posts(integer) from public,anon,authenticated;
grant execute on function public.claim_social_insight_posts(integer) to service_role;
