\set ON_ERROR_STOP on
begin;
-- Disposable PostgreSQL CI only. Never apply this fixture to production.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create table public.events (
 id uuid primary key, site_id uuid, at timestamptz not null,
 name text not null, is_bot boolean
);
create table public.events_lean (
 id uuid primary key, site_id uuid, at timestamptz not null,
 name text not null, is_bot boolean
);
create table public.event_taxonomy(event_name text primary key,stage text not null,note text);
grant select on public.events,public.events_lean,public.event_taxonomy to service_role;
grant usage on schema public to service_role;
\ir ../pending/analytics_event_inventory_v1.sql

do $$
begin
 if has_function_privilege('anon','public.analytics_event_inventory_v1()','execute') or
   has_function_privilege('authenticated','public.analytics_event_inventory_v1()','execute')
   or not has_function_privilege('service_role','public.analytics_event_inventory_v1()','execute')
 then raise exception 'Owner route must call a service-role-only RPC';end if;
 if (select stage from public.event_taxonomy where event_name='music_play')<>'content'
 or (select stage from public.event_taxonomy where event_name='form_start')<>'engage'
 or (select stage from public.event_taxonomy where event_name='form_submit')<>'lead'
 then raise exception 'Misclassified client signals';end if;
 if exists (select 1 from public.event_taxonomy where event_name='signup_succeeded')
 then raise exception 'Client-side signup success cannot be treated as verified registration';end if;
end $$;

insert into public.events(id,site_id,name,at,is_bot) values
 ('00000000-0000-4000-8000-000000000001',null,'music_play',now()-interval '3 hours',false),
 ('00000000-0000-4000-8000-000000000002',null,'music_play',now()-interval '2 hours',true),
 ('00000000-0000-4000-8000-000000000003',null,'signup_succeeded',now()-interval '2 days',false),
 ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000090','music_play',now()-interval '1 hour',false);
insert into public.events_lean(id,site_id,name,at,is_bot) values
 ('00000000-0000-4000-8000-000000000001',null,'music_play',now()-interval '3 hours',false),
 ('00000000-0000-4000-8000-000000000003',null,'signup_succeeded',now()-interval '2 days',false);

do $$
declare r record;u record;
begin
 select * into strict r from public.analytics_event_inventory_v1() where event_name='music_play';
 if r.raw_total<>2 or r.lean_total<>1 or r.bot_rows<>1
 or r.recent_24h<>2 or r.recent_7d<>2 or r.taxonomy_stage<>'content'
 then raise exception 'Event view count or stage mismatch: %',row_to_json(r); end if;
 select * into strict u from public.analytics_event_inventory_v1() where event_name='signup_succeeded';
 if u.raw_total<>1 or u.taxonomy_stage is not null or u.recent_24h<>0
 then raise exception 'Client registration falsely classified: %',row_to_json(u);end if;
end $$;
rollback;
