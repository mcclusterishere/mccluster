-- PENDING: PRIM3 level drafts and immutable playable snapshots. NOT applied.
-- Generated with `supabase migration new prim3_level_builder_v1`, then moved
-- here under the repository's production-version-only migration convention.
-- Authority stays with the canonical mccluster Worker and house-owner membership.
-- Snapshots are private; "publish" freezes a play version, not public access.
-- Rollback is intentionally not destructive: disable Worker routes first and
-- retain these tables. Dropping the schema requires a separate data-retention decision.
begin;

create or replace function public.prim3_level_document_valid(p_doc jsonb)
returns boolean language plpgsql immutable security invoker set search_path = ''
as $$
declare
  b jsonb;
  item jsonb;
  min_x integer; max_x integer; min_y integer; max_y integer;
  known_assets constant text[] := array[
    'concrete-tile-8','soil-tile-8','grass-tile-8','water-tile-16',
    'warehouse-16','tower-8','wall-8','low-barrier-4','high-cover-4',
    'container-12','crate-2','bridge-16','stairs-8','catwalk-8','ladder-8',
    'pipe-stack-6','hvac-3','relay-terminal','gate-8','fence-8','tree-8',
    'rock-cluster','spawn-marker','extraction-marker'
  ];
begin
  if jsonb_typeof(p_doc) is distinct from 'object' or octet_length(p_doc::text) > 262144 then return false; end if;
  if p_doc->'schemaVersion' is distinct from '1'::jsonb
     or jsonb_typeof(p_doc->'id') is distinct from 'string'
     or coalesce(p_doc->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
     or jsonb_typeof(p_doc->'title') is distinct from 'string'
     or length(btrim(p_doc->>'title')) not between 1 and 80 then return false; end if;
  if exists (select 1 from jsonb_object_keys(p_doc) k where k <> all(array['schemaVersion','id','title','bounds','objects','spawns','objective','extraction','connections','metadata'])) then return false; end if;
  b := p_doc->'bounds';
  if jsonb_typeof(b) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(b)) <> 4 then return false; end if;
  if not (b ?& array['minX','maxX','minY','maxY']) then return false; end if;
  if exists (select 1 from jsonb_each(b) v where jsonb_typeof(v.value) <> 'number' or v.value::text !~ '^-?[0-9]+$') then return false; end if;
  min_x := (b->>'minX')::integer; max_x := (b->>'maxX')::integer;
  min_y := (b->>'minY')::integer; max_y := (b->>'maxY')::integer;
  if least(min_x,min_y) < -256 or greatest(max_x,max_y) > 255
     or max_x-min_x+1 not between 128 and 256 or max_y-min_y+1 not between 128 and 256
     or min_x > 0 or max_x < 0 or min_y > 0 or max_y < 0 then return false; end if;
  if jsonb_typeof(p_doc->'objects') is distinct from 'array' or jsonb_array_length(p_doc->'objects') > 500 then return false; end if;
  for item in select value from jsonb_array_elements(p_doc->'objects') loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'id') is distinct from 'string'
       or coalesce(item->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
       or not coalesce(item->>'assetId' = any(known_assets),false)
       or jsonb_typeof(item->'x') is distinct from 'number' or jsonb_typeof(item->'y') is distinct from 'number'
       or item->>'x' !~ '^-?[0-9]+$' or item->>'y' !~ '^-?[0-9]+$'
       or (item->>'x')::integer not between min_x and max_x or (item->>'y')::integer not between min_y and max_y then return false; end if;
    if exists (select 1 from jsonb_object_keys(item) k where k <> all(array['id','assetId','x','y','rotation','elevation','scale'])) then return false; end if;
    if item ? 'rotation' and (jsonb_typeof(item->'rotation') <> 'number' or item->'rotation' not in ('0'::jsonb,'90'::jsonb,'180'::jsonb,'270'::jsonb)) then return false; end if;
    if item ? 'elevation' and (jsonb_typeof(item->'elevation') <> 'number' or item->>'elevation' !~ '^[0-9]+$' or (item->>'elevation')::integer not between 0 and 24) then return false; end if;
    if item ? 'scale' and (jsonb_typeof(item->'scale') <> 'number' or (item->>'scale')::numeric not between 0.5 and 3) then return false; end if;
  end loop;
  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(p_doc->'objects')) then return false; end if;
  if p_doc->'objective' is distinct from '{"type":"relay","x":0,"y":0}'::jsonb then return false; end if;
  if jsonb_typeof(p_doc->'extraction') is distinct from 'object'
     or not (p_doc->'extraction' ?& array['x','y','radius'])
     or (select count(*) from jsonb_object_keys(p_doc->'extraction')) <> 3
     or jsonb_typeof(p_doc->'extraction'->'x') is distinct from 'number'
     or jsonb_typeof(p_doc->'extraction'->'y') is distinct from 'number'
     or jsonb_typeof(p_doc->'extraction'->'radius') is distinct from 'number'
     or (p_doc->'extraction'->>'x') !~ '^-?[0-9]+$'
     or (p_doc->'extraction'->>'y') !~ '^-?[0-9]+$'
     or (p_doc->'extraction'->>'radius') !~ '^[0-9]+$'
     or (p_doc->'extraction'->>'x')::integer not between min_x and max_x
     or (p_doc->'extraction'->>'y')::integer not between min_y and max_y
     or (p_doc->'extraction'->>'radius')::integer not between 2 and 16 then return false; end if;
  if jsonb_typeof(p_doc->'spawns') is distinct from 'array' or jsonb_array_length(p_doc->'spawns') > 32
     or jsonb_typeof(p_doc->'connections') is distinct from 'array' or jsonb_array_length(p_doc->'connections') > 64 then return false; end if;
  -- The Worker runs the shared editor compiler for full spawn, footprint and
  -- traversal validation before any write, and reachability before publishing.
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.prim3_level_document_valid(jsonb) from public, anon, authenticated;
grant execute on function public.prim3_level_document_valid(jsonb) to service_role;

create table if not exists public.prim3_levels (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  title text not null check (length(btrim(title)) between 1 and 80),
  draft jsonb not null check (public.prim3_level_document_valid(draft)),
  revision integer not null default 1 check (revision > 0),
  archived boolean not null default false,
  published_version integer check (published_version > 0),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (id = draft->>'id' and title = draft->>'title')
);
create index if not exists prim3_levels_recent_idx on public.prim3_levels(archived, updated_at desc, id);
create index if not exists prim3_levels_created_by_idx on public.prim3_levels(created_by);
create index if not exists prim3_levels_updated_by_idx on public.prim3_levels(updated_by);

create table if not exists public.prim3_level_versions (
  level_id text not null references public.prim3_levels(id) on delete restrict,
  version integer not null check (version > 0),
  source_revision integer not null check (source_revision > 0),
  document jsonb not null check (public.prim3_level_document_valid(document)),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (level_id, version),
  unique (level_id, source_revision),
  check (level_id = document->>'id')
);
create index if not exists prim3_level_versions_created_by_idx on public.prim3_level_versions(created_by);

alter table public.prim3_levels enable row level security;
alter table public.prim3_level_versions enable row level security;
-- No anon/authenticated policies: drafts and snapshots are private admin data.
revoke all on public.prim3_levels, public.prim3_level_versions from public, anon, authenticated;
revoke all on public.prim3_levels, public.prim3_level_versions from service_role;
grant select, insert, update on public.prim3_levels to service_role;
grant select, insert on public.prim3_level_versions to service_role;
revoke delete, truncate on public.prim3_levels from service_role;
revoke update, delete, truncate on public.prim3_level_versions from service_role;

create or replace function public.prim3_level_version_immutable()
returns trigger language plpgsql security invoker set search_path = ''
as $$ begin raise exception 'Level snapshots are immutable' using errcode = '55000'; end; $$;
revoke all on function public.prim3_level_version_immutable() from public, anon, authenticated;
drop trigger if exists prim3_level_version_immutable on public.prim3_level_versions;
create trigger prim3_level_version_immutable before update or delete on public.prim3_level_versions
for each row execute function public.prim3_level_version_immutable();

create or replace function public.prim3_level_mutate(
  p_action text, p_id text, p_actor uuid, p_document jsonb, p_expected_revision integer
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  current_level public.prim3_levels%rowtype;
  snapshot_version integer;
begin
  -- Server-owned actor identity. Called only by service_role after validating
  -- the live bearer user; repeat membership here to close revocation races.
  if p_actor is null or not exists (
    select 1 from public.org_members m join public.orgs o on o.id = m.org_id
    where o.slug = 'mccluster' and m.profile_id = p_actor and m.role = 'owner'
  ) then raise exception 'House owner required' using errcode = '42501'; end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
     or p_action is null or p_action not in ('create','save','archive','restore','publish') then
    raise exception 'Invalid level mutation' using errcode = '22023';
  end if;
  if p_action in ('create','save') and (
    not public.prim3_level_document_valid(p_document) or p_document->>'id' is distinct from p_id
  ) then raise exception 'Invalid level document' using errcode = '23514'; end if;
  if p_action = 'create' then
    if p_expected_revision is not null then raise exception 'Create has no expected revision' using errcode = '22023'; end if;
    insert into public.prim3_levels(id,title,draft,created_by,updated_by)
    values(p_id,p_document->>'title',p_document,p_actor,p_actor) returning * into current_level;
    return to_jsonb(current_level);
  end if;
  select * into current_level from public.prim3_levels where id = p_id for update;
  if not found then raise exception 'Level not found' using errcode = 'P0002'; end if;
  if p_expected_revision is distinct from current_level.revision then
    raise exception 'Revision conflict' using errcode = '40001';
  end if;
  if p_action in ('save','publish') and current_level.archived then
    raise exception 'Level is archived' using errcode = '55000';
  end if;
  if p_action = 'publish' then
    -- Idempotent for the same source revision; no mutable pointer is returned
    -- as the snapshot's document. Draft saves cannot alter earlier snapshots.
    select version into snapshot_version from public.prim3_level_versions
      where level_id = p_id and source_revision = current_level.revision;
    if snapshot_version is null then
      select coalesce(max(version),0)+1 into snapshot_version from public.prim3_level_versions where level_id = p_id;
      insert into public.prim3_level_versions(level_id,version,source_revision,document,created_by)
      values(p_id,snapshot_version,current_level.revision,current_level.draft,p_actor);
    end if;
    update public.prim3_levels set published_version = snapshot_version, updated_by = p_actor, updated_at = now()
      where id = p_id returning * into current_level;
  else
    if current_level.revision >= 2147483646 then raise exception 'Revision exhausted' using errcode = '22023'; end if;
    update public.prim3_levels set
      draft = case when p_action = 'save' then p_document else draft end,
      title = case when p_action = 'save' then p_document->>'title' else title end,
      archived = case when p_action = 'archive' then true when p_action = 'restore' then false else archived end,
      revision = revision + 1, updated_by = p_actor, updated_at = now()
    where id = p_id returning * into current_level;
  end if;
  return to_jsonb(current_level);
end;
$$;
revoke all on function public.prim3_level_mutate(text,text,uuid,jsonb,integer) from public, anon, authenticated;
grant execute on function public.prim3_level_mutate(text,text,uuid,jsonb,integer) to service_role;

comment on table public.prim3_levels is 'Owner-private PRIM3 level drafts; canonical Worker only.';
comment on table public.prim3_level_versions is 'Immutable owner-private playable snapshots, not public releases.';
notify pgrst, 'reload schema';
commit;
