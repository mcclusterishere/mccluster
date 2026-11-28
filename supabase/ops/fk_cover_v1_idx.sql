-- Foreign-key covering indexes, v1 (Supabase performance review of 2026-11-28,
-- docs/control-plane/SUPABASE-HARDENING-2026-11-28.md, finding P1).
--
-- NOT APPLIED. Run only with the owner's approval. Each statement runs ALONE, in its own
-- call, outside a transaction (CREATE INDEX CONCURRENTLY refuses inside one), so live
-- writers are never blocked. After each, confirm the index is valid:
--   select indexrelid::regclass, indisvalid, indisready from pg_index
--    where indexrelid = 'public.<name>'::regclass;
-- An invalid leftover (a cancelled build) is dropped with DROP INDEX CONCURRENTLY and rebuilt.
--
-- Of the 481 unindexed_foreign_keys findings, these are the seven on tables with more than
-- 25,000 rows (production estimates of 2026-11-28). The rest are on tables of a few hundred
-- rows or fewer, where a sequential scan is cheaper than another index to maintain.
-- Without these, deleting or re-keying a parent row (a news source, an ontology link,
-- object or action run, an objective, an auth user) scans the whole child table under lock.
--
--   media_news_articles     ~800k rows, 1.1 GB   source_id
--   ops_ontology_lineage    ~186k rows, 384 MB   link_id, object_id, action_run_id, actor_user_id
--   ops_agent_jobs           ~52k rows, 259 MB   objective_id
--   control_observability_events ~28k rows        actor_user_id
--
-- Rollback: drop index concurrently if exists public.<name>; for each.

create index concurrently if not exists media_news_articles_source_id_fk_idx
  on public.media_news_articles (source_id);

create index concurrently if not exists ops_ontology_lineage_link_id_fk_idx
  on public.ops_ontology_lineage (link_id);

create index concurrently if not exists ops_ontology_lineage_object_id_fk_idx
  on public.ops_ontology_lineage (object_id);

create index concurrently if not exists ops_ontology_lineage_action_run_id_fk_idx
  on public.ops_ontology_lineage (action_run_id);

create index concurrently if not exists ops_ontology_lineage_actor_user_id_fk_idx
  on public.ops_ontology_lineage (actor_user_id);

create index concurrently if not exists ops_agent_jobs_objective_id_fk_idx
  on public.ops_agent_jobs (objective_id);

create index concurrently if not exists control_observability_events_actor_user_id_fk_idx
  on public.control_observability_events (actor_user_id);
