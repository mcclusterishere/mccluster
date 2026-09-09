-- The 2026-08 Equity Uprise tables grant INSERT/UPDATE/DELETE to `anon`.
--
-- This is not currently exploitable: RLS is enabled on all of them and every
-- policy is scoped to `authenticated`, so an anonymous writer matches no
-- policy and is denied. The grant is nonetheless a loaded gun pointed at a
-- future change — the day someone adds a read policy `to anon, authenticated`
-- and word it slightly too broadly, or disables RLS on one table while
-- debugging, anonymous writes become real. Nothing should rely on RLS alone
-- when the privilege underneath can simply be taken away.
--
-- `authenticated` keeps its write privileges: the policies above are written
-- for it and the app depends on them. Only `anon` loses what it could never
-- use. SELECT is untouched, so public reads keep working.

do $$
declare
  t text;
begin
  foreach t in array array[
    'eu_applications','eu_audit','eu_campaign_recipients','eu_campaigns','eu_conversations',
    'eu_fellowship_sources','eu_fellowships','eu_messages','eu_perspectives','eu_profile_contact',
    'eu_profiles','eu_saves','eu_suppressions','eu_topics'
  ] loop
    execute format('revoke insert, update, delete on public.%I from anon', t);
  end loop;
end $$;

-- Prove no anon write privilege survives on any eu_ table.
do $$
declare
  leftover text;
begin
  select string_agg(distinct table_name, ', ')
    into leftover
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name like 'eu\_%'
     and grantee = 'anon'
     and privilege_type in ('INSERT','UPDATE','DELETE');
  if leftover is not null then
    raise exception 'anon still holds write privileges on: %', leftover;
  end if;
end $$;
