-- Learning evidence v1: the PRIM3 / Equity Uprise learning record on the shared data plane.
--
-- What a learner did in the SANDBOX building (lab sessions and their append-only,
-- hash-chained evidence), what Equity Uprise rates them (competency states, with the
-- automated ceiling at Demonstrated), what they earned elsewhere (certificates uploaded
-- to a private bucket, self-reported until a reviewer verifies them), where they are in
-- a pathway, and FEMA HSEEP exercise records (EEG observations, hotwash, AAR/IP and the
-- improvement items that follow) plus the ICS-214 activity log.
--
-- Per learner from day one (user_id everywhere) so the LMS can open later; today the
-- Worker serves it to the house owner only (workers/mccluster/src/prim3/learning.js,
-- LEARNING_AUDIENCE). Written by Worker `mccluster` and McCluster Core with the service
-- role. RLS: a learner reads their own rows; reviewers and the house owner read and
-- review; anon reads nothing.
--
-- Equity Uprise never issues FEMA, CISA, IRS, CompTIA or BICSI credentials, and the FEMA
-- SID is never stored. Idempotent: safe to run twice.

-- ---------------------------------------------------------------------------
-- Reviewers and the reviewer test used by RLS
-- ---------------------------------------------------------------------------
create table if not exists public.learning_reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'reviewer' check (role in ('reviewer', 'evaluator', 'controller')),
  active boolean not null default true,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Any given user (triggers, service role). Not callable by clients: it would let anyone probe who reviews.
create or replace function public.learning_user_is_reviewer(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and (
    exists (
      select 1 from public.org_members m
      join public.orgs o on o.id = m.org_id
      where o.slug = 'mccluster' and m.role = 'owner' and m.profile_id = p_user
    )
    or exists (select 1 from public.learning_reviewers r where r.user_id = p_user and r.active)
  )
$$;
revoke all on function public.learning_user_is_reviewer(uuid) from public, anon, authenticated;
grant execute on function public.learning_user_is_reviewer(uuid) to service_role;

-- The caller (RLS).
create or replace function public.learning_is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.learning_user_is_reviewer((select auth.uid()))
$$;
revoke all on function public.learning_is_reviewer() from public, anon;
grant execute on function public.learning_is_reviewer() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Lab sessions
-- ---------------------------------------------------------------------------
create table if not exists public.learning_lab_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pack_id text not null check (pack_id ~ '^[a-z][a-z0-9-]{2,63}$'),
  pack_version text not null check (pack_version ~ '^\d+\.\d+\.\d+$'),
  scenario_id text not null check (scenario_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$'),
  mode text not null default 'SIMULATION' check (mode in ('SIMULATION', 'SANDBOX')),
  execution_target text not null default 'SANDBOX' check (execution_target = 'SANDBOX'),
  difficulty text check (difficulty in ('FOUNDATION', 'TECHNICIAN', 'ADMIN', 'ADVANCED', 'EXPERT')),
  seed bigint not null default 0,
  exercise_id uuid,
  ics_role text check (ics_role ~ '^[a-z][a-z_]{2,40}$'),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text not null default 'in_progress'
    check (outcome in ('in_progress', 'completed', 'incomplete', 'abandoned', 'safety_stop')),
  last_event_seq integer not null default 0,
  last_event_hash text check (last_event_hash ~ '^[0-9a-f]{64}$'),
  evidence_bundle_sha256 text check (evidence_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check ((outcome = 'in_progress') = (ended_at is null)),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists learning_lab_sessions_user_recent on public.learning_lab_sessions (user_id, started_at desc);
create index if not exists learning_lab_sessions_scenario on public.learning_lab_sessions (user_id, pack_id, scenario_id, outcome);

-- ---------------------------------------------------------------------------
-- Evidence events: append-only, sequenced and hash-chained by the database
-- ---------------------------------------------------------------------------
create table if not exists public.learning_evidence_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.learning_lab_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seq integer not null check (seq >= 1),
  event_type text not null check (event_type in
    ('start', 'inspect', 'action', 'decision', 'hint', 'safety_violation', 'criterion', 'artifact', 'role_change', 'note', 'complete')),
  action_id text check (action_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$'),
  status text check (status in ('success', 'incorrect', 'blocked', 'role_refused', 'error', 'info')),
  actor_role text check (actor_role ~ '^[a-z][a-z_]{2,40}$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  occurred_at timestamptz not null default now(),
  prev_hash text check (prev_hash ~ '^[0-9a-f]{64}$'),
  event_hash text not null check (event_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);
create index if not exists learning_evidence_events_user on public.learning_evidence_events (user_id, created_at desc);

-- The hash a reader can recompute: sha256 over the previous hash and this event's fields.
create or replace function public.learning_event_digest(
  p_prev text, p_session uuid, p_seq integer, p_type text, p_action text, p_status text, p_role text, p_payload jsonb, p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(pg_catalog.sha256(convert_to(concat_ws(E'\n',
    coalesce(p_prev, 'GENESIS'), p_session::text, p_seq::text, p_type, coalesce(p_action, ''), coalesce(p_status, ''),
    coalesce(p_role, ''), p_payload::text, to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'UTF8')), 'hex')
$$;

create or replace function public.learning_evidence_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
begin
  select id, user_id, outcome, last_event_seq, last_event_hash into s
    from public.learning_lab_sessions where id = new.session_id for update;
  if not found then raise exception 'learning session % not found', new.session_id using errcode = '23503'; end if;
  if s.outcome <> 'in_progress' then raise exception 'learning session % is closed', new.session_id using errcode = '55000'; end if;
  if new.user_id <> s.user_id then raise exception 'evidence user does not own the session' using errcode = '42501'; end if;
  new.seq := s.last_event_seq + 1;
  new.prev_hash := s.last_event_hash;
  new.occurred_at := coalesce(new.occurred_at, now());
  new.event_hash := public.learning_event_digest(new.prev_hash, new.session_id, new.seq, new.event_type, new.action_id,
    new.status, new.actor_role, new.payload, new.occurred_at);
  update public.learning_lab_sessions set last_event_seq = new.seq, last_event_hash = new.event_hash where id = new.session_id;
  return new;
end;
$$;
revoke all on function public.learning_evidence_chain() from public, anon, authenticated;

drop trigger if exists learning_evidence_chain on public.learning_evidence_events;
create trigger learning_evidence_chain before insert on public.learning_evidence_events
  for each row execute function public.learning_evidence_chain();

-- Append-only. A learner's whole record goes only when their account does (auth.users
-- cascade); set learning.allow_purge = 'on' in that transaction.
create or replace function public.learning_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('learning.allow_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

drop trigger if exists learning_evidence_append_only on public.learning_evidence_events;
create trigger learning_evidence_append_only before update or delete on public.learning_evidence_events
  for each row execute function public.learning_append_only();

-- ---------------------------------------------------------------------------
-- Competency ratings (history; the latest row per competency is current)
-- ---------------------------------------------------------------------------
create table if not exists public.learning_competency_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  competency_id text not null check (competency_id ~ '^(CORE|SHR|PSC|RSP|ENT|MED|OPS)-\d{2}$'),
  rubric_version text not null default '0.1.0',
  state text not null check (state in ('Aware', 'Trained', 'Practicing', 'Demonstrated', 'Verified', 'Applied', 'Mentor')),
  source text not null check (source in ('automated', 'reviewer')),
  session_id uuid references public.learning_lab_sessions(id) on delete set null,
  exercise_id uuid,
  evidence_sha256 text check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  reviewer_id uuid references auth.users(id),
  review_note text check (char_length(review_note) <= 4000),
  rated_at timestamptz not null default now(),
  -- The automated ceiling: simulation evidence alone never rises above Demonstrated.
  check (source <> 'automated' or (state in ('Aware', 'Trained', 'Practicing', 'Demonstrated') and reviewer_id is null)),
  -- Verified, Applied and Mentor need a named human reviewer who is not the learner.
  check (state not in ('Verified', 'Applied', 'Mentor') or (source = 'reviewer' and reviewer_id is not null and reviewer_id <> user_id)),
  check (source <> 'reviewer' or reviewer_id is not null)
);
create index if not exists learning_competency_ratings_current on public.learning_competency_ratings (user_id, competency_id, rated_at desc);

create or replace function public.learning_rating_reviewer_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'reviewer' and not public.learning_user_is_reviewer(new.reviewer_id) then
    raise exception 'reviewer % is not an Equity Uprise reviewer', new.reviewer_id using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.learning_rating_reviewer_guard() from public, anon, authenticated;
drop trigger if exists learning_rating_reviewer_guard on public.learning_competency_ratings;
create trigger learning_rating_reviewer_guard before insert on public.learning_competency_ratings
  for each row execute function public.learning_rating_reviewer_guard();
drop trigger if exists learning_ratings_append_only on public.learning_competency_ratings;
create trigger learning_ratings_append_only before update or delete on public.learning_competency_ratings
  for each row execute function public.learning_append_only();

-- ---------------------------------------------------------------------------
-- External credentials uploaded by the learner
-- ---------------------------------------------------------------------------
create table if not exists public.learning_external_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  issuer text not null check (char_length(issuer) between 2 and 120),
  catalog_id text check (catalog_id ~ '^[A-Z][A-Z0-9-]{2,63}$'),
  external_program text check (char_length(external_program) <= 200),
  course_code text check (char_length(course_code) <= 40),
  title text not null check (char_length(title) between 2 and 300),
  completion_date date not null check (completion_date >= date '1990-01-01'),
  expires_on date,
  certificate_bucket text not null default 'learning-credentials' check (certificate_bucket = 'learning-credentials'),
  certificate_path text check (certificate_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$'),
  certificate_sha256 text check (certificate_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  byte_size integer check (byte_size between 1 and 10485760),
  verification_status text not null default 'self_reported'
    check (verification_status in ('self_reported', 'reviewer_verified', 'rejected')),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  verification_note text check (char_length(verification_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (catalog_id is not null or external_program is not null),
  check (certificate_path is null or split_part(certificate_path, '/', 1) = user_id::text),
  check (expires_on is null or expires_on >= completion_date),
  check (verification_status = 'self_reported' or (verified_by is not null and verified_at is not null and verified_by <> user_id))
);
create index if not exists learning_external_credentials_user on public.learning_external_credentials (user_id, completion_date desc);
create index if not exists learning_external_credentials_queue on public.learning_external_credentials (verification_status, created_at) where verification_status = 'self_reported';
create unique index if not exists learning_external_credentials_file on public.learning_external_credentials (certificate_path) where certificate_path is not null;

-- Only a reviewer may move a credential off self_reported, and nobody may rewrite what was claimed.
create or replace function public.learning_credential_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verification_status is distinct from old.verification_status
     and new.verification_status <> 'self_reported'
     and not public.learning_user_is_reviewer(new.verified_by) then
    raise exception 'only a reviewer can verify or reject a credential' using errcode = '42501';
  end if;
  if (new.user_id, new.issuer, new.catalog_id, new.title, new.completion_date, new.certificate_path, new.certificate_sha256)
     is distinct from (old.user_id, old.issuer, old.catalog_id, old.title, old.completion_date, old.certificate_path, old.certificate_sha256)
     and old.verification_status <> 'self_reported' then
    raise exception 'a reviewed credential cannot be edited; upload a new one' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.learning_credential_guard() from public, anon, authenticated;
drop trigger if exists learning_credential_guard on public.learning_external_credentials;
create trigger learning_credential_guard before update on public.learning_external_credentials
  for each row execute function public.learning_credential_guard();

-- ---------------------------------------------------------------------------
-- Pathway enrollment and step progress (LEARNING-PATHWAYS.json)
-- ---------------------------------------------------------------------------
create table if not exists public.learning_pathway_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pathway_id text not null check (pathway_id ~ '^[a-z][a-z0-9-]{2,63}$'),
  pathways_version text not null check (pathways_version ~ '^\d+\.\d+\.\d+$'),
  status text not null default 'active' check (status in ('active', 'completed', 'withdrawn')),
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, pathway_id),
  check ((status = 'completed') = (completed_at is not null))
);

create table if not exists public.learning_pathway_step_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.learning_pathway_enrollments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  step_id text not null check (step_id ~ '^[a-z][a-z0-9-]{2,63}$'),
  status text not null check (status in ('locked', 'available', 'evidence_submitted', 'satisfied', 'reviewer_confirmed')),
  credential_id uuid references public.learning_external_credentials(id) on delete set null,
  session_id uuid references public.learning_lab_sessions(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (enrollment_id, step_id)
);

-- ---------------------------------------------------------------------------
-- HSEEP exercises, EEG observations, hotwash, AAR/IP, improvement items, ICS-214
-- ---------------------------------------------------------------------------
create table if not exists public.learning_hseep_exercises (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  title text not null check (char_length(title) between 3 and 200),
  exercise_type text not null check (exercise_type in ('seminar', 'workshop', 'tabletop', 'game', 'drill', 'functional', 'full_scale')),
  pack_id text check (pack_id ~ '^[a-z][a-z0-9-]{2,63}$'),
  pack_version text check (pack_version ~ '^\d+\.\d+\.\d+$'),
  scenario_id text check (scenario_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$'),
  mode text not null default 'SIMULATION' check (mode in ('SIMULATION', 'SANDBOX')),
  status text not null default 'planned' check (status in ('planned', 'conducted', 'evaluated', 'aar_draft', 'aar_final', 'closed')),
  objectives jsonb not null default '[]'::jsonb check (jsonb_typeof(objectives) = 'array'),
  core_capabilities text[] not null default '{}',
  scheduled_for timestamptz,
  conducted_at timestamptz,
  hotwash_notes text check (char_length(hotwash_notes) <= 20000),
  hotwash_recorded_at timestamptz,
  hotwash_recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.learning_lab_sessions
    add constraint learning_lab_sessions_exercise_fk foreign key (exercise_id) references public.learning_hseep_exercises(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.learning_competency_ratings
    add constraint learning_competency_ratings_exercise_fk foreign key (exercise_id) references public.learning_hseep_exercises(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.learning_hseep_participants (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.learning_hseep_exercises(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_role text not null check (exercise_role in ('player', 'controller', 'evaluator', 'facilitator', 'observer')),
  ics_position text check (ics_position ~ '^[a-z][a-z_]{2,40}$'),
  session_id uuid references public.learning_lab_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (exercise_id, user_id, exercise_role)
);
create index if not exists learning_hseep_participants_user on public.learning_hseep_participants (user_id);

-- Exercise Evaluation Guide observations, rated with HSEEP's P / S / M / U.
create table if not exists public.learning_hseep_evaluations (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.learning_hseep_exercises(id) on delete cascade,
  evaluator_id uuid not null references auth.users(id),
  criterion_id text not null check (criterion_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$'),
  objective_id text check (objective_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$'),
  rating text not null check (rating in ('P', 'S', 'M', 'U')),
  observation_type text not null check (observation_type in ('strength', 'area_for_improvement')),
  observation text not null check (char_length(observation) between 3 and 4000),
  source text not null default 'human' check (source in ('human', 'automated_draft')),
  recorded_at timestamptz not null default now()
);
create index if not exists learning_hseep_evaluations_exercise on public.learning_hseep_evaluations (exercise_id, criterion_id);

create table if not exists public.learning_hseep_aar (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null unique references public.learning_hseep_exercises(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'final')),
  summary text check (char_length(summary) <= 20000),
  strengths jsonb not null default '[]'::jsonb check (jsonb_typeof(strengths) = 'array'),
  areas_for_improvement jsonb not null default '[]'::jsonb check (jsonb_typeof(areas_for_improvement) = 'array'),
  document_sha256 text check (document_sha256 ~ '^[0-9a-f]{64}$'),
  drafted_by uuid references auth.users(id),
  finalized_by uuid references auth.users(id),
  finalized_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'final') = (finalized_by is not null and finalized_at is not null))
);

create table if not exists public.learning_hseep_improvement_items (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.learning_hseep_exercises(id) on delete cascade,
  item_code text not null check (item_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$'),
  objective_id text,
  issue text not null check (char_length(issue) between 3 and 2000),
  corrective_action text check (char_length(corrective_action) <= 2000),
  core_capability text,
  owner_user_id uuid references auth.users(id),
  owner_label text check (char_length(owner_label) <= 200),
  start_date date,
  due_date date,
  status text not null default 'open' check (status in ('open', 'in_progress', 'closed', 'deferred')),
  closed_at timestamptz,
  closure_evidence text check (char_length(closure_evidence) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exercise_id, item_code),
  check ((status = 'closed') = (closed_at is not null)),
  check (status <> 'closed' or closure_evidence is not null),
  check (due_date is null or start_date is null or due_date >= start_date)
);

-- ICS Form 214 activity log lines, append-only.
create table if not exists public.learning_ics214_entries (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid references public.learning_hseep_exercises(id) on delete cascade,
  session_id uuid references public.learning_lab_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ics_position text not null check (ics_position ~ '^[a-z][a-z_]{2,40}$'),
  operational_period text check (char_length(operational_period) <= 120),
  entry_time timestamptz not null default now(),
  activity text not null check (char_length(activity) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (exercise_id is not null or session_id is not null)
);
create index if not exists learning_ics214_entries_exercise on public.learning_ics214_entries (exercise_id, entry_time);
drop trigger if exists learning_ics214_append_only on public.learning_ics214_entries;
create trigger learning_ics214_append_only before update or delete on public.learning_ics214_entries
  for each row execute function public.learning_append_only();

-- updated_at on the mutable tables
create or replace function public.learning_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists learning_touch on public.learning_pathway_enrollments;
create trigger learning_touch before update on public.learning_pathway_enrollments for each row execute function public.learning_touch_updated_at();
drop trigger if exists learning_touch on public.learning_pathway_step_progress;
create trigger learning_touch before update on public.learning_pathway_step_progress for each row execute function public.learning_touch_updated_at();
drop trigger if exists learning_touch on public.learning_hseep_exercises;
create trigger learning_touch before update on public.learning_hseep_exercises for each row execute function public.learning_touch_updated_at();
drop trigger if exists learning_touch on public.learning_hseep_aar;
create trigger learning_touch before update on public.learning_hseep_aar for each row execute function public.learning_touch_updated_at();
drop trigger if exists learning_touch on public.learning_hseep_improvement_items;
create trigger learning_touch before update on public.learning_hseep_improvement_items for each row execute function public.learning_touch_updated_at();

-- Who may see an exercise: a reviewer, its creator, or anyone on its roster.
create or replace function public.learning_in_exercise(p_exercise uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.learning_hseep_participants p
    where p.exercise_id = p_exercise and p.user_id = (select auth.uid())
  ) or exists (
    select 1 from public.learning_hseep_exercises e
    where e.id = p_exercise and e.created_by = (select auth.uid())
  )
$$;
revoke all on function public.learning_in_exercise(uuid) from public, anon;
grant execute on function public.learning_in_exercise(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.learning_reviewers enable row level security;
alter table public.learning_lab_sessions enable row level security;
alter table public.learning_evidence_events enable row level security;
alter table public.learning_competency_ratings enable row level security;
alter table public.learning_external_credentials enable row level security;
alter table public.learning_pathway_enrollments enable row level security;
alter table public.learning_pathway_step_progress enable row level security;
alter table public.learning_hseep_exercises enable row level security;
alter table public.learning_hseep_participants enable row level security;
alter table public.learning_hseep_evaluations enable row level security;
alter table public.learning_hseep_aar enable row level security;
alter table public.learning_hseep_improvement_items enable row level security;
alter table public.learning_ics214_entries enable row level security;

revoke all on public.learning_reviewers, public.learning_lab_sessions, public.learning_evidence_events,
  public.learning_competency_ratings, public.learning_external_credentials, public.learning_pathway_enrollments,
  public.learning_pathway_step_progress, public.learning_hseep_exercises, public.learning_hseep_participants,
  public.learning_hseep_evaluations, public.learning_hseep_aar, public.learning_hseep_improvement_items,
  public.learning_ics214_entries from anon, authenticated;
grant all on public.learning_reviewers, public.learning_lab_sessions, public.learning_evidence_events,
  public.learning_competency_ratings, public.learning_external_credentials, public.learning_pathway_enrollments,
  public.learning_pathway_step_progress, public.learning_hseep_exercises, public.learning_hseep_participants,
  public.learning_hseep_evaluations, public.learning_hseep_aar, public.learning_hseep_improvement_items,
  public.learning_ics214_entries to service_role;

-- Learners read their own learning record; reviewers read everyone's.
grant select on public.learning_lab_sessions, public.learning_evidence_events, public.learning_competency_ratings,
  public.learning_external_credentials, public.learning_pathway_enrollments, public.learning_pathway_step_progress,
  public.learning_hseep_exercises, public.learning_hseep_participants, public.learning_hseep_evaluations,
  public.learning_hseep_aar, public.learning_hseep_improvement_items, public.learning_ics214_entries,
  public.learning_reviewers to authenticated;
-- Learners may start sessions, append evidence, claim credentials and enrol; nothing else.
grant insert on public.learning_lab_sessions, public.learning_evidence_events,
  public.learning_external_credentials, public.learning_pathway_enrollments to authenticated;
-- Reviewers rate competencies and verify credentials (RLS below narrows both).
grant insert on public.learning_competency_ratings to authenticated;
grant update (verification_status, verified_by, verified_at, verification_note) on public.learning_external_credentials to authenticated;

drop policy if exists learning_reviewers_read on public.learning_reviewers;
create policy learning_reviewers_read on public.learning_reviewers for select to authenticated
  using (user_id = (select auth.uid()) or (select public.learning_is_reviewer()));

drop policy if exists learning_sessions_read on public.learning_lab_sessions;
create policy learning_sessions_read on public.learning_lab_sessions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.learning_is_reviewer()));
drop policy if exists learning_sessions_start on public.learning_lab_sessions;
create policy learning_sessions_start on public.learning_lab_sessions for insert to authenticated
  with check (user_id = (select auth.uid()) and outcome = 'in_progress' and ended_at is null and last_event_seq = 0);

drop policy if exists learning_events_read on public.learning_evidence_events;
create policy learning_events_read on public.learning_evidence_events for select to authenticated
  using (user_id = (select auth.uid()) or (select public.learning_is_reviewer()));
drop policy if exists learning_events_append on public.learning_evidence_events;
create policy learning_events_append on public.learning_evidence_events for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists learning_ratings_read on public.learning_competency_ratings;
create policy learning_ratings_read on public.learning_competency_ratings for select to authenticated
  using (user_id = (select auth.uid()) or (select public.learning_is_reviewer()));
drop policy if exists learning_ratings_review on public.learning_competency_ratings;
create policy learning_ratings_review on public.learning_competency_ratings for insert to authenticated
  with check (source = 'reviewer' and reviewer_id = (select auth.uid()) and user_id <> (select auth.uid())
              and (select public.learning_is_reviewer()));

drop policy if exists learning_credentials_read on public.learning_external_credentials;
create policy learning_credentials_read on public.learning_external_credentials for select to authenticated
  using (user_id = (select auth.uid()) or (select public.learning_is_reviewer()));
drop policy if exists learning_credentials_claim on public.learning_external_credentials;
create policy learning_credentials_claim on public.learning_external_credentials for insert to authenticated
  with check (user_id = (select auth.uid()) and verification_status = 'self_reported' and verified_by is null);
drop policy if exists learning_credentials_review on public.learning_external_credentials;
create policy learning_credentials_review on public.learning_external_credentials for update to authenticated
  using ((select public.learning_is_reviewer()) and user_id <> (select auth.uid()))
  with check (verified_by = (select auth.uid()));

drop policy if exists learning_enrollments_read on public.learning_pathway_enrollments;
create policy learning_enrollments_read on public.learning_pathway_enrollments for select to authenticated
  using (user_id = (select auth.uid()) or (select public.learning_is_reviewer()));
drop policy if exists learning_enrollments_join on public.learning_pathway_enrollments;
create policy learning_enrollments_join on public.learning_pathway_enrollments for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'active');

drop policy if exists learning_steps_read on public.learning_pathway_step_progress;
create policy learning_steps_read on public.learning_pathway_step_progress for select to authenticated
  using (user_id = (select auth.uid()) or (select public.learning_is_reviewer()));

drop policy if exists learning_exercises_read on public.learning_hseep_exercises;
create policy learning_exercises_read on public.learning_hseep_exercises for select to authenticated
  using ((select public.learning_is_reviewer()) or public.learning_in_exercise(id));
drop policy if exists learning_participants_read on public.learning_hseep_participants;
create policy learning_participants_read on public.learning_hseep_participants for select to authenticated
  using ((select public.learning_is_reviewer()) or public.learning_in_exercise(exercise_id));
drop policy if exists learning_evaluations_read on public.learning_hseep_evaluations;
create policy learning_evaluations_read on public.learning_hseep_evaluations for select to authenticated
  using ((select public.learning_is_reviewer()) or public.learning_in_exercise(exercise_id));
drop policy if exists learning_aar_read on public.learning_hseep_aar;
create policy learning_aar_read on public.learning_hseep_aar for select to authenticated
  using ((select public.learning_is_reviewer()) or public.learning_in_exercise(exercise_id));
drop policy if exists learning_improvements_read on public.learning_hseep_improvement_items;
create policy learning_improvements_read on public.learning_hseep_improvement_items for select to authenticated
  using ((select public.learning_is_reviewer()) or public.learning_in_exercise(exercise_id) or owner_user_id = (select auth.uid()));
drop policy if exists learning_ics214_read on public.learning_ics214_entries;
create policy learning_ics214_read on public.learning_ics214_entries for select to authenticated
  using (user_id = (select auth.uid()) or (select public.learning_is_reviewer())
         or (exercise_id is not null and public.learning_in_exercise(exercise_id)));

-- ---------------------------------------------------------------------------
-- Private certificate bucket: <user_id>/<uuid>.<ext>; the owner and reviewers read.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('learning-credentials', 'learning-credentials', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "learning credentials: learners upload to their own folder" on storage.objects;
create policy "learning credentials: learners upload to their own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'learning-credentials' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "learning credentials: owner and reviewers read" on storage.objects;
create policy "learning credentials: owner and reviewers read" on storage.objects for select to authenticated
  using (bucket_id = 'learning-credentials'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.learning_is_reviewer())));
