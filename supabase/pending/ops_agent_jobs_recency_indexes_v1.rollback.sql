-- Rollback of ops_agent_jobs_recency_indexes_v1.sql. Outside a transaction block, like the apply.
-- Core keeps working: recency reads fall back to sequential scans.
drop index concurrently if exists public.ops_agent_jobs_org_type_recent_idx;
drop index concurrently if exists public.ops_agent_jobs_org_recent_idx;
