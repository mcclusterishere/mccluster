-- McCluster spatial intelligence data plane.
--
-- One canonical Supabase project, one org spine, one server-mediated API.
-- Provider credentials stay in the canonical Cloudflare Worker. Direct browser
-- access to these tables is intentionally denied so retention/licensing rules
-- can be enforced before data leaves the control plane.

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

-- Server-mediated spatial RPCs. service_role is the only Data API caller
-- granted EXECUTE; client authorization happens in the canonical Worker.
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

-- Explicit Data API boundary. Supabase no longer auto-grants public-table
-- privileges for newly created tables, and we make the intended boundary
-- explicit so historical project settings cannot accidentally widen it.
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

-- Seed metadata only. Credential values are Worker secrets and never database rows.
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
