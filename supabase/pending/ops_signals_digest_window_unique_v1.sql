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
  lock table public.ops_signals in share mode;
  for expected in select * from jsonb_each_text('{"ops_signals_core_digest_window_key":"CREATE UNIQUE INDEX ops_signals_core_digest_window_key ON public.ops_signals USING btree (org_id, ((payload ->> ''window_id''::text))) WHERE ((signal_type = ''core_morning_digest''::text) AND (payload ? ''window_id''::text))"}'::jsonb) loop
    index_oid:=to_regclass('public.'||expected.key);
    if index_oid is null then continue; end if;
    if not exists(select 1 from pg_index where indexrelid=index_oid and indrelid='public.ops_signals'::regclass and indisvalid and indisready and not indisprimary)
      or pg_get_indexdef(index_oid)<>expected.value
      or exists(select 1 from pg_constraint where conindid=index_oid) then
      raise exception using errcode='55000',message='PENDING_INDEX_CHANGED: reviewed optional index changed '||expected.key;
    end if;
  end loop;
end $reviewed_indexes$;
-- One Core daily report per house and report window (core/src/digest.mjs).
--
-- The digest looks for its window first and inserts only when it finds none, so two runs that start together
-- (a manual run beside the timer, a timer that fires twice) can each insert one, and each would then send the
-- owner a text. With this index the second insert fails with 23505; the digest then reads the row the first run
-- recorded, treats the window as recorded, and leaves the first delivery to that run (core/src/digest.mjs:
-- isUniqueViolation, recordedRecently). Rows from before window ids existed carry no window_id and are not
-- covered. The code works without the index; the index is what makes "one row per window" hold.
--
-- Before applying, this must return no rows (an existing duplicate aborts the migration without deleting
-- or modifying the conflicting signal rows):
--   select org_id, payload->>'window_id' as window_id, count(*)
--     from public.ops_signals
--    where signal_type = 'core_morning_digest' and payload ? 'window_id'
--    group by 1, 2 having count(*) > 1;
--
-- 2026-11-24 read-only preflight: 64 rows, 155648 total bytes, zero duplicate windows,
-- and no equivalent index. A normal build on this measured small table belongs in the
-- standard transactional migration flow. It briefly blocks writes; a five-second lock
-- timeout aborts instead of waiting indefinitely. Recheck size/duplicates before apply.
create unique index if not exists ops_signals_core_digest_window_key
  on public.ops_signals (org_id, (payload->>'window_id'))
  where signal_type = 'core_morning_digest' and payload ? 'window_id';
