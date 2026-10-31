-- Pending: not applied. Supports bounded reads in core/src/reflection-context.mjs.
-- The 2026-10-31 production EXPLAIN showed a full scan for both query shapes.
-- Apply in a transaction through the migration tool and record its actual version.
set local lock_timeout = '5s';
create index if not exists ops_agent_jobs_reflection_health_idx
  on public.ops_agent_jobs (org_id, updated_at desc, id desc)
  where job_type = 'host_health' and status = 'done';
create index if not exists ops_agent_jobs_reflection_recent_idx
  on public.ops_agent_jobs (org_id, updated_at desc, id desc)
  where job_type <> 'host_health';
