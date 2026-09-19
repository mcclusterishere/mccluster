-- McCluster Operational Ontology v1
-- A governed semantic/operational layer over the existing canonical Supabase
-- control plane. This does NOT introduce a second scheduler, database, memory
-- store, or identity system. It materializes selected canonical records into
-- objects + links, preserves source provenance, and exposes bounded actions.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.ops_ontology_types (
  org_id uuid not null references public.orgs(id) on delete cascade,
  type_key text not null check (type_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  display_name text not null,
  description text not null default '',
  property_schema jsonb not null default '{}'::jsonb,
  source_binding jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, type_key)
);

create table if not exists public.ops_ontology_objects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  type_key text not null,
  object_key text not null check (char_length(object_key) between 1 and 500),
  display_name text not null default '',
  properties jsonb not null default '{}'::jsonb,
  source_ref jsonb not null default '{}'::jsonb,
  observed_at timestamptz,
  valid_from timestamptz,
  valid_to timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, type_key)
    references public.ops_ontology_types(org_id, type_key)
    on delete restrict,
  unique (org_id, type_key, object_key),
  unique (id, org_id)
);
create index if not exists ops_ontology_objects_type_updated_idx
  on public.ops_ontology_objects(org_id, type_key, updated_at desc);
create index if not exists ops_ontology_objects_key_idx
  on public.ops_ontology_objects(org_id, object_key);

create table if not exists public.ops_ontology_link_types (
  org_id uuid not null references public.orgs(id) on delete cascade,
  link_key text not null check (link_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  display_name text not null,
  description text not null default '',
  source_type_key text not null,
  target_type_key text not null,
  directed boolean not null default true,
  property_schema jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, link_key),
  foreign key (org_id, source_type_key)
    references public.ops_ontology_types(org_id, type_key)
    on delete restrict,
  foreign key (org_id, target_type_key)
    references public.ops_ontology_types(org_id, type_key)
    on delete restrict
);

create table if not exists public.ops_ontology_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  link_key text not null,
  source_object_id uuid not null,
  target_object_id uuid not null,
  properties jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  source_ref jsonb not null default '{}'::jsonb,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, link_key)
    references public.ops_ontology_link_types(org_id, link_key)
    on delete restrict,
  foreign key (source_object_id, org_id)
    references public.ops_ontology_objects(id, org_id)
    on delete cascade,
  foreign key (target_object_id, org_id)
    references public.ops_ontology_objects(id, org_id)
    on delete cascade,
  check (source_object_id <> target_object_id),
  unique (org_id, link_key, source_object_id, target_object_id),
  unique (id, org_id)
);
create index if not exists ops_ontology_links_source_idx
  on public.ops_ontology_links(org_id, source_object_id, link_key);
create index if not exists ops_ontology_links_target_idx
  on public.ops_ontology_links(org_id, target_object_id, link_key);

create table if not exists public.ops_ontology_action_types (
  org_id uuid not null references public.orgs(id) on delete cascade,
  action_key text not null check (action_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  display_name text not null,
  description text not null default '',
  target_type_key text,
  input_schema jsonb not null default '{}'::jsonb,
  effect jsonb not null default '{}'::jsonb,
  risk text not null default 'write'
    check (risk in ('read','write','spend','external')),
  approval_mode text not null default 'owner'
    check (approval_mode in ('none','owner','review','budget')),
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, action_key),
  foreign key (org_id, target_type_key)
    references public.ops_ontology_types(org_id, type_key)
    on delete restrict
);

create table if not exists public.ops_ontology_action_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  action_key text not null,
  target_object_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'owner'
    check (actor_kind in ('owner','agent','system','service')),
  parameters jsonb not null default '{}'::jsonb,
  request_hash text not null,
  idempotency_key text,
  approval_id uuid references public.control_approvals(id) on delete set null,
  status text not null default 'requested'
    check (status in ('requested','running','succeeded','failed','rejected')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  foreign key (org_id, action_key)
    references public.ops_ontology_action_types(org_id, action_key)
    on delete restrict,
  foreign key (target_object_id)
    references public.ops_ontology_objects(id)
    on delete set null
);
create unique index if not exists ops_ontology_action_runs_idempotency_idx
  on public.ops_ontology_action_runs(org_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists ops_ontology_action_runs_created_idx
  on public.ops_ontology_action_runs(org_id, created_at desc);

create table if not exists public.ops_ontology_lineage (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_type text not null,
  subject_type text not null,
  subject_key text not null,
  object_id uuid references public.ops_ontology_objects(id) on delete set null,
  link_id uuid references public.ops_ontology_links(id) on delete set null,
  action_run_id uuid references public.ops_ontology_action_runs(id) on delete set null,
  source_ref jsonb not null default '{}'::jsonb,
  before_state jsonb,
  after_state jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'system',
  at timestamptz not null default now()
);
create index if not exists ops_ontology_lineage_subject_idx
  on public.ops_ontology_lineage(org_id, subject_type, subject_key, at desc);
create index if not exists ops_ontology_lineage_object_idx
  on public.ops_ontology_lineage(org_id, object_id, at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'ops_ontology_types',
    'ops_ontology_objects',
    'ops_ontology_link_types',
    'ops_ontology_links',
    'ops_ontology_action_types',
    'ops_ontology_action_runs',
    'ops_ontology_lineage'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

create or replace function private.ops_ontology_ensure_base_types(p_org uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
begin
  insert into public.ops_ontology_types(
    org_id,type_key,display_name,description,property_schema,source_binding
  )
  values
    (p_org,'organization','Organization','A McCluster tenant or operating organization',
      '{"type":"object"}'::jsonb,'{"table":"orgs","id":"id"}'::jsonb),
    (p_org,'objective','Objective','A durable McCluster objective',
      '{"type":"object","properties":{"status":{"type":"string"},"priority":{"type":"integer"}}}'::jsonb,
      '{"table":"ops_objectives","id":"id"}'::jsonb),
    (p_org,'agent_job','Agent job','A durable McCluster Core job',
      '{"type":"object","properties":{"status":{"type":"string"},"priority":{"type":"integer"},"job_type":{"type":"string"}}}'::jsonb,
      '{"table":"ops_agent_jobs","id":"id"}'::jsonb),
    (p_org,'application','Application','A registered McCluster application',
      '{"type":"object","properties":{"app_key":{"type":"string"},"enabled":{"type":"boolean"}}}'::jsonb,
      '{"table":"platform_apps","id":"id","scope":"house"}'::jsonb)
  on conflict (org_id,type_key) do nothing;

  insert into public.ops_ontology_link_types(
    org_id,link_key,display_name,description,source_type_key,target_type_key
  )
  values
    (p_org,'objective_has_job','Objective has job','Connects an objective to jobs executed on its behalf','objective','agent_job')
  on conflict (org_id,link_key) do nothing;

  insert into public.ops_ontology_action_types(
    org_id,action_key,display_name,description,target_type_key,input_schema,effect,risk,approval_mode
  )
  values
    (p_org,'object_annotate','Annotate object','Merge owner-controlled annotations without overwriting source-backed fields',null,
      '{"type":"object","required":["annotations"],"properties":{"annotations":{"type":"object"}}}'::jsonb,
      '{"kind":"annotate"}'::jsonb,'write','owner'),
    (p_org,'object_tag','Tag object','Replace the bounded owner-controlled tag set on an object',null,
      '{"type":"object","required":["tags"],"properties":{"tags":{"type":"array","items":{"type":"string"}}}}'::jsonb,
      '{"kind":"tag"}'::jsonb,'write','owner'),
    (p_org,'object_link','Link objects','Create or update a governed ontology link between compatible objects',null,
      '{"type":"object","required":["target_object_id","link_key"],"properties":{"target_object_id":{"type":"string"},"link_key":{"type":"string"},"properties":{"type":"object"}}}'::jsonb,
      '{"kind":"link"}'::jsonb,'write','owner')
  on conflict (org_id,action_key) do nothing;
end
$$;

create or replace function private.ops_ontology_upsert_source_object(
  p_org uuid,
  p_type_key text,
  p_object_key text,
  p_display_name text,
  p_properties jsonb,
  p_source_ref jsonb,
  p_observed_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_preserved jsonb := '{}'::jsonb;
begin
  perform private.ops_ontology_ensure_base_types(p_org);

  select to_jsonb(o),
         jsonb_strip_nulls(jsonb_build_object(
           '_annotations', o.properties->'_annotations',
           '_tags', o.properties->'_tags'
         ))
    into v_before, v_preserved
  from public.ops_ontology_objects o
  where o.org_id=p_org and o.type_key=p_type_key and o.object_key=p_object_key;

  insert into public.ops_ontology_objects(
    org_id,type_key,object_key,display_name,properties,source_ref,observed_at
  ) values (
    p_org,p_type_key,p_object_key,coalesce(p_display_name,''),
    coalesce(p_properties,'{}'::jsonb) || coalesce(v_preserved,'{}'::jsonb),
    coalesce(p_source_ref,'{}'::jsonb),p_observed_at
  )
  on conflict (org_id,type_key,object_key) do update set
    display_name=excluded.display_name,
    properties=excluded.properties,
    source_ref=excluded.source_ref,
    observed_at=excluded.observed_at,
    version=public.ops_ontology_objects.version+1,
    updated_at=now()
  returning id into v_id;

  select to_jsonb(o) into v_after
  from public.ops_ontology_objects o where o.id=v_id;

  insert into public.ops_ontology_lineage(
    org_id,event_type,subject_type,subject_key,object_id,source_ref,before_state,after_state,actor_kind
  ) values (
    p_org,case when v_before is null then 'object.materialized' else 'object.synced' end,
    p_type_key,p_object_key,v_id,coalesce(p_source_ref,'{}'::jsonb),v_before,v_after,'system'
  );

  return v_id;
end
$$;

create or replace function private.ops_ontology_delete_source_object(
  p_org uuid,
  p_type_key text,
  p_object_key text,
  p_source_ref jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_id uuid;
  v_before jsonb;
begin
  select id,to_jsonb(o) into v_id,v_before
  from public.ops_ontology_objects o
  where o.org_id=p_org and o.type_key=p_type_key and o.object_key=p_object_key;

  if v_id is null then return; end if;

  insert into public.ops_ontology_lineage(
    org_id,event_type,subject_type,subject_key,object_id,source_ref,before_state,actor_kind
  ) values (
    p_org,'object.source_deleted',p_type_key,p_object_key,v_id,
    coalesce(p_source_ref,'{}'::jsonb),v_before,'system'
  );

  delete from public.ops_ontology_objects where id=v_id;
end
$$;

create or replace function private.ops_ontology_sync_org()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
begin
  if tg_op='DELETE' then return old; end if;
  perform private.ops_ontology_ensure_base_types(new.id);
  perform private.ops_ontology_upsert_source_object(
    new.id,'organization',new.id::text,new.name,
    jsonb_build_object(
      'slug',new.slug,'name',new.name,'kind',new.kind,'enabled',new.enabled,
      'settings',new.settings,'created_at',new.created_at
    ),
    jsonb_build_object('table','orgs','pk',new.id::text),
    now()
  );
  return new;
end
$$;

drop trigger if exists ops_ontology_sync_org_t on public.orgs;
create trigger ops_ontology_sync_org_t
after insert or update on public.orgs
for each row execute function private.ops_ontology_sync_org();

create or replace function private.ops_ontology_sync_objective()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
begin
  if tg_op='DELETE' then
    perform private.ops_ontology_delete_source_object(
      old.org_id,'objective',old.id::text,
      jsonb_build_object('table','ops_objectives','pk',old.id::text)
    );
    return old;
  end if;

  perform private.ops_ontology_upsert_source_object(
    new.org_id,'objective',new.id::text,new.name,
    jsonb_build_object(
      'name',new.name,'description',new.description,'status',new.status,
      'priority',new.priority,'success_metric',new.success_metric,'scope',new.scope,
      'created_at',new.created_at,'updated_at',new.updated_at
    ),
    jsonb_build_object('table','ops_objectives','pk',new.id::text),
    new.updated_at
  );
  return new;
end
$$;

drop trigger if exists ops_ontology_sync_objective_t on public.ops_objectives;
create trigger ops_ontology_sync_objective_t
after insert or update or delete on public.ops_objectives
for each row execute function private.ops_ontology_sync_objective();

create or replace function private.ops_ontology_sync_job()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_job uuid;
  v_objective uuid;
begin
  if tg_op='DELETE' then
    perform private.ops_ontology_delete_source_object(
      old.org_id,'agent_job',old.id::text,
      jsonb_build_object('table','ops_agent_jobs','pk',old.id::text)
    );
    return old;
  end if;

  v_job := private.ops_ontology_upsert_source_object(
    new.org_id,'agent_job',new.id::text,coalesce(new.job_type,'agent job'),
    jsonb_build_object(
      'job_type',new.job_type,'objective_id',new.objective_id,'target_type',new.target_type,
      'target_id',new.target_id,'status',new.status,'priority',new.priority,
      'attempts',new.attempts,'max_attempts',new.max_attempts,'run_after',new.run_after,
      'locked_at',new.locked_at,'locked_by',new.locked_by,'last_error',new.last_error,
      'created_at',new.created_at,'updated_at',new.updated_at
    ),
    jsonb_build_object('table','ops_agent_jobs','pk',new.id::text),
    new.updated_at
  );

  delete from public.ops_ontology_links
  where org_id=new.org_id and link_key='objective_has_job' and target_object_id=v_job;

  if new.objective_id is not null then
    select id into v_objective
    from public.ops_ontology_objects
    where org_id=new.org_id and type_key='objective' and object_key=new.objective_id::text;

    if v_objective is not null then
      insert into public.ops_ontology_links(
        org_id,link_key,source_object_id,target_object_id,source_ref
      ) values (
        new.org_id,'objective_has_job',v_objective,v_job,
        jsonb_build_object('table','ops_agent_jobs','pk',new.id::text,'column','objective_id')
      )
      on conflict (org_id,link_key,source_object_id,target_object_id) do update set
        source_ref=excluded.source_ref,
        updated_at=now();
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists ops_ontology_sync_job_t on public.ops_agent_jobs;
create trigger ops_ontology_sync_job_t
after insert or update or delete on public.ops_agent_jobs
for each row execute function private.ops_ontology_sync_job();

create or replace function private.ops_ontology_sync_app()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_org uuid;
begin
  select id into v_org from public.orgs where slug='mccluster' limit 1;
  if v_org is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if tg_op='DELETE' then
    perform private.ops_ontology_delete_source_object(
      v_org,'application',old.id::text,
      jsonb_build_object('table','platform_apps','pk',old.id::text)
    );
    return old;
  end if;

  perform private.ops_ontology_upsert_source_object(
    v_org,'application',new.id::text,new.name,
    jsonb_build_object(
      'app_key',new.app_key,'name',new.name,'product_family',new.product_family,
      'kind',new.kind,'bundle_id',new.bundle_id,'public_url',new.public_url,
      'oauth_client_id',new.oauth_client_id,'oauth_redirect_uris',new.oauth_redirect_uris,
      'settings',new.settings,'enabled',new.enabled,'created_at',new.created_at,'updated_at',new.updated_at
    ),
    jsonb_build_object('table','platform_apps','pk',new.id::text),
    new.updated_at
  );
  return new;
end
$$;

drop trigger if exists ops_ontology_sync_app_t on public.platform_apps;
create trigger ops_ontology_sync_app_t
after insert or update or delete on public.platform_apps
for each row execute function private.ops_ontology_sync_app();

create or replace function public.ops_ontology_schema_service(p_org uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'types',coalesce((
      select jsonb_agg(to_jsonb(t) order by t.type_key)
      from public.ops_ontology_types t where t.org_id=p_org and t.active
    ),'[]'::jsonb),
    'link_types',coalesce((
      select jsonb_agg(to_jsonb(l) order by l.link_key)
      from public.ops_ontology_link_types l where l.org_id=p_org and l.active
    ),'[]'::jsonb),
    'action_types',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.action_key)
      from public.ops_ontology_action_types a where a.org_id=p_org and a.active
    ),'[]'::jsonb)
  );
$$;

create or replace function public.ops_ontology_query_service(
  p_org uuid,
  p_type_key text default null,
  p_object_key text default null,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'objects',coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc),'[]'::jsonb)
  )
  from (
    select o.*
    from public.ops_ontology_objects o
    where o.org_id=p_org
      and (p_type_key is null or o.type_key=p_type_key)
      and (p_object_key is null or o.object_key=p_object_key)
    order by o.updated_at desc
    limit greatest(1,least(coalesce(p_limit,100),500))
  ) x;
$$;

create or replace function public.ops_ontology_neighbors_service(
  p_org uuid,
  p_object_id uuid,
  p_direction text default 'both',
  p_link_key text default null,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with edges as (
    select l.*
    from public.ops_ontology_links l
    where l.org_id=p_org
      and (p_link_key is null or l.link_key=p_link_key)
      and (
        (p_direction in ('out','both') and l.source_object_id=p_object_id)
        or (p_direction in ('in','both') and l.target_object_id=p_object_id)
      )
    order by l.updated_at desc
    limit greatest(1,least(coalesce(p_limit,100),500))
  ),
  neighbor_ids as (
    select case when e.source_object_id=p_object_id then e.target_object_id else e.source_object_id end id
    from edges e
  )
  select jsonb_build_object(
    'links',coalesce((select jsonb_agg(to_jsonb(e)) from edges e),'[]'::jsonb),
    'objects',coalesce((
      select jsonb_agg(to_jsonb(o))
      from public.ops_ontology_objects o
      where o.org_id=p_org and o.id in (select id from neighbor_ids)
    ),'[]'::jsonb)
  );
$$;

create or replace function public.ops_ontology_apply_action_service(
  p_org uuid,
  p_action_key text,
  p_target_object_id uuid,
  p_actor_user uuid,
  p_actor_kind text,
  p_parameters jsonb,
  p_request_hash text,
  p_idempotency_key text default null,
  p_approval_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_action public.ops_ontology_action_types;
  v_object public.ops_ontology_objects;
  v_run public.ops_ontology_action_runs;
  v_effect text;
  v_before jsonb;
  v_after jsonb;
  v_annotations jsonb;
  v_tags jsonb;
  v_target uuid;
  v_link_type public.ops_ontology_link_types;
  v_target_object public.ops_ontology_objects;
  v_link_id uuid;
  v_existing public.ops_ontology_action_runs;
begin
  if p_actor_user is null then
    raise exception 'actor_user is required for ontology mutation';
  end if;
  if not exists (
    select 1 from public.org_members
    where org_id=p_org and profile_id=p_actor_user and role='owner'
  ) then
    raise exception 'owner permission required';
  end if;
  if p_request_hash is null or char_length(trim(p_request_hash)) < 16 then
    raise exception 'request_hash is required';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from public.ops_ontology_action_runs
    where org_id=p_org and idempotency_key=p_idempotency_key
    limit 1;
    if v_existing.id is not null then
      return jsonb_build_object(
        'ok',v_existing.status='succeeded',
        'duplicate',true,
        'action_run',to_jsonb(v_existing)
      );
    end if;
  end if;

  select * into v_action
  from public.ops_ontology_action_types
  where org_id=p_org and action_key=p_action_key and active
  limit 1;
  if v_action.action_key is null then raise exception 'unknown or inactive ontology action'; end if;
  if v_action.approval_mode='budget' then raise exception 'budget ontology actions are not implemented in v1'; end if;

  select * into v_object
  from public.ops_ontology_objects
  where org_id=p_org and id=p_target_object_id
  for update;
  if v_object.id is null then raise exception 'ontology target object not found'; end if;
  if v_action.target_type_key is not null and v_action.target_type_key<>v_object.type_key then
    raise exception 'ontology action target type mismatch';
  end if;

  if v_action.approval_mode='review' then
    if p_approval_id is null or not exists (
      select 1 from public.control_approvals a
      where a.id=p_approval_id
        and a.org_id=p_org
        and a.capability='ontology.write'
        and a.resource_type='ontology_object'
        and a.resource_id=p_target_object_id::text
        and a.request_hash=p_request_hash
        and a.state='approved'
        and a.expires_at>now()
    ) then
      raise exception 'valid ontology approval required';
    end if;
  end if;

  insert into public.ops_ontology_action_runs(
    org_id,action_key,target_object_id,actor_user_id,actor_kind,parameters,
    request_hash,idempotency_key,approval_id,status,started_at
  ) values (
    p_org,p_action_key,p_target_object_id,p_actor_user,
    case when p_actor_kind in ('owner','agent','system','service') then p_actor_kind else 'agent' end,
    coalesce(p_parameters,'{}'::jsonb),p_request_hash,p_idempotency_key,p_approval_id,
    'running',now()
  ) returning * into v_run;

  v_effect := v_action.effect->>'kind';
  v_before := to_jsonb(v_object);

  if v_effect='annotate' then
    v_annotations := coalesce(p_parameters->'annotations','{}'::jsonb);
    if jsonb_typeof(v_annotations)<>'object' then
      update public.ops_ontology_action_runs
        set status='failed',error='annotations must be an object',finished_at=now()
        where id=v_run.id;
      return jsonb_build_object('ok',false,'action_run_id',v_run.id,'error','annotations must be an object');
    end if;

    update public.ops_ontology_objects
      set properties=jsonb_set(
        properties,
        '{_annotations}',
        coalesce(properties->'_annotations','{}'::jsonb) || v_annotations,
        true
      ),
      version=version+1,
      updated_at=now()
    where id=v_object.id;
    select to_jsonb(o) into v_after from public.ops_ontology_objects o where o.id=v_object.id;

  elsif v_effect='tag' then
    v_tags := coalesce(p_parameters->'tags','[]'::jsonb);
    if jsonb_typeof(v_tags)<>'array' or jsonb_array_length(v_tags)>50 then
      update public.ops_ontology_action_runs
        set status='failed',error='tags must be an array of at most 50 values',finished_at=now()
        where id=v_run.id;
      return jsonb_build_object('ok',false,'action_run_id',v_run.id,'error','tags must be an array of at most 50 values');
    end if;

    if exists (
      select 1 from jsonb_array_elements(v_tags) as e(value)
      where jsonb_typeof(e.value)<>'string' or char_length(trim(e.value #>> '{}'))>120
    ) then
      update public.ops_ontology_action_runs
        set status='failed',error='each tag must be a string of at most 120 characters',finished_at=now()
        where id=v_run.id;
      return jsonb_build_object('ok',false,'action_run_id',v_run.id,'error','invalid tag');
    end if;

    update public.ops_ontology_objects
      set properties=jsonb_set(properties,'{_tags}',v_tags,true),
          version=version+1,
          updated_at=now()
    where id=v_object.id;
    select to_jsonb(o) into v_after from public.ops_ontology_objects o where o.id=v_object.id;

  elsif v_effect='link' then
    begin
      v_target := (p_parameters->>'target_object_id')::uuid;
    exception when others then
      v_target := null;
    end;
    if v_target is null or coalesce(trim(p_parameters->>'link_key'),'')='' then
      update public.ops_ontology_action_runs
        set status='failed',error='target_object_id and link_key are required',finished_at=now()
        where id=v_run.id;
      return jsonb_build_object('ok',false,'action_run_id',v_run.id,'error','target_object_id and link_key are required');
    end if;

    select * into v_target_object
    from public.ops_ontology_objects
    where org_id=p_org and id=v_target;
    if v_target_object.id is null then
      update public.ops_ontology_action_runs
        set status='failed',error='link target object not found',finished_at=now()
        where id=v_run.id;
      return jsonb_build_object('ok',false,'action_run_id',v_run.id,'error','link target object not found');
    end if;

    select * into v_link_type
    from public.ops_ontology_link_types
    where org_id=p_org and link_key=p_parameters->>'link_key' and active;
    if v_link_type.link_key is null
       or v_link_type.source_type_key<>v_object.type_key
       or v_link_type.target_type_key<>v_target_object.type_key then
      update public.ops_ontology_action_runs
        set status='failed',error='link type is incompatible with source/target object types',finished_at=now()
        where id=v_run.id;
      return jsonb_build_object('ok',false,'action_run_id',v_run.id,'error','incompatible link type');
    end if;

    insert into public.ops_ontology_links(
      org_id,link_key,source_object_id,target_object_id,properties,source_ref
    ) values (
      p_org,v_link_type.link_key,v_object.id,v_target_object.id,
      case when jsonb_typeof(coalesce(p_parameters->'properties','{}'::jsonb))='object'
        then coalesce(p_parameters->'properties','{}'::jsonb) else '{}'::jsonb end,
      jsonb_build_object('action_run_id',v_run.id)
    )
    on conflict (org_id,link_key,source_object_id,target_object_id) do update set
      properties=excluded.properties,
      source_ref=excluded.source_ref,
      updated_at=now()
    returning id into v_link_id;

    v_after := jsonb_build_object('link_id',v_link_id,'target_object_id',v_target_object.id);

  else
    update public.ops_ontology_action_runs
      set status='failed',error='unsupported ontology effect',finished_at=now()
      where id=v_run.id;
    return jsonb_build_object('ok',false,'action_run_id',v_run.id,'error','unsupported ontology effect');
  end if;

  update public.ops_ontology_action_runs
    set status='succeeded',
        result=jsonb_build_object('effect',v_effect,'after',v_after),
        finished_at=now()
  where id=v_run.id
  returning * into v_run;

  insert into public.ops_ontology_lineage(
    org_id,event_type,subject_type,subject_key,object_id,link_id,action_run_id,
    source_ref,before_state,after_state,actor_user_id,actor_kind
  ) values (
    p_org,'action.applied',v_object.type_key,v_object.object_key,
    v_object.id,v_link_id,v_run.id,
    jsonb_build_object('action_key',p_action_key),
    v_before,v_after,p_actor_user,v_run.actor_kind
  );

  return jsonb_build_object('ok',true,'duplicate',false,'action_run',to_jsonb(v_run),'after',v_after);
end
$$;


revoke all on function private.ops_ontology_ensure_base_types(uuid) from public, anon, authenticated;
revoke all on function private.ops_ontology_upsert_source_object(uuid,text,text,text,jsonb,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function private.ops_ontology_delete_source_object(uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function private.ops_ontology_sync_org() from public, anon, authenticated;
revoke all on function private.ops_ontology_sync_objective() from public, anon, authenticated;
revoke all on function private.ops_ontology_sync_job() from public, anon, authenticated;
revoke all on function private.ops_ontology_sync_app() from public, anon, authenticated;

revoke all on function public.ops_ontology_schema_service(uuid) from public, anon, authenticated;
revoke all on function public.ops_ontology_query_service(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.ops_ontology_neighbors_service(uuid,uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.ops_ontology_apply_action_service(uuid,text,uuid,uuid,text,jsonb,text,text,uuid) from public, anon, authenticated;
grant execute on function public.ops_ontology_schema_service(uuid) to service_role;
grant execute on function public.ops_ontology_query_service(uuid,text,text,integer) to service_role;
grant execute on function public.ops_ontology_neighbors_service(uuid,uuid,text,text,integer) to service_role;
grant execute on function public.ops_ontology_apply_action_service(uuid,text,uuid,uuid,text,jsonb,text,text,uuid) to service_role;

insert into public.control_capabilities(capability,description,risk)
values
  ('ontology.read','Read the McCluster operational ontology','low'),
  ('ontology.write','Apply bounded governed ontology actions','medium')
on conflict (capability) do update
set description=excluded.description,risk=excluded.risk;

insert into public.control_role_capabilities(role,capability,allowed)
values
  ('admin','ontology.read',true),('admin','ontology.write',true),
  ('owner','ontology.read',true),('owner','ontology.write',true),
  ('staff','ontology.read',true),('member','ontology.read',true)
on conflict (role,capability) do update set allowed=excluded.allowed;

do $$
declare
  r record;
  v_house uuid;
begin
  for r in select * from public.orgs loop
    perform private.ops_ontology_ensure_base_types(r.id);
    perform private.ops_ontology_upsert_source_object(
      r.id,'organization',r.id::text,r.name,
      jsonb_build_object('slug',r.slug,'name',r.name,'kind',r.kind,'enabled',r.enabled,'settings',r.settings,'created_at',r.created_at),
      jsonb_build_object('table','orgs','pk',r.id::text),now()
    );
  end loop;

  for r in select * from public.ops_objectives loop
    perform private.ops_ontology_upsert_source_object(
      r.org_id,'objective',r.id::text,r.name,
      jsonb_build_object('name',r.name,'description',r.description,'status',r.status,'priority',r.priority,'success_metric',r.success_metric,'scope',r.scope,'created_at',r.created_at,'updated_at',r.updated_at),
      jsonb_build_object('table','ops_objectives','pk',r.id::text),r.updated_at
    );
  end loop;

  for r in select * from public.ops_agent_jobs loop
    perform private.ops_ontology_upsert_source_object(
      r.org_id,'agent_job',r.id::text,coalesce(r.job_type,'agent job'),
      jsonb_build_object('job_type',r.job_type,'objective_id',r.objective_id,'target_type',r.target_type,'target_id',r.target_id,'status',r.status,'priority',r.priority,'attempts',r.attempts,'max_attempts',r.max_attempts,'run_after',r.run_after,'locked_at',r.locked_at,'locked_by',r.locked_by,'last_error',r.last_error,'created_at',r.created_at,'updated_at',r.updated_at),
      jsonb_build_object('table','ops_agent_jobs','pk',r.id::text),r.updated_at
    );
  end loop;

  insert into public.ops_ontology_links(org_id,link_key,source_object_id,target_object_id,source_ref)
  select j.org_id,'objective_has_job',o.id,jj.id,
         jsonb_build_object('table','ops_agent_jobs','pk',j.id::text,'column','objective_id')
  from public.ops_agent_jobs j
  join public.ops_ontology_objects o
    on o.org_id=j.org_id and o.type_key='objective' and o.object_key=j.objective_id::text
  join public.ops_ontology_objects jj
    on jj.org_id=j.org_id and jj.type_key='agent_job' and jj.object_key=j.id::text
  where j.objective_id is not null
  on conflict (org_id,link_key,source_object_id,target_object_id) do nothing;

  select id into v_house from public.orgs where slug='mccluster' limit 1;
  if v_house is not null then
    perform private.ops_ontology_ensure_base_types(v_house);
    for r in select * from public.platform_apps loop
      perform private.ops_ontology_upsert_source_object(
        v_house,'application',r.id::text,r.name,
        jsonb_build_object('app_key',r.app_key,'name',r.name,'product_family',r.product_family,'kind',r.kind,'bundle_id',r.bundle_id,'public_url',r.public_url,'oauth_client_id',r.oauth_client_id,'oauth_redirect_uris',r.oauth_redirect_uris,'settings',r.settings,'enabled',r.enabled,'created_at',r.created_at,'updated_at',r.updated_at),
        jsonb_build_object('table','platform_apps','pk',r.id::text),r.updated_at
      );
    end loop;
  end if;
end
$$;

comment on table public.ops_ontology_objects is
  'McCluster operational objects materialized from canonical source tables with provenance-preserving owner annotations.';
comment on table public.ops_ontology_links is
  'Typed governed relationships between operational objects.';
comment on table public.ops_ontology_action_types is
  'Bounded action definitions. v1 effects are internal annotate/tag/link operations only; external side effects remain behind existing Core capability gates.';
