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
create table public.social_accounts(id uuid primary key,org_id uuid not null,platform text not null,status text not null default 'connected',media_discovery_error text);
create table public.social_posts(id uuid primary key,org_id uuid not null,account_id uuid not null);
create table public.social_metric_snapshots(id uuid primary key,org_id uuid not null,post_id uuid not null,source text not null);
grant select on public.events,public.events_lean,public.event_taxonomy,
  public.social_accounts,public.social_posts,public.social_metric_snapshots to service_role;
grant usage on schema public to service_role;
\ir ../migrations/20261022005028_analytics_event_inventory_v1.sql
do $$
begin
  if to_regclass('public.events_first_party_inventory_v1_idx') is null or
     to_regclass('public.events_lean_first_party_inventory_v1_idx') is null then
    raise exception 'Both first-party inventory covering indexes are required';
  end if;
  if (select count(*) from pg_class
      where relname in ('events','events_lean')
        and 'autovacuum_vacuum_insert_scale_factor=0.01'=any(reloptions)) <> 2 then
    raise exception 'Both analytics stores require insert-triggered visibility maintenance';
  end if;
end $$;

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


insert into public.social_accounts(id,org_id,platform,status,media_discovery_error) values
 ('00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000090','instagram','connected','meta_error_190'),
 ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000090','tiktok','connected',null),
 ('00000000-0000-4000-8000-000000000107','00000000-0000-4000-8000-000000000090','instagram','disconnected',null);
insert into public.social_posts(id,org_id,account_id) values
 ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000100'),
 ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000101');
insert into public.social_metric_snapshots(id,org_id,post_id,source) values
 ('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000102','reported'),
 ('00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000102','platform_api'),
 ('00000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000103','platform_api');
do $$
declare r record;
begin
 select * into strict r from public.analytics_instagram_source_status_v1('00000000-0000-4000-8000-000000000090');
 if r.instagram_posts<>1 or r.verified_insight_snapshots<>1 or
    r.instagram_accounts<>2 or r.connected_accounts<>1 or r.authorization_expired is distinct from true
 then raise exception 'Provider data illegally counted other social platform or manually reported snapshots: %',row_to_json(r);end if;
 if has_function_privilege('anon','public.analytics_instagram_source_status_v1(uuid)','execute')
    or has_function_privilege('authenticated','public.analytics_instagram_source_status_v1(uuid)','execute')
 then raise exception 'Provider source RPC grant leak';end if;
end $$;

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
