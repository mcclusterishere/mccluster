-- Isolated test fixtures only, never applied to production.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key, created_at timestamptz, email_confirmed_at timestamptz);
create function public.eu_is_admin() returns boolean language sql stable as $$
  select coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','')='house_owner'
$$;
create table public.events(id uuid primary key, name text, at timestamptz, device_id text);
create table public.events_lean(
  id uuid primary key default gen_random_uuid(), at timestamptz, site_id uuid, name text,
  path text, device_id text, session_id text, is_bot boolean default false,
  country text, region text, region_code text, src text, source text, referrer text
);
create table public.event_taxonomy(event_name text primary key,stage text,note text);
alter table public.events enable row level security;
alter table public.events_lean enable row level security;
grant usage on schema public to anon,authenticated,service_role;
grant select on public.events,public.events_lean,public.event_taxonomy to authenticated,service_role;
create policy owner_events on public.events for select to authenticated using(public.eu_is_admin());
create policy owner_lean on public.events_lean for select to authenticated using(public.eu_is_admin());
insert into public.event_taxonomy values
 ('page_view','view',''),('song_start','content',''),('click','engage',''),('purchase','purchase','Client report');
