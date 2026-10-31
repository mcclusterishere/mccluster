-- Removes only the optional read indexes; preserves all job data.
set local lock_timeout = '5s';
drop index if exists public.ops_agent_jobs_reflection_health_idx;
drop index if exists public.ops_agent_jobs_reflection_recent_idx;
