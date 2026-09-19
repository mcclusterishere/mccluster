-- Longitudinal entity history for the spatial intelligence plane.
--
-- seek_first_entities holds CURRENT state and is upserted by external_id, so without
-- this an April "wooded parcel" is silently overwritten by a July "building
-- footprint" and the change that matters is the one thing we cannot see.
-- seek_first_observations already records metrics over time; this records how the
-- entity itself changed, so "what physically happened on this parcel between
-- March and August" is answerable from stored evidence rather than inference.

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

/*
  Record a revision only when something an analyst would call a change actually
  changed. A re-ingest that finds the world unchanged updates last_seen_at and
  writes no revision, so the history stays a record of events rather than a
  record of how often the collector ran.

  revision is a per-entity counter for readability; recorded_at is the ordering
  key. It is deliberately not unique: two collectors racing the same entity
  should both leave a trace, not abort an ingestion run.
*/
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
      -- Compare geometries by their binary form: with search_path pinned to
      -- '' the bare geometry = geometry operator is ambiguous, and geography
      -- equality is an index operator rather than a value comparison.
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

/*
  One timeline for a place: entity revisions, events and observations in a
  radius and a time window, newest first. This is the query behind "what
  changed around this parcel in the last six months", and it returns provenance
  with every row so an answer can be traced back to the source that produced it.
*/
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

-- Same Data API boundary as the rest of the plane: no browser role reaches
-- these directly; the canonical Worker authorizes first and calls as
-- service_role.
alter table public.seek_first_entity_revisions enable row level security;
revoke all on table public.seek_first_entity_revisions from anon, authenticated;
grant select, insert, update, delete on table public.seek_first_entity_revisions to service_role;

revoke all on function public.seek_first_timeline(uuid,double precision,double precision,double precision,timestamptz,timestamptz,integer,text) from public, anon, authenticated;
grant execute on function public.seek_first_timeline(uuid,double precision,double precision,double precision,timestamptz,timestamptz,integer,text) to service_role;
revoke all on function public.seek_first_entities_record_revision() from public, anon, authenticated;
grant execute on function public.seek_first_entities_record_revision() to service_role;
