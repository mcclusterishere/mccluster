-- Rollback of supabase/pending/20261125003000_equity_fighter_chat_v1.sql (migration name equity_fighter_chat_v1_rollback).
-- PENDING ONLY. Never applied. Never a forward migration. Owner approval required.
-- Refuses (55000), changing nothing, while any table holds a row: chat history and pairings are data, and dropping
-- them is a deletion. To drop them on purpose, export first and run with
--   set local mccluster.equity_fighter_drop_data = 'on';
-- as the first statement after begin. Touches nothing outside the four ef_* tables.
begin;
set local lock_timeout = '5s';
do $refuse$
declare
  n bigint := 0;
  t text;
begin
  foreach t in array array['ef_steps','ef_runs','ef_messages','ef_identities'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 and coalesce(current_setting('mccluster.equity_fighter_drop_data', true), '') <> 'on' then
        raise exception 'public.% has % rows; export and set mccluster.equity_fighter_drop_data = on to drop', t, n using errcode = '55000';
      end if;
    end if;
  end loop;
end $refuse$;
drop table if exists public.ef_steps;
drop table if exists public.ef_runs;
drop table if exists public.ef_messages;
drop table if exists public.ef_identities;
commit;
