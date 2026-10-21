-- ANALYTICS READS A LEAN COPY OF THE EVENTS.
-- public.events carries everything an event knows (props, device and edge
-- blobs, user agent), about 1.3 KB a row. The owner dashboard counted a few
-- short columns by walking those fat rows: the 30-day totals read took 10 to
-- 16 s, past the 8 s limit on signed-in statements. public.events_lean holds
-- only what the analytics functions read, kept in step by a trigger, and is
-- readable under the same two rules as events. This first step creates the
-- table and the trigger only; the backfill and function swap come next and
-- only read events.

-- never queue behind a busy events table: give up in 5 s instead
set local lock_timeout = '5s';

create table if not exists public.events_lean (
  id uuid primary key references public.events(id) on delete cascade,
  at timestamptz not null,
  site_id uuid,
  name text not null,
  path text,
  device_id text,
  session_id text,
  is_bot boolean not null default false,
  country text,
  referrer text,
  network text,
  src text,
  source text,
  track text,
  album text,
  listened_seconds numeric,
  dwell_s numeric
);
create index if not exists events_lean_at_idx on public.events_lean (at desc);
create index if not exists events_lean_name_idx on public.events_lean (name, at desc);
create index if not exists events_lean_site_at_idx on public.events_lean (site_id, at desc) where site_id is not null;
create index if not exists events_lean_session_idx on public.events_lean (session_id, at) where session_id is not null;

alter table public.events_lean enable row level security;
revoke all on table public.events_lean from public, anon, authenticated;
grant select on table public.events_lean to authenticated;
grant all on table public.events_lean to service_role;

create policy "only the desk reads it" on public.events_lean
  for select using ((select public.eu_is_admin()));
create policy "analytics owners read site events" on public.events_lean
  for select to authenticated using (
    site_id is not null and exists (
      select 1 from public.analytics_sites s
      where s.id = events_lean.site_id
        and (s.owner_user_id = (select auth.uid())
          or (s.org_id is not null and private.is_org_member(s.org_id))
          or (s.site_account_id is not null and exists (
            select 1 from public.site_accounts a
            where a.id = s.site_account_id and a.user_id = (select auth.uid())))))
  );

-- one projection, used by the trigger and the backfill alike
create or replace function private.events_lean_row(e public.events)
returns public.events_lean
language sql immutable
set search_path = ''
as $$
  select row(
    e.id, e.at, e.site_id, e.name, e.path, e.device_id, e.session_id,
    coalesce(e.is_bot, false), e.country, e.referrer,
    coalesce(e.device->'network'->>'effective', e.asn_org),
    nullif(e.props->>'src', ''),
    nullif(e.props->>'source', ''),
    case
      when lower(coalesce(e.props->>'song', '')) = 'whodidtheshoot' then 'who did the shoot'
      else nullif(trim(regexp_replace(lower(coalesce(e.props->>'track', e.props->>'song')), '[-_]+', ' ', 'g')), '')
    end,
    nullif(trim(coalesce(e.props->>'album', e.props->>'album_slug')), ''),
    case when jsonb_typeof(e.props->'listened_seconds') = 'number' then (e.props->>'listened_seconds')::numeric end,
    case when e.name = 'dwell' and jsonb_typeof(e.props->'s') = 'number' then (e.props->>'s')::numeric end
  )::public.events_lean
$$;

-- Events arrive from the anonymous collector; the copy is written with the
-- definer's rights so the collector never needs a grant on the lean table.
create or replace function private.events_lean_sync()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.events_lean
  select (private.events_lean_row(new)).*
  on conflict (id) do update set
    at = excluded.at, site_id = excluded.site_id, name = excluded.name, path = excluded.path,
    device_id = excluded.device_id, session_id = excluded.session_id, is_bot = excluded.is_bot,
    country = excluded.country, referrer = excluded.referrer, network = excluded.network,
    src = excluded.src, source = excluded.source, track = excluded.track, album = excluded.album,
    listened_seconds = excluded.listened_seconds, dwell_s = excluded.dwell_s;
  return null;
exception when others then
  -- the copy is for reporting; it must never stop an event being recorded
  raise warning 'events_lean_sync skipped %: %', new.id, sqlerrm;
  return null;
end;
$$;
revoke all on function private.events_lean_row(public.events) from public, anon, authenticated;
revoke all on function private.events_lean_sync() from public, anon, authenticated;

create trigger events_lean_sync
  after insert or update on public.events
  for each row execute function private.events_lean_sync();

