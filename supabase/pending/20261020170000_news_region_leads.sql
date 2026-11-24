-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- The migration runner owns one transaction for this entire file.
set local lock_timeout = '5s';
do $migration_isolation$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='PENDING_REQUIRES_READ_COMMITTED: recovery must see writes committed before its table lock';
  end if;
end $migration_isolation$;
select pg_advisory_xact_lock(20261124,2);
do $reviewed_table$
declare table_oid oid:=to_regclass('public.news_region_leads'); actual jsonb;
begin
  if table_oid is null then return; end if;
  lock table public.news_region_leads in access exclusive mode;
  if not exists(select 1 from pg_class where oid=table_oid and relkind='r' and relowner='postgres'::regrole and relrowsecurity and relforcerowsecurity=false)
    or exists(select 1 from pg_trigger where tgrelid=table_oid and not tgisinternal)
    or exists(select 1 from pg_policy where polrelid=table_oid) then
    raise exception using errcode='55000',message='PENDING_TABLE_CHANGED: unexpected owner, RLS, policy or trigger on news_region_leads';
  end if;
  select jsonb_build_object(
    'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,coalesce(pg_get_expr(d.adbin,d.adrelid),''),a.attidentity,a.attgenerated) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=table_oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select jsonb_object_agg(conname,pg_get_constraintdef(oid)) from pg_constraint where conrelid=table_oid),
    'indexes',(select jsonb_object_agg(ic.relname,pg_get_indexdef(i.indexrelid)) from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=table_oid)
  ) into actual;
  if actual is distinct from '{"columns":[["m_uid","uuid",true,"","",""],["country_code","text",true,"","",""],["granted_by","uuid",true,"","",""],["granted_at","timestamp with time zone",true,"now()","",""]],"indexes":{"news_region_leads_pkey":"CREATE UNIQUE INDEX news_region_leads_pkey ON public.news_region_leads USING btree (m_uid, country_code)","news_region_leads_country_idx":"CREATE INDEX news_region_leads_country_idx ON public.news_region_leads USING btree (country_code)"},"constraints":{"news_region_leads_pkey":"PRIMARY KEY (m_uid, country_code)","news_region_leads_m_uid_fkey":"FOREIGN KEY (m_uid) REFERENCES m_people(id) ON DELETE CASCADE","news_region_leads_country_code_check":"CHECK ((country_code ~ ''^[A-Z]{2}$''::text))"}}'::jsonb
    or exists(select 1 from pg_constraint where conrelid=table_oid and not convalidated)
    or exists(select 1 from pg_index where indrelid=table_oid and (not indisvalid or not indisready)) then
    raise exception using errcode='55000',message='PENDING_TABLE_CHANGED: reviewed shape changed for news_region_leads';
  end if;
end $reviewed_table$;
-- REGION LEADERS FOR THE MORNING BRIEF (pending; not applied in production)
--
-- Owner, 2026-10-20: "Each region leader will be doing this so make a summary of
-- each country's news for the day." A region leader reads, asks for, reads live
-- and publishes the briefs of the countries granted to them here; the house owner
-- grants and removes them (POST/DELETE /v1/news-briefs/leads,
-- workers/mccluster/src/news-briefs.js). Their countries are also queued every
-- night. Until this table exists the briefs are the house owner's alone.
--
-- Service role only: the Worker checks the house owner before every write.
-- Rollback: 20261020170000_news_region_leads.rollback.sql

create table if not exists public.news_region_leads (
  m_uid uuid not null references public.m_people(id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  primary key (m_uid, country_code)
);
create index if not exists news_region_leads_country_idx on public.news_region_leads (country_code);
alter table public.news_region_leads enable row level security;
revoke all on public.news_region_leads from public, anon, authenticated;
-- Declare the Worker's access explicitly rather than relying on the migration
-- role's default table grants.
grant select, insert, update, delete on public.news_region_leads to service_role;
do $reviewed_table$
declare table_oid oid:=to_regclass('public.news_region_leads'); actual jsonb;
begin
  if table_oid is null then return; end if;
  lock table public.news_region_leads in access exclusive mode;
  if not exists(select 1 from pg_class where oid=table_oid and relkind='r' and relowner='postgres'::regrole and relrowsecurity and relforcerowsecurity=false)
    or exists(select 1 from pg_trigger where tgrelid=table_oid and not tgisinternal)
    or exists(select 1 from pg_policy where polrelid=table_oid) then
    raise exception using errcode='55000',message='PENDING_TABLE_CHANGED: unexpected owner, RLS, policy or trigger on news_region_leads';
  end if;
  select jsonb_build_object(
    'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,coalesce(pg_get_expr(d.adbin,d.adrelid),''),a.attidentity,a.attgenerated) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=table_oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select jsonb_object_agg(conname,pg_get_constraintdef(oid)) from pg_constraint where conrelid=table_oid),
    'indexes',(select jsonb_object_agg(ic.relname,pg_get_indexdef(i.indexrelid)) from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=table_oid)
  ) into actual;
  if actual is distinct from '{"columns":[["m_uid","uuid",true,"","",""],["country_code","text",true,"","",""],["granted_by","uuid",true,"","",""],["granted_at","timestamp with time zone",true,"now()","",""]],"indexes":{"news_region_leads_pkey":"CREATE UNIQUE INDEX news_region_leads_pkey ON public.news_region_leads USING btree (m_uid, country_code)","news_region_leads_country_idx":"CREATE INDEX news_region_leads_country_idx ON public.news_region_leads USING btree (country_code)"},"constraints":{"news_region_leads_pkey":"PRIMARY KEY (m_uid, country_code)","news_region_leads_m_uid_fkey":"FOREIGN KEY (m_uid) REFERENCES m_people(id) ON DELETE CASCADE","news_region_leads_country_code_check":"CHECK ((country_code ~ ''^[A-Z]{2}$''::text))"}}'::jsonb
    or exists(select 1 from pg_constraint where conrelid=table_oid and not convalidated)
    or exists(select 1 from pg_index where indrelid=table_oid and (not indisvalid or not indisready)) then
    raise exception using errcode='55000',message='PENDING_TABLE_CHANGED: reviewed shape changed for news_region_leads';
  end if;
end $reviewed_table$;
