-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- Recovery removes only an empty reviewed creator_site_cohort_grants; no force or cascade option.
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
declare table_oid oid:=to_regclass('public.creator_site_cohort_grants'); actual jsonb;
begin
  if table_oid is null then return; end if;
  lock table public.creator_site_cohort_grants in access exclusive mode;
  if not exists(select 1 from pg_class where oid=table_oid and relkind='r' and relowner='postgres'::regrole and relrowsecurity and relforcerowsecurity=true)
    or exists(select 1 from pg_trigger where tgrelid=table_oid and not tgisinternal)
    or exists(select 1 from pg_policy where polrelid=table_oid) then
    raise exception using errcode='55000',message='PENDING_TABLE_CHANGED: unexpected owner, RLS, policy or trigger on creator_site_cohort_grants';
  end if;
  select jsonb_build_object(
    'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,coalesce(pg_get_expr(d.adbin,d.adrelid),''),a.attidentity,a.attgenerated) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=table_oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select jsonb_object_agg(conname,pg_get_constraintdef(oid)) from pg_constraint where conrelid=table_oid),
    'indexes',(select jsonb_object_agg(ic.relname,pg_get_indexdef(i.indexrelid)) from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=table_oid)
  ) into actual;
  if actual is distinct from '{"columns":[["org_id","uuid",true,"","",""],["creator_user_id","uuid",true,"","",""],["cohort_id","uuid",true,"","",""],["granted_by","uuid",true,"","",""],["granted_at","timestamp with time zone",true,"now()","",""],["revoked_at","timestamp with time zone",false,"","",""],["reason","text",true,"","",""]],"indexes":{"creator_site_cohort_grants_pkey":"CREATE UNIQUE INDEX creator_site_cohort_grants_pkey ON public.creator_site_cohort_grants USING btree (org_id)","creator_site_cohort_grants_creator_idx":"CREATE INDEX creator_site_cohort_grants_creator_idx ON public.creator_site_cohort_grants USING btree (creator_user_id) WHERE (revoked_at IS NULL)"},"constraints":{"creator_site_cohort_grants_pkey":"PRIMARY KEY (org_id)","creator_site_cohort_grants_reason_check":"CHECK (((length(TRIM(BOTH FROM reason)) >= 8) AND (length(TRIM(BOTH FROM reason)) <= 500)))","creator_site_cohort_grants_granted_by_fkey":"FOREIGN KEY (granted_by) REFERENCES auth.users(id)","creator_site_cohort_grants_creator_user_id_fkey":"FOREIGN KEY (creator_user_id) REFERENCES auth.users(id)"}}'::jsonb
    or exists(select 1 from pg_constraint where conrelid=table_oid and not convalidated)
    or exists(select 1 from pg_index where indrelid=table_oid and (not indisvalid or not indisready)) then
    raise exception using errcode='55000',message='PENDING_TABLE_CHANGED: reviewed shape changed for creator_site_cohort_grants';
  end if;
end $reviewed_table$;
do $retain_records$
declare has_rows boolean;
begin
  if to_regprocedure('public.creator_publish_site(uuid,text,text,text,uuid)') is not null then
    raise exception using errcode='55000',message='CREATOR_PUBLISH_ROLLBACK_REQUIRED: recover the five-argument publisher first';
  end if;
  if to_regclass('public.creator_site_cohort_grants') is null then return; end if;
  lock table public.creator_site_cohort_grants in access exclusive mode;
  execute 'select exists(select 1 from public.creator_site_cohort_grants)' into has_rows;
  if has_rows then raise exception using errcode='55000',message='PENDING_ROLLBACK_DATA_PRESENT: retain creator_site_cohort_grants records'; end if;
end $retain_records$;
drop table if exists public.creator_site_cohort_grants;
