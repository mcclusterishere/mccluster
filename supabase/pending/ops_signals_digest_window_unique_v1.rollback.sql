-- Rollback of ops_signals_digest_window_unique_v1.sql. Outside a transaction block, like the apply.
-- Core keeps working: the digest's lookup-then-insert stays, without the guarantee under concurrency.
drop index concurrently if exists public.ops_signals_core_digest_window_key;
