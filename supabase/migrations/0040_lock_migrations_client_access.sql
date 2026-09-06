-- The migration workflow needs this table; browser/client roles do not.
-- Keep RLS unchanged for now so the workflow is not accidentally blocked.
revoke all privileges on table public._migrations from anon, authenticated;
