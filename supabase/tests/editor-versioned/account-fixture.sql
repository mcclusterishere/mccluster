-- Synthetic account authority only. Never run on production.
create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb->>'role'$$;
create function public.mnet_is_admin() returns boolean language sql stable as $$select auth.uid()='33333333-3333-4333-8333-333333333333'::uuid$$;
alter table m_people add column status text default 'active';
create table m_auth_user_links(auth_user_id uuid,m_uid uuid,is_primary boolean);
create table network_profiles(m_uid uuid primary key,visibility text);
create table platform_profiles(user_id uuid primary key,mccluster_id text);
create table orgs(id uuid primary key,slug text);
create table org_members(org_id uuid,profile_id uuid,role text);
grant select on m_people,m_auth_user_links,network_profiles,platform_profiles,orgs,org_members to service_role;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into m_people(id) select id from auth.users;
insert into m_auth_user_links select id,id,true from auth.users;
insert into network_profiles select id,'public' from auth.users;
insert into platform_profiles values('11111111-1111-4111-8111-111111111111','alice'),('22222222-2222-4222-8222-222222222222','bob'),('33333333-3333-4333-8333-333333333333','operator');
insert into orgs values('33333333-3333-4333-8333-333333333333','mccluster');
insert into org_members values('33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333333','owner');
