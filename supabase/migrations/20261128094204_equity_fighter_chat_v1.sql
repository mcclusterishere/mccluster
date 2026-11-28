-- EQUITY FIGHTER CHAT v1 (migration name equity_fighter_chat_v1): state for the Equity Fighter chat layer
-- (packages/equity-fighter), the gateway that connects official Slack / Telegram (and, behind flags,
-- WhatsApp Business Cloud API / Discord) to the McCluster dispatch layer.
-- PENDING ONLY. Never applied to production. Owner approval required before any apply.
-- Contract: docs/control-plane/EQUITY-FIGHTER.md. Rollback: 20261125003000_equity_fighter_chat_v1.rollback.sql.
-- Needs, already in production: public.orgs. Pairs with (but does not require) ai_context_dispatch_v1:
-- ef_runs.turn_id points at ai_context.dispatch_turns by value only, so either can be applied first.
--
-- What it creates, all additive:
--   public.ef_identities  who may talk to the agent per platform account: owner (paired or allowlisted) or blocked.
--   public.ef_messages    inbound/outbound chat messages; unique (platform, external_msg_id) is the idempotency
--                         claim for platform retries. The owner can delete them (/forget).
--   public.ef_runs        one row per request: the dispatch turn, job, approval and reply address it maps to.
--   public.ef_steps       checkpoints of the gateway's agent loop (receive, route, record, reply); unique (run, seq).
-- No routing decision, approval or memory lives here: those stay in ai_context.dispatch_turns,
-- ai_context.decisions and public.control_approvals, written by the dispatch layer.
--
-- Access: RLS on and forced, no policies, no grants to anon or authenticated. Only service_role (the gateway's
-- server-side key) reads and writes. It changes no existing object. One transaction, safe to run twice.
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if to_regclass('public.orgs') is null then
    raise exception 'equity_fighter_chat_v1 needs public.orgs; nothing changed' using errcode = '55000';
  end if;
end $guard$;

create table if not exists public.ef_identities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  platform text not null check (platform in ('slack','telegram','whatsapp','discord','msteams','googlechat','matrix','signal','imessage')),
  platform_user_id text not null check (length(platform_user_id) between 1 and 200),
  trust text not null check (trust in ('owner','blocked')),
  paired_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, platform_user_id)
);

create table if not exists public.ef_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  platform text not null,
  conversation_id text not null check (length(conversation_id) between 1 and 300),
  direction text not null check (direction in ('inbound','outbound')),
  external_msg_id text check (external_msg_id is null or length(external_msg_id) <= 300),
  platform_user_id text,
  content text not null check (length(content) <= 20000),
  tainted boolean not null default false,
  created_at timestamptz not null default now()
);
-- A plain unique constraint (outbound rows have a null external_msg_id, and nulls never collide), so it is a
-- valid PostgREST on_conflict target.
do $uq$
begin
  if not exists (select 1 from pg_constraint where conname = 'ef_messages_platform_external_msg_id_key') then
    alter table public.ef_messages add constraint ef_messages_platform_external_msg_id_key unique (platform, external_msg_id);
  end if;
end $uq$;
create index if not exists ef_messages_conversation_idx on public.ef_messages(platform, conversation_id, created_at desc);

create table if not exists public.ef_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  message_row_id uuid references public.ef_messages(id) on delete set null,
  platform text not null,
  platform_user_id text not null,
  conversation_id text not null,
  reply_address jsonb not null,
  status text not null check (status in ('received','answered','clarify','refused','running','awaiting_approval','done','failed')),
  route text check (route is null or route in ('answer','clarify','run','approval','refused','equitynet')),
  intent text,
  capability text,
  turn_id uuid,
  job_id uuid,
  compute_task_id text,
  approval_id uuid,
  decision_id uuid,
  last_relay text check (last_relay is null or length(last_relay) <= 4000),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ef_runs_open_idx on public.ef_runs(status, created_at) where closed_at is null;
create index if not exists ef_runs_owner_idx on public.ef_runs(platform, platform_user_id, created_at desc);

create table if not exists public.ef_steps (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.ef_runs(id) on delete cascade,
  seq integer not null check (seq between 0 and 63),
  kind text not null check (length(kind) between 1 and 40),
  status text not null check (status in ('done','failed')),
  output jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

alter table public.ef_identities enable row level security;
alter table public.ef_identities force row level security;
alter table public.ef_messages enable row level security;
alter table public.ef_messages force row level security;
alter table public.ef_runs enable row level security;
alter table public.ef_runs force row level security;
alter table public.ef_steps enable row level security;
alter table public.ef_steps force row level security;

revoke all on table public.ef_identities, public.ef_messages, public.ef_runs, public.ef_steps from public, anon, authenticated;
grant select, insert, update on table public.ef_identities to service_role;
grant select, insert, update, delete on table public.ef_messages to service_role;
grant select, insert, update on table public.ef_runs to service_role;
grant select, insert, update on table public.ef_steps to service_role;

comment on table public.ef_identities is 'Equity Fighter: platform accounts allowed to reach the harness (owner) or blocked. Service role only.';
comment on table public.ef_messages is 'Equity Fighter: chat messages; unique (platform, external_msg_id) dedupes platform retries; deletable by the owner via /forget. Service role only.';
comment on table public.ef_runs is 'Equity Fighter: one row per chat request, pointing at ai_context.dispatch_turns / ops_agent_jobs / control_approvals by id. Service role only.';
comment on table public.ef_steps is 'Equity Fighter: agent-loop checkpoints (save and resume). Holds ids and harness outcomes, not message text. Service role only.';

commit;
