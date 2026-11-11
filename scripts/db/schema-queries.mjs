// The one set of read-only catalog queries behind scripts/db/verify-production-schema.mjs.
//
// The same SQL text runs three ways, so the results are comparable:
//   1. against production through the Supabase MCP `execute_sql` tool (print it with
//      `node scripts/db/verify-production-schema.mjs --print-sql <section>`);
//   2. against production or any database through a connection string held in an
//      environment variable (`--database-url-env NAME`, run with psql);
//   3. against the disposable database CI rebuilds from supabase/migrations/
//      (the "Supabase migration reset" job), which produces supabase/schema-manifest.json.
//
// Every query is a single SELECT over pg_catalog, information_schema, pg_policies,
// storage.buckets, cron.job or supabase_migrations.schema_migrations. None writes.
// Each returns exactly one row with two columns: `md5`, the md5 of `j::text`, and `j`,
// a jsonb array of arrays. The md5 lets a saved copy of the result prove it is the
// result byte for byte (see canonicalJsonbText below).
//
// Nothing personal is selected: no table rows, no `created_by`, no function bodies,
// policy expressions or cron commands in clear (each is a 12-hex md5 prefix).

// Schemas Supabase or an extension owns. Their objects are not this repo's schema.
// `storage` is out of scope for tables but in scope for policies and buckets.
export const MANAGED_SCHEMAS = [
  '_analytics', '_realtime', '_supavisor', 'auth', 'cron', 'extensions', 'graphql',
  'graphql_public', 'information_schema', 'net', 'pgbouncer', 'pgmq', 'pgsodium',
  'pgsodium_masks', 'realtime', 'storage', 'supabase_functions', 'supabase_migrations',
  'tiger', 'tiger_data', 'topology', 'vault',
];

const managedList = MANAGED_SCHEMAS.map((s) => `'${s}'`).join(',');

// Schemas whose objects the repo's migrations own.
const SCOPE = `select oid, nspname from pg_namespace where nspname not in (${managedList}) and nspname !~ '^pg_'`;
// Not created by an extension (pg_depend deptype 'e').
const notExtension = (classTable, oidExpr) =>
  `not exists (select 1 from pg_depend d where d.classid = '${classTable}'::regclass and d.objid = ${oidExpr} and d.deptype = 'e')`;

// Privileges of PUBLIC, anon and authenticated, from an acl (defaults applied).
const aclFor = (aclExpr) => `coalesce((select string_agg(z.grantee || '=' || z.privs, ';' order by z.grantee collate "C") from (
      select case e.grantee when 0 then 'PUBLIC' else e.grantee::regrole::text end as grantee,
             string_agg(case e.privilege_type when 'SELECT' then 'r' when 'INSERT' then 'a' when 'UPDATE' then 'w'
               when 'DELETE' then 'd' when 'TRUNCATE' then 'D' when 'REFERENCES' then 'x' when 'TRIGGER' then 't'
               when 'MAINTAIN' then 'm' when 'EXECUTE' then 'X' when 'USAGE' then 'U' else '?' end,
               '' order by e.privilege_type collate "C") as privs
      from aclexplode(${aclExpr}) e
      where e.grantee = 0 or e.grantee::regrole::text in ('anon', 'authenticated')
      group by 1) z), '')`;

// A uuid literal in a default or a constraint is data chosen when the migration ran
// (0026_tenancy sets org_id's default to the house org's freshly generated id), so it
// differs on every rebuild. Signatures compare the shape, not the value.
const UUID_LITERAL = (expr) => `regexp_replace(${expr}, '''[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}''', '''<uuid>''', 'g')`;

const wrap = (inner, rowExpr, order) =>
  `select md5(j::text) as md5, j from (select coalesce(jsonb_agg(${rowExpr} order by ${order}), '[]'::jsonb) as j from (${inner}) q) s`;

export const SECTIONS = {
  // The applied migration ledger.
  // md5: over the stored statements joined with ''. A migration applied with
  // apply_migration stores one statement, so for n = 1 it equals the md5 of the committed
  // file when the file is byte-identical.
  // code_md5: the same text with `--` comments removed and whitespace runs collapsed
  // (see normalizeSqlCode), so a file whose header comments were rewritten after apply
  // still proves its executable SQL is what production ran.
  ledger: {
    describe: 'supabase_migrations.schema_migrations: [version, name, statement_count, md5(statements), code_md5]',
    sql: wrap(
      `select version, name, coalesce(array_length(statements, 1), 0) as n,
              md5(coalesce(array_to_string(statements, ''), '')) as m,
              md5(btrim(regexp_replace(regexp_replace(coalesce(array_to_string(statements, ''), ''), '--[^\\n]*', '', 'g'), '[ \\t\\n\\r\\f\\v]+', ' ', 'g'))) as c
       from supabase_migrations.schema_migrations`,
      `jsonb_build_array(version, name, n, m, c)`,
      `version collate "C", name collate "C"`,
    ),
  },

  schemas: {
    describe: 'schemas the repo owns: [schema, owner, usage acl for PUBLIC/anon/authenticated]',
    sql: wrap(
      `select n.nspname, pg_get_userbyid(n.nspowner) as owner,
              ${aclFor(`coalesce(n.nspacl, acldefault('n', n.nspowner))`)} as acl
       from pg_namespace n where n.oid in (select oid from (${SCOPE}) sc)`,
      `jsonb_build_array(nspname, owner, acl)`,
      `nspname collate "C"`,
    ),
  },

  extensions: {
    describe: 'pg_extension: [name, version, schema]',
    sql: wrap(
      `select e.extname, e.extversion, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace`,
      `jsonb_build_array(extname, extversion, nspname)`,
      `extname collate "C"`,
    ),
  },

  // Tables, views, materialized views, foreign tables in repo-owned schemas.
  // colsig: md5 prefix of the columns (name, type, not null, default, generated) by name,
  // with uuid literals in defaults and constraints masked (UUID_LITERAL).
  // consig: constraints by name. idxsig: index definitions. defsig: view definition.
  // security_invoker: the view option ('' when unset, which means definer rights).
  relations: {
    describe: '[schema, name, relkind, rls_enabled, rls_forced, security_invoker, ncols, colsig, consig, idxsig, defsig, acl]',
    sql: wrap(
      `select sc.nspname, c.relname, c.relkind::text as relkind, c.relrowsecurity, c.relforcerowsecurity,
              coalesce((select o.option_value from pg_options_to_table(c.reloptions) o where o.option_name = 'security_invoker'), '') as invoker,
              (select count(*) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)::int as ncols,
              left(md5(coalesce((select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                   || case when a.attnotnull then ' nn' else '' end
                   || coalesce(' d=' || ${UUID_LITERAL('pg_get_expr(ad.adbin, ad.adrelid)')}, '')
                   || case when a.attgenerated <> '' then ' g' else '' end
                   || case when a.attidentity <> '' then ' i' else '' end, ',' order by a.attname collate "C")
                 from pg_attribute a left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
                 where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '')), 12) as colsig,
              left(md5(coalesce((select string_agg(k.conname || ' ' || ${UUID_LITERAL('pg_get_constraintdef(k.oid)')}, ',' order by k.conname collate "C")
                 from pg_constraint k where k.conrelid = c.oid), '')), 12) as consig,
              left(md5(coalesce((select string_agg(pg_get_indexdef(i.indexrelid), ',' order by pg_get_indexdef(i.indexrelid) collate "C")
                 from pg_index i where i.indrelid = c.oid), '')), 12) as idxsig,
              case when c.relkind in ('v', 'm') then left(md5(pg_get_viewdef(c.oid)), 12) else '' end as defsig,
              ${aclFor(`coalesce(c.relacl, acldefault('r', c.relowner))`)} as acl
       from pg_class c join (${SCOPE}) sc on sc.oid = c.relnamespace
       where c.relkind in ('r', 'p', 'v', 'm', 'f') and ${notExtension('pg_class', 'c.oid')}`,
      `jsonb_build_array(nspname, relname, relkind, relrowsecurity, relforcerowsecurity, invoker, ncols, colsig, consig, idxsig, defsig, acl)`,
      `nspname collate "C", relname collate "C"`,
    ),
  },

  // Functions and procedures in repo-owned schemas.
  // exec: who of PUBLIC/anon/authenticated holds EXECUTE (a NULL proacl means PUBLIC does).
  functions: {
    describe: '[schema, name, identity_args, result_or_kind, security_definer, volatility, config, body_md5, exec_acl]',
    sql: wrap(
      `select sc.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args,
              case p.prokind when 'f' then pg_get_function_result(p.oid) else p.prokind::text end as result,
              p.prosecdef, p.provolatile::text as vol,
              coalesce((select string_agg(x, ',' order by x collate "C") from unnest(p.proconfig) x), '') as config,
              left(md5(coalesce(p.prosrc, '')), 12) as body,
              ${aclFor(`coalesce(p.proacl, acldefault('f', p.proowner))`)} as acl
       from pg_proc p join (${SCOPE}) sc on sc.oid = p.pronamespace
       where ${notExtension('pg_proc', 'p.oid')}`,
      `jsonb_build_array(nspname, proname, args, result, prosecdef, vol, config, body, acl)`,
      `nspname collate "C", proname collate "C", args collate "C"`,
    ),
  },

  // Every RLS policy outside cron (storage.objects policies included).
  // using/check: md5 prefix of the expression as Postgres deparses it ('' when absent).
  policies: {
    describe: '[schema, table, policy, permissive, cmd, roles, using_md5, check_md5]',
    sql: wrap(
      `select schemaname, tablename, policyname, permissive, cmd,
              (select string_agg(r, ',' order by r collate "C") from unnest(roles) r) as roles,
              case when qual is null then '' else left(md5(qual), 12) end as u,
              case when with_check is null then '' else left(md5(with_check), 12) end as w
       from pg_policies where schemaname <> 'cron'`,
      `jsonb_build_array(schemaname, tablename, policyname, permissive, cmd, roles, u, w)`,
      `schemaname collate "C", tablename collate "C", policyname collate "C"`,
    ),
  },

  triggers: {
    describe: '[schema, table, trigger, enabled, def_md5]',
    sql: wrap(
      `select sc.nspname, c.relname, t.tgname, t.tgenabled::text as en, left(md5(pg_get_triggerdef(t.oid)), 12) as d
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join (${SCOPE}) sc on sc.oid = c.relnamespace
       where not t.tgisinternal`,
      `jsonb_build_array(nspname, relname, tgname, en, d)`,
      `nspname collate "C", relname collate "C", tgname collate "C"`,
    ),
  },

  buckets: {
    describe: 'storage.buckets: [id, name, public, file_size_limit, allowed_mime_types]',
    sql: wrap(
      `select id, name, public, file_size_limit, allowed_mime_types from storage.buckets`,
      `jsonb_build_array(id, name, public, file_size_limit, to_jsonb(allowed_mime_types))`,
      `id collate "C"`,
    ),
  },

  // Scheduled jobs. The command is hashed: it can hold URLs and headers.
  // Runs only where cron.job exists (the runner checks `requires` first).
  cron_jobs: {
    describe: 'cron.job: [jobname, schedule, active, command_md5]',
    requires: 'cron.job',
    sql: wrap(
      `select jobname, schedule, active, left(md5(command), 12) as c from cron.job`,
      `jsonb_build_array(jobname, schedule, active, c)`,
      `jobname collate "C", schedule collate "C"`,
    ),
  },
};

export const SECTION_NAMES = Object.keys(SECTIONS);

// The JavaScript twin of the ledger's code_md5 normalization.
export function normalizeSqlCode(text) {
  return text.replace(/--[^\n]*/g, '').replace(/[ \t\n\r\f\v]+/g, ' ').replace(/^ +| +$/g, '');
}

// Postgres prints jsonb as text with ", " between elements and ": " after keys.
// The sections only hold arrays, strings, numbers, booleans and null.
export function canonicalJsonbText(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJsonbText).join(', ')}]`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}: ${canonicalJsonbText(value[k])}`).join(', ')}}`;
  }
  throw new TypeError(`unsupported jsonb value: ${typeof value}`);
}
