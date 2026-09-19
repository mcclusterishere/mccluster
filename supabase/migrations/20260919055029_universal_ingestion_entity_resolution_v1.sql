-- McCluster Universal Ingestion + Entity Resolution v1
-- Gate 2 of the operational-intelligence finish line.
-- Existing source systems remain canonical. This layer records ingest provenance,
-- sync/replay state, fact claims, aliases, and resolution decisions.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.ops_ingest_connectors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  connector_key text not null check (connector_key ~ '^[a-z][a-z0-9_.:-]{0,119}$'),
  kind text not null check (kind in (
    'api','database','file','email','calendar','web','telemetry','event_stream','mcp','internal'
  )),
  display_name text not null,
  description text not null default '',
  config jsonb not null default '{}'::jsonb,
  cursor jsonb not null default '{}'::jsonb,
  retention_policy jsonb not null default '{}'::jsonb,
  license_policy jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  last_sync_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, connector_key),
  unique (id, org_id)
);
create index if not exists ops_ingest_connectors_kind_idx
  on public.ops_ingest_connectors(org_id, kind, enabled);

create table if not exists public.ops_ingest_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  connector_id uuid not null,
  trace_id uuid not null default gen_random_uuid(),
  mode text not null default 'incremental'
    check (mode in ('initial','incremental','replay','manual')),
  status text not null default 'running'
    check (status in ('running','succeeded','partial','failed')),
  cursor_before jsonb not null default '{}'::jsonb,
  cursor_after jsonb not null default '{}'::jsonb,
  records_seen integer not null default 0 check (records_seen >= 0),
  records_written integer not null default 0 check (records_written >= 0),
  records_rejected integer not null default 0 check (records_rejected >= 0),
  error text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (connector_id, org_id)
    references public.ops_ingest_connectors(id, org_id) on delete cascade
);
create index if not exists ops_ingest_runs_connector_idx
  on public.ops_ingest_runs(org_id, connector_id, started_at desc);
create index if not exists ops_ingest_runs_status_idx
  on public.ops_ingest_runs(org_id, status, started_at desc);

create table if not exists public.ops_ingest_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  connector_id uuid not null,
  run_id uuid references public.ops_ingest_runs(id) on delete set null,
  trace_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 1000),
  record_kind text not null check (char_length(record_kind) between 1 and 160),
  source_ref jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 1200),
  payload jsonb not null default '{}'::jsonb,
  retention_policy jsonb not null default '{}'::jsonb,
  license_policy jsonb not null default '{}'::jsonb,
  status text not null default 'accepted'
    check (status in ('accepted','rejected','superseded')),
  error text,
  created_at timestamptz not null default now(),
  foreign key (connector_id, org_id)
    references public.ops_ingest_connectors(id, org_id) on delete cascade,
  unique (org_id, connector_id, idempotency_key),
  unique (id, org_id)
);
create index if not exists ops_ingest_records_external_idx
  on public.ops_ingest_records(org_id, connector_id, external_id, observed_at desc);
create index if not exists ops_ingest_records_hash_idx
  on public.ops_ingest_records(org_id, content_hash);
create index if not exists ops_ingest_records_trace_idx
  on public.ops_ingest_records(org_id, trace_id, ingested_at);

create table if not exists public.ops_fact_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  subject_object_id uuid,
  predicate text not null check (predicate ~ '^[a-z][a-z0-9_.:-]{0,159}$'),
  value jsonb not null,
  value_hash text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  source_record_id uuid not null,
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  valid_from timestamptz,
  valid_to timestamptz,
  observed_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active','conflicting','retracted')),
  created_at timestamptz not null default now(),
  foreign key (subject_object_id, org_id)
    references public.ops_ontology_objects(id, org_id) on delete set null,
  foreign key (source_record_id, org_id)
    references public.ops_ingest_records(id, org_id) on delete cascade,
  unique (org_id, source_record_id, predicate, value_hash)
);
create index if not exists ops_fact_claims_subject_idx
  on public.ops_fact_claims(org_id, subject_object_id, predicate, observed_at desc);
create index if not exists ops_fact_claims_predicate_idx
  on public.ops_fact_claims(org_id, predicate, observed_at desc);

create table if not exists public.ops_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  namespace text not null check (namespace ~ '^[a-z][a-z0-9_.:-]{0,119}$'),
  alias_key text not null check (char_length(alias_key) between 1 and 1000),
  object_id uuid not null,
  source_record_id uuid,
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  status text not null default 'candidate'
    check (status in ('candidate','resolved','rejected')),
  resolution_method text not null default 'manual'
    check (resolution_method in ('deterministic','rule','model','manual')),
  rationale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (object_id, org_id)
    references public.ops_ontology_objects(id, org_id) on delete cascade,
  foreign key (source_record_id, org_id)
    references public.ops_ingest_records(id, org_id) on delete set null
);
create index if not exists ops_entity_aliases_lookup_idx
  on public.ops_entity_aliases(org_id, namespace, alias_key, status);
create unique index if not exists ops_entity_aliases_resolved_idx
  on public.ops_entity_aliases(org_id, namespace, alias_key)
  where status='resolved';

create table if not exists public.ops_entity_resolution_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  namespace text not null,
  alias_key text not null,
  candidate_object_id uuid,
  selected_object_id uuid,
  source_record_id uuid,
  decision text not null check (decision in ('candidate','resolve','reject','reassign')),
  method text not null check (method in ('deterministic','rule','model','manual')),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  rationale text,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'system'
    check (actor_kind in ('owner','agent','system','service')),
  at timestamptz not null default now(),
  foreign key (candidate_object_id, org_id)
    references public.ops_ontology_objects(id, org_id) on delete set null,
  foreign key (selected_object_id, org_id)
    references public.ops_ontology_objects(id, org_id) on delete set null,
  foreign key (source_record_id, org_id)
    references public.ops_ingest_records(id, org_id) on delete set null
);
create index if not exists ops_entity_resolution_events_alias_idx
  on public.ops_entity_resolution_events(org_id, namespace, alias_key, at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'ops_ingest_connectors','ops_ingest_runs','ops_ingest_records',
    'ops_fact_claims','ops_entity_aliases','ops_entity_resolution_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- Clean-replay compatibility: production already had ops_repo_events from the
-- historical outreach/autopilot layer, while earlier Git history did not
-- reproduce that table. Preserve the exact live source contract before
-- attaching the repository-event ingest adapter.
create table if not exists public.ops_repo_events (
  id bigint generated by default as identity primary key,
  org_id uuid not null,
  repo text not null,
  ref text,
  commit_sha text,
  event_type text not null,
  paths jsonb not null default '[]'::jsonb,
  test_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);
create index if not exists ops_repo_events_repo_observed_idx
  on public.ops_repo_events(repo, observed_at desc);
alter table public.ops_repo_events enable row level security;
revoke all on table public.ops_repo_events from public, anon, authenticated;
grant all on table public.ops_repo_events to service_role;

create or replace function private.ops_ingest_ensure_connector(
  p_org uuid,
  p_connector_key text,
  p_kind text,
  p_display_name text,
  p_description text default '',
  p_retention jsonb default '{}'::jsonb,
  p_license jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare v_id uuid;
begin
  insert into public.ops_ingest_connectors(
    org_id,connector_key,kind,display_name,description,retention_policy,license_policy
  ) values (
    p_org,p_connector_key,p_kind,p_display_name,coalesce(p_description,''),
    coalesce(p_retention,'{}'::jsonb),coalesce(p_license,'{}'::jsonb)
  )
  on conflict (org_id,connector_key) do update set
    kind=excluded.kind,
    display_name=excluded.display_name,
    description=excluded.description,
    retention_policy=excluded.retention_policy,
    license_policy=excluded.license_policy,
    updated_at=now()
  returning id into v_id;
  return v_id;
end
$$;

create or replace function private.ops_ingest_upsert_record(
  p_org uuid,
  p_connector_key text,
  p_connector_kind text,
  p_connector_name text,
  p_external_id text,
  p_record_kind text,
  p_source_ref jsonb,
  p_observed_at timestamptz,
  p_payload jsonb,
  p_trace_id uuid default null,
  p_run_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path='public','extensions','pg_temp'
as $$
declare
  v_connector uuid;
  v_payload jsonb := coalesce(p_payload,'{}'::jsonb);
  v_hash text;
  v_key text;
  v_id uuid;
  v_trace uuid := coalesce(p_trace_id,gen_random_uuid());
  v_retention jsonb;
  v_license jsonb;
begin
  v_connector := private.ops_ingest_ensure_connector(
    p_org,p_connector_key,p_connector_kind,p_connector_name,
    'Canonical McCluster source adapter', '{}'::jsonb, '{}'::jsonb
  );
  select retention_policy,license_policy into v_retention,v_license
  from public.ops_ingest_connectors where id=v_connector;

  v_hash := encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex');
  v_key := p_external_id || ':' || v_hash;

  insert into public.ops_ingest_records(
    org_id,connector_id,run_id,trace_id,external_id,record_kind,source_ref,
    observed_at,content_hash,idempotency_key,payload,retention_policy,license_policy
  ) values (
    p_org,v_connector,p_run_id,v_trace,p_external_id,p_record_kind,
    coalesce(p_source_ref,'{}'::jsonb),coalesce(p_observed_at,now()),
    v_hash,v_key,v_payload,coalesce(v_retention,'{}'::jsonb),coalesce(v_license,'{}'::jsonb)
  )
  on conflict (org_id,connector_id,idempotency_key) do update set
    trace_id=excluded.trace_id,
    source_ref=excluded.source_ref,
    observed_at=excluded.observed_at,
    ingested_at=now(),
    payload=excluded.payload,
    status='accepted',
    error=null
  returning id into v_id;

  return v_id;
end
$$;

create or replace function private.ops_ingest_fabric_event()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
begin
  perform private.ops_ingest_upsert_record(
    new.org_id,'fabric.events','event_stream','McCluster Fabric events',
    new.event_id::text,new.kind,
    jsonb_build_object('table','fabric_events','pk',new.event_id::text,'origin_node',new.origin_node),
    new.occurred_at,to_jsonb(new),new.trace_id,null
  );
  return new;
end $$;

create or replace function private.ops_ingest_kb_document()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
begin
  perform private.ops_ingest_upsert_record(
    new.org_id,'knowledge.documents','file','Knowledge documents',
    new.id::text,coalesce(new.kind,'document'),
    jsonb_build_object('table','kb_documents','pk',new.id::text,'url',new.url,'source',new.source),
    new.updated_at,to_jsonb(new),null,null
  );
  return new;
end $$;

create or replace function private.ops_ingest_inbox_message()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
begin
  perform private.ops_ingest_upsert_record(
    new.org_id,'communications.inbox','email','Inbox messages',
    new.id::text,'message',
    jsonb_build_object('table','inbox_messages','pk',new.id::text,'conversation_id',new.conv_id::text,'external_id',new.external_id),
    new.at,to_jsonb(new),null,null
  );
  return new;
end $$;

create or replace function private.ops_ingest_repo_event()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
begin
  perform private.ops_ingest_upsert_record(
    new.org_id,'repositories.events','event_stream','Repository events',
    new.id::text,new.event_type,
    jsonb_build_object('table','ops_repo_events','pk',new.id::text,'repo',new.repo,'commit_sha',new.commit_sha),
    new.observed_at,to_jsonb(new),null,null
  );
  return new;
end $$;

drop trigger if exists ops_ingest_fabric_event_t on public.fabric_events;
create trigger ops_ingest_fabric_event_t after insert or update on public.fabric_events
for each row execute function private.ops_ingest_fabric_event();

drop trigger if exists ops_ingest_kb_document_t on public.kb_documents;
create trigger ops_ingest_kb_document_t after insert or update on public.kb_documents
for each row execute function private.ops_ingest_kb_document();

drop trigger if exists ops_ingest_inbox_message_t on public.inbox_messages;
create trigger ops_ingest_inbox_message_t after insert or update on public.inbox_messages
for each row execute function private.ops_ingest_inbox_message();

drop trigger if exists ops_ingest_repo_event_t on public.ops_repo_events;
create trigger ops_ingest_repo_event_t after insert or update on public.ops_repo_events
for each row execute function private.ops_ingest_repo_event();

create or replace function public.ops_ingest_connectors_service(p_org uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'connectors',coalesce(jsonb_agg(to_jsonb(c) order by c.connector_key),'[]'::jsonb)
  )
  from public.ops_ingest_connectors c where c.org_id=p_org;
$$;

create or replace function public.ops_ingest_records_service(
  p_org uuid, p_connector_key text default null, p_status text default null, p_limit integer default 100
)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'records',coalesce(jsonb_agg(to_jsonb(x) order by x.ingested_at desc),'[]'::jsonb)
  )
  from (
    select r.*
    from public.ops_ingest_records r
    join public.ops_ingest_connectors c on c.id=r.connector_id and c.org_id=r.org_id
    where r.org_id=p_org
      and (p_connector_key is null or c.connector_key=p_connector_key)
      and (p_status is null or r.status=p_status)
    order by r.ingested_at desc
    limit greatest(1,least(coalesce(p_limit,100),500))
  ) x;
$$;

create or replace function public.ops_ingest_begin_run_service(
  p_org uuid, p_connector_key text, p_mode text default 'incremental', p_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_connector public.ops_ingest_connectors; v_run public.ops_ingest_runs;
begin
  select * into v_connector from public.ops_ingest_connectors
  where org_id=p_org and connector_key=p_connector_key and enabled;
  if v_connector.id is null then raise exception 'unknown or disabled ingest connector'; end if;

  insert into public.ops_ingest_runs(org_id,connector_id,mode,cursor_before,metadata)
  values (
    p_org,v_connector.id,
    case when p_mode in ('initial','incremental','replay','manual') then p_mode else 'incremental' end,
    v_connector.cursor,coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v_run;
  return to_jsonb(v_run);
end $$;

create or replace function public.ops_ingest_write_record_service(
  p_org uuid, p_run_id uuid, p_external_id text, p_record_kind text,
  p_source_ref jsonb, p_observed_at timestamptz, p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_run public.ops_ingest_runs; v_connector public.ops_ingest_connectors; v_id uuid;
begin
  select * into v_run from public.ops_ingest_runs
  where id=p_run_id and org_id=p_org and status in ('running','partial');
  if v_run.id is null then raise exception 'active ingest run not found'; end if;

  select * into v_connector from public.ops_ingest_connectors
  where id=v_run.connector_id and org_id=p_org and enabled;
  if v_connector.id is null then raise exception 'ingest connector not found'; end if;

  v_id := private.ops_ingest_upsert_record(
    p_org,v_connector.connector_key,v_connector.kind,v_connector.display_name,
    p_external_id,p_record_kind,p_source_ref,p_observed_at,p_payload,v_run.trace_id,v_run.id
  );
  update public.ops_ingest_runs
    set records_seen=records_seen+1,records_written=records_written+1
  where id=v_run.id;
  return jsonb_build_object('record_id',v_id,'trace_id',v_run.trace_id);
exception when others then
  if v_run.id is not null then
    update public.ops_ingest_runs
      set records_seen=records_seen+1,records_rejected=records_rejected+1,
          status='partial',error=left(sqlerrm,4000)
    where id=v_run.id;
  end if;
  raise;
end $$;

create or replace function public.ops_ingest_finish_run_service(
  p_org uuid, p_run_id uuid, p_status text,
  p_cursor_after jsonb default '{}'::jsonb, p_error text default null
)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_run public.ops_ingest_runs;
begin
  update public.ops_ingest_runs
  set status=case when p_status in ('succeeded','partial','failed') then p_status else 'failed' end,
      cursor_after=coalesce(p_cursor_after,'{}'::jsonb),
      error=left(p_error,4000),finished_at=now()
  where id=p_run_id and org_id=p_org and status in ('running','partial')
  returning * into v_run;
  if v_run.id is null then raise exception 'unfinished ingest run not found'; end if;

  update public.ops_ingest_connectors
  set cursor=case when v_run.status in ('succeeded','partial') then v_run.cursor_after else cursor end,
      last_sync_at=now(),
      last_ok_at=case when v_run.status='succeeded' then now() else last_ok_at end,
      last_error=case when v_run.status='failed' then v_run.error else null end,
      last_error_at=case when v_run.status='failed' then now() else null end,
      updated_at=now()
  where id=v_run.connector_id and org_id=p_org;
  return to_jsonb(v_run);
end $$;

create or replace function public.ops_entity_aliases_service(
  p_org uuid, p_namespace text default null, p_alias_key text default null, p_limit integer default 100
)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'aliases',coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc),'[]'::jsonb)
  )
  from (
    select a.* from public.ops_entity_aliases a
    where a.org_id=p_org
      and (p_namespace is null or a.namespace=p_namespace)
      and (p_alias_key is null or a.alias_key=p_alias_key)
    order by a.updated_at desc
    limit greatest(1,least(coalesce(p_limit,100),500))
  ) x;
$$;

create or replace function public.ops_entity_resolve_service(
  p_org uuid, p_namespace text, p_alias_key text, p_object_id uuid,
  p_source_record_id uuid default null, p_confidence numeric default null,
  p_method text default 'manual', p_rationale text default null,
  p_actor_user uuid default null, p_actor_kind text default 'owner'
)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_alias public.ops_entity_aliases;
begin
  if p_actor_user is null then raise exception 'actor_user is required'; end if;
  if not exists (
    select 1 from public.org_members where org_id=p_org and profile_id=p_actor_user and role='owner'
  ) then raise exception 'owner permission required'; end if;
  if not exists (
    select 1 from public.ops_ontology_objects where id=p_object_id and org_id=p_org
  ) then raise exception 'ontology object not found'; end if;

  update public.ops_entity_aliases
    set status='rejected',updated_at=now(),
        rationale=coalesce(rationale,'Superseded by explicit owner resolution')
  where org_id=p_org and namespace=p_namespace and alias_key=p_alias_key
    and status='resolved' and object_id<>p_object_id;

  insert into public.ops_entity_aliases(
    org_id,namespace,alias_key,object_id,source_record_id,confidence,status,resolution_method,rationale
  ) values (
    p_org,p_namespace,p_alias_key,p_object_id,p_source_record_id,p_confidence,'resolved',
    case when p_method in ('deterministic','rule','model','manual') then p_method else 'manual' end,
    p_rationale
  )
  on conflict (org_id,namespace,alias_key) where status='resolved'
  do update set
    object_id=excluded.object_id,source_record_id=excluded.source_record_id,
    confidence=excluded.confidence,resolution_method=excluded.resolution_method,
    rationale=excluded.rationale,updated_at=now()
  returning * into v_alias;

  insert into public.ops_entity_resolution_events(
    org_id,namespace,alias_key,candidate_object_id,selected_object_id,source_record_id,
    decision,method,confidence,rationale,actor_user_id,actor_kind
  ) values (
    p_org,p_namespace,p_alias_key,p_object_id,p_object_id,p_source_record_id,
    'resolve',v_alias.resolution_method,p_confidence,p_rationale,p_actor_user,
    case when p_actor_kind in ('owner','agent','system','service') then p_actor_kind else 'owner' end
  );
  return to_jsonb(v_alias);
end $$;

create or replace function public.ops_fact_claim_service(
  p_org uuid, p_subject_object_id uuid, p_predicate text, p_value jsonb,
  p_source_record_id uuid, p_confidence numeric default null,
  p_valid_from timestamptz default null, p_valid_to timestamptz default null
)
returns jsonb language plpgsql security definer set search_path='public','extensions','pg_temp' as $$
declare v_hash text; v_claim public.ops_fact_claims;
begin
  if not exists (
    select 1 from public.ops_ontology_objects where id=p_subject_object_id and org_id=p_org
  ) then raise exception 'ontology subject not found'; end if;
  if not exists (
    select 1 from public.ops_ingest_records where id=p_source_record_id and org_id=p_org
  ) then raise exception 'source ingest record not found'; end if;

  v_hash := encode(extensions.digest(convert_to(coalesce(p_value,'null'::jsonb)::text,'UTF8'),'sha256'),'hex');

  if exists (
    select 1 from public.ops_fact_claims
    where org_id=p_org and subject_object_id=p_subject_object_id
      and predicate=p_predicate and status in ('active','conflicting') and value_hash<>v_hash
  ) then
    update public.ops_fact_claims set status='conflicting'
    where org_id=p_org and subject_object_id=p_subject_object_id
      and predicate=p_predicate and status='active';
  end if;

  insert into public.ops_fact_claims(
    org_id,subject_object_id,predicate,value,value_hash,source_record_id,
    confidence,valid_from,valid_to,observed_at,status
  )
  select p_org,p_subject_object_id,p_predicate,p_value,v_hash,p_source_record_id,
         p_confidence,p_valid_from,p_valid_to,r.observed_at,
         case when exists (
           select 1 from public.ops_fact_claims c
           where c.org_id=p_org and c.subject_object_id=p_subject_object_id
             and c.predicate=p_predicate and c.status='conflicting'
         ) then 'conflicting' else 'active' end
  from public.ops_ingest_records r where r.id=p_source_record_id and r.org_id=p_org
  on conflict (org_id,source_record_id,predicate,value_hash) do update set
    confidence=excluded.confidence,valid_from=excluded.valid_from,valid_to=excluded.valid_to
  returning * into v_claim;
  return to_jsonb(v_claim);
end $$;

create or replace function public.ops_fact_claims_service(
  p_org uuid, p_subject_object_id uuid default null, p_predicate text default null, p_limit integer default 100
)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'claims',coalesce(jsonb_agg(to_jsonb(x) order by x.observed_at desc),'[]'::jsonb)
  )
  from (
    select c.* from public.ops_fact_claims c
    where c.org_id=p_org
      and (p_subject_object_id is null or c.subject_object_id=p_subject_object_id)
      and (p_predicate is null or c.predicate=p_predicate)
    order by c.observed_at desc
    limit greatest(1,least(coalesce(p_limit,100),500))
  ) x;
$$;

revoke all on function private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function private.ops_ingest_upsert_record(uuid,text,text,text,text,text,jsonb,timestamptz,jsonb,uuid,uuid) from public, anon, authenticated;
revoke all on function private.ops_ingest_fabric_event() from public, anon, authenticated;
revoke all on function private.ops_ingest_kb_document() from public, anon, authenticated;
revoke all on function private.ops_ingest_inbox_message() from public, anon, authenticated;
revoke all on function private.ops_ingest_repo_event() from public, anon, authenticated;

revoke all on function public.ops_ingest_connectors_service(uuid) from public, anon, authenticated;
revoke all on function public.ops_ingest_records_service(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.ops_ingest_begin_run_service(uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.ops_ingest_write_record_service(uuid,uuid,text,text,jsonb,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.ops_ingest_finish_run_service(uuid,uuid,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.ops_entity_aliases_service(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.ops_entity_resolve_service(uuid,text,text,uuid,uuid,numeric,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.ops_fact_claim_service(uuid,uuid,text,jsonb,uuid,numeric,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.ops_fact_claims_service(uuid,uuid,text,integer) from public, anon, authenticated;

grant execute on function public.ops_ingest_connectors_service(uuid) to service_role;
grant execute on function public.ops_ingest_records_service(uuid,text,text,integer) to service_role;
grant execute on function public.ops_ingest_begin_run_service(uuid,text,text,jsonb) to service_role;
grant execute on function public.ops_ingest_write_record_service(uuid,uuid,text,text,jsonb,timestamptz,jsonb) to service_role;
grant execute on function public.ops_ingest_finish_run_service(uuid,uuid,text,jsonb,text) to service_role;
grant execute on function public.ops_entity_aliases_service(uuid,text,text,integer) to service_role;
grant execute on function public.ops_entity_resolve_service(uuid,text,text,uuid,uuid,numeric,text,text,uuid,text) to service_role;
grant execute on function public.ops_fact_claim_service(uuid,uuid,text,jsonb,uuid,numeric,timestamptz,timestamptz) to service_role;
grant execute on function public.ops_fact_claims_service(uuid,uuid,text,integer) to service_role;

insert into public.control_capabilities(capability,description,risk)
values
  ('ingest.read','Read connector, ingest, claim, and resolution state','low'),
  ('ingest.write','Write through the governed universal ingestion contract','medium'),
  ('entity.resolve','Resolve an external alias to a governed ontology object','medium')
on conflict (capability) do update set description=excluded.description,risk=excluded.risk;

insert into public.control_role_capabilities(role,capability,allowed)
values
  ('admin','ingest.read',true),('admin','ingest.write',true),('admin','entity.resolve',true),
  ('owner','ingest.read',true),('owner','ingest.write',true),('owner','entity.resolve',true),
  ('staff','ingest.read',true),('member','ingest.read',true)
on conflict (role,capability) do update set allowed=excluded.allowed;

do $$
declare r record;
begin
  for r in select id from public.orgs loop
    perform private.ops_ingest_ensure_connector(r.id,'fabric.events','event_stream','McCluster Fabric events',
      'Canonical cross-node event fabric','{"mode":"organization-policy"}'::jsonb,'{"basis":"first-party"}'::jsonb);
    perform private.ops_ingest_ensure_connector(r.id,'knowledge.documents','file','Knowledge documents',
      'Canonical knowledge-base documents','{"mode":"organization-policy"}'::jsonb,'{"basis":"source-specific"}'::jsonb);
    perform private.ops_ingest_ensure_connector(r.id,'communications.inbox','email','Inbox messages',
      'Canonical unified inbox messages','{"mode":"organization-policy"}'::jsonb,'{"basis":"communication-channel"}'::jsonb);
    perform private.ops_ingest_ensure_connector(r.id,'repositories.events','event_stream','Repository events',
      'Canonical repository event observations','{"mode":"organization-policy"}'::jsonb,'{"basis":"first-party"}'::jsonb);
  end loop;

  for r in select * from public.fabric_events loop
    perform private.ops_ingest_upsert_record(
      r.org_id,'fabric.events','event_stream','McCluster Fabric events',r.event_id::text,r.kind,
      jsonb_build_object('table','fabric_events','pk',r.event_id::text,'origin_node',r.origin_node),
      r.occurred_at,to_jsonb(r),r.trace_id,null
    );
  end loop;
  for r in select * from public.kb_documents loop
    perform private.ops_ingest_upsert_record(
      r.org_id,'knowledge.documents','file','Knowledge documents',r.id::text,coalesce(r.kind,'document'),
      jsonb_build_object('table','kb_documents','pk',r.id::text,'url',r.url,'source',r.source),
      r.updated_at,to_jsonb(r),null,null
    );
  end loop;
  for r in select * from public.inbox_messages loop
    perform private.ops_ingest_upsert_record(
      r.org_id,'communications.inbox','email','Inbox messages',r.id::text,'message',
      jsonb_build_object('table','inbox_messages','pk',r.id::text,'conversation_id',r.conv_id::text,'external_id',r.external_id),
      r.at,to_jsonb(r),null,null
    );
  end loop;
  for r in select * from public.ops_repo_events loop
    perform private.ops_ingest_upsert_record(
      r.org_id,'repositories.events','event_stream','Repository events',r.id::text,r.event_type,
      jsonb_build_object('table','ops_repo_events','pk',r.id::text,'repo',r.repo,'commit_sha',r.commit_sha),
      r.observed_at,to_jsonb(r),null,null
    );
  end loop;
end $$;

comment on table public.ops_ingest_connectors is
  'Universal connector contract for APIs, databases, files, email, calendar, web, telemetry, event streams, MCP and internal sources. Secrets stay outside config.';
comment on table public.ops_ingest_records is
  'Content-addressed, idempotent source records preserving provenance, policy snapshots, source identity and trace ids.';
comment on table public.ops_fact_claims is
  'Provenance-preserving fact claims. Conflicting values coexist instead of silently overwriting one another.';
comment on table public.ops_entity_aliases is
  'External aliases mapped to ontology objects without deleting source provenance.';
