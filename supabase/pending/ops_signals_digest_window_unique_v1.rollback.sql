-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- Recovery removes only exact reviewed optional indexes and preserves every row.
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
drop index if exists public.ops_signals_core_digest_window_key;
