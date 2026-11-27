-- Draft only. Apply to a disposable database with canonical tenancy and Core queue.
-- PostgREST exposes only the service-role entry point. The Worker derives p_actor
-- from the verified bearer. Private definer routines can verify auth.users without
-- granting the service role general access to authentication records.
begin;
create schema equiquant;
revoke all on schema equiquant from public, anon, authenticated, service_role;
grant usage on schema equiquant to service_role;

create table equiquant.research_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  owner_id uuid not null,
  title text not null check (length(title) between 1 and 160),
  created_at timestamptz not null default now()
);
create index equiquant_project_workspace on equiquant.research_projects(org_id, created_at);
create table equiquant.research_project_members (
  project_id uuid not null references equiquant.research_projects(id),
  profile_id uuid not null,
  status text not null check (status in ('owner','member','invited')),
  primary key (project_id, profile_id)
);
create index equiquant_member_projects on equiquant.research_project_members(profile_id, project_id);
create table equiquant.research_credit_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  profile_id uuid not null,
  role text not null check (role in (
    'Conceptualization', 'Data curation', 'Formal analysis', 'Funding acquisition',
    'Investigation', 'Methodology', 'Project administration', 'Resources', 'Software',
    'Supervision', 'Validation', 'Visualization', 'Writing - original draft', 'Writing - review & editing'
  )),
  credit_name text not null check (length(credit_name) between 1 and 100),
  statement text not null check (length(statement) between 1 and 1000),
  consented_at timestamptz not null default now(),
  unique (project_id, profile_id, role),
  foreign key (project_id, profile_id) references equiquant.research_project_members(project_id,profile_id)
);

-- Each model's hash covers every held-out fold across all four pilot settings.
create table equiquant.mosaic_model_pins (
  scenario text primary key,
  result_sha256 text not null unique,
  held_out_mse numeric not null,
  model_sha256 text not null unique
);
insert into equiquant.mosaic_model_pins values
 ('pooled', '1ff244cbd378d568008aacb022beeddb4ddd3f56b1f1f8efdfdd7ddc56bfeddf', 0.3340546369, '5374cae4064179f0e65f0c5874220129955c426677bc6084fe0250d61e418ed2'),
 ('group_levels', '2c92416ed00303e53775306edfb97e3fd3ff725ff580e8cdc34015401b27b782', 0.2529111721, '6e22a780cfd26067de53d7df5cde9ab74f56db5c93ebf01b66eb6939440eaf1b'),
 ('group_slopes', 'b0fe5ad9536b8681eae1eb1f1aadcb4df8d4e020abd6d0bd99bfbe631d9f9fa6', 0.2556166798, 'f7bcc64b96eb31dcf31ed0e6c0ab73374b5c7c4da69b9d1eefa84808f5b28f9c');
-- A runner publishes a signed self-test over the existing service-role channel.
-- Browser credentials cannot register capabilities. The server dates their expiry.
create table equiquant.mosaic_runner_capabilities (
  worker_id text primary key,
  target text not null check (target in ('prime','ovh_core')),
  observed_at timestamptz not null,
  attestation jsonb not null
);
create index equiquant_target_freshness on equiquant.mosaic_runner_capabilities(target, observed_at desc);

create function equiquant.register_mosaic_capability(a jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  observed timestamptz;
  hashes jsonb;
begin
  select jsonb_object_agg(scenario,model_sha256) into hashes from equiquant.mosaic_model_pins;
  if jsonb_typeof(a) is distinct from 'object' or octet_length(a::text)>8192
     or a - array['target','backend','precision','hardware_sha256','code_sha256','spec_sha256',
                  'observations_sha256','model_hashes','node_version','worker_id','signing_public_key',
                  'signature','observed_at'] <> '{}'::jsonb
     or coalesce(a->>'target','') not in ('prime','ovh_core')
     or a->>'backend' is distinct from 'node_cpu' or a->>'precision' is distinct from 'binary64'
     or a->>'code_sha256' is distinct from '52ad9f8d364159868b83532e1f811d92653a8e2ae199d791d28119592ac9b21e'
     or a->>'spec_sha256' is distinct from 'f12502819b7a9769ea22ae6c0bbfc079b669b3cb4ede2c55513ae7bb3a53be62'
     or a->>'observations_sha256' is distinct from '6539910bd6218f85f8a2bd436ca73f544e722f2d207e8c6c3098d371c37f4c63'
     or a->'model_hashes' is distinct from hashes
     or coalesce(a->>'hardware_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(a->>'worker_id','') !~ '^[A-Za-z0-9_.:-]{1,160}$'
     or coalesce(a->>'node_version','') !~ '^[0-9]+[.][0-9]+[.][0-9]+$'
     or coalesce(a->>'signing_public_key','') !~ '^[A-Za-z0-9_-]{59}$'
     or coalesce(a->>'signature','') !~ '^[A-Za-z0-9_-]{86}$'
     or coalesce(a->>'observed_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'
  then raise exception using errcode='PT400',message='Target did not attest the pinned model, specification and precision'; end if;
  observed := (a->>'observed_at')::timestamptz;
  if observed < clock_timestamp()-interval '120 seconds' or observed > clock_timestamp()+interval '5 seconds' then
    raise exception using errcode='PT409',message='Request a fresh target self-test';
  end if;
  insert into equiquant.mosaic_runner_capabilities(worker_id,target,observed_at,attestation)
    values(a->>'worker_id',a->>'target',observed,a)
    on conflict(worker_id) do update set target=excluded.target,observed_at=excluded.observed_at,attestation=excluded.attestation
    where equiquant.mosaic_runner_capabilities.observed_at < excluded.observed_at
       or equiquant.mosaic_runner_capabilities.attestation = excluded.attestation;
  if not found then raise exception using errcode='PT409',message='A newer target self-test is registered'; end if;
  return jsonb_build_object('ok',true);
end $$;

create function public.equiquant_attest_target(p_attestation jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select equiquant.register_mosaic_capability(p_attestation)
$$;

create function equiquant.mosaic_target_choices(p_org uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_agg(jsonb_build_object('id',t.id,'label',t.label,'available',c.attestation is not null,
    'reason',case when t.id='connected_inference' then 'The inference service does not run this binary64 experiment.'
                  when o.id is null then 'Core replay is unavailable for this workspace.'
                  when c.attestation is null then 'No fresh self-test for this experiment and precision.'
                  else 'Verified for the pinned binary64 experiment.' end)
    || case when c.attestation is null then '{}'::jsonb else jsonb_build_object(
        'attestation',c.attestation,'backend',c.attestation->'backend','precision',c.attestation->'precision',
        'hardware_sha256',c.attestation->'hardware_sha256','node_version',c.attestation->'node_version') end order by t.pos)
  from (values (1,'prime','Prime / local'),(2,'ovh_core','OVH Core'),(3,'connected_inference','Connected inference')) t(pos,id,label)
    left join public.orgs o on o.id=p_org and o.enabled and o.slug='mccluster'
    left join lateral (select attestation from equiquant.mosaic_runner_capabilities
       where target=t.id and o.id is not null and observed_at >= statement_timestamp()-interval '120 seconds'
       order by observed_at desc,worker_id limit 1) c on true
$$;

create table equiquant.research_replay_jobs (
  job_id uuid primary key,
  project_id uuid not null references equiquant.research_projects(id),
  scenario text not null references equiquant.mosaic_model_pins,
  target text not null check (target in ('prime','ovh_core')),
  hardware_sha256 text not null,
  node_version text not null,
  claim_attestation jsonb,
  created_at timestamptz not null default now()
);
create index equiquant_runs_by_project on equiquant.research_replay_jobs(project_id, target, scenario, hardware_sha256, node_version, created_at desc);
create table equiquant.research_result_receipts (
  job_id uuid primary key references equiquant.research_replay_jobs,
  snapshot jsonb not null,
  result_json text not null
);
create table equiquant.research_release_credits (
  project_id uuid primary key references equiquant.research_projects,
  snapshot jsonb not null
);

create function equiquant.reject_research_record_edit() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode='55000', message='This research record is immutable';
end $$;
create trigger immutable_receipt before update or delete on equiquant.research_result_receipts
  for each row execute function equiquant.reject_research_record_edit();
create trigger immutable_credit_review before update or delete on equiquant.research_release_credits
  for each row execute function equiquant.reject_research_record_edit();
create trigger immutable_attestation before update or delete on equiquant.research_credit_evidence
  for each row execute function equiquant.reject_research_record_edit();

-- Bind an actual lease issuer to its fresh, matching self-test when claiming.
-- Reclaim may select a new process key on the same hardware and Node runtime.
create function equiquant.bind_mosaic_runner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r equiquant.research_replay_jobs;
  a jsonb;
begin
  select * into r from equiquant.research_replay_jobs where job_id=new.id;
  if not found or new.locked_by is null or new.locked_by !~ '^[^#]+#[^#]+$' then
    raise exception using errcode='PT409',message='The requested target is unavailable for this lease';
  end if;
  select c.attestation into a from equiquant.mosaic_runner_capabilities c
    where c.worker_id=split_part(new.locked_by,'#',1) and c.target=r.target
      and c.attestation->>'hardware_sha256'=r.hardware_sha256 and c.attestation->>'node_version'=r.node_version
      and c.observed_at>=clock_timestamp()-interval '120 seconds' for share;
  if not found or new.input is distinct from jsonb_build_object(
       'scenario',r.scenario,'target',r.target,'hardware_sha256',r.hardware_sha256,'node_version',r.node_version) then
    raise exception using errcode='PT409',message='The requested target is unavailable for this lease';
  end if;
  update equiquant.research_replay_jobs set claim_attestation=a where job_id=new.id;
  return new;
end $$;
create trigger equiquant_bind_replay_claim before update of status on public.ops_agent_jobs
  for each row when (new.job_type='equiquant_mosaic_replay' and new.status='running' and old.status='queued')
  execute function equiquant.bind_mosaic_runner();

-- The existing runner writes its lease-fenced completion. The same transaction
-- snapshots only a bound job and independently hashes the actual result bytes.
create function equiquant.capture_mosaic_receipt() returns trigger language plpgsql
security definer set search_path = '' as $$
declare
  model equiquant.mosaic_model_pins;
  result_text text := new.output->>'result_json';
  a jsonb;
  execution jsonb := new.output->'execution';
  doi constant text := '10.1594/PANGAEA.958449';
  source_sha constant text := '523112ddbcd2b9dfcc16891437f83a5781d045fb';
  observations_sha constant text := '6539910bd6218f85f8a2bd436ca73f544e722f2d207e8c6c3098d371c37f4c63';
begin
  select r.claim_attestation into a from equiquant.research_replay_jobs r where r.job_id=new.id;
  select m.* into model from equiquant.research_replay_jobs r
    join equiquant.research_projects p on p.id=r.project_id
    join equiquant.mosaic_model_pins m on m.scenario=r.scenario
    where r.job_id=new.id and p.org_id=new.org_id and p.id::text=new.target_id
      and new.target_type='equiquant_project' and new.input=jsonb_build_object('scenario',r.scenario,'target',r.target,'hardware_sha256',r.hardware_sha256,'node_version',r.node_version);
  if not found or old.status is distinct from 'running' or old.locked_by is null or old.attempts < 1
     or a is null or a->>'worker_id' is distinct from split_part(old.locked_by,'#',1)
     or jsonb_typeof(execution) is distinct from 'object'
     or execution - array['target','backend','precision','hardware_sha256','code_sha256','spec_sha256',
                         'model_sha256','node_version','worker_id','signing_public_key','elapsed_ns','signature'] <> '{}'::jsonb
     or (execution - array['elapsed_ns','signature','model_sha256']) is distinct from
        (a - array['model_hashes','observations_sha256','observed_at','signature'])
     or execution->>'model_sha256' is distinct from model.model_sha256
     or coalesce(execution->>'signature','') !~ '^[A-Za-z0-9_-]{86}$'
     or jsonb_typeof(execution->'elapsed_ns') is distinct from 'number'
     or coalesce(execution->>'elapsed_ns','') !~ '^[1-9][0-9]{0,14}$'
     or new.output->>'scenario' is distinct from model.scenario
     or new.output->>'dataset_doi' is distinct from doi
     or new.output->>'source_commit' is distinct from source_sha
     or new.output->>'observations_sha256' is distinct from observations_sha
     or new.output->>'result_sha256' is distinct from model.result_sha256
     or encode(sha256(convert_to(result_text,'UTF8')),'hex') is distinct from model.result_sha256
     or new.output->'held_out_mse' is distinct from to_jsonb(model.held_out_mse)
     or new.output->'folds' is distinct from '13'::jsonb
     or new.output#>>'{completion_evidence,schema_version}' is distinct from 'mccluster-completion-evidence/v1'
     or new.output#>>'{completion_evidence,job_id}' is distinct from new.id::text
     or new.output#>>'{completion_evidence,job_type}' is distinct from 'equiquant_mosaic_replay'
  then
    raise exception using errcode='22023', message='Core replay provenance could not be verified';
  end if;
  insert into equiquant.research_result_receipts(job_id,snapshot,result_json)
    values(new.id,jsonb_build_object('job_id',new.id,'scenario',model.scenario,'status','done',
      'dataset_doi',doi,'source_commit',source_sha,'observations_sha256',observations_sha,
      'target',a->'target','hardware_sha256',a->'hardware_sha256','execution',execution,'attestation',a,
      'result_sha256',model.result_sha256,'held_out_mse',model.held_out_mse,'folds',13),result_text);
  return new;
end $$;
create trigger equiquant_capture_completed_replay after update of status on public.ops_agent_jobs
  for each row when (new.job_type='equiquant_mosaic_replay' and new.status='done' and old.status is distinct from new.status)
  execute function equiquant.capture_mosaic_receipt();

-- The operational ontology is readable by ordinary organization members. Its
-- canonical job trigger includes target_id, even for invite-only projects.
-- Retain the canonical mirror for every other job type and for its deletions.
do $$
declare
  mirror pg_catalog.pg_trigger;
begin
  select * into mirror from pg_catalog.pg_trigger where tgrelid='public.ops_agent_jobs'::regclass
    and tgname='ops_ontology_sync_job_t';
  if found then
    if mirror.tgfoid is distinct from to_regprocedure('private.ops_ontology_sync_job()')
       or mirror.tgtype<>29 or mirror.tgenabled<>'O' or mirror.tgqual is not null then
      raise exception 'Review the changed Core job ontology trigger before applying Equity Quantized';
    end if;
    drop trigger ops_ontology_sync_job_t on public.ops_agent_jobs;
    create trigger ops_ontology_sync_job_t after insert or update on public.ops_agent_jobs
      for each row when (new.job_type <> 'equiquant_mosaic_replay')
      execute function private.ops_ontology_sync_job();
    create trigger equiquant_mirror_other_deleted_jobs after delete on public.ops_agent_jobs
      for each row when (old.job_type <> 'equiquant_mosaic_replay')
      execute function private.ops_ontology_sync_job();
  end if;
end $$;


-- No private title, identity, invite, or credit statement enters the shared queue.
create function equiquant.request_mosaic_replay(p_project uuid,p_org uuid,p_scenario text,p_target text,p_signature text)
returns void language plpgsql set search_path = '' as $$
declare
  new_job uuid;
  capability jsonb;
  hardware text;
  runtime_version text;
begin
  if not exists (select 1 from equiquant.mosaic_model_pins where scenario=p_scenario) then
    raise exception using errcode='PT400',message='Choose a supported sea-ice model';
  end if;
  if not exists (select 1 from public.orgs where id=p_org and slug='mccluster' and enabled is true) then
    raise exception using errcode='PT409',message='Core replay is unavailable for this workspace';
  end if;
  -- The Worker verified this signed self-test. Match it again inside the
  -- enqueue transaction. A stale token cannot select a different runtime.
  select attestation into capability from equiquant.mosaic_runner_capabilities
    where target=p_target and attestation->>'signature'=p_signature
      and observed_at>=clock_timestamp()-interval '120 seconds' for share;
  if not found then
    raise exception using errcode='PT409',message='A fresh, compatible target self-test is required. Refresh and try again.';
  end if;
  hardware := capability->>'hardware_sha256';
  runtime_version := capability->>'node_version';
  -- The project lock serializes submissions for the same target/model/runtime.
  -- Hardware and runtime changes must produce another measurement.
  if exists (select 1 from equiquant.research_replay_jobs r left join public.ops_agent_jobs j on j.id=r.job_id
             left join equiquant.research_result_receipts c on c.job_id=r.job_id
             where r.project_id=p_project and r.scenario=p_scenario and r.target=p_target
               and r.hardware_sha256=hardware and r.node_version=runtime_version
               and (c.job_id is not null or j.status in ('queued','running'))) then
    return;
  end if;
  insert into public.ops_agent_jobs(org_id,job_type,target_type,target_id,input)
    values(p_org,'equiquant_mosaic_replay','equiquant_project',p_project::text,
           jsonb_build_object('scenario',p_scenario,'target',p_target,'hardware_sha256',hardware,'node_version',runtime_version)) returning id into new_job;
  insert into equiquant.research_replay_jobs(job_id,project_id,scenario,target,hardware_sha256,node_version)
    values(new_job,p_project,p_scenario,p_target,hardware,runtime_version);
end $$;

-- All credit IDs are selected explicitly and their order becomes citation order.
create function equiquant.freeze_project_credits(p_project equiquant.research_projects,p_actor uuid,p_data jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  requested jsonb := p_data->'evidence_ids';
  job uuid := (p_data->>'job_id')::uuid;
  credit_rows jsonb;
  run_snapshot jsonb;
  prior jsonb;
begin
  if p_data->'confirmed' is distinct from 'true'::jsonb
     or jsonb_typeof(requested) is distinct from 'array' then
    raise exception using errcode='PT400',message='Confirm the credit review and select evidence';
  end if;
  if jsonb_array_length(requested) not between 1 and 100 or job is null then
    raise exception using errcode='PT400',message='Select one completed run and 1-100 credit records';
  end if;
  select snapshot into prior from equiquant.research_release_credits where project_id=p_project.id;
  if found then
    if prior#>>'{run,job_id}'=job::text and requested=(
      select jsonb_agg(x.credit->'id' order by x.pos) from jsonb_array_elements(prior->'credits')
      with ordinality as x(credit,pos)) then return;
    end if;
    raise exception using errcode='PT409',message='This project already has a frozen credit review';
  end if;
  select c.snapshot into run_snapshot from equiquant.research_result_receipts c
    join equiquant.research_replay_jobs r on r.job_id=c.job_id where c.job_id=job and r.project_id=p_project.id;
  if not found then
    raise exception using errcode='PT409',message='Choose a completed replay from this project';
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(requested)) <> jsonb_array_length(requested) then
    raise exception using errcode='PT400',message='Each selected credit must appear once';
  end if;
  select jsonb_agg(to_jsonb(e)-'project_id' order by items.pos) into credit_rows
  from jsonb_array_elements_text(requested) with ordinality as items(id,pos)
    join equiquant.research_credit_evidence e on e.id::text=items.id and e.project_id=p_project.id
    join public.org_members om on om.org_id=p_project.org_id and om.profile_id=e.profile_id
    join auth.users u on u.id=e.profile_id and u.email_confirmed_at is not null;
  if coalesce(jsonb_array_length(credit_rows),0) <> jsonb_array_length(requested) then
    raise exception using errcode='PT400',message='Select current, consented evidence from this project';
  end if;
  insert into equiquant.research_release_credits(project_id,snapshot)
    values(p_project.id,jsonb_build_object('id',gen_random_uuid(),'title',p_project.title,
      'reviewed_by',p_actor,'reviewed_at',now(),'credits',credit_rows,'run',run_snapshot));
end $$;

create function equiquant.read_research_project(p_project equiquant.research_projects,p_membership text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'project',jsonb_build_object('id',p_project.id,'title',p_project.title,
      'owner_id',p_project.owner_id,'membership',p_membership),
    'targets',equiquant.mosaic_target_choices(p_project.org_id),
    'members',coalesce((select jsonb_agg(to_jsonb(m)-'project_id' order by m.profile_id)
      from equiquant.research_project_members m where m.project_id=p_project.id),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(to_jsonb(e)-'project_id' order by e.consented_at,e.id)
      from equiquant.research_credit_evidence e where e.project_id=p_project.id),'[]'::jsonb),
    'runs',coalesce((select jsonb_agg(coalesce(c.snapshot,jsonb_build_object(
      'job_id',r.job_id,'scenario',r.scenario,'target',r.target,'hardware_sha256',r.hardware_sha256,
      'node_version',r.node_version,'status',coalesce(j.status,'unavailable')))
      order by r.created_at,r.job_id) from equiquant.research_replay_jobs r
      left join public.ops_agent_jobs j on j.id=r.job_id
      left join equiquant.research_result_receipts c on c.job_id=r.job_id where r.project_id=p_project.id),'[]'::jsonb),
    'release',(select snapshot from equiquant.research_release_credits where project_id=p_project.id)
  )
$$;

create function equiquant.apply_project_action(p_actor uuid,p_org uuid,p_action text,p_project uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  project equiquant.research_projects;
  membership text;
  workspace_role text;
  target uuid;
  project_title text := btrim(p_data->>'title');
  chosen_role text := p_data->>'role';
  chosen_name text := btrim(p_data->>'credit_name');
  chosen_statement text := btrim(p_data->>'statement');
  allowed_keys text[];
begin
  -- A verified M Account and a current membership of an enabled workspace are
  -- required even when the project invitation or project ownership predates this call.
  select m.role into workspace_role from public.org_members m
    join public.orgs o on o.id=m.org_id and o.enabled is true
    join auth.users u on u.id=m.profile_id and u.email_confirmed_at is not null
    where m.org_id=p_org and m.profile_id=p_actor for share of m,o,u;
  if not found then
    raise exception using errcode='PT403',message='Verified workspace membership required';
  end if;

  allowed_keys := case p_action
    when 'list' then array[]::text[] when 'create' then array['title']
    when 'state' then array[]::text[] when 'invite' then array['profile_id']
    when 'accept' then array[]::text[] when 'evidence' then array['role','credit_name','statement','consent']
    when 'replay' then array['scenario','target','capability_signature'] when 'review' then array['evidence_ids','confirmed','job_id'] end;
  if allowed_keys is null or jsonb_typeof(p_data) is distinct from 'object'
     or p_data - allowed_keys <> '{}'::jsonb then
    raise exception using errcode='PT400',message='Unsupported research action or fields';
  end if;
  if p_action='list' then
    return jsonb_build_object('projects',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'title',p.title,'owner_id',p.owner_id,'membership',m.status) order by p.created_at desc,p.id)
      from equiquant.research_projects p join equiquant.research_project_members m on m.project_id=p.id
      where p.org_id=p_org and m.profile_id=p_actor),'[]'::jsonb));
  end if;
  if p_action='create' then
    if workspace_role not in ('owner','staff') then
      raise exception using errcode='PT403',message='Workspace owner or staff access required to create a project';
    end if;
    if jsonb_typeof(p_data->'title') is distinct from 'string' or length(project_title) not between 1 and 160 then
      raise exception using errcode='PT400',message='Enter a project title of 1-160 characters';
    end if;
    p_project := coalesce(p_project,gen_random_uuid());
    insert into equiquant.research_projects(id,org_id,owner_id,title) values(p_project,p_org,p_actor,project_title)
      on conflict(id) do nothing;
    if found then
      insert into equiquant.research_project_members(project_id,profile_id,status) values(p_project,p_actor,'owner');
    elsif not exists(select 1 from equiquant.research_projects where id=p_project and org_id=p_org
                       and owner_id=p_actor and title=project_title) then
      raise exception using errcode='PT409',message='Project creation reference is already in use';
    end if;
  end if;

  -- Serialize invites, replay submissions, evidence and release review per project.
  -- The membership join keeps the private project indistinguishable from a missing ID.
  select p.* into project from equiquant.research_projects p
    join equiquant.research_project_members m on m.project_id=p.id and m.profile_id=p_actor
    where p.id=p_project and p.org_id=p_org for update of p;
  if not found then raise exception using errcode='P0002',message='Project unavailable'; end if;
  select m.status into membership from equiquant.research_project_members m where m.project_id=p_project and m.profile_id=p_actor;
  if p_action='accept' and membership='invited' then
    update equiquant.research_project_members set status='member' where project_id=p_project and profile_id=p_actor;
    membership := 'member';
  elsif membership='invited' then
    raise exception using errcode='PT403',message='Accept your project invitation first';
  end if;
  if p_action in ('invite','review') and (membership <> 'owner' or workspace_role not in ('owner','staff')) then
    raise exception using errcode='PT403',message='Project owner access required';
  end if;

  case p_action
  when 'invite' then
    target := (p_data->>'profile_id')::uuid;
    perform 1 from public.org_members m join auth.users u on u.id=m.profile_id
      where m.org_id=p_org and m.profile_id=target and u.email_confirmed_at is not null for share of m,u;
    if not found then raise exception using errcode='PT400',message='Choose a verified member of this workspace'; end if;
    insert into equiquant.research_project_members(project_id,profile_id,status) values(p_project,target,'invited') on conflict do nothing;
  when 'evidence' then
    if p_data->'consent' is distinct from 'true'::jsonb
       or jsonb_typeof(p_data->'role') is distinct from 'string'
       or jsonb_typeof(p_data->'credit_name') is distinct from 'string' or length(chosen_name) not between 1 and 100
       or jsonb_typeof(p_data->'statement') is distinct from 'string' or length(chosen_statement) not between 1 and 1000 then
      raise exception using errcode='PT400',message='Enter a credit name, role and evidence statement, and consent to credit review';
    end if;
    if exists(select 1 from equiquant.research_credit_evidence where profile_id=p_actor and project_id=p_project and credit_name<>chosen_name) then
      raise exception using errcode='PT409',message='Use your existing credit name for this project';
    end if;
    begin
      insert into equiquant.research_credit_evidence(project_id,profile_id,role,credit_name,statement)
        values(p_project,p_actor,chosen_role,chosen_name,chosen_statement)
        on conflict(project_id,profile_id,role) do nothing;
      if not found and not exists(select 1 from equiquant.research_credit_evidence where project_id=p_project and profile_id=p_actor
                                   and role=chosen_role and statement=chosen_statement) then
        raise exception using errcode='PT409',message='This role already has a consented evidence record';
      end if;
    exception when check_violation then
      raise exception using errcode='PT400',message='Choose a supported CRediT role';
    end;
  when 'replay' then
    perform equiquant.request_mosaic_replay(p_project,p_org,p_data->>'scenario',p_data->>'target',p_data->>'capability_signature');
  when 'review' then
    perform equiquant.freeze_project_credits(project,p_actor,p_data);
  else null;
  end case;
  return equiquant.read_research_project(project,membership);
exception when invalid_text_representation then
  raise exception using errcode='PT400',message='Use a valid research record ID';
end $$;

create function public.equiquant_action(p_actor uuid,p_org uuid,p_action text,p_project uuid,p_data jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select equiquant.apply_project_action(p_actor,p_org,p_action,p_project,p_data)
$$;

alter table equiquant.research_projects enable row level security;
alter table equiquant.research_project_members enable row level security;
alter table equiquant.mosaic_model_pins enable row level security;
alter table equiquant.mosaic_runner_capabilities enable row level security;
alter table equiquant.research_credit_evidence enable row level security;
alter table equiquant.research_replay_jobs enable row level security;
alter table equiquant.research_result_receipts enable row level security;
alter table equiquant.research_release_credits enable row level security;
revoke all on all tables in schema equiquant from public, anon, authenticated, service_role;
revoke all on all functions in schema equiquant from public, anon, authenticated, service_role;
revoke all on function public.equiquant_attest_target(jsonb),public.equiquant_action(uuid,uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function equiquant.register_mosaic_capability(jsonb),public.equiquant_attest_target(jsonb),
  equiquant.apply_project_action(uuid,uuid,text,uuid,jsonb),
  public.equiquant_action(uuid,uuid,text,uuid,jsonb) to service_role;
commit;
