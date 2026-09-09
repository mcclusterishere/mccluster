-- PostgREST upserts require a matching unique constraint/index for on_conflict.
-- NULL external ids remain freely insertable; provider rows with stable ids are
-- deduplicated per tenant/source.
create unique index if not exists seek_first_observations_external_uidx
  on public.seek_first_observations (org_id, source_key, external_id);
