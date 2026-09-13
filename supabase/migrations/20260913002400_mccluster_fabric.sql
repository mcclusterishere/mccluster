-- McCluster Fabric v1: canonical immutable event log, receipts, and peer outbox.
-- Supabase remains authoritative durable state; Cloudflare and OVH are relay peers.

create table if not exists public.fabric_events (
  event_id uuid primary key,
  org_id uuid not null,
  trace_id uuid not null,
  kind text not null check (length(btrim(kind)) > 0 and length(kind) <= 160),
  origin_node text not null check (origin_node in ('supabase','cloudflare','ovh')),
  occurred_at timestamptz not null,
  schema_version integer not null default 1 check (schema_version > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint fabric_conversation_reference_only check (
    kind <> 'conversation.ingested'
    or (
      (payload - array['provider','conversation_id','receipt_id','message_count','payload_hash']::text[]) = '{}'::jsonb
      and coalesce(payload->>'conversation_id','') <> ''
      and coalesce(payload->>'receipt_id','') <> ''
      and jsonb_typeof(payload->'message_count') = 'number'
      and (payload->>'message_count')::numeric >= 0
    )
  )
);

create index if not exists fabric_events_org_created_idx
  on public.fabric_events(org_id, created_at desc);

create table if not exists public.fabric_receipts (
  event_id uuid not null references public.fabric_events(event_id) on delete cascade,
  node text not null check (node in ('supabase','cloudflare','ovh')),
  state text not null default 'pending' check (state in ('pending','acked','dead')),
  first_seen_at timestamptz not null default now(),
  acked_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  updated_at timestamptz not null default now(),
  primary key(event_id,node)
);

create table if not exists public.fabric_outbox (
  event_id uuid not null references public.fabric_events(event_id) on delete cascade,
  target_node text not null check (target_node in ('cloudflare','ovh')),
  status text not null default 'pending' check (status in ('pending','leased','acked','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  acked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(event_id,target_node)
);

create index if not exists fabric_outbox_delivery_idx
  on public.fabric_outbox(target_node, status, next_attempt_at, created_at);

create or replace function public.fabric_reject_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'fabric_events is append-only';
end;
$function$;

revoke execute on function public.fabric_reject_event_mutation() from public, anon, authenticated;

drop trigger if exists fabric_events_immutable_guard on public.fabric_events;
create trigger fabric_events_immutable_guard
before update or delete on public.fabric_events
for each row execute function public.fabric_reject_event_mutation();

create or replace function public.fabric_seed_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_target text;
  v_now timestamptz := now();
begin
  insert into public.fabric_receipts(event_id,node,state,first_seen_at,acked_at,attempts,updated_at)
  values(new.event_id,'supabase','acked',v_now,v_now,1,v_now)
  on conflict(event_id,node) do nothing;

  if new.origin_node <> 'supabase' then
    insert into public.fabric_receipts(event_id,node,state,first_seen_at,acked_at,attempts,updated_at)
    values(new.event_id,new.origin_node,'acked',v_now,v_now,1,v_now)
    on conflict(event_id,node) do nothing;
  end if;

  foreach v_target in array array['cloudflare','ovh']::text[] loop
    if v_target <> new.origin_node then
      insert into public.fabric_receipts(event_id,node,state,first_seen_at,attempts,updated_at)
      values(new.event_id,v_target,'pending',v_now,0,v_now)
      on conflict(event_id,node) do nothing;

      insert into public.fabric_outbox(event_id,target_node,status,attempts,next_attempt_at,created_at,updated_at)
      values(new.event_id,v_target,'pending',0,v_now,v_now,v_now)
      on conflict(event_id,target_node) do nothing;
    end if;
  end loop;

  return new;
end;
$function$;

revoke execute on function public.fabric_seed_delivery() from public, anon, authenticated;

drop trigger if exists fabric_events_seed_delivery on public.fabric_events;
create trigger fabric_events_seed_delivery
after insert on public.fabric_events
for each row execute function public.fabric_seed_delivery();

alter table public.fabric_events enable row level security;
alter table public.fabric_receipts enable row level security;
alter table public.fabric_outbox enable row level security;

revoke all on table public.fabric_events from public, anon, authenticated;
revoke all on table public.fabric_receipts from public, anon, authenticated;
revoke all on table public.fabric_outbox from public, anon, authenticated;

revoke all on table public.fabric_events from service_role;
revoke all on table public.fabric_receipts from service_role;
revoke all on table public.fabric_outbox from service_role;

grant select, insert on table public.fabric_events to service_role;
grant select, insert, update on table public.fabric_receipts to service_role;
grant select, insert, update on table public.fabric_outbox to service_role;
