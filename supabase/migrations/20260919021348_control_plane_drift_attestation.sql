create or replace function public.system_migration_attestation()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with ordered as (
    select version, name
      from supabase_migrations.schema_migrations
     order by version
  ),
  materialized as (
    select
      count(*)::int as migration_count,
      max(version) as latest_version,
      (array_agg(name order by version desc))[1] as latest_name,
      string_agg(version || ':' || name, E'\n' order by version) as ledger_text
    from ordered
  )
  select jsonb_build_object(
    'migration_count', migration_count,
    'latest_version', latest_version,
    'latest_name', latest_name,
    'ledger_sha256',
      encode(extensions.digest(convert_to(coalesce(ledger_text,''),'UTF8'),'sha256'),'hex')
  )
  from materialized;
$$;

revoke all on function public.system_migration_attestation()
  from public, anon, authenticated;
grant execute on function public.system_migration_attestation()
  to service_role;

comment on function public.system_migration_attestation() is
  'Backend-only drift attestation for the canonical Supabase migration ledger.';
