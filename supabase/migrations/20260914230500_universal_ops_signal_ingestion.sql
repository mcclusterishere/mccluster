-- Universal Initiative OS signal intake.
-- Extends the existing canonical ops_signals table instead of creating another
-- memory/workflow plane. Signals are service-role-only provenance records that
-- may deterministically queue objective_synthesis.

alter table public.ops_signals
  add column if not exists fingerprint text,
  add column if not exists status text not null default 'new',
  add column if not exists objective_id uuid references public.ops_objectives(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ops_signals'::regclass
      and conname = 'ops_signals_status_check'
  ) then
    alter table public.ops_signals
      add constraint ops_signals_status_check
      check (status in ('new','processed','ignored','failed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ops_signals'::regclass
      and conname = 'ops_signals_org_fingerprint_uq'
  ) then
    alter table public.ops_signals
      add constraint ops_signals_org_fingerprint_uq unique (org_id, fingerprint);
  end if;
end $$;

create index if not exists ops_signals_org_status_observed_idx
  on public.ops_signals(org_id, status, observed_at desc);
create index if not exists ops_signals_objective_idx
  on public.ops_signals(objective_id) where objective_id is not null;

alter table public.ops_signals enable row level security;
revoke all on table public.ops_signals from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_signals to service_role;

-- Normalize durable inbound communications into the same Initiative OS signal
-- plane. The trigger never sends messages or performs external actions.
create or replace function public.ops_capture_message_signal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_signal_id bigint;
  v_fingerprint text;
  v_source text;
  v_source_ref text;
  v_summary text;
  v_observed timestamptz;
  v_payload jsonb;
begin
  if tg_table_name = 'comms_messages' then
    if new.direction <> 'inbound' then return new; end if;
    v_source := 'sms';
    v_source_ref := 'comms_message:' || new.id::text;
    v_summary := left(new.body, 4000);
    v_observed := coalesce(new.occurred_at, now());
    v_payload := jsonb_build_object(
      'channel', 'sms',
      'message_id', new.id,
      'thread_id', new.thread_id,
      'sender_type', new.sender_type,
      'external_id', new.external_id,
      'project', 'McCluster Communications',
      'initiative', 'SMS',
      'objective_synthesis', true
    );
  elsif tg_table_name = 'inbox_messages' then
    if new.direction <> 'in' then return new; end if;
    v_source := coalesce(nullif(new.meta->>'channel',''), 'inbox');
    v_source_ref := 'inbox_message:' || new.id::text;
    v_summary := left(new.body, 4000);
    v_observed := coalesce(new.at, now());
    v_payload := jsonb_build_object(
      'channel', v_source,
      'message_id', new.id,
      'conversation_id', new.conv_id,
      'author', new.author,
      'external_id', new.external_id,
      'project', coalesce(nullif(new.meta->>'project',''), 'McCluster'),
      'initiative', coalesce(nullif(new.meta->>'initiative',''), 'Inbox'),
      'objective_synthesis', true,
      'metadata', coalesce(new.meta, '{}'::jsonb)
    );
  else
    return new;
  end if;

  v_fingerprint := md5(new.org_id::text || E'\n' || v_source || E'\n' || v_source_ref);

  insert into public.ops_signals (
    org_id, signal_type, source, source_ref, severity, confidence,
    payload, observed_at, fingerprint, status, updated_at
  ) values (
    new.org_id, 'communication', v_source, v_source_ref, 60, 1.0,
    jsonb_build_object('summary', v_summary) || v_payload,
    v_observed, v_fingerprint, 'new', now()
  )
  on conflict (org_id, fingerprint) do update
    set updated_at = excluded.updated_at
  returning id into v_signal_id;

  insert into public.ops_agent_jobs (
    org_id, job_type, target_type, target_id, status, priority, input, max_attempts
  ) values (
    new.org_id,
    'objective_synthesis',
    'signal',
    v_signal_id::text,
    'queued',
    55,
    jsonb_build_object(
      'source', jsonb_build_object(
        'signal_id', v_signal_id,
        'source_type', v_source,
        'source_ref', v_source_ref,
        'fingerprint', v_fingerprint,
        'observed_at', v_observed
      ),
      'schedule_reflection', true
    ),
    3
  );

  return new;
end;
$$;

revoke all on function public.ops_capture_message_signal() from public, anon, authenticated;
grant execute on function public.ops_capture_message_signal() to service_role;

drop trigger if exists comms_messages_ops_signal on public.comms_messages;
create trigger comms_messages_ops_signal
after insert on public.comms_messages
for each row execute function public.ops_capture_message_signal();

drop trigger if exists inbox_messages_ops_signal on public.inbox_messages;
create trigger inbox_messages_ops_signal
after insert on public.inbox_messages
for each row execute function public.ops_capture_message_signal();

comment on table public.ops_signals is
  'Canonical normalized signal plane for Initiative OS. Raw private transcripts remain in their owning systems; signals carry bounded summaries/references and provenance.';
comment on function public.ops_capture_message_signal() is
  'Normalizes inbound SMS/inbox records into ops_signals and queues bounded objective synthesis; no external side effects.';
