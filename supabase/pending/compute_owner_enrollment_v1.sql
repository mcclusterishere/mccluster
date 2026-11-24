-- PENDING ONLY. Owner review, isolated SQL proof and explicit migration approval
-- are required before applying this to canonical Supabase. No ledger entry here.
-- Reuses ops_compute_nodes/tasks/leases. A secret is never stored: only SHA-256
-- of a 256-bit random enrollment credential, scoped to one owned device.
-- The migration runner owns the transaction. This lock serializes scheduler
-- migrations and their recovery scripts; it does not serialize ordinary jobs.
set local lock_timeout = '5s';
select pg_advisory_xact_lock(821,20261122);
do $enrollment_preflight$
declare expected record;actual record;function_oid oid;present_count integer:=0;
begin
  if to_regclass('public.orgs') is null or to_regclass('public.ops_compute_nodes') is null
    or to_regprocedure('public.compute_start_lease(text,uuid,text,integer)') is null
    or to_regprocedure('public.compute_heartbeat_lease(text,uuid,text,jsonb,integer)') is null
    or to_regprocedure('public.compute_complete_lease(text,uuid,text,jsonb)') is null then
    raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: canonical compute lease authority is required';
  end if;
  for expected in select * from (values
      ('compute_enroll_once','compute_enroll_once(text,jsonb)','97918135eb8ec6a39d432bd52b6fe5e06649a8c808671c1528ecb6bf3abe0e24','plpgsql',false,'public, extensions, pg_temp',array['p_credential_hash','p_node']::text[],0,'','jsonb')
    ) as signatures(name,signature,body_sha,language_name,is_definer,search_path,arg_names,default_count,default_sql,return_type) loop
    function_oid := to_regprocedure('public.'||expected.signature);
    if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=expected.name) > 1 then
      raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: unexpected overload '||expected.name;
    end if;
    if function_oid is null then continue; end if;
    select p.*,l.lanname into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=function_oid;
    if encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex') <> expected.body_sha
      or actual.lanname <> expected.language_name or actual.prosecdef is distinct from expected.is_definer
      or actual.proconfig is distinct from array['search_path='||expected.search_path]
      or coalesce(actual.proargnames,'{}'::text[]) is distinct from expected.arg_names
      or actual.pronargdefaults <> expected.default_count
      or coalesce(pg_get_expr(actual.proargdefaults,0),'') <> expected.default_sql
      or actual.prorettype <> expected.return_type::regtype or actual.proretset
      or actual.prokind <> 'f' or actual.proisstrict or actual.proleakproof
      or actual.provolatile <> 'v' or actual.proparallel <> 'u'
      or pg_get_userbyid(actual.proowner) <> 'postgres' then
      raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: reviewed function changed '||expected.signature;
    end if;
    present_count := present_count + 1;
  end loop;
  if (to_regclass('public.ops_compute_enrollments') is not null) is distinct from (present_count=1) then
    raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: partial enrollment schema';
  end if;
end $enrollment_preflight$;

create table if not exists public.ops_compute_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  issued_by uuid not null,
  display_name text not null check (length(display_name) between 1 and 80),
  platform text not null check (platform in ('darwin','win32','linux')),
  credential_hash text not null unique check (credential_hash ~ '^[a-f0-9]{64}$'),
  allowed_implementations jsonb not null default '["qwen3.8b.local","exo.mlx.local"]'::jsonb
    check (jsonb_typeof(allowed_implementations) = 'array' and jsonb_array_length(allowed_implementations) between 1 and 16),
  max_leases integer not null default 1 check (max_leases = 1),
  created_at timestamptz not null default now(),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  node_id text references public.ops_compute_nodes(id),
  check (expires_at > issued_at and expires_at <= issued_at + interval '10 minutes'),
  check ((consumed_at is null) = (node_id is null))
);
create index if not exists ops_compute_enrollments_pending_idx
  on public.ops_compute_enrollments(org_id, created_at desc) where consumed_at is null;
alter table public.ops_compute_enrollments enable row level security;
revoke all on public.ops_compute_enrollments from public, anon, authenticated;
grant select, insert, update on public.ops_compute_enrollments to service_role;

create or replace function public.compute_enroll_once(p_credential_hash text, p_node jsonb)
returns jsonb language plpgsql security invoker set search_path = public, extensions, pg_temp
as $$
declare
  v_enrollment public.ops_compute_enrollments%rowtype;
  v_existing public.ops_compute_nodes%rowtype;
  v_now timestamptz;
  v_cap jsonb;
  v_labels jsonb;
begin
  if p_credential_hash is null or p_credential_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_node) is distinct from 'object' then return null; end if;
  -- Row lock serializes two consumers and an owner reissue. Expiry is checked
  -- after acquiring the lock; waiting requests cannot revive expired authority.
  select * into v_enrollment from public.ops_compute_enrollments
    where credential_hash = p_credential_hash for update;
  v_now := clock_timestamp();
  if not found or v_enrollment.consumed_at is not null or v_enrollment.expires_at <= v_now then return null; end if;
  if p_node->>'org_id' is distinct from v_enrollment.org_id::text
    or p_node->'inventory'->>'platform' is distinct from v_enrollment.platform
    or p_node->>'protocol_version' is distinct from 'mccluster-compute/1'
    or p_node->>'max_leases' is distinct from '1'
    or p_node->>'id' is null or p_node->>'id' !~ '^node_[a-f0-9]{32}$'
    or p_node->>'key_fingerprint' is null or p_node->>'key_fingerprint' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_node->'capabilities') is distinct from 'array'
    or jsonb_typeof(p_node->'inventory') is distinct from 'object' then return null; end if;
  for v_cap in select value from jsonb_array_elements(p_node->'capabilities') loop
    if not coalesce(((v_cap->>'capability' = 'ai.chat' and v_cap->>'implementation' = 'qwen3.8b.local')
      or (v_cap->>'capability' = 'compute.pair.control' and v_cap->>'implementation' = 'exo.mlx.local')),false)
      or not coalesce((v_enrollment.allowed_implementations ? (v_cap->>'implementation')),false)
      or v_cap->>'max_concurrency' is distinct from '1' then return null; end if;
  end loop;
  -- A new enrollment is a new identity. Existing and revoked keys must not be
  -- rebound or revived using another enrollment credential.
  select * into v_existing from public.ops_compute_nodes where id = p_node->>'id' for update;
  if found then return null; end if;
  v_labels := jsonb_build_object('trust','owned','enrolled_trust','owned','role','device-worker',
    'enrollment_id',v_enrollment.id,'enrollment_scope',jsonb_build_object('implementations',v_enrollment.allowed_implementations,'max_leases',1));
  insert into public.ops_compute_nodes(id,org_id,display_name,public_key_pem,key_fingerprint,protocol_version,agent_version,state,inventory,capabilities,labels,max_leases,last_seen_at)
  values(p_node->>'id',v_enrollment.org_id,v_enrollment.display_name,p_node->>'public_key_pem',p_node->>'key_fingerprint',
    p_node->>'protocol_version',coalesce(p_node->>'agent_version','unknown'),'online',p_node->'inventory',p_node->'capabilities',v_labels,1,v_now);
  update public.ops_compute_enrollments set consumed_at=v_now,node_id=p_node->>'id' where id=v_enrollment.id;
  return jsonb_build_object('node_id',p_node->>'id','enrollment_id',v_enrollment.id);
end;
$$;
revoke all on function public.compute_enroll_once(text,jsonb) from public, anon, authenticated;
grant execute on function public.compute_enroll_once(text,jsonb) to service_role;
