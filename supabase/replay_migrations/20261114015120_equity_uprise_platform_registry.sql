-- Replay twin of supabase/migrations/20261114015120_equity_uprise_platform_registry.sql,
-- used only by scripts/supabase-local-reset-with-replay.sh (CI rebuilds).
--
-- Production applied the registry on 2026-11-14 outside Git, and the file under supabase/migrations/ is its
-- stored statement byte for byte. Two of its preflight checks refuse the database this repository rebuilds, so
-- the reset stopped there (ledger row 365), and with it each CI job that rebuilds the database through this script:
--   1. it wants all four canonical apps registered and enabled. Production registered mnet-web outside the
--      replayable history: no migration, replay file or seed inserts it, so a rebuild has three of the four
--      (mccluster-web, equity-uprise-web, music-web) and the check fails first;
--   2. it wants exactly one authenticated McCluster owner. No migration, replay file or seed inserts into
--      auth.users, so a rebuild has none. This file does not invent one.
--
-- It follows supabase/replay_migrations/20261016031123_anon_policy_scope_v1.sql, whose header reads:
--   "Production created the fifteen network_* self policies and the mixed read
--   policies outside the replayable history, so a rebuilt database lacks some of
--   them and a bare ALTER POLICY fails (42704). This twin applies the same
--   changes only where the policy (or table) exists; on production, where every
--   object exists, it is the same effect as the recorded migration, which stays
--   byte-identical to the stored statement."
-- Likewise here. Below this header the file is the stored statement byte for byte except two lines:
--   the app check   refuses a canonical app that is registered but disabled (the stored statement also refuses
--                   one that is missing); the binding insert already binds only the apps that exist;
--   the owner check refuses more than one authenticated McCluster owner (the stored statement also refuses
--                   none); with none, the owner copy inserts no row.
-- Every other check (one enabled McCluster organisation, no equity-uprise organisation yet, the compatibility
-- invariant), every table, index, function, grant, policy and view, and the seed of the platform, its tenants,
-- app and module bindings and artist spaces run unchanged. On production, where all four apps are enabled and
-- exactly one authenticated owner exists, it is the same effect as the recorded migration, which stays
-- byte-identical to the stored statement.
--
-- 20261114060150_equity_uprise_music_workspace.sql needs no twin: nothing in it depends on the owner check or
-- the owner copy, and it applies unchanged after this file.
--
-- Proof (2026-11-18, PostgreSQL 16.15, a disposable server on 127.0.0.1):
--   scripts/test/eu-platform-replay.native.integration.mjs, on a database shaped like the rebuild just before
--   ledger row 365 (supabase/tests/eu_platform_replay.stub.sql). It runs scripts/supabase-local-reset-with-replay.sh
--   with the Supabase CLI stood in for by a shim that applies rows 365 to 376 with psql. Without this file the reset
--   stops at the registry's app check and applies nothing from row 365 on; with it all twelve apply, and the 27
--   catalog rows of the two 2026-11-14 files (9 relations, 10 functions, 8 policies; they create no trigger) and the
--   21 the ten files after them create or change equal production's snapshot of 2026-11-18 in the production
--   verifier's catalog queries. Given production's preconditions it writes the same rows and builds the same catalog
--   as the stored statement, and it keeps every other refusal. Not proven there: the Supabase CLI itself and the 364
--   rows before this one, for which the stub stands; the CI job "Supabase migration reset" remains the proof of the
--   whole chain.

-- Equity Uprise platform, existing McCluster organization as tenant.
-- Expand-only compatibility release: no legacy auth/action/music DDL or DML.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '45s';

-- Capture only counts/checksums, never private rows, credentials or media.
create temporary table eu_platform_before(name text primary key, value jsonb not null) on commit drop;
create function pg_temp.eu_platform_legacy_fingerprint() returns jsonb
language plpgsql set search_path = '' as $$
declare r record; v jsonb; result jsonb := '{}'::jsonb; begin
 for r in select n.nspname, c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and ((n.nspname='auth' and c.relname in ('users','identities')) or
   (n.nspname='public' and (c.relname like 'action\_%' escape '\' or c.relname like 'music\_%' escape '\'
    or c.relname in ('m_people','m_auth_user_links','platform_profiles','platform_user_apps','platform_apps','platform_oauth_clients','creator_tracks','tenants','tenant_domains'))))
 loop
  execute pg_catalog.format('select jsonb_build_object(''count'',count(*),''checksum'',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),''''))) from %I.%I t',r.nspname,r.relname) into v;
  result:=result||jsonb_build_object(r.nspname||'.'||r.relname,v);
 end loop;
 select jsonb_build_object('functions',md5(coalesce(string_agg(pg_catalog.pg_get_functiondef(p.oid),'' order by p.oid),''))) into v
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prokind='f' and p.proname not like 'eu_platform\_%' escape '\';
 result:=result||v;
 select jsonb_build_object('policies',md5(coalesce(string_agg(to_jsonb(p)::text,'' order by schemaname,tablename,policyname),''))) into v
 from pg_catalog.pg_policies p where p.schemaname in ('public','private','storage') and p.tablename not like 'eu_platform\_%' escape '\';
 return result||v;
end $$;
insert into eu_platform_before values('legacy',pg_temp.eu_platform_legacy_fingerprint());
insert into eu_platform_before select 'org:'||id,to_jsonb(o) from public.orgs o;
insert into eu_platform_before select 'membership:'||org_id||':'||profile_id,to_jsonb(m) from public.org_members m;

do $$ begin
 if (select count(*) from public.orgs where slug='mccluster' and enabled)<>1 then raise exception 'Expected one enabled canonical McCluster organization'; end if;
 if exists(select 1 from public.orgs where slug='equity-uprise') then raise exception 'Equity Uprise organization already exists; review its ownership before proceeding'; end if;
 if exists(select 1 from public.platform_apps where app_key in ('mccluster-web','mnet-web','music-web','equity-uprise-web') and not enabled) then raise exception 'Canonical app registration preflight failed'; end if;
 if (select count(*) from public.org_members m join public.orgs o on o.id=m.org_id join auth.users u on u.id=m.profile_id where o.slug='mccluster' and m.role='owner')>1 then raise exception 'Expected one existing authenticated McCluster owner'; end if;
end $$;

create table public.eu_platform_registry (
 org_id uuid primary key references public.orgs(id) on delete restrict,
 platform_key text not null unique check(platform_key='equity-uprise'),
 display_name text not null, enabled boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.eu_platform_tenants (
 org_id uuid primary key references public.orgs(id) on delete restrict,
 platform_org_id uuid not null references public.eu_platform_registry(org_id) on delete restrict,
 tenant_kind text not null check(tenant_kind in ('platform','organization','artist')),
 display_name text not null, public_listing boolean not null default false,
 enabled boolean not null default true, created_at timestamptz not null default now(),
 check((tenant_kind='platform')=(org_id=platform_org_id)), unique(org_id,platform_org_id)
);
create index eu_platform_tenants_platform_idx on public.eu_platform_tenants(platform_org_id,org_id);
create table public.eu_platform_app_bindings (
 app_id uuid primary key references public.platform_apps(id) on delete restrict,
 tenant_org_id uuid not null references public.eu_platform_tenants(org_id) on delete restrict,
 created_at timestamptz not null default now()
);
create index eu_platform_app_tenant_idx on public.eu_platform_app_bindings(tenant_org_id,app_id);
create table public.eu_platform_module_bindings (
 tenant_org_id uuid not null references public.eu_platform_tenants(org_id) on delete restrict,
 module_key text not null check(module_key in ('identity','missions','music')),
 provider_org_id uuid not null references public.eu_platform_tenants(org_id) on delete restrict,
 adapter text not null check(adapter in ('shared_identity_v1','mccluster_actions_v1','shared_music_catalog_v1','pending_tenant_actions_v2','pending_creator_music_v2')),
 read_enabled boolean not null, write_enabled boolean not null,
 primary key(tenant_org_id,module_key),
 check(adapter not like 'pending\_%' escape '\' or (not read_enabled and not write_enabled)),
 check(adapter<>'shared_music_catalog_v1' or not write_enabled)
);
create index eu_platform_module_provider_idx on public.eu_platform_module_bindings(provider_org_id);
create table private.eu_platform_artist_bindings (
 m_uid uuid primary key references public.music_creator_profiles(m_uid) on delete restrict,
 tenant_org_id uuid not null unique references public.eu_platform_tenants(org_id) on delete restrict,
 identity_state text not null check(identity_state in ('linked','needs_identity_review')),
 created_at timestamptz not null default now()
);
create table private.eu_platform_release_checks (
 release_key text primary key, before_state jsonb not null, after_state jsonb not null,
 applied_at timestamptz not null default now(), check(before_state=after_state)
);

-- Membership lookup uses the existing, server-maintained org_members table.
-- It does not inherit the legacy global eu_is_admin bypass or editable JWT metadata.
create function private.eu_platform_org_role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
 select m.role from public.org_members m
 where m.org_id=p_org and m.profile_id=(select auth.uid()) and (select auth.uid()) is not null;
$$;
revoke all on function private.eu_platform_org_role(uuid) from public, anon;
grant execute on function private.eu_platform_org_role(uuid) to authenticated, service_role;

alter table public.eu_platform_registry enable row level security;
alter table public.eu_platform_tenants enable row level security;
alter table public.eu_platform_app_bindings enable row level security;
alter table public.eu_platform_module_bindings enable row level security;
alter table private.eu_platform_artist_bindings enable row level security;
alter table private.eu_platform_release_checks enable row level security;
create policy eu_platform_registry_public on public.eu_platform_registry for select to anon,authenticated using(enabled);
create policy eu_platform_tenants_public on public.eu_platform_tenants for select to anon using(enabled and public_listing and exists(select 1 from public.eu_platform_registry p where p.org_id=platform_org_id and p.enabled));
create policy eu_platform_tenants_member on public.eu_platform_tenants for select to authenticated using((enabled and public_listing and exists(select 1 from public.eu_platform_registry p where p.org_id=platform_org_id and p.enabled)) or private.eu_platform_org_role(org_id) is not null or private.eu_platform_org_role(platform_org_id)='owner');
create policy eu_platform_apps_visible on public.eu_platform_app_bindings for select to anon,authenticated using(exists(select 1 from public.eu_platform_tenants t where t.org_id=tenant_org_id and t.enabled));
create policy eu_platform_modules_visible on public.eu_platform_module_bindings for select to anon,authenticated using(exists(select 1 from public.eu_platform_tenants t where t.org_id=tenant_org_id and t.enabled));
create policy eu_platform_artist_self on private.eu_platform_artist_bindings for select to authenticated using((select auth.uid()) is not null and m_uid=(select public.current_m_uid()));
create policy eu_platform_checks_service on private.eu_platform_release_checks for select to service_role using(true);
revoke all on public.eu_platform_registry,public.eu_platform_tenants,public.eu_platform_app_bindings,public.eu_platform_module_bindings from public,anon,authenticated;
grant select on public.eu_platform_registry,public.eu_platform_tenants,public.eu_platform_app_bindings,public.eu_platform_module_bindings to anon,authenticated;
grant select,insert,update,delete on public.eu_platform_registry,public.eu_platform_tenants,public.eu_platform_app_bindings,public.eu_platform_module_bindings to service_role;
revoke all on private.eu_platform_artist_bindings,private.eu_platform_release_checks from public,anon,authenticated;
grant select on private.eu_platform_artist_bindings to authenticated;
grant select,insert,update on private.eu_platform_artist_bindings to service_role;
grant select on private.eu_platform_release_checks to service_role;

do $$ declare platform_id uuid; mccluster_id uuid; artist_org uuid; creator record; linked_user uuid; n integer; begin
 select id into strict mccluster_id from public.orgs where slug='mccluster';
 insert into public.orgs(slug,name,kind,settings) values('equity-uprise','Equity Uprise','business','{"platform":"equity-uprise","operator_status":"formation_planned"}') returning id into platform_id;
 insert into public.eu_platform_registry(org_id,platform_key,display_name) values(platform_id,'equity-uprise','Equity Uprise');
 insert into public.eu_platform_tenants(org_id,platform_org_id,tenant_kind,display_name,public_listing) values
  (platform_id,platform_id,'platform','Equity Uprise',true),(mccluster_id,platform_id,'organization','McCluster',true);
 -- Same existing owner; no other McCluster member receives parent-platform privileges.
 insert into public.org_members(org_id,profile_id,role)
 select platform_id,m.profile_id,'owner' from public.org_members m join auth.users u on u.id=m.profile_id where m.org_id=mccluster_id and m.role='owner';
 insert into public.eu_platform_app_bindings(app_id,tenant_org_id)
 select id,case when app_key='equity-uprise-web' then platform_id else mccluster_id end from public.platform_apps where app_key in ('mccluster-web','mnet-web','music-web','equity-uprise-web');
 insert into public.eu_platform_module_bindings values
  (mccluster_id,'identity',platform_id,'shared_identity_v1',true,true),
  (mccluster_id,'missions',mccluster_id,'mccluster_actions_v1',true,true),
  (mccluster_id,'music',mccluster_id,'shared_music_catalog_v1',true,false),
  (platform_id,'identity',platform_id,'shared_identity_v1',true,true),
  (platform_id,'missions',platform_id,'pending_tenant_actions_v2',false,false),
  (platform_id,'music',mccluster_id,'shared_music_catalog_v1',true,false);
 for creator in select m_uid,artist_name from public.music_creator_profiles order by m_uid loop
  if exists(select 1 from public.orgs where slug='artist-'||creator.m_uid::text) then raise exception 'Artist organization slug exists without reviewed binding'; end if;
  insert into public.orgs(slug,name,kind,settings) values('artist-'||creator.m_uid::text,creator.artist_name,'business','{"platform":"equity-uprise","space_kind":"artist"}') returning id into artist_org;
  insert into public.eu_platform_tenants(org_id,platform_org_id,tenant_kind,display_name) values(artist_org,platform_id,'artist',creator.artist_name);
  select count(*),min(l.auth_user_id::text)::uuid into n,linked_user from public.m_auth_user_links l join auth.users u on u.id=l.auth_user_id where l.m_uid=creator.m_uid and l.is_primary;
  insert into private.eu_platform_artist_bindings(m_uid,tenant_org_id,identity_state) values(creator.m_uid,artist_org,case when n=1 then 'linked' else 'needs_identity_review' end);
  if n=1 then insert into public.org_members(org_id,profile_id,role) values(artist_org,linked_user,'owner'); end if;
  insert into public.eu_platform_module_bindings values(artist_org,'identity',platform_id,'shared_identity_v1',true,true),(artist_org,'music',artist_org,'pending_creator_music_v2',false,false);
 end loop;
end $$;

-- New public read API. Existing app keys, redirects, client IDs and endpoints stay intact.
create function public.eu_platform_context(p_app_key text) returns jsonb
language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object('schema','equity-uprise.platform-context/v1',
  'platform',jsonb_build_object('org_id',p.org_id,'key',p.platform_key,'name',p.display_name),
  'tenant',jsonb_build_object('org_id',t.org_id,'name',t.display_name,'kind',t.tenant_kind),
  'app',jsonb_build_object('id',a.id,'key',a.app_key),
  'modules',coalesce((select jsonb_object_agg(m.module_key,jsonb_build_object('provider_org_id',m.provider_org_id,'adapter',m.adapter,'read_enabled',m.read_enabled,'write_enabled',m.write_enabled)) from public.eu_platform_module_bindings m where m.tenant_org_id=t.org_id),'{}'::jsonb))
 from public.eu_platform_app_bindings b join public.platform_apps a on a.id=b.app_id
 join public.eu_platform_tenants t on t.org_id=b.tenant_org_id
 join public.eu_platform_registry p on p.org_id=t.platform_org_id
 where a.app_key=p_app_key and a.enabled and t.enabled and p.enabled;
$$;
revoke all on function public.eu_platform_context(text) from public;
grant execute on function public.eu_platform_context(text) to anon,authenticated,service_role;

create function public.eu_platform_my_memberships() returns jsonb
language sql stable security invoker set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('tenant_org_id',t.org_id,'platform_org_id',t.platform_org_id,'name',t.display_name,'kind',t.tenant_kind,'role',m.role) order by t.tenant_kind,t.display_name),'[]'::jsonb)
 from public.eu_platform_tenants t join public.org_members m on m.org_id=t.org_id
 where (select auth.uid()) is not null and m.profile_id=(select auth.uid()) and t.enabled;
$$;
revoke all on function public.eu_platform_my_memberships() from public,anon;
grant execute on function public.eu_platform_my_memberships() to authenticated,service_role;

-- Read-only shared discovery, preserving the existing underlying visibility policies.
-- orgs is private to members, so use the already-public app binding rather than
-- granting anonymous access to the canonical organization directory.
create view public.eu_platform_mission_directory with(security_invoker=true) as
 select t.platform_org_id,t.org_id as tenant_org_id,m.* from public.action_missions m
 cross join public.eu_platform_app_bindings b join public.platform_apps a on a.id=b.app_id
 join public.eu_platform_tenants t on t.org_id=b.tenant_org_id
 join public.eu_platform_registry p on p.org_id=t.platform_org_id
 where a.app_key='mccluster-web' and a.enabled and t.enabled and p.enabled and m.status in ('open','paused','closed');
create view public.eu_platform_music_directory with(security_invoker=true) as
 select t.platform_org_id,t.org_id as catalogue_host_org_id,m.* from public.music_catalog_objects m
 cross join public.eu_platform_app_bindings b join public.platform_apps a on a.id=b.app_id
 join public.eu_platform_tenants t on t.org_id=b.tenant_org_id
 join public.eu_platform_registry p on p.org_id=t.platform_org_id
 where a.app_key='music-web' and a.enabled and t.enabled and p.enabled and m.status='active';
revoke all on public.eu_platform_mission_directory,public.eu_platform_music_directory from public,anon,authenticated;
grant select on public.eu_platform_mission_directory,public.eu_platform_music_directory to anon,authenticated,service_role;

do $$ declare before_state jsonb; after_state jsonb; r record; actual jsonb; begin
 select value into before_state from eu_platform_before where name='legacy';
 after_state:=pg_temp.eu_platform_legacy_fingerprint();
 if before_state<>after_state then raise exception 'Compatibility invariant failed: existing account/action/music data, functions or policies changed'; end if;
 for r in select name,value from eu_platform_before where name like 'org:%' loop
  select to_jsonb(o) into actual from public.orgs o where id=(substr(r.name,5))::uuid;
  if actual is distinct from r.value then raise exception 'An existing organization changed'; end if;
 end loop;
 for r in select name,value from eu_platform_before where name like 'membership:%' loop
  select to_jsonb(m) into actual from public.org_members m where org_id=(r.value->>'org_id')::uuid and profile_id=(r.value->>'profile_id')::uuid;
  if actual is distinct from r.value then raise exception 'An existing membership changed'; end if;
 end loop;
 insert into private.eu_platform_release_checks(release_key,before_state,after_state) values('platform-registry-v1',before_state,after_state);
end $$;
notify pgrst,'reload schema';
commit;

