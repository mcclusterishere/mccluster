-- Minimal stand-ins for the objects
-- supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql
-- builds on: the tables its foreign keys, policies and triggers name, with the columns
-- (and column types) its expressions read, so Postgres deparses those expressions the
-- way production does. Test-only, for a scratch database; never applied to a real
-- project. Applied after supabase_api_roles.stub.sql and supabase_storage.stub.sql.
create schema if not exists extensions;
-- Supabase keeps pgcrypto in the extensions schema (gen_random_bytes, digest).
alter extension pgcrypto set schema extensions;

-- pgvector is not installed on a plain Postgres: a domain named vector and the one
-- operator kb_search uses stand in for it.
create domain public.vector as real[];
create function public.vector_cosine_stub(public.vector, public.vector) returns double precision
  language sql immutable as $$ select 0::double precision $$;
create operator public.<=> (leftarg = public.vector, rightarg = public.vector, function = public.vector_cosine_stub);

create table public.orgs(id uuid primary key default gen_random_uuid());
create table public.org_members(org_id uuid references public.orgs(id), profile_id uuid, role text, primary key (org_id, profile_id));
create function private.is_org_member(p_org uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
  as $$ select exists (select 1 from public.org_members m where m.org_id = p_org and m.profile_id = auth.uid()) $$;
create function private.is_org_owner(p_org uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
  as $$ select exists (select 1 from public.org_members m where m.org_id = p_org and m.profile_id = auth.uid() and m.role = 'owner') $$;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_org_member(uuid), private.is_org_owner(uuid) to anon, authenticated;

create table public.platform_apps(id uuid primary key default gen_random_uuid(), name text not null default '');
create table public.platform_profiles(user_id uuid primary key, display_name text not null default '', avatar_url text not null default '');
create table public.m_auth_user_links(auth_user_id uuid primary key, m_uid uuid references public.m_people(id));
create table public.network_profiles(m_uid uuid primary key references public.m_people(id), display_name text not null default '', avatar_url text not null default '');
create table public.network_posts(id uuid primary key default gen_random_uuid(), author_m_uid uuid, visibility text not null default 'public',
  source_app_id uuid, source_org_id uuid, created_at timestamptz not null default now(), deleted_at timestamptz);
create table public.network_activity(id uuid primary key default gen_random_uuid(), actor_m_uid uuid, visibility text not null default 'public',
  source_app_id uuid, source_org_id uuid, occurred_at timestamptz not null default now(), verb text, object_type text, object_id text, summary text);
create table public.network_feed_items(id uuid primary key default gen_random_uuid(), actor_m_uid uuid, source_app_id uuid, source_org_id uuid,
  item_type text, activity_id uuid unique, post_id uuid unique, visibility text, occurred_at timestamptz, payload jsonb);
create function public.mnet_feed_item_from_post() returns trigger language plpgsql as $$ begin return new; end $$;
create table public.network_follows(follower_m_uid uuid, followed_m_uid uuid, status text);
create table public.network_reactions(actor_m_uid uuid);
create table public.network_blocks(blocker_m_uid uuid, blocked_m_uid uuid);
create table public.network_bookmarks(m_uid uuid, post_id uuid);
create table public.network_connections(requester_m_uid uuid, addressee_m_uid uuid, status text);
create table public.network_mutes(muter_m_uid uuid, muted_m_uid uuid);
create table public.mnet_onboarding_state(m_uid uuid, app_id uuid);
create table public.mnet_surface_config(app_id uuid primary key, network_enabled boolean not null default true, entry_mode text,
  default_feed_scope text, feed_label text);
create table public.control_approvals(id uuid primary key default gen_random_uuid(), org_id uuid, requested_by uuid, decided_by uuid, state text);
create table public.control_audit(id bigserial primary key, org_id uuid);
create table public.control_capabilities(capability text primary key);
create table public.control_commands(id uuid primary key default gen_random_uuid(), org_id uuid);
create table public.control_leases(id uuid primary key default gen_random_uuid(), org_id uuid);
create table public.control_role_capabilities(role text, capability text);
create table public.events(id bigserial primary key, name text);
create table public.leads(id bigserial primary key, email text);
create table public.eu_recordings(id uuid primary key default gen_random_uuid(), org_id uuid, isrc text, metadata jsonb, updated_at timestamptz);
create table public.out_campaigns(id uuid primary key default gen_random_uuid());
create table public.out_companies(id uuid primary key default gen_random_uuid());
create table public.out_contacts(id uuid primary key default gen_random_uuid());
create table public.ops_objectives(id uuid primary key default gen_random_uuid());
create table public.kb_documents(id uuid primary key default gen_random_uuid(), title text, url text, kind text, enabled boolean);
create table public.kb_chunks(id uuid primary key default gen_random_uuid(), document_id uuid, body text, fts tsvector, embedding public.vector);
create function public.l3_is_staff() returns boolean language sql stable security definer set search_path = public
  as $$ select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email','') = 'staff@example.test' $$;
grant execute on function public.l3_is_staff() to authenticated;
-- The verifier's ledger query reads this; empty here.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
