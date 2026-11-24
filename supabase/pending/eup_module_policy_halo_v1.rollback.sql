-- Recovery artifact for supabase/pending/eup_module_policy_halo_v1.sql: never a forward migration.
-- Returns the module registry to the three applied units. The command log is append-only and a policy row is never
-- deleted (the applied triggers refuse both), so this file REFUSES, changing nothing, once the 'halo' unit has a
-- policy row or a recorded command: at that point the unit has history and removing its id would orphan it.
-- Disable the unit instead and leave the registration in place. Safe to run twice.
-- Equity Uprise shared-platform support only; no module activation or building capability.
begin;
set local lock_timeout = '5s';

-- READ COMMITTED is required before any catalog or application-row read: a
-- transaction snapshot taken before a lock wait must never authorize recovery.
do $isolation$ begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'HALO_READ_COMMITTED_REQUIRED; nothing changed' using errcode = '55000';
  end if;
end $isolation$;
-- Forward and recovery use the same transaction lock. All ordinary table reads,
-- writes and table DDL are excluded before inspecting history or schema shape.
select pg_advisory_xact_lock(1163219023, 1212238927);
do $locks$ begin
  lock table public.eup_module_policies, public.eup_module_policy_commands in access exclusive mode;
exception when undefined_table then
  raise exception 'eup_module_policy_v1 is not applied; nothing changed' using errcode = '55000';
end $locks$;

-- Exact reviewed baseline OR this extension, never a partial or unfamiliar mix.
-- Both directions compare the complete catalog including the untouched guard
-- functions, owner/ACLs, columns, constraints, indexes, RLS, policies and triggers.
-- Fingerprints: scripts/db/halo-module-policy-preflight.sql; native proof rebuilds
-- the applied policy bytes and compares them with fresh production catalog evidence.
do $shape$
declare actual jsonb;
begin
-- BEGIN HALO CATALOG PREFLIGHT
with catalog as (
  select jsonb_build_object(
    'functions', (select jsonb_agg(jsonb_build_object(
      'name', p.proname, 'arguments', pg_get_function_identity_arguments(p.oid),
      'definition_md5', md5(pg_get_functiondef(p.oid)), 'owner', pg_get_userbyid(p.proowner),
      'acl', (select jsonb_agg(jsonb_build_array(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
        pg_get_userbyid(a.grantor), a.privilege_type, a.is_grantable)
        order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type, a.is_grantable)
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)) order by p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('eup_module_control_read', 'eup_module_policy_install',
        'eup_module_policy_command', 'eup_module_policy_read', 'eup_module_policy_json', 'eup_module_policy_immutable',
        'eup_module_guard', 'eup_module_guard_reduce', 'eup_module_guard_trigger')),
    'relations', (select jsonb_agg(jsonb_build_object(
      'name', c.relname, 'kind', c.relkind, 'owner', pg_get_userbyid(c.relowner),
      'persistence', c.relpersistence, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
      'replica_identity', c.relreplident, 'options', c.reloptions, 'partition', c.relispartition,
      'acl', (select jsonb_agg(jsonb_build_array(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
        pg_get_userbyid(a.grantor), a.privilege_type, a.is_grantable)
        order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type, a.is_grantable)
        from aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end, c.relowner))) a)) order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
        and c.relname in ('eup_module_policies', 'eup_module_policy_commands', 'eup_module_policy_commands_seq_seq')),
    'columns', (select jsonb_agg(jsonb_build_object(
      'table', c.relname, 'position', a.attnum, 'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull, 'identity', a.attidentity, 'generated', a.attgenerated,
      'default', replace(pg_get_expr(d.adbin, d.adrelid), 'public.', ''),
      'collation', col.collname, 'acl', a.attacl::text) order by c.relname, a.attnum)
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      left join pg_collation col on col.oid = a.attcollation
      where n.nspname = 'public' and c.relname in ('eup_module_policies', 'eup_module_policy_commands')
        and a.attnum > 0 and not a.attisdropped),
    'constraints', (select jsonb_agg(jsonb_build_object(
      'table', t.relname, 'name', c.conname, 'type', c.contype, 'validated', c.convalidated,
      'deferrable', c.condeferrable, 'deferred', c.condeferred, 'no_inherit', c.connoinherit,
      'definition', replace(pg_get_constraintdef(c.oid, true), 'public.', '')) order by t.relname, c.conname)
      from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname in ('eup_module_policies', 'eup_module_policy_commands')),
    'indexes', (select jsonb_agg(jsonb_build_object(
      'table', t.relname, 'name', c.relname, 'valid', i.indisvalid, 'ready', i.indisready,
      'definition', replace(pg_get_indexdef(i.indexrelid), 'public.', '')) order by t.relname, c.relname)
      from pg_index i join pg_class t on t.oid = i.indrelid join pg_class c on c.oid = i.indexrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname in ('eup_module_policies', 'eup_module_policy_commands')),
    'triggers', (select jsonb_agg(jsonb_build_object(
      'table', c.relname, 'name', t.tgname, 'enabled', t.tgenabled,
      'definition', replace(pg_get_triggerdef(t.oid, true), 'public.', '')) order by c.relname, t.tgname)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('eup_module_policies', 'eup_module_policy_commands') and not t.tgisinternal),
    'policies', (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'name', p.polname,
      'command', p.polcmd, 'permissive', p.polpermissive,
      'using', pg_get_expr(p.polqual, p.polrelid), 'check', pg_get_expr(p.polwithcheck, p.polrelid)) order by c.relname, p.polname), '[]'::jsonb)
      from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('eup_module_policies', 'eup_module_policy_commands')),
    'rules', (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'name', r.rulename,
      'enabled', r.ev_enabled, 'definition', replace(pg_get_ruledef(r.oid, true), 'public.', '')) order by c.relname, r.rulename), '[]'::jsonb)
      from pg_rewrite r join pg_class c on c.oid = r.ev_class join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('eup_module_policies', 'eup_module_policy_commands'))
  ) as detail
)
select (select jsonb_object_agg(key, md5(value::text)) from jsonb_each(detail)) into actual
from catalog;
-- END HALO CATALOG PREFLIGHT
  if actual is distinct from '{"rules":"d751713988987e9331980363e24189ce","columns":"2f6d26466365640e2a25228923f04749","indexes":"f85291a5ad99d0d0afe39067481d8bd4","policies":"d751713988987e9331980363e24189ce","triggers":"ce521d000a5ce4b35efd9b408c1e12ee","functions":"7192b3d8f40ca2f36db0583230633a8d","relations":"a70803fbc257d141ecfec4e7f8f4fcfe","constraints":"f8d7400df5de5fee7324c2932056e00d"}'::jsonb
     and actual is distinct from '{"rules":"d751713988987e9331980363e24189ce","columns":"2f6d26466365640e2a25228923f04749","indexes":"f85291a5ad99d0d0afe39067481d8bd4","policies":"d751713988987e9331980363e24189ce","triggers":"ce521d000a5ce4b35efd9b408c1e12ee","functions":"458ab1e67c3570af97bc2ac01b35c330","relations":"a70803fbc257d141ecfec4e7f8f4fcfe","constraints":"a8dbe8f75efcb05510da5965f62608d6"}'::jsonb then
    raise exception 'HALO_CATALOG_DRIFT; nothing changed. Re-review the current policy schema.' using errcode = '55000';
  end if;
end $shape$;

do $$ begin
  if exists (select 1 from public.eup_module_policies where module_id = 'halo')
     or exists (select 1 from public.eup_module_policy_commands where module_id = 'halo') then
    raise exception 'the halo unit has a policy row or recorded commands; nothing changed. Disable it instead.' using errcode = '55000';
  end if;
end $$;

alter table public.eup_module_policies drop constraint if exists eup_module_policies_module_id_check;
alter table public.eup_module_policies add constraint eup_module_policies_module_id_check
  check (module_id in ('environment','league','intake'));
alter table public.eup_module_policy_commands drop constraint if exists eup_module_policy_commands_module_id_check;
alter table public.eup_module_policy_commands add constraint eup_module_policy_commands_module_id_check
  check (module_id in ('environment','league','intake'));

create or replace function public.eup_module_control_read(p_actor uuid, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare house uuid;
begin
  select o.id into house from public.org_members mm join public.orgs o on o.id = mm.org_id
   where o.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner' limit 1;
  if p_actor is null or house is null then raise exception 'House owner required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'installationId', 'mccluster',
    'modules', (select jsonb_agg(jsonb_build_object('moduleId', r.module_id, 'installed', p.org_id is not null,
        'state', p.state, 'revision', p.revision, 'updated_at', p.updated_at, 'updated_by', p.updated_by,
        'last_command', (select jsonb_build_object('seq', c.seq, 'command', c.command, 'requested_state', c.requested_state,
            'expected_revision', c.expected_revision, 'reason', c.reason, 'actor', c.actor, 'created_at', c.created_at,
            'idempotency_key', c.idempotency_key, 'receipt', c.receipt)
          from public.eup_module_policy_commands c where c.org_id = house and c.module_id = r.module_id order by c.seq desc limit 1)
      ) order by r.ord)
      from (values (1, 'environment'), (2, 'league'), (3, 'intake')) r(ord, module_id)
      left join public.eup_module_policies p on p.org_id = house and p.module_id = r.module_id),
    'commands', coalesce((select jsonb_agg(to_jsonb(q) order by q.seq desc) from (
        select c.seq, c.module_id, c.command, c.requested_state, c.expected_revision, c.reason, c.actor, c.prior_state,
               c.prior_revision, c.idempotency_key, c.receipt, c.created_at
        from public.eup_module_policy_commands c where c.org_id = house order by c.seq desc
        limit least(greatest(coalesce(p_limit, 50), 1), 200)) q), '[]'::jsonb));
end $$;

create or replace function public.eup_module_policy_install(p_actor uuid, p_module text, p_key text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare house uuid; prior public.eup_module_policy_commands%rowtype; pol public.eup_module_policies%rowtype; digest text; receipt jsonb;
begin
  select o.id into house from public.org_members mm join public.orgs o on o.id = mm.org_id
   where o.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner' limit 1;
  if p_actor is null or house is null then raise exception 'House owner required' using errcode = '42501'; end if;
  if p_module is null or p_module not in ('environment','league','intake') or p_key is null or p_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_reason is null or length(p_reason) not between 1 and 500 or p_reason ~ '[\u0000-\u001f\u007f]' then
    raise exception 'invalid_policy_command' using errcode = '22023'; end if;
  digest := encode(sha256(convert_to(p_actor::text || '|' || p_module || '|install|disabled||' || p_reason, 'utf8')), 'hex');
  perform pg_advisory_xact_lock(1163219023, hashtext(house::text || ':' || p_module));
  select * into prior from public.eup_module_policy_commands where org_id = house and idempotency_key = p_key;
  if found then
    if prior.payload_digest <> digest then raise exception 'command_conflict' using errcode = 'EUM06'; end if;
    return prior.receipt;
  end if;
  if exists (select 1 from public.eup_module_policies where org_id = house and module_id = p_module) then
    raise exception 'module_already_installed' using errcode = 'EUM07'; end if;
  insert into public.eup_module_policies(org_id, module_id, state, revision, updated_by) values (house, p_module, 'disabled', 0, p_actor) returning * into pol;
  receipt := jsonb_build_object('policy', public.eup_module_policy_json(pol.module_id, pol.state, pol.revision), 'changed', true,
    'prior', null, 'recorded_at', pol.updated_at);
  insert into public.eup_module_policy_commands(org_id, idempotency_key, actor, module_id, command, requested_state, expected_revision, reason, payload_digest, prior_state, prior_revision, receipt)
    values (house, p_key, p_actor, p_module, 'install', 'disabled', null, p_reason, digest, null, null, receipt);
  return receipt;
end $$;

create or replace function public.eup_module_policy_command(p_actor uuid, p_module text, p_state text, p_expected_revision bigint, p_key text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare house uuid; prior public.eup_module_policy_commands%rowtype; pol public.eup_module_policies%rowtype; digest text; receipt jsonb;
        old_state text; old_revision bigint; changed boolean := false;
begin
  select o.id into house from public.org_members mm join public.orgs o on o.id = mm.org_id
   where o.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner' limit 1;
  if p_actor is null or house is null then raise exception 'House owner required' using errcode = '42501'; end if;
  if p_module is null or p_module not in ('environment','league','intake') or p_state is null or p_state not in ('enabled','draining','disabled')
     or p_expected_revision is null or p_expected_revision < 0 or p_key is null or p_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     or p_reason is null or length(p_reason) not between 1 and 500 or p_reason ~ '[\u0000-\u001f\u007f]' then
    raise exception 'invalid_policy_command' using errcode = '22023'; end if;
  digest := encode(sha256(convert_to(p_actor::text || '|' || p_module || '|set_state|' || p_state || '|' || p_expected_revision::text || '|' || p_reason, 'utf8')), 'hex');
  -- A finished command replays without waiting for the lock.
  select * into prior from public.eup_module_policy_commands where org_id = house and idempotency_key = p_key;
  if found then
    if prior.payload_digest <> digest then raise exception 'command_conflict' using errcode = 'EUM06'; end if;
    return prior.receipt;
  end if;
  perform pg_advisory_xact_lock(1163219023, hashtext(house::text || ':' || p_module));
  select * into pol from public.eup_module_policies where org_id = house and module_id = p_module for update;
  if not found then raise exception 'module_not_installed' using errcode = 'EUM01'; end if;
  -- Under the lock: a concurrent identical command has either finished (replay) or not started.
  select * into prior from public.eup_module_policy_commands where org_id = house and idempotency_key = p_key;
  if found then
    if prior.payload_digest <> digest then raise exception 'command_conflict' using errcode = 'EUM06'; end if;
    return prior.receipt;
  end if;
  if pol.revision <> p_expected_revision then raise exception 'revision_conflict' using errcode = '40001'; end if;
  if pol.state = 'enabled' and p_state = 'disabled' then raise exception 'drain_required' using errcode = 'EUM05'; end if;
  old_state := pol.state; old_revision := pol.revision;
  if pol.state <> p_state then
    if pol.revision >= 9007199254740991 then raise exception 'revision_exhausted' using errcode = '22003'; end if;
    update public.eup_module_policies set state = p_state, revision = revision + 1, updated_by = p_actor, updated_at = clock_timestamp()
     where org_id = house and module_id = p_module returning * into pol;
    changed := true;
  end if;
  receipt := jsonb_build_object('policy', public.eup_module_policy_json(pol.module_id, pol.state, pol.revision), 'changed', changed,
    'prior', jsonb_build_object('state', old_state, 'revision', old_revision), 'recorded_at', clock_timestamp());
  insert into public.eup_module_policy_commands(org_id, idempotency_key, actor, module_id, command, requested_state, expected_revision, reason, payload_digest, prior_state, prior_revision, receipt)
    values (house, p_key, p_actor, p_module, 'set_state', p_state, p_expected_revision, p_reason, digest, old_state, old_revision, receipt);
  return receipt;
end $$;

revoke all on function public.eup_module_control_read(uuid, integer), public.eup_module_policy_install(uuid, text, text, text),
  public.eup_module_policy_command(uuid, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.eup_module_control_read(uuid, integer), public.eup_module_policy_install(uuid, text, text, text),
  public.eup_module_policy_command(uuid, text, text, bigint, text, text) to service_role;
commit;
