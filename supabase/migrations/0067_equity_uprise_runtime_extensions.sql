-- Policy OS runtime prerequisites. Production already has these extensions,
-- but a fresh Supabase reset must not rely on production-only state.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Fail early with a useful error if the local/preview Supabase image cannot
-- provide the schemas the scheduler migration references.
do $$
begin
  if to_regnamespace('cron') is null then
    raise exception 'pg_cron did not create cron schema';
  end if;
  if to_regnamespace('net') is null then
    raise exception 'pg_net did not create net schema';
  end if;
  if to_regnamespace('vault') is null then
    raise exception 'supabase_vault did not create vault schema';
  end if;
end $$;
