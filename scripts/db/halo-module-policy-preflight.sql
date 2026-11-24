-- Read-only catalog evidence for the optional Halo module registration.
-- Equity Uprise shared-platform support; no product capability or activation.
-- No application rows, actor identities, credentials or migration authors are read.
-- The named catalog sections are hashed identically by forward and recovery guards.
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
select current_setting('server_version') as server_version, clock_timestamp() as read_at,
  detail, (select jsonb_object_agg(key, md5(value::text)) from jsonb_each(detail)) as fingerprints
from catalog;
