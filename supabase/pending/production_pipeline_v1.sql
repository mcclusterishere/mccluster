-- Production pipeline v1 (docs/control-plane/PRODUCTION-PIPELINE.md).
--
-- Records for the production job service: projects, members, versioned
-- assets, actor consents, shots, jobs and artifacts. The durable queue
-- is NOT here: each production_jobs row points at exactly one
-- ops_compute_tasks row, which owned workers lease over the signed
-- compute protocol (mccluster-compute/1).
--
-- Files never live in these tables. An asset or artifact row records a
-- project-relative path, its sha256 and the node that holds it
-- (storage 'node-local'): recordings, likeness and unreleased masters
-- stay on the owner's machines.
--
-- RLS is on with no client policies: only the service role (Core) reads
-- and writes; Creator Suite and the MCP reach these rows through the
-- named core.production.* tools, which authorize the stamped actor.
--
-- Not applied by this change. Apply only with the owner's go-ahead.

begin;

create table if not exists public.production_projects (
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  status text not null default 'active' check (status in ('active','archived','locked')),
  -- Where each owned node keeps this project's files, by node id; paths
  -- in jobs are relative to it. Example: {"roots": {"node_...": "C:\\Users\\...\\get-it-back"}}
  storage jsonb not null default '{}'::jsonb check (jsonb_typeof(storage) = 'object'),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, id)
);

create table if not exists public.production_members (
  org_id uuid not null,
  project_id text not null,
  profile_id uuid not null,
  role text not null check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, project_id, profile_id),
  foreign key (org_id, project_id) references public.production_projects(org_id, id) on delete cascade
);

create table if not exists public.production_assets (
  org_id uuid not null,
  project_id text not null,
  asset_id text not null check (asset_id ~ '^[a-z0-9][a-z0-9_.-]{0,127}$'),
  version integer not null default 1 check (version >= 1),
  kind text not null check (kind in ('master','set','prop','audio','recording','export','character','script','unreal_sequence')),
  path text not null check (length(path) between 1 and 400 and path !~ '(^/|^[A-Za-z]:|\\|(^|/)\.\.(/|$))'),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint check (bytes is null or bytes >= 0),
  approved boolean not null default false,
  editable boolean not null default true,
  label text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (org_id, project_id, asset_id, version),
  foreign key (org_id, project_id) references public.production_projects(org_id, id) on delete cascade
);
create index if not exists production_assets_path_idx on public.production_assets(org_id, project_id, path);

create table if not exists public.production_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id text not null,
  actor_id text not null check (actor_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  profile_id uuid,
  -- camera, microphone, face_tracking, performance, likeness, render, transcript
  scope text[] not null default '{}',
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  evidence_ref text,
  created_at timestamptz not null default now(),
  foreign key (org_id, project_id) references public.production_projects(org_id, id) on delete cascade
);
create index if not exists production_consents_actor_idx on public.production_consents(org_id, project_id, actor_id) where revoked_at is null;

create table if not exists public.production_shots (
  org_id uuid not null,
  project_id text not null,
  shot_id text not null check (shot_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  episode text,
  start_frame integer,
  end_frame integer,
  fps integer not null default 24,
  camera text,
  line_id text,
  actors text[] not null default '{}',
  status text not null default 'open' check (status in ('open','locked','final')),
  updated_at timestamptz not null default now(),
  primary key (org_id, project_id, shot_id),
  check (end_frame is null or start_frame is null or end_frame >= start_frame),
  foreign key (org_id, project_id) references public.production_projects(org_id, id) on delete cascade
);

create table if not exists public.production_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id text not null,
  kind text not null check (kind in ('render','facetrack','transcript')),
  shot_id text,
  take integer check (take is null or take between 1 and 999),
  engine text,
  job_key text not null check (length(job_key) between 8 and 300),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  retake_of uuid references public.production_jobs(id) on delete set null,
  compute_task_id uuid references public.ops_compute_tasks(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','canceled','cancel_requested')),
  max_attempts integer not null default 2 check (max_attempts between 1 and 3),
  cancel_requested_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, job_key),
  foreign key (org_id, project_id) references public.production_projects(org_id, id) on delete cascade
);
create index if not exists production_jobs_shot_idx on public.production_jobs(org_id, project_id, kind, shot_id, created_at desc);
create index if not exists production_jobs_task_idx on public.production_jobs(compute_task_id);

create table if not exists public.production_artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  project_id text not null,
  job_id uuid not null references public.production_jobs(id) on delete cascade,
  shot_id text,
  take integer,
  kind text not null check (kind in ('preview_mp4','frames','log','export','unreal_project','level_sequence','checks','curves','transcript','receipt','blend','render_result')),
  path text not null check (length(path) between 1 and 1000),
  project_path text,
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint,
  node_id text references public.ops_compute_nodes(id) on delete set null,
  storage text not null default 'node-local' check (storage in ('node-local','supabase-private')),
  simulated boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (job_id, kind, path),
  foreign key (org_id, project_id) references public.production_projects(org_id, id) on delete cascade
);
create index if not exists production_artifacts_project_idx on public.production_artifacts(org_id, project_id, created_at desc);

alter table public.production_projects enable row level security;
alter table public.production_members enable row level security;
alter table public.production_assets enable row level security;
alter table public.production_consents enable row level security;
alter table public.production_shots enable row level security;
alter table public.production_jobs enable row level security;
alter table public.production_artifacts enable row level security;

revoke all on public.production_projects, public.production_members, public.production_assets, public.production_consents,
  public.production_shots, public.production_jobs, public.production_artifacts from anon, authenticated;
grant select, insert, update, delete on public.production_projects, public.production_members, public.production_assets,
  public.production_consents, public.production_shots, public.production_jobs, public.production_artifacts to service_role;

-- Cancel a compute task for its owner: queued -> canceled atomically
-- against the claim (the claim locks queued rows FOR UPDATE SKIP LOCKED);
-- leased/running -> metadata.cancel_requested_at, which the compute
-- gateway returns on the holder's next lease heartbeat so the node stops
-- the executor and reports a final, non-retried failure.
create or replace function public.production_request_compute_cancel(p_org_id uuid, p_task_id uuid, p_reason text default 'canceled')
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_task public.ops_compute_tasks%rowtype;
begin
  select * into v_task from public.ops_compute_tasks where id = p_task_id and org_id = p_org_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_task.status = 'queued' then
    update public.ops_compute_tasks set status = 'canceled', last_error = left(coalesce(p_reason,'canceled'), 4000), updated_at = now() where id = p_task_id;
    return jsonb_build_object('ok', true, 'mode', 'queued', 'task_id', p_task_id);
  end if;
  if v_task.status in ('leased','running') then
    update public.ops_compute_tasks
      set metadata = metadata || jsonb_build_object('cancel_requested_at', now(), 'cancel_reason', left(coalesce(p_reason,'canceled'), 500)),
          updated_at = now()
      where id = p_task_id;
    return jsonb_build_object('ok', true, 'mode', 'running', 'task_id', p_task_id);
  end if;
  return jsonb_build_object('ok', false, 'reason', v_task.status, 'task_id', p_task_id);
end;
$$;
revoke all on function public.production_request_compute_cancel(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.production_request_compute_cancel(uuid, uuid, text) to service_role;

commit;
