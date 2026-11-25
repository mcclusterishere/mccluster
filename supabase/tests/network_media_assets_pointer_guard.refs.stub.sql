-- Applied by scripts/test-network-media-pointer-guard-db.sh AFTER the real
-- network_media_assets DDL: stand-ins for the tables that name an upload, with
-- the same reference columns and foreign-key actions as production, and the
-- test's own helpers. Test only; never applied to a real project.

-- A member may remove their own post (production: network_posts is
-- authenticated=damrw under RLS). Deleting it fires the media row's
-- ON DELETE SET NULL, which is an UPDATE of network_media_assets.
alter table public.network_posts enable row level security;
create policy network_posts_author_delete on public.network_posts for delete to authenticated
  using (author_m_uid = public.current_m_uid());
create policy network_posts_author_read on public.network_posts for select to authenticated using (true);
grant select, delete on public.network_posts to authenticated;
grant all on public.network_posts to service_role;

-- supabase/migrations/20261003023055_action_mission_camera_loop_v1.sql:
-- a proof names its upload in metadata, with no foreign key.
create table public.action_proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
);
-- supabase/migrations/20261014185154_antisocial_get_social_three_levels_draft.sql
create table public.action_antisocial_levels (
  assignment_id uuid not null,
  level smallint not null check (level between 1 and 3),
  media_asset_id uuid references public.network_media_assets(id) on delete set null,
  status text not null default 'pending',
  primary key (assignment_id, level)
);
-- supabase/migrations/20261002185248_fbi_board_v1.sql: ids in an array, no foreign key.
create table public.fbi_cases (
  id uuid primary key default gen_random_uuid(),
  reporter_m_uid uuid not null references public.m_people(id) on delete cascade,
  media_asset_ids uuid[] not null check (cardinality(media_asset_ids) between 1 and 4),
  status text not null default 'pending'
);
-- supabase/migrations/20261006170955_action_clipping_marketplace_v1.sql
create table public.action_clip_assets (
  id uuid primary key default gen_random_uuid(),
  network_media_asset_id uuid references public.network_media_assets(id) on delete restrict
);
-- supabase/migrations/20261015000455_antisocial_get_social_completion_v1.sql
create table public.action_collaboration_posts (
  post_id uuid primary key,
  media_asset_id uuid references public.network_media_assets(id) on delete set null
);
grant all on public.action_proofs, public.action_antisocial_levels, public.fbi_cases,
             public.action_clip_assets, public.action_collaboration_posts to service_role;

-- A stand-in for the two production functions that attach an upload on a
-- member's behalf (public.publish_antisocial_collaboration, EXECUTE to
-- authenticated; public.action_share_assignment_internal): SECURITY DEFINER,
-- so the write runs as the function's owner while the JWT is the member's.
create function public.test_definer_attach(p_asset uuid, p_post uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.network_media_assets set post_id = p_post, status = 'attached', updated_at = now()
   where id = p_asset and owner_m_uid = public.current_m_uid();
  if not found then raise exception 'that upload is not yours or is not ready'; end if;
end $$;
revoke all on function public.test_definer_attach(uuid, uuid) from public, anon;
grant execute on function public.test_definer_attach(uuid, uuid) to authenticated, service_role;

-- The same write WITHOUT definer rights: it runs as the member.
create function public.test_invoker_attach(p_asset uuid, p_post uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.network_media_assets set post_id = p_post, status = 'attached', updated_at = now()
   where id = p_asset;
end $$;
grant execute on function public.test_invoker_attach(uuid, uuid) to authenticated, service_role;

------------------------------------------------------------------------------
-- Test helpers, in their own schema so no fingerprint of public sees them.
------------------------------------------------------------------------------
create schema t;
grant usage on schema t to anon, authenticated, service_role;

-- Run as a signed-in member, the way PostgREST does: the role and the claims
-- (as one JSON setting and as the older per-claim settings; auth.uid() reads
-- one or the other depending on the Supabase version).
create function t.as_member(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end $$;
create function t.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role service_role';
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- A statement must fail with this SQLSTATE and a message matching this pattern.
create function t.must_fail(p_sql text, p_state text, p_like text) returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state <> p_state or v_msg not like p_like then
      raise exception 'expected % / %, got % / % from: %', p_state, p_like, v_state, v_msg, p_sql;
    end if;
    return;
  end;
  raise exception 'expected % / %, but it succeeded: %', p_state, p_like, p_sql;
end $$;
-- A statement must change exactly this many rows.
create function t.must_change(p_sql text, p_rows integer) returns void language plpgsql as $$
declare v_n integer;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  if v_n <> p_rows then raise exception 'expected % row(s), got % from: %', p_rows, v_n, p_sql; end if;
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- Everything the candidate could leave behind, in one comparable value: every
-- function, trigger, constraint, policy, index, relation, grant and comment in
-- public and storage. Equal before the candidate and after its rollback means
-- the rollback left nothing behind.
create function t.fingerprint() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'relations', (select coalesce(jsonb_agg(jsonb_build_array(n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
                         coalesce(c.relacl::text, ''), coalesce(obj_description(c.oid, 'pg_class'), ''))
                         order by n.nspname, c.relname), '[]'::jsonb)
                    from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname in ('public', 'storage') and c.relkind in ('r', 'v', 'm', 'S', 'i')),
    'columns', (select coalesce(jsonb_agg(jsonb_build_array(n.nspname, c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                         coalesce(pg_get_expr(d.adbin, d.adrelid), ''))
                         order by n.nspname, c.relname, a.attnum), '[]'::jsonb)
                  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                 where n.nspname in ('public', 'storage') and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped),
    'constraints', (select coalesce(jsonb_agg(jsonb_build_array(n.nspname, c.relname, k.conname, pg_get_constraintdef(k.oid), k.convalidated)
                         order by n.nspname, c.relname, k.conname), '[]'::jsonb)
                      from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname in ('public', 'storage')),
    'indexes', (select coalesce(jsonb_agg(jsonb_build_array(schemaname, tablename, indexname, indexdef)
                         order by schemaname, tablename, indexname), '[]'::jsonb)
                  from pg_indexes where schemaname in ('public', 'storage')),
    'policies', (select coalesce(jsonb_agg(jsonb_build_array(schemaname, tablename, policyname, permissive, cmd, roles::text, coalesce(qual, ''), coalesce(with_check, ''))
                         order by schemaname, tablename, policyname), '[]'::jsonb)
                   from pg_policies where schemaname in ('public', 'storage')),
    'triggers', (select coalesce(jsonb_agg(jsonb_build_array(n.nspname, c.relname, tg.tgname, tg.tgenabled, pg_get_triggerdef(tg.oid))
                         order by n.nspname, c.relname, tg.tgname), '[]'::jsonb)
                   from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where not tg.tgisinternal and n.nspname in ('public', 'storage')),
    'functions', (select coalesce(jsonb_agg(jsonb_build_array(n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef,
                         coalesce(p.proconfig::text, ''), md5(p.prosrc), coalesce(p.proacl::text, ''), coalesce(obj_description(p.oid, 'pg_proc'), ''))
                         order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public', 'storage')))
$$;
create table t.fingerprints (label text primary key, value jsonb not null);
