-- 2026-10-19 / REGION FEED V1 -- PENDING, DO NOT APPLY BY REPO MERGE.
-- Turn WORLD_PLACE_SCOPE_ENABLED on ONLY AFTER application is confirmed in
-- the production migration ledger, privacy acknowledgement/region tests pass,
-- and production country-scoped feed reads are checked.
-- No IP-location writes, no inferred post placement, no retroactive backfill.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.network_posts add column if not exists country_code text;
do $$
begin
 if not exists (
    select 1 from pg_constraint where conrelid='public.network_posts'::regclass
      and conname='network_posts_country_code_valid'
 ) then
    alter table public.network_posts add constraint network_posts_country_code_valid
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
 end if;
end $$;
create index if not exists network_posts_public_country_timeline_v1
  on public.network_posts(country_code,created_at desc,id desc)
  where country_code is not null and visibility='public'
    and deleted_at is null and group_id is null and reply_to_id is null;

alter table if exists public.network_live_sessions add column if not exists country_code text;
do $$
begin
 if to_regclass('public.network_live_sessions') is not null and not exists (
    select 1 from pg_constraint where conrelid='public.network_live_sessions'::regclass
    and conname='network_live_sessions_country_code_valid'
 ) then
   alter table public.network_live_sessions add constraint network_live_sessions_country_code_valid
   check (country_code is null or country_code ~ '^[A-Z]{2}$');
 end if;
end $$;
commit;