-- One Core daily report per house and report window (core/src/digest.mjs).
--
-- The digest looks for its window first and inserts only when it finds none, so two runs that start together
-- (a manual run beside the timer, a timer that fires twice) can each insert one, and each would then send the
-- owner a text. With this index the second insert fails with 23505; the digest then reads the row the first run
-- recorded, treats the window as recorded, and leaves the first delivery to that run (core/src/digest.mjs:
-- isUniqueViolation, recordedRecently). Rows from before window ids existed carry no window_id and are not
-- covered. The code works without the index; the index is what makes "one row per window" hold.
--
-- Before applying, this must return no rows (an existing duplicate makes the build fail and leaves an INVALID
-- index to drop):
--   select org_id, payload->>'window_id' as window_id, count(*)
--     from public.ops_signals
--    where signal_type = 'core_morning_digest' and payload ? 'window_id'
--    group by 1, 2 having count(*) > 1;
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block: apply this file on its own, outside a
-- migration transaction. It takes no lock that blocks writes to ops_signals.
create unique index concurrently if not exists ops_signals_core_digest_window_key
  on public.ops_signals (org_id, (payload->>'window_id'))
  where signal_type = 'core_morning_digest' and payload ? 'window_id';
