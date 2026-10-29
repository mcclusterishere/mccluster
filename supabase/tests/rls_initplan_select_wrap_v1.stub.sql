-- Tables for the access test of supabase/pending/20261029100200_rls_initplan_select_wrap_v1.sql:
-- a representative set of the 71 policies (every pattern it rewrites: auth.uid() alone and
-- in EXISTS sub-queries, auth.jwt() ->> 'email', current_m_uid(), policies for anon and
-- for the public role, INSERT/UPDATE/DELETE/SELECT/ALL). The policies are created here as
-- placeholders with production's command and roles; scripts/test-schema-hygiene-db.sh
-- then sets their expressions to production's from the rollback file, so the "before"
-- state is production's text exactly. Test-only, scratch database. Applied after
-- supabase_api_roles.stub.sql and schema_test_helpers.sql.
create schema if not exists private;
grant usage on schema private to anon, authenticated;
create table public.org_members(org_id uuid, profile_id uuid, role text);
create function private.is_org_member(p_org uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
  as $$ select exists (select 1 from public.org_members m where m.org_id = p_org and m.profile_id = auth.uid()) $$;
create function public.is_org_member(p_org uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
  as $$ select exists (select 1 from public.org_members m where m.org_id = p_org and m.profile_id = auth.uid()) $$;
grant execute on function private.is_org_member(uuid), public.is_org_member(uuid) to anon, authenticated;
create function public.eu_is_staff() returns boolean language sql stable security definer set search_path = public
  as $$ select public.eu_is_admin() $$;
create function public.eu_role() returns text language sql stable security definer set search_path = public
  as $$ select case when auth.uid() is null then 'visitor' when public.eu_is_admin() then 'admin' else 'member' end $$;
grant execute on function public.eu_is_staff(), public.eu_role() to anon, authenticated;

create table public.prim3_course_progress(user_id uuid, lesson text);
create policy "prim3 progress select own" on public.prim3_course_progress for select using (true);
create policy "prim3 progress insert own" on public.prim3_course_progress for insert with check (true);
create policy "prim3 progress update own" on public.prim3_course_progress for update using (true) with check (true);
create policy "prim3 progress delete own" on public.prim3_course_progress for delete using (true);

create table public.comments(id bigserial primary key, uid uuid, body text, hidden boolean default false);
create policy cm_read on public.comments for select to anon, authenticated using (true);
create policy cm_speak on public.comments for insert to authenticated with check (true);
create policy cm_sweep on public.comments for update to authenticated using (true);
create policy cm_take_back on public.comments for delete to authenticated using (true);

create table public.campaigns(id bigserial primary key, note text);
create policy cp_admin on public.campaigns for all to authenticated using (true) with check (true);

create table public.network_profiles(m_uid uuid primary key, visibility text);
create table public.creator_service_offers(id bigserial primary key, m_uid uuid, status text, title text);
create policy creator_service_read on public.creator_service_offers for select to authenticated using (true);
create policy creator_service_insert on public.creator_service_offers for insert to authenticated with check (true);
create policy creator_service_update on public.creator_service_offers for update to authenticated using (true) with check (true);
create policy creator_service_delete on public.creator_service_offers for delete to authenticated using (true);

create table public.eu_fellowships(id bigserial primary key, status text, created_by uuid, org_profile_id uuid, source text);
create policy eu_fellowships_read on public.eu_fellowships for select to anon, authenticated using (true);
create policy eu_fellowships_host_add on public.eu_fellowships for insert to authenticated with check (true);
create policy eu_fellowships_edit on public.eu_fellowships for update to authenticated using (true) with check (true);

create table public.site_accounts(id uuid primary key, user_id uuid);
create table public.analytics_sites(id uuid primary key, owner_user_id uuid, org_id uuid, site_account_id uuid);
create table public.events(id bigserial primary key, site_id uuid, name text);
create policy "analytics owners read site events" on public.events for select to authenticated using (true);

create table public.network_follows(follower_m_uid uuid, followed_m_uid uuid, status text);
create table public.network_activity(id bigserial primary key, actor_m_uid uuid, visibility text, source_org_id uuid);
create policy network_activity_read on public.network_activity for select to authenticated using (true);

do $$ declare t text; begin
  foreach t in array array['prim3_course_progress','comments','campaigns','creator_service_offers','eu_fellowships','events','network_activity'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;
grant usage on all sequences in schema public to anon, authenticated;

-- people: A and B are members with M identities; the desk is the house owner by email
insert into public.m_people(id) values ('a0000000-0000-4000-8000-00000000000a'), ('b0000000-0000-4000-8000-00000000000b');
insert into public.m_links(user_id, m_uid) values
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a'),
  ('33333333-3333-4333-8333-333333333333', 'b0000000-0000-4000-8000-00000000000b');
insert into public.org_members values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner');

insert into public.prim3_course_progress values ('11111111-1111-4111-8111-111111111111', 'a1'), ('33333333-3333-4333-8333-333333333333', 'b1');
insert into public.comments(uid, body) values ('11111111-1111-4111-8111-111111111111', 'from A'), ('33333333-3333-4333-8333-333333333333', 'from B');
insert into public.campaigns(note) values ('desk only');
insert into public.network_profiles values ('a0000000-0000-4000-8000-00000000000a', 'public'), ('b0000000-0000-4000-8000-00000000000b', 'private');
insert into public.creator_service_offers(m_uid, status, title) values
  ('a0000000-0000-4000-8000-00000000000a', 'published', 'A public'), ('a0000000-0000-4000-8000-00000000000a', 'draft', 'A draft'),
  ('b0000000-0000-4000-8000-00000000000b', 'published', 'B private profile');
insert into public.eu_fellowships(status, created_by, org_profile_id, source) values
  ('published', null, null, 'seed'), ('pending', '11111111-1111-4111-8111-111111111111', null, 'host'), ('pending', null, '33333333-3333-4333-8333-333333333333', 'host');
insert into public.site_accounts values ('cccccccc-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333');
insert into public.analytics_sites values
  ('dddddddd-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', null, null),
  ('dddddddd-0000-4000-8000-000000000002', null, 'aaaaaaaa-0000-4000-8000-000000000001', null),
  ('dddddddd-0000-4000-8000-000000000003', null, null, 'cccccccc-0000-4000-8000-000000000001');
insert into public.events(site_id, name) values ('dddddddd-0000-4000-8000-000000000001', 'own'), ('dddddddd-0000-4000-8000-000000000002', 'org'),
  ('dddddddd-0000-4000-8000-000000000003', 'account'), (null, 'no site');
insert into public.network_follows values ('b0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000a', 'following');
insert into public.network_activity(actor_m_uid, visibility, source_org_id) values
  ('a0000000-0000-4000-8000-00000000000a', 'public', null), ('a0000000-0000-4000-8000-00000000000a', 'network', null),
  ('a0000000-0000-4000-8000-00000000000a', 'org', 'aaaaaaaa-0000-4000-8000-000000000001'), ('b0000000-0000-4000-8000-00000000000b', 'private', null);
