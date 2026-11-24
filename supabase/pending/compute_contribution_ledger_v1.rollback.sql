-- Rollback for compute_contribution_ledger_v1. Drops exactly what that file created.
-- PENDING ONLY. Owner review and explicit approval are required before running
-- this against canonical Supabase. No ledger entry here. The ledger's rows are
-- lost with it: export them first if anything was ever settled.
drop function if exists public.compute_ledger_reserve(text,text,uuid,bigint,integer,text,integer);
drop function if exists public.compute_ledger_reserve(text,text,uuid,bigint,integer);
drop function if exists public.compute_ledger_settle(text,uuid,text,integer,jsonb,text,text,bigint);
drop function if exists public.compute_ledger_release(text,uuid,text,text,bigint);
drop function if exists public.compute_ledger_correct(text,bigint,text,bigint,bigint,text);
drop function if exists public.compute_ledger_balances(text);
drop function if exists public.compute_ledger_receipt(uuid);
drop function if exists public.compute_ledger_balances_internal(text);
drop function if exists public.compute_ledger_operation_lookup(text,text,text);
drop function if exists public.compute_ledger_term_ok(uuid,text,bigint);
drop function if exists public.compute_ledger_sha256(text);
drop function if exists public.compute_ledger_canonical_json(jsonb);
drop trigger if exists ops_compute_contribution_ledger_append_only on public.ops_compute_contribution_ledger;
drop function if exists public.compute_ledger_append_only();
drop table if exists public.ops_compute_ledger_operations;
drop table if exists public.ops_compute_display_points;
drop table if exists public.ops_compute_account_carry;
drop table if exists public.ops_compute_contribution_ledger;
drop table if exists public.ops_compute_spend_reservations;
drop table if exists public.ops_compute_fraud_reviews;
drop table if exists public.ops_compute_known_answer_tasks;
drop table if exists public.ops_compute_private_grants;
drop table if exists public.ops_compute_account_relations;
drop table if exists public.ops_compute_account_quotas;
drop table if exists public.ops_compute_model_classes;
drop table if exists public.ops_compute_node_accounts;
drop table if exists public.ops_compute_accounts;
