-- Synthetic isolated database only. Never apply to a project.
create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.mnet_is_admin() returns boolean language sql stable security definer as $$select auth.uid()='11111111-1111-4111-8111-111111111111'::uuid$$;
 grant usage on schema auth to anon,authenticated;
 create table public.orgs(id uuid primary key,slug text,enabled boolean);insert into public.orgs values('11111111-1111-4111-8111-111111111111','mccluster',true);
 create table public.org_members(org_id uuid,profile_id uuid,role text);insert into public.org_members values('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','owner');
 create table public.platform_apps(id uuid primary key default gen_random_uuid(),app_key text unique,name text,settings jsonb not null default '{}',enabled boolean default true,updated_at timestamptz default now());
 insert into public.platform_apps(app_key,name,settings) values('fixture','Fixture','{"preserve":"unchanged"}'),('other','Other','{}'),('system','System','{}');
