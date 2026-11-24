-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- The migration runner owns one transaction for this entire file.
set local lock_timeout = '5s';
do $migration_isolation$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='PENDING_REQUIRES_READ_COMMITTED: recovery must see writes committed before its table lock';
  end if;
end $migration_isolation$;
select pg_advisory_xact_lock(20261124,2);
do $reviewed_indexes$
declare expected record; index_oid oid;
begin
  lock table public.ops_agent_jobs in share mode;
  for expected in select * from jsonb_each_text('{"ops_agent_jobs_reflection_health_idx":"CREATE INDEX ops_agent_jobs_reflection_health_idx ON public.ops_agent_jobs USING btree (org_id, updated_at DESC, id DESC) WHERE ((job_type = ''host_health''::text) AND (status = ''done''::text))","ops_agent_jobs_reflection_recent_idx":"CREATE INDEX ops_agent_jobs_reflection_recent_idx ON public.ops_agent_jobs USING btree (org_id, updated_at DESC, id DESC) WHERE (job_type <> ''host_health''::text)"}'::jsonb) loop
    index_oid:=to_regclass('public.'||expected.key);
    if index_oid is null then continue; end if;
    if not exists(select 1 from pg_index where indexrelid=index_oid and indrelid='public.ops_agent_jobs'::regclass and indisvalid and indisready and not indisprimary)
      or pg_get_indexdef(index_oid)<>expected.value
      or exists(select 1 from pg_constraint where conindid=index_oid) then
      raise exception using errcode='55000',message='PENDING_INDEX_CHANGED: reviewed optional index changed '||expected.key;
    end if;
  end loop;
end $reviewed_indexes$;
-- Pending: not applied. Supports bounded reads in core/src/reflection-context.mjs.
-- The 2026-10-31 production EXPLAIN showed a full scan for both query shapes.
-- Apply in a transaction through the migration tool and record its actual version.
create index if not exists ops_agent_jobs_reflection_health_idx
  on public.ops_agent_jobs (org_id, updated_at desc, id desc)
  where job_type = 'host_health' and status = 'done';
create index if not exists ops_agent_jobs_reflection_recent_idx
  on public.ops_agent_jobs (org_id, updated_at desc, id desc)
  where job_type <> 'host_health';
