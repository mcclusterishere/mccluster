create table if not exists public.control_observability_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  trace_id uuid not null,
  request_id uuid not null,
  parent_span_id uuid,
  event_kind text not null default 'request'
    check (event_kind in ('request','job','scheduled','dependency','incident')),
  level text not null default 'info'
    check (level in ('info','warn','error')),
  service text not null default 'mccluster-worker',
  route text not null,
  method text,
  status_code integer,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  actor_user_id uuid references auth.users(id) on delete set null,
  resource_type text,
  resource_id text,
  message text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, request_id)
);

create index if not exists control_observability_events_org_created_idx
  on public.control_observability_events(org_id, created_at desc, id desc);

create index if not exists control_observability_events_trace_idx
  on public.control_observability_events(org_id, trace_id, created_at asc, id asc);

create index if not exists control_observability_events_level_idx
  on public.control_observability_events(org_id, level, created_at desc);

alter table public.control_observability_events enable row level security;
alter table public.control_observability_events force row level security;

revoke all on table public.control_observability_events from public;
revoke all on table public.control_observability_events from anon;
revoke all on table public.control_observability_events from authenticated;
grant select, insert, delete on table public.control_observability_events to service_role;
grant usage, select on sequence public.control_observability_events_id_seq to service_role;

comment on table public.control_observability_events is
  'Durable org-scoped Control observability events. Worker writes only after verifying the claimed workspace membership; browser roles have no direct access.';
