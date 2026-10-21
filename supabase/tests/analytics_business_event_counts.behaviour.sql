\set ON_ERROR_STOP on
begin;
-- Disposable CI database only: never run this file on production.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create table public.events_lean(
  id bigserial primary key, name text not null, at timestamptz not null,
  site_id uuid, is_bot boolean
);
grant usage on schema public to service_role;
grant select on public.events_lean to service_role;
\ir ../migrations/20261021205801_analytics_business_event_counts_v1.sql

insert into public.events_lean(name,at,site_id,is_bot) values
  ('page_view','2026-10-20 10:00+00',null,false),
  ('page_view','2026-10-21 10:00+00',null,null),
  ('click','2026-10-21 10:05+00',null,false),
  ('acquired','2026-10-21 10:06+00',null,false),
  ('album_play','2026-10-21 10:07+00',null,false),
  ('music_play','2026-10-21 10:08+00',null,false),
  ('music_preview_play','2026-10-21 10:09+00',null,false),
  ('music_full_play','2026-10-21 10:10+00',null,false),
  ('music_complete','2026-10-21 10:11+00',null,false),
  ('click','2026-10-22 00:00+00',null,false),
  ('click','2026-10-21 10:12+00',null,true),
  ('click','2026-10-21 10:13+00','0e2de6f3-77d4-4e52-af84-bb911b52b905',false);

do $$
declare r record;
begin
  select * into strict r from public.analytics_business_event_counts(
    '2026-10-21 00:00+00','2026-10-22 00:00+00');
  if r.events_total <> 10 or r.events_window <> 8
     or r.page_views_total <> 2 or r.page_views_window <> 1
     or r.clicks_total <> 2 or r.clicks_window <> 1
     or r.acquired_total <> 1 or r.acquired_window <> 1
     or r.legacy_plays_total <> 1 or r.legacy_plays_window <> 1
     or r.music_plays_total <> 1 or r.music_plays_window <> 1
     or r.preview_plays_total <> 1 or r.preview_plays_window <> 1
     or r.full_plays_total <> 1 or r.full_plays_window <> 1
     or r.completes_total <> 1 or r.completes_window <> 1
  then raise exception 'Event aggregate semantic mismatch: %',row_to_json(r); end if;
  select * into strict r from public.analytics_business_event_counts();
  if r.events_total <> 10 or r.events_window is not null
     or r.clicks_total <> 2 or r.clicks_window is not null
  then raise exception 'Unbounded window semantic mismatch: %',row_to_json(r); end if;
  if has_function_privilege('anon','public.analytics_business_event_counts(timestamptz,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated','public.analytics_business_event_counts(timestamptz,timestamptz)','EXECUTE')
     or not has_function_privilege('service_role','public.analytics_business_event_counts(timestamptz,timestamptz)','EXECUTE')
  then raise exception 'Owner-only RPC access boundary violated'; end if;
end $$;
set local role service_role;
select * from public.analytics_business_event_counts('2026-10-21 00:00+00','2026-10-22 00:00+00');
reset role;
rollback;
