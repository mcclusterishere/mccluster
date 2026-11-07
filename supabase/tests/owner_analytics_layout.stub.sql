-- Disposable native test dependencies only; never production schema.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role authenticator login noinherit;
grant anon,authenticated,service_role to authenticator;
create schema auth;
create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid $$;
create table public.orgs(id uuid primary key,slug text unique,enabled boolean not null);
create table public.org_members(org_id uuid references public.orgs,profile_id uuid references auth.users,role text,primary key(org_id,profile_id));
-- Underlying identity-directory boundary is synthetic; the mnet_is_admin body
-- and org predicates are extracted unmodified from canonical migration source.
create function public.current_m_uid() returns uuid language sql stable as $$ select auth.uid() $$;
create function public.mnet_admin_m_uids() returns setof uuid language sql stable as $$ values ('11111111-1111-4111-8111-111111111111'::uuid),('22222222-2222-4222-8222-222222222222'::uuid) $$;
grant usage on schema public,auth to anon,authenticated,service_role;
insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into orgs values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','mccluster',true),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','fixture-a',true),('cccccccc-cccc-4ccc-8ccc-cccccccccccc','fixture-b',true),('dddddddd-dddd-4ddd-8ddd-dddddddddddd','fixture-disabled',false);
insert into org_members values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','viewer'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','owner'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','owner'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','viewer'),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','owner');
