-- Rollback for media_operation_claims_v1.sql. Recovery artifact, not a forward
-- migration. Dropping the table discards the winner/loser evidence for every
-- operation id; a Worker still configured for claims answers 503 on paid
-- generation until the forward file is reapplied or the Worker is rolled back.
drop function if exists public.media_fail_operation_v1(uuid, text, jsonb);
drop function if exists public.media_bind_operation_v1(uuid, text, uuid);
drop function if exists public.media_claim_operation_v1(uuid, text, text, uuid, text);
drop table if exists public.media_operation_claims;
