create table if not exists public.fabric_events (
  event_id uuid primary key,
  org_id uuid not null,
  trace_id uuid not null,
  schema_version smallint not null default 1 check (schema_version = 1),
  kind text not null check (char_length(kind) between 1 and 160),
  origin_node text not null check (origin_node in ('supabase','cloudflare','ovh')),
  occurred_at timestamptz not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.fabric_receipts (
  event_id uuid not null references public.fabric_events(event_id) on delete cascade,
  node text not null check (node in ('supabase','cloudflare','ovh')),
  state text not null default 'seen' check (state in ('seen','acked')),
  first_seen_at timestamptz not null default now(),
  acked_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (event_id, node)
);

create table if not exists public.fabric_outbox (
  event_id uuid not null references public.fabric_events(event_id) on delete cascade,
  target_node text not null check (target_node in ('cloudflare','ovh')),
  status text not null default 'pending' check (status in ('pending','leased','acked','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  acked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, target_node)
);

create index if not exists fabric_events_org_created_idx on public.fabric_events(org_id, created_at desc);
create index if not exists fabric_events_trace_idx on public.fabric_events(trace_id, created_at asc);
create index if not exists fabric_receipts_node_state_idx on public.fabric_receipts(node, state, updated_at desc);
create index if not exists fabric_outbox_due_idx on public.fabric_outbox(target_node, status, next_attempt_at, created_at);

alter table public.fabric_events enable row level security;
alter table public.fabric_receipts enable row level security;
alter table public.fabric_outbox enable row level security;

revoke all on table public.fabric_events from anon, authenticated;
revoke all on table public.fabric_receipts from anon, authenticated;
revoke all on table public.fabric_outbox from anon, authenticated;

grant select, insert on table public.fabric_events to service_role;
grant select, insert, update on table public.fabric_receipts to service_role;
grant select, insert, update on table public.fabric_outbox to service_role;

create or replace function public.fabric_seed_delivery()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.fabric_receipts(event_id, node, state, first_seen_at, acked_at, attempts, updated_at)
  values (new.event_id, 'supabase', 'acked', now(), now(), 1, now())
  on conflict (event_id, node) do update
    set state = 'acked',
        acked_at = coalesce(public.fabric_receipts.acked_at, excluded.acked_at),
        attempts = greatest(public.fabric_receipts.attempts, 1),
        last_error = null,
        updated_at = now();

  if new.origin_node = 'cloudflare' then
    insert into public.fabric_receipts(event_id, node, state, first_seen_at, acked_at, attempts, updated_at)
    values (new.event_id, 'cloudflare', 'acked', now(), now(), 1, now())
    on conflict (event_id, node) do update
      set state='acked', acked_at=coalesce(public.fabric_receipts.acked_at, excluded.acked_at), last_error=null, updated_at=now();
  else
    insert into public.fabric_outbox(event_id, target_node) values (new.event_id, 'cloudflare')
    on conflict (event_id, target_node) do nothing;
  end if;

  if new.origin_node = 'ovh' then
    insert into public.fabric_receipts(event_id, node, state, first_seen_at, acked_at, attempts, updated_at)
    values (new.event_id, 'ovh', 'acked', now(), now(), 1, now())
    on conflict (event_id, node) do update
      set state='acked', acked_at=coalesce(public.fabric_receipts.acked_at, excluded.acked_at), last_error=null, updated_at=now();
  else
    insert into public.fabric_outbox(event_id, target_node) values (new.event_id, 'ovh')
    on conflict (event_id, target_node) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.fabric_seed_delivery() from public, anon, authenticated;
grant execute on function public.fabric_seed_delivery() to service_role;

drop trigger if exists fabric_events_seed_delivery on public.fabric_events;
create trigger fabric_events_seed_delivery
after insert on public.fabric_events
for each row execute function public.fabric_seed_delivery();
