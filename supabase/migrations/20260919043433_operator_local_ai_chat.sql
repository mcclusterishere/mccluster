-- Durable owner-only conversation state for the resident McCluster AI.
-- Inference remains provider-independent behind Core's stable ai.chat capability.

create table if not exists public.ops_ai_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  title text not null default 'New chat',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (id, org_id)
);

create index if not exists ops_ai_threads_org_recent_idx
  on public.ops_ai_threads(org_id, status, last_message_at desc);

create table if not exists public.ops_ai_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  org_id uuid not null,
  role text not null check (role in ('system','user','assistant','tool')),
  content text not null check (length(btrim(content)) > 0),
  model text,
  implementation text,
  compute_task_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ops_ai_messages_thread_org_fk
    foreign key (thread_id, org_id)
    references public.ops_ai_threads(id, org_id)
    on delete cascade
);

create index if not exists ops_ai_messages_thread_created_idx
  on public.ops_ai_messages(thread_id, created_at asc);
create index if not exists ops_ai_messages_org_created_idx
  on public.ops_ai_messages(org_id, created_at desc);

alter table public.ops_ai_threads enable row level security;
alter table public.ops_ai_threads force row level security;
alter table public.ops_ai_messages enable row level security;
alter table public.ops_ai_messages force row level security;

drop policy if exists ops_ai_threads_owner on public.ops_ai_threads;
create policy ops_ai_threads_owner on public.ops_ai_threads
  for all to authenticated
  using (private.is_org_owner(org_id))
  with check (private.is_org_owner(org_id));

drop policy if exists ops_ai_messages_owner on public.ops_ai_messages;
create policy ops_ai_messages_owner on public.ops_ai_messages
  for all to authenticated
  using (private.is_org_owner(org_id))
  with check (private.is_org_owner(org_id));

revoke all on table public.ops_ai_threads from public, anon, authenticated;
revoke all on table public.ops_ai_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_ai_threads to authenticated;
grant select, insert, update, delete on table public.ops_ai_messages to authenticated;
grant all on table public.ops_ai_threads to service_role;
grant all on table public.ops_ai_messages to service_role;

create or replace function public.ops_ai_touch_thread()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.ops_ai_threads
     set updated_at = now(),
         last_message_at = new.created_at,
         title = case
           when title = 'New chat' and new.role = 'user'
             then left(regexp_replace(btrim(new.content), E'\\s+', ' ', 'g'), 80)
           else title
         end
   where id = new.thread_id
     and org_id = new.org_id;
  return new;
end;
$$;

revoke all on function public.ops_ai_touch_thread() from public, anon, authenticated;

drop trigger if exists ops_ai_messages_touch_thread_t on public.ops_ai_messages;
create trigger ops_ai_messages_touch_thread_t
  after insert on public.ops_ai_messages
  for each row execute function public.ops_ai_touch_thread();

comment on table public.ops_ai_threads is
  'Durable owner-only conversation threads for the resident McCluster AI.';
comment on table public.ops_ai_messages is
  'Durable user/assistant messages whose inference runs through the stable Core ai.chat capability.';
