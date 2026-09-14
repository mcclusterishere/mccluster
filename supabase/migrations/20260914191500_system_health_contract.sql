-- Canonical system-health contract marker.
-- Core uses this service-role-only singleton to distinguish API reachability from
-- database/schema parity with the exact repository contract it is running.

create table if not exists public.ops_system_contract (
  singleton boolean primary key default true check (singleton = true),
  schema_version text not null,
  migration_version text not null,
  updated_at timestamptz not null default now()
);

alter table public.ops_system_contract enable row level security;

revoke all on table public.ops_system_contract from public, anon, authenticated;
grant select on table public.ops_system_contract to service_role;

insert into public.ops_system_contract (singleton, schema_version, migration_version, updated_at)
values (true, 'mccluster-system-health/v1', '20260914191500', now())
on conflict (singleton) do update
set schema_version = excluded.schema_version,
    migration_version = excluded.migration_version,
    updated_at = excluded.updated_at;

comment on table public.ops_system_contract is
  'Service-role-only singleton proving the live database has reached the canonical McCluster system-health contract.';
