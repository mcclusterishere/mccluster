-- McCluster Music Registry: canonical music catalog + first-party ISRC allocation.
-- The live database already had the eu_* music tables; these IF NOT EXISTS
-- definitions make a clean repository replay converge to that same schema.

create table if not exists public.eu_music_works (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid,
  title text not null,
  iswc text not null default '',
  writers jsonb not null default '[]'::jsonb,
  publishers jsonb not null default '[]'::jsonb,
  rights jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.eu_recordings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  initiative_id uuid,
  work_id uuid references public.eu_music_works(id) on delete set null,
  artifact_id uuid,
  title text not null,
  version_title text not null default '',
  artist text not null default '',
  featured_artists jsonb not null default '[]'::jsonb,
  isrc text not null default '',
  duration_ms integer,
  recording_year integer,
  master_owner text not null default '',
  p_line text not null default '',
  c_line text not null default '',
  language text not null default 'en',
  explicit boolean not null default false,
  audio_ref jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.eu_music_works enable row level security;
alter table public.eu_recordings enable row level security;
revoke all on public.eu_music_works, public.eu_recordings from anon;
revoke insert, update, delete on public.eu_music_works, public.eu_recordings from authenticated;

create table if not exists public.music_isrc_registrants (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  prefix_code text not null default '',
  registrant_type text not null default 'rights_owner' check (registrant_type in ('rights_owner','isrc_manager')),
  active boolean not null default false,
  agency text not null default 'US ISRC Agency',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint music_isrc_prefix_format check (prefix_code = '' or prefix_code ~ '^[A-Z]{2}[A-Z0-9]{3}$')
);

alter table public.music_isrc_registrants enable row level security;
revoke all on public.music_isrc_registrants from anon, authenticated;
grant all on public.music_isrc_registrants to service_role;

create table if not exists public.music_isrc_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  recording_id uuid not null references public.eu_recordings(id) on delete cascade,
  isrc text not null,
  year_of_reference smallint not null,
  designation_code integer not null check (designation_code between 1 and 99999),
  assigned_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(recording_id),
  unique(isrc),
  unique(org_id, year_of_reference, designation_code)
);

alter table public.music_isrc_allocations enable row level security;
revoke all on public.music_isrc_allocations from anon, authenticated;
grant all on public.music_isrc_allocations to service_role;

create unique index if not exists eu_recordings_isrc_unique_nonblank
on public.eu_recordings (isrc) where isrc <> '';

create or replace function public.music_assign_isrc(p_recording_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
  v_existing text;
  v_prefix text;
  v_year integer := extract(year from current_date)::integer;
  v_code integer;
  v_isrc text;
begin
  select org_id, nullif(isrc,'') into v_org, v_existing
  from public.eu_recordings where id = p_recording_id for update;

  if v_org is null then raise exception 'recording_not_found'; end if;
  if v_existing is not null then return v_existing; end if;

  select prefix_code into v_prefix
  from public.music_isrc_registrants
  where org_id = v_org and active = true
  for update;

  if v_prefix is null or v_prefix = '' then raise exception 'isrc_prefix_not_configured'; end if;

  select coalesce(max(designation_code),0)+1 into v_code
  from public.music_isrc_allocations
  where org_id = v_org and year_of_reference = v_year;

  if v_code > 99999 then raise exception 'isrc_annual_capacity_exhausted'; end if;

  v_isrc := v_prefix || right(v_year::text,2) || lpad(v_code::text,5,'0');

  insert into public.music_isrc_allocations(org_id, recording_id, isrc, year_of_reference, designation_code)
  values(v_org,p_recording_id,v_isrc,v_year,v_code);

  update public.eu_recordings
  set isrc = v_isrc,
      metadata = coalesce(metadata,'{}'::jsonb) ||
        jsonb_build_object('isrc_assigned_at',now(),'isrc_source','mccluster_registry'),
      updated_at = now()
  where id = p_recording_id;

  return v_isrc;
end;
$$;

revoke all on function public.music_assign_isrc(uuid) from public, anon, authenticated;
grant execute on function public.music_assign_isrc(uuid) to service_role;

-- Resolve McCluster by stable slug rather than embedding an environment-specific UUID.
insert into public.music_isrc_registrants(org_id)
select id from public.orgs where slug = 'mccluster'
on conflict (org_id) do nothing;
