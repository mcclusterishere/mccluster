-- Pending review. OVH market-layer1 depends on retaining the authoritative
-- source license/retention policy when ops_ingest_write_record_service calls
-- private.ops_ingest_upsert_record -> private.ops_ingest_ensure_connector.
-- The September helper currently overwrites both policies with {} every write.
-- Keep the existing function signature and caller/privilege contract; no new tables.
create or replace function private.ops_ingest_ensure_connector(
  p_org uuid,
  p_connector_key text,
  p_kind text,
  p_display_name text,
  p_description text default '',
  p_retention jsonb default '{}'::jsonb,
  p_license jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare v_id uuid;
begin
  insert into public.ops_ingest_connectors(
    org_id, connector_key, kind, display_name, description, retention_policy, license_policy
  ) values (
    p_org, p_connector_key, p_kind, p_display_name, coalesce(p_description,''),
    coalesce(p_retention,'{}'::jsonb), coalesce(p_license,'{}'::jsonb)
  )
  on conflict (org_id,connector_key) do update set
    kind = excluded.kind,
    display_name = excluded.display_name,
    description = case when excluded.description = 'Canonical McCluster source adapter'
      then public.ops_ingest_connectors.description else excluded.description end,
    retention_policy = case when coalesce(p_retention,'{}'::jsonb) = '{}'::jsonb
      then public.ops_ingest_connectors.retention_policy else excluded.retention_policy end,
    license_policy = case when coalesce(p_license,'{}'::jsonb) = '{}'::jsonb
      then public.ops_ingest_connectors.license_policy else excluded.license_policy end,
    updated_at = now()
  returning id into v_id;
  return v_id;
end
$$;

-- No grants added. private schema remains outside the Data API; the existing
-- public service RPC stays the only authorized ingestion path.
