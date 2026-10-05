-- Owned meeting-delegate sessions for McCluster Core.
-- Raw meeting provider credentials never belong in these tables.

create table if not exists public.ops_meeting_delegate_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  calendar_event_id text,
  provider text not null default 'vexa-compatible',
  provider_bot_id text,
  platform text not null check (platform in ('google_meet','teams','zoom','jitsi')),
  meeting_url_hash text,
  native_meeting_id text,
  mode text not null check (mode in ('notes','delegate','observe')),
  bot_display_name text not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','dispatching','dispatched','joined','collecting','completed','failed','cancelled')),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  dispatched_at timestamptz,
  joined_at timestamptz,
  completed_at timestamptz,
  join_job_id text,
  collect_job_id text,
  brief jsonb not null default '{}'::jsonb,
  policy jsonb not null default '{}'::jsonb,
  transcript jsonb,
  summary jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ops_meeting_delegate_sessions_calendar_event_uniq
  on public.ops_meeting_delegate_sessions(org_id, calendar_event_id)
  where calendar_event_id is not null;

create index if not exists ops_meeting_delegate_sessions_org_schedule_idx
  on public.ops_meeting_delegate_sessions(org_id, scheduled_start desc);

create index if not exists ops_meeting_delegate_sessions_org_status_idx
  on public.ops_meeting_delegate_sessions(org_id, status, updated_at desc);

create table if not exists public.ops_meeting_delegate_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  session_id uuid not null references public.ops_meeting_delegate_sessions(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists ops_meeting_delegate_events_session_time_idx
  on public.ops_meeting_delegate_events(session_id, occurred_at asc);

alter table public.ops_meeting_delegate_sessions enable row level security;
alter table public.ops_meeting_delegate_sessions force row level security;
alter table public.ops_meeting_delegate_events enable row level security;
alter table public.ops_meeting_delegate_events force row level security;

drop policy if exists ops_meeting_delegate_sessions_owner on public.ops_meeting_delegate_sessions;
create policy ops_meeting_delegate_sessions_owner on public.ops_meeting_delegate_sessions
  for all to authenticated
  using (private.is_org_owner(org_id))
  with check (private.is_org_owner(org_id));

drop policy if exists ops_meeting_delegate_events_owner on public.ops_meeting_delegate_events;
create policy ops_meeting_delegate_events_owner on public.ops_meeting_delegate_events
  for all to authenticated
  using (private.is_org_owner(org_id))
  with check (private.is_org_owner(org_id));

revoke all on table public.ops_meeting_delegate_sessions from public, anon, authenticated;
revoke all on table public.ops_meeting_delegate_events from public, anon, authenticated;

grant select, insert, update, delete on table public.ops_meeting_delegate_sessions to authenticated;
grant select, insert, update, delete on table public.ops_meeting_delegate_events to authenticated;

grant all on table public.ops_meeting_delegate_sessions to service_role;
grant all on table public.ops_meeting_delegate_events to service_role;

comment on table public.ops_meeting_delegate_sessions is
  'Owner-only durable lifecycle, briefing, transcript and debrief state for disclosed McCluster AI meeting attendance.';

comment on table public.ops_meeting_delegate_events is
  'Append-only-style lifecycle evidence for McCluster AI meeting sessions; provider secrets are never stored here.';
