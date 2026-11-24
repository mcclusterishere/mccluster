-- Equity Uprise shared-platform support-only: empty-column recovery only.
-- PENDING ONLY. Requires named-file approval. Retains the base receipt table,
-- every signature and all leases. Saved device facts require a forward repair.
do $rollback$
declare
  v_column smallint;
  v_expression text;
  v_marker constant text := 'compute_job_attestations_device_facts_v1; node-reported completion snapshot; 32768 UTF-8 bytes';
  v_expected constant text := '((device_facts IS NULL) OR ((jsonb_typeof(device_facts) = ''object''::text) AND (octet_length((device_facts)::text) <= 32768)))';
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'DEVICE_FACTS_READ_COMMITTED_REQUIRED' using errcode = '55000';
  end if;
  perform set_config('lock_timeout', '5s', true);
  if to_regclass('public.ops_compute_attestations') is null then return; end if;
  lock table public.ops_compute_attestations in access exclusive mode;
  select attnum into v_column from pg_attribute
    where attrelid = 'public.ops_compute_attestations'::regclass and attname = 'device_facts' and not attisdropped;
  if v_column is null then return; end if;
  select pg_get_expr(conbin, conrelid) into v_expression from pg_constraint
    where conrelid = 'public.ops_compute_attestations'::regclass
      and conname = 'ops_compute_attestations_device_facts_v1_check'
      and contype = 'c' and convalidated and not condeferrable and conkey = array[v_column];
  if not exists (select 1 from pg_attribute where attrelid = 'public.ops_compute_attestations'::regclass
      and attnum = v_column and atttypid = 'jsonb'::regtype and not attnotnull
      and not atthasdef and attgenerated = '' and attidentity = '')
     or col_description('public.ops_compute_attestations'::regclass, v_column) is distinct from v_marker
     or regexp_replace(v_expression, '\s+', '', 'g') is distinct from regexp_replace(v_expected, '\s+', '', 'g')
     or (select count(*) from pg_constraint where conrelid = 'public.ops_compute_attestations'::regclass and v_column = any(conkey)) <> 1
     or exists (select 1 from pg_index where indrelid = 'public.ops_compute_attestations'::regclass and v_column = any(indkey))
     -- indkey alone misses expression keys and predicate-only dependencies.
     -- DROP COLUMN would automatically remove those owner-added indexes too.
     or exists (select 1 from pg_index i join pg_depend d
       on d.classid = 'pg_class'::regclass and d.objid = i.indexrelid
       where i.indrelid = 'public.ops_compute_attestations'::regclass
         and d.refclassid = 'pg_class'::regclass and d.refobjid = i.indrelid
         and d.refobjsubid = v_column) then
    raise exception 'DEVICE_FACTS_RECOVERY_SHAPE_MISMATCH' using errcode = '55000';
  end if;
  if exists (select 1 from public.ops_compute_attestations where device_facts is not null) then
    raise exception 'DEVICE_FACTS_RECOVERY_DATA_PRESENT' using errcode = '55000';
  end if;
  alter table public.ops_compute_attestations drop column device_facts;
end
$rollback$;
