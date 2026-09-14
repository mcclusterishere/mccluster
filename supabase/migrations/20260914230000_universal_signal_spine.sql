-- Universal McCluster signal spine.
-- Extends the original outreach-oriented ops_signals table without breaking its CRM columns.

alter table public.ops_signals
  add column if not exists fingerprint text,
  add column if not exists status text not null default 'new',
  add column if not exists processed_at timestamptz,
  add column if not exists objective_id uuid references public.ops_objectives(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.ops_signals drop constraint if exists ops_signals_status_check;
alter table public.ops_signals add constraint ops_signals_status_check
  check (status in ('new','queued','consumed','ignored','failed'));
alter table public.ops_signals drop constraint if exists ops_signals_severity_check;
alter table public.ops_signals add constraint ops_signals_severity_check check (severity between 0 and 100);
alter table public.ops_signals drop constraint if exists ops_signals_confidence_check;
alter table public.ops_signals add constraint ops_signals_confidence_check check (confidence between 0 and 1);

create unique index if not exists ops_signals_org_fingerprint_uq
  on public.ops_signals(org_id, fingerprint) where fingerprint is not null;
create index if not exists ops_signals_intake_idx
  on public.ops_signals(org_id, status, severity desc, observed_at desc);
create index if not exists ops_signals_source_idx
  on public.ops_signals(org_id, source, source_ref) where source_ref is not null;
create index if not exists ops_signals_objective_idx
  on public.ops_signals(objective_id) where objective_id is not null;

alter table public.ops_signals enable row level security;
revoke all on table public.ops_signals from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_signals to service_role;
grant usage, select on sequence public.ops_signals_id_seq to service_role;

comment on table public.ops_signals is
  'Canonical McCluster signal intake spine. CRM outreach columns remain for backwards compatibility; universal provenance/content lives in source/source_ref/payload/fingerprint.';
comment on column public.ops_signals.fingerprint is
  'Deterministic SHA-256 identity used for idempotent multi-provider ingestion.';
comment on column public.ops_signals.status is
  'Signal lifecycle: new -> queued -> consumed|ignored|failed.';

-- Inbound self-hosted SMS becomes a first-class signal automatically. This
-- catches every relay implementation, not only the current Core executor.
create or replace function public.mccluster_signal_from_comms_message()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare fp text;
begin
  if new.direction <> 'inbound' then return new; end if;
  fp := encode(digest(concat_ws(':', new.org_id::text, 'sms', new.id::text, coalesce(new.body,'')), 'sha256'), 'hex');
  insert into public.ops_signals(org_id, signal_type, source, source_ref, severity, confidence, payload, fingerprint, status, observed_at)
  values (
    new.org_id, 'message', 'sms', new.id::text, 40, 1,
    jsonb_build_object(
      'schema_version','mccluster-signal/v1',
      'content',new.body,
      'metadata',jsonb_build_object('thread_id',new.thread_id,'sender_type',new.sender_type,'message_status',new.status),
      'provenance',jsonb_build_object('source','sms','source_ref',new.id::text)
    ), fp, 'new', coalesce(new.occurred_at, now())
  ) on conflict (org_id, fingerprint) where fingerprint is not null do nothing;
  return new;
end $$;
revoke all on function public.mccluster_signal_from_comms_message() from public, anon, authenticated;
grant execute on function public.mccluster_signal_from_comms_message() to service_role;
drop trigger if exists mccluster_signal_comms_message on public.comms_messages;
create trigger mccluster_signal_comms_message after insert on public.comms_messages
for each row execute function public.mccluster_signal_from_comms_message();

-- Unified Inbox carries email and other connected-channel inbound messages.
create or replace function public.mccluster_signal_from_inbox_message()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare fp text; src text;
begin
  if new.direction <> 'in' and new.direction <> 'inbound' then return new; end if;
  src := coalesce(nullif(new.meta->>'channel',''), nullif(new.meta->>'provider',''), 'inbox');
  fp := encode(digest(concat_ws(':', new.org_id::text, src, new.id::text, coalesce(new.body,'')), 'sha256'), 'hex');
  insert into public.ops_signals(org_id, signal_type, source, source_ref, severity, confidence, payload, fingerprint, status, observed_at)
  values (
    new.org_id, 'message', lower(src), new.id::text, 35, 1,
    jsonb_build_object(
      'schema_version','mccluster-signal/v1',
      'content',new.body,
      'metadata',coalesce(new.meta,'{}'::jsonb) || jsonb_build_object('conversation_id',new.conv_id,'author',new.author),
      'provenance',jsonb_build_object('source',lower(src),'source_ref',new.id::text)
    ), fp, 'new', coalesce(new.at, now())
  ) on conflict (org_id, fingerprint) where fingerprint is not null do nothing;
  return new;
end $$;
revoke all on function public.mccluster_signal_from_inbox_message() from public, anon, authenticated;
grant execute on function public.mccluster_signal_from_inbox_message() to service_role;
drop trigger if exists mccluster_signal_inbox_message on public.inbox_messages;
create trigger mccluster_signal_inbox_message after insert on public.inbox_messages
for each row execute function public.mccluster_signal_from_inbox_message();

-- Fabric is the provider-neutral event bus. Mirroring it means calendar/event,
-- webhook and future provider adapters need only publish one canonical fabric event.
create or replace function public.mccluster_signal_from_fabric_event()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare fp text;
begin
  if new.kind like 'signal.%' then return new; end if;
  fp := encode(digest(concat_ws(':', new.org_id::text, 'fabric', new.event_id::text, new.content_hash), 'sha256'), 'hex');
  insert into public.ops_signals(org_id, signal_type, source, source_ref, severity, confidence, payload, fingerprint, status, observed_at)
  values (
    new.org_id, new.kind, 'fabric', new.event_id::text, 30, 1,
    jsonb_build_object(
      'schema_version','mccluster-signal/v1',
      'content',coalesce(new.payload->>'summary',new.payload->>'body',new.payload->>'title',''),
      'metadata',coalesce(new.payload,'{}'::jsonb) || jsonb_build_object('trace_id',new.trace_id,'origin_node',new.origin_node,'content_hash',new.content_hash),
      'provenance',jsonb_build_object('source','fabric','source_ref',new.event_id::text)
    ), fp, 'new', coalesce(new.occurred_at, now())
  ) on conflict (org_id, fingerprint) where fingerprint is not null do nothing;
  return new;
end $$;
revoke all on function public.mccluster_signal_from_fabric_event() from public, anon, authenticated;
grant execute on function public.mccluster_signal_from_fabric_event() to service_role;
drop trigger if exists mccluster_signal_fabric_event on public.fabric_events;
create trigger mccluster_signal_fabric_event after insert on public.fabric_events
for each row execute function public.mccluster_signal_from_fabric_event();
