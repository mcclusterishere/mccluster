-- The migration workflow may use this legacy table on older installations;
-- browser/client roles never need it. Fresh Supabase databases do not create
-- public._migrations, so harden it only when it actually exists.
do $$
begin
  if to_regclass('public._migrations') is not null then
    revoke all privileges on table public._migrations from anon, authenticated;
  end if;
end $$;
