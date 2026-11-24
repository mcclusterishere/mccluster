-- Equity Uprise shared-platform support-only: immutable Core completion facts.
-- PENDING ONLY. Requires named-file approval after compute_job_attestations_v1.
-- This is a separate forward migration. Never replay the base migration with
-- changed SQL. No module, device, policy or scheduler is enabled here.
-- Recovery: compute_job_attestations_device_facts_v1.rollback.sql. It refuses
-- any saved facts, preserving the signed base receipt in all cases.
do $migration$
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
  if to_regclass('public.ops_compute_attestations') is null then
    raise exception 'DEVICE_FACTS_BASE_MIGRATION_REQUIRED' using errcode = '55000';
  end if;
  lock table public.ops_compute_attestations in access exclusive mode;
  if not (select relkind = 'r' and relrowsecurity from pg_class where oid = 'public.ops_compute_attestations'::regclass)
     or not has_table_privilege('service_role', 'public.ops_compute_attestations', 'SELECT')
     or not has_table_privilege('service_role', 'public.ops_compute_attestations', 'INSERT')
     or has_table_privilege('service_role', 'public.ops_compute_attestations', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_table_privilege('anon', 'public.ops_compute_attestations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_table_privilege('authenticated', 'public.ops_compute_attestations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or exists (select 1 from pg_policy where polrelid = 'public.ops_compute_attestations'::regclass) then
    raise exception 'DEVICE_FACTS_BASE_PERMISSIONS_MISMATCH' using errcode = '55000';
  end if;
  if (select array_agg(attname || ':' || format_type(atttypid, atttypmod) order by attnum)
      from pg_attribute where attrelid = 'public.ops_compute_attestations'::regclass
        and attnum > 0 and not attisdropped and attname <> 'device_facts')
     is distinct from array['lease_id:uuid','task_id:uuid','node_id:text','attempt:integer',
       'protocol:text','method:text','path:text','signed_at:text','nonce:text',
       'body_digest:text','signature:text','result_sha256:text','recorded_at:timestamp with time zone'] then
    raise exception 'DEVICE_FACTS_BASE_SHAPE_MISMATCH' using errcode = '55000';
  end if;
  select attnum into v_column from pg_attribute
    where attrelid = 'public.ops_compute_attestations'::regclass and attname = 'device_facts' and not attisdropped;
  if v_column is not null then
    select pg_get_expr(conbin, conrelid) into v_expression from pg_constraint
      where conrelid = 'public.ops_compute_attestations'::regclass
        and conname = 'ops_compute_attestations_device_facts_v1_check'
        and contype = 'c' and convalidated and not condeferrable and conkey = array[v_column];
    if not exists (select 1 from pg_attribute where attrelid = 'public.ops_compute_attestations'::regclass
        and attnum = v_column and atttypid = 'jsonb'::regtype and not attnotnull
        and not atthasdef and attgenerated = '' and attidentity = '')
       or col_description('public.ops_compute_attestations'::regclass, v_column) is distinct from v_marker
       or regexp_replace(v_expression, '\s+', '', 'g') is distinct from regexp_replace(v_expected, '\s+', '', 'g') then
      raise exception 'DEVICE_FACTS_EXISTING_COLUMN_MISMATCH' using errcode = '55000';
    end if;
    return;
  end if;
  alter table public.ops_compute_attestations add column device_facts jsonb
    constraint ops_compute_attestations_device_facts_v1_check check (
      device_facts is null or (jsonb_typeof(device_facts) = 'object' and octet_length(device_facts::text) <= 32768));
  comment on column public.ops_compute_attestations.device_facts is
    'compute_job_attestations_device_facts_v1; node-reported completion snapshot; 32768 UTF-8 bytes';
end
$migration$;
