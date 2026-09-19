create table if not exists public.prim3_course_progress (
  user_id uuid not null,
  course_id text not null default 'prim3-foundation',
  module_id text not null check (module_id ~ '^M[0-9]{2}$'),
  reading_completed_at timestamptz,
  assessment_score integer check (assessment_score between 0 and 100),
  assessment_attempts integer not null default 0 check (assessment_attempts >= 0),
  passed_at timestamptz,
  mastery jsonb not null default '{}'::jsonb,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id, module_id)
);

create index if not exists prim3_course_progress_course_user_idx
  on public.prim3_course_progress (course_id, user_id, module_id);

alter table public.prim3_course_progress enable row level security;

drop policy if exists "prim3 progress select own" on public.prim3_course_progress;
create policy "prim3 progress select own"
  on public.prim3_course_progress for select
  using (auth.uid() = user_id);

drop policy if exists "prim3 progress insert own" on public.prim3_course_progress;
create policy "prim3 progress insert own"
  on public.prim3_course_progress for insert
  with check (auth.uid() = user_id);

drop policy if exists "prim3 progress update own" on public.prim3_course_progress;
create policy "prim3 progress update own"
  on public.prim3_course_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "prim3 progress delete own" on public.prim3_course_progress;
create policy "prim3 progress delete own"
  on public.prim3_course_progress for delete
  using (auth.uid() = user_id);
