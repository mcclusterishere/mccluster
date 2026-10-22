-- Safe operational rollback/deactivation for OVH Layer 1. Do NOT reintroduce
-- the prior private.ops_ingest_ensure_connector implementation: it erased
-- existing license_policy and retention_policy on every upsert.
-- Disable only the market collectors; preserve existing observations, run
-- history and source policies for audit and a later authorized recovery.
begin;
update public.ops_ingest_connectors
set enabled = false, updated_at = now()
where connector_key in ('market.wdi','market.bls','market.sec','market.alpaca.iex');
commit;
