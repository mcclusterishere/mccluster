-- Recency indexes for public.ops_agent_jobs (Core's job table).
--
-- The table holds ~53,700 rows / 247 MB (2026-11-28) and grows by ~1,500 rows a day, mostly
-- prim3_agent_news with large outputs. Its only indexes are the primary key, the queue index
-- (status, run_after, priority) and two actor_news_comment partials, so every "newest jobs" read
-- (order by updated_at desc) is a sequential scan of the whole table. pg_stat_statements shows those
-- reads reaching 20-77 s, and objective_reflection (the nightly reflection that plans Core's next
-- safe work) failed 19 times in three days with "canceling statement due to statement timeout".
--
-- core/src/reflection-context.mjs now ranks on narrow columns first, which works without these
-- indexes; the indexes are what keeps the ranking itself fast as the table grows:
--   * (org_id, updated_at desc, id desc): reflection's recent-job window, digest, health reads.
--   * (org_id, job_type, updated_at desc, id desc): "latest host_health", "latest job of type X"
--     (reflection health, system health, Control's job lists, MCP job lookups).
--
-- Additive only: no data changes, no RLS or grant changes. CREATE INDEX CONCURRENTLY cannot run
-- inside a transaction block: apply each statement on its own, outside a migration transaction. It
-- takes no lock that blocks writes. If a build is interrupted, drop the INVALID index and re-run.
create index concurrently if not exists ops_agent_jobs_org_recent_idx
  on public.ops_agent_jobs (org_id, updated_at desc, id desc);

create index concurrently if not exists ops_agent_jobs_org_type_recent_idx
  on public.ops_agent_jobs (org_id, job_type, updated_at desc, id desc);
