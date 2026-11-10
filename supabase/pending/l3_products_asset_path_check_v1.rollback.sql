-- Rollback for supabase/pending/l3_products_asset_path_check_v1.sql. Drops the
-- constraint: asset_path is unconstrained text again, as production has it today.
-- No row is changed. supabase/functions/l3-download keeps refusing a path that is not
-- a plain object path either way; only the table stops refusing it at write time.
set local lock_timeout = '5s';

alter table public.l3_products drop constraint if exists l3_products_asset_path_plain_check;
