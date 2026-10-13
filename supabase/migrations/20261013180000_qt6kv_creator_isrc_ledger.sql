-- QT6KV allocation ledger for creator uploads. No client-side minting.
-- Historical numbers are reserved before any new assignment.
create table if not exists public.music_isrc_creator_registry (
  id uuid primary key default gen_random_uuid(),
  creator_track_id uuid unique references public.creator_tracks(id) on delete restrict,
  prefix_code text not null default 'QT6KV' check (prefix_code ~ '^[A-Z]{2}[A-Z0-9]{3}$'),
  reference_year smallint not null check (reference_year between 1900 and 9999),
  designation integer not null check (designation between 1 and 99999),
  isrc text generated always as (prefix_code || lpad((reference_year % 100)::text, 2, '0') || lpad(designation::text, 5, '0')) stored,
  recording_title text not null,
  version_title text not null default '',
  asset_type text not null default 'Audio',
  production_year smallint,
  duration_text text not null default '',
  explicit_content boolean,
  immersive boolean,
  artist text not null default '',
  rights_owner text not null default 'McCluster Corp',
  assignment_source text not null check (assignment_source in ('historical','platform','external')),
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(prefix_code,reference_year,designation),
  unique(isrc)
);
alter table public.music_isrc_creator_registry enable row level security;
revoke all on public.music_isrc_creator_registry from anon, authenticated;
-- Historical reservations from data/ddex/identifiers.json. Never reuse.
insert into public.music_isrc_creator_registry
(reference_year,designation,recording_title,artist,assignment_source)
values
(2026,1,'Who Did The Shoot','McCluster','historical'),
(2026,2,'Runway Walk','McCluster','historical'),
(2026,3,'Write a Song','McCluster','historical'),
(2026,4,'Here','McCluster','historical'),
(2026,5,'Antisocial','McCluster','historical'),
(2026,6,'Lightroom','McCluster','historical'),
(2026,7,'Got WiFi?','McCluster','historical'),
(2026,8,'Environmental Injustice','McCluster','historical'),
(2026,9,'Environmental Injustice (Brave mix)','McCluster','historical'),
(2026,10,'Please Set Me Free','McCluster','historical'),
(2026,11,'Money or the Power','McCluster','historical'),
(2026,12,'Deep End','McCluster','historical'),
(2026,13,'Heal the 3rd World','McCluster','historical'),
(2026,14,'Vaunt (Acoustic)','McCluster','historical'),
(2026,15,'Dealer Plates (A-Side)','McCluster','historical'),
(2026,16,'Dealer Plates (B-Side)','McCluster','historical'),
(2026,17,'Upset','McCluster','historical')
on conflict (prefix_code,reference_year,designation) do nothing;

-- Admin/server-only, idempotent and concurrency-safe.
-- Call only after the recording's rights and authorization have been checked.
create or replace function public.music_assign_creator_isrc(p_track uuid, p_rights_owner text default 'McCluster Corp')
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.creator_tracks%rowtype;
  existing text;
  yr smallint := extract(year from current_date)::smallint;
  next_number integer;
  result_code text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server-only ISRC assignment';
  end if;
  if p_rights_owner is null or btrim(p_rights_owner) = '' then
    raise exception 'Rights owner is required';
  end if;
  select * into t from public.creator_tracks where id = p_track;
  if not found then raise exception 'Recording not found'; end if;
  if t.status <> 'published' or t.rights_status not in ('approved','cleared') then
    raise exception 'Recording must be published and rights-cleared before assigning ISRC';
  end if;
  perform pg_advisory_xact_lock(hashtext('QT6KV-ISRC'),yr::integer);
  select isrc into existing from public.music_isrc_creator_registry where creator_track_id = p_track;
  if found then return existing; end if;
  -- Compare both ledgers, including the older eu_recordings allocator.
  select greatest(
    coalesce((select max(designation) from public.music_isrc_creator_registry
      where prefix_code = 'QT6KV' and reference_year = yr),0),
    coalesce((select max(designation_code) from public.music_isrc_allocations
      where year_of_reference = yr and left(isrc,5) = 'QT6KV'),0)
  ) + 1 into next_number;
  if next_number > 99999 then raise exception 'ISRC designation exhausted for %', yr; end if;
  insert into public.music_isrc_creator_registry
    (creator_track_id,reference_year,designation,recording_title,artist,rights_owner,assignment_source)
  values (p_track,yr,next_number,t.title,t.artist,p_rights_owner,'platform')
  returning isrc into result_code;
  return result_code;
end $$;
revoke all on function public.music_assign_creator_isrc(uuid,text) from public,anon,authenticated;
grant execute on function public.music_assign_creator_isrc(uuid,text) to service_role;

-- Admin export: service role only; never expose the registry through client RLS.
create or replace view public.music_isrc_admin_export as
select r.isrc,r.recording_title as title,r.version_title,r.artist,r.rights_owner,
       r.asset_type,r.production_year,r.duration_text,r.explicit_content,r.immersive,
       r.reference_year,r.designation,r.assignment_source,r.assigned_at,
       r.creator_track_id,t.duration_ms,t.genre,t.status
from public.music_isrc_creator_registry r
left join public.creator_tracks t on t.id = r.creator_track_id;
revoke all on public.music_isrc_admin_export from public,anon,authenticated;
grant select on public.music_isrc_admin_export to service_role;
