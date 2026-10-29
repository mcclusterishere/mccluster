-- Production's state, 2026-10-29, for what supabase/pending/20261029100000_privilege_hygiene_v1.sql
-- touches: the same grants (pg_class.relacl, pg_proc.proacl), the same policy roles and
-- expressions (pg_policies), the same trigger functions, on minimal tables. Test-only, for a
-- scratch database. Applied after supabase_api_roles.stub.sql.
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role;

create table public.org_members(org_id uuid, profile_id uuid, role text);
create schema if not exists private;
grant usage on schema private to anon, authenticated;
create function private.is_org_member(p_org uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
  as $$ select exists (select 1 from public.org_members m where m.org_id = p_org and m.profile_id = auth.uid()) $$;
create function private.is_org_owner(p_org uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
  as $$ select exists (select 1 from public.org_members m where m.org_id = p_org and m.profile_id = auth.uid() and m.role = 'owner') $$;
grant execute on function private.is_org_member(uuid), private.is_org_owner(uuid) to anon, authenticated;

-- eu_is_admin: production's predicate is the desk's email; the stub's is the same shape.
create or replace function public.eu_is_admin() returns boolean language sql stable security definer set search_path = public
  as $$ select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email','') = 'matthew@mccluster.org' $$;
create function public.eu_is_staff() returns boolean language sql stable security definer set search_path = public
  as $$ select public.eu_is_admin() $$;
create function public.shake_is_crew() returns boolean language sql stable security definer set search_path = public
  as $$ select public.eu_is_admin() $$;
create function public.eu_role() returns text language sql stable security definer set search_path = public
  as $$ select case when auth.uid() is null then 'visitor' when public.eu_is_admin() then 'admin' else 'member' end $$;
create function public.mnet_is_admin() returns boolean language sql stable security definer set search_path = public
  as $$ select public.eu_is_admin() $$;
revoke all on function public.eu_is_admin(), public.eu_is_staff(), public.shake_is_crew(), public.eu_role(), public.mnet_is_admin() from public;
grant execute on function public.eu_is_admin(), public.eu_is_staff(), public.shake_is_crew(), public.eu_role() to anon, authenticated, service_role;
grant execute on function public.mnet_is_admin() to public, authenticated, service_role;

-- 1. the seven tables where authenticated holds TRUNCATE, REFERENCES and TRIGGER
do $$ declare t text; begin
  foreach t in array array['campaigns','engagement_modules','engagements','licence_scopes','modules','offerings','eu_suppressions'] loop
    execute format('create table public.%I(id bigserial primary key, note text)', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('grant all on public.%I to authenticated, service_role', t);
    execute format('grant select, insert, update, delete on public.%I to anon', t);
    execute format('create policy %I on public.%I for all to authenticated using (((auth.jwt() ->> ''email''::text) = ''matthew@mccluster.org''::text)) with check (((auth.jwt() ->> ''email''::text) = ''matthew@mccluster.org''::text))', t || '_admin', t);
  end loop;
end $$;

-- 2. network_* (anon holds full DML; every policy is to authenticated) and the news view
create table public.network_blocks(blocker_m_uid uuid, blocked_m_uid uuid);
create table public.network_bookmarks(m_uid uuid, post_id uuid);
create table public.network_connections(requester_m_uid uuid, addressee_m_uid uuid, status text);
create table public.network_mutes(muter_m_uid uuid, muted_m_uid uuid);
alter table public.network_blocks enable row level security;
alter table public.network_bookmarks enable row level security;
alter table public.network_connections enable row level security;
alter table public.network_mutes enable row level security;
grant select, insert, update, delete on public.network_blocks, public.network_bookmarks, public.network_connections, public.network_mutes to anon, authenticated, service_role;
create policy network_blocks_self on public.network_blocks for all to authenticated using (blocker_m_uid = public.current_m_uid()) with check (blocker_m_uid = public.current_m_uid());
create policy network_bookmarks_self on public.network_bookmarks for all to authenticated using (m_uid = public.current_m_uid()) with check (m_uid = public.current_m_uid());
create policy network_connections_self_write on public.network_connections for insert to authenticated with check (requester_m_uid = public.current_m_uid());
create policy network_mutes_self on public.network_mutes for all to authenticated using (muter_m_uid = public.current_m_uid()) with check (muter_m_uid = public.current_m_uid());

create table public.media_news_sources(id uuid primary key default gen_random_uuid(), domain text);
create table public.media_news_articles(id uuid primary key default gen_random_uuid(), source_id uuid references public.media_news_sources(id), title text,
  canonical_url text, published_at timestamptz, language_code text, topic_keys text[], headline_location_label text,
  headline_latitude double precision, headline_longitude double precision, location_basis text, ingestion_provider text, country text);
alter table public.media_news_sources enable row level security;
alter table public.media_news_articles enable row level security;
create view public.media_public_world_feed as
 SELECT a.id, a.title, a.canonical_url, a.published_at, a.language_code, a.topic_keys, a.headline_location_label,
    a.headline_latitude, a.headline_longitude, a.location_basis, o.domain AS publisher_domain
   FROM public.media_news_articles a JOIN public.media_news_sources o ON o.id = a.source_id
  WHERE a.ingestion_provider = 'gdelt_doc_v2'::text;
grant select, insert, update, delete on public.media_public_world_feed to anon, authenticated, service_role;

-- 3. the write policies on the public role, and the two intake policies that stay open to anon
create table public.inbox_channels(id bigserial primary key, name text);
create table public.out_campaigns(id bigserial primary key, org_id uuid);
create table public.out_companies(id bigserial primary key, org_id uuid);
create table public.out_contacts(id bigserial primary key, org_id uuid);
create table public.out_sender_identities(id bigserial primary key, org_id uuid);
create table public.out_suppressions(id bigserial primary key, org_id uuid, address text);
create table public.prim3_course_progress(user_id uuid, lesson text);
create table public.leads(id bigserial primary key, status text default 'new', name text, email text, want text, note text, page text,
  source text, medium text, campaign text, gclid text, company_id uuid);
create table public.eu_perspectives(id bigserial primary key, status text default 'new', profile_id uuid, body text);
do $$ declare t text; begin
  foreach t in array array['inbox_channels','out_campaigns','out_companies','out_contacts','out_sender_identities','out_suppressions',
    'prim3_course_progress','leads','eu_perspectives'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated, service_role', t);
  end loop;
end $$;
grant usage on all sequences in schema public to anon, authenticated;
create policy inbox_channels_admin on public.inbox_channels using (public.eu_is_admin()) with check (public.eu_is_admin());
create policy out_campaigns_org on public.out_campaigns using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy out_companies_org on public.out_companies using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy out_contacts_org on public.out_contacts using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));
create policy out_sender_owner on public.out_sender_identities using (private.is_org_owner(org_id)) with check (private.is_org_owner(org_id));
create policy out_suppressions_add on public.out_suppressions for insert with check (private.is_org_member(org_id));
create policy "prim3 progress select own" on public.prim3_course_progress for select using (auth.uid() = user_id);
create policy "prim3 progress insert own" on public.prim3_course_progress for insert with check (auth.uid() = user_id);
create policy "prim3 progress update own" on public.prim3_course_progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "prim3 progress delete own" on public.prim3_course_progress for delete using (auth.uid() = user_id);
create policy leads_in on public.leads for insert to anon, authenticated with check (status = 'new' and company_id is null);
create policy eu_perspectives_in on public.eu_perspectives for insert to anon, authenticated
  with check ((status = 'new'::text) and ((profile_id is null) or (profile_id = auth.uid())) and (length(body) <= 8000));

-- the anon reads that keep eu_is_admin() executable by anon
create table public.action_missions(id bigserial primary key, status text);
alter table public.action_missions enable row level security;
grant select on public.action_missions to anon, authenticated;
create policy "public reads open missions" on public.action_missions for select to anon, authenticated
  using ((status = any (array['open'::text, 'paused'::text, 'closed'::text])) or (select public.eu_is_admin()));

-- 4. trigger functions (PUBLIC holds EXECUTE in production)
create function public.out_lower_address() returns trigger language plpgsql as $$ begin new.address := lower(new.address); return new; end $$;
grant execute on function public.out_lower_address() to public, anon, authenticated, service_role;
create trigger out_suppressions_lower before insert or update on public.out_suppressions for each row execute function public.out_lower_address();
create table public.action_proofs(id bigserial primary key, kind text, flagged boolean default false);
alter table public.action_proofs enable row level security;
grant select, insert on public.action_proofs to authenticated;
create policy action_proofs_own on public.action_proofs for all to authenticated using (true) with check (true);
create function public.antisocial_block_legacy_proof() returns trigger language plpgsql security definer set search_path = public
  as $$ begin if new.kind = 'legacy' then raise exception 'legacy proof refused'; end if; return new; end $$;
grant execute on function public.antisocial_block_legacy_proof() to public, service_role;
create trigger antisocial_no_legacy_proof before insert on public.action_proofs for each row execute function public.antisocial_block_legacy_proof();
create table public.media_articles(id bigserial primary key, title text, pinned boolean default false);
grant select, insert on public.media_articles to authenticated;
create function public.media_apply_geo_rule() returns trigger language plpgsql security definer set search_path = public
  as $$ begin new.pinned := true; return new; end $$;
grant execute on function public.media_apply_geo_rule() to public, service_role;
create trigger media_auto_geo_pin before insert on public.media_articles for each row execute function public.media_apply_geo_rule();
grant usage on all sequences in schema public to anon, authenticated;

insert into public.action_missions(status) values ('open'), ('draft');
insert into public.org_members values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner');
