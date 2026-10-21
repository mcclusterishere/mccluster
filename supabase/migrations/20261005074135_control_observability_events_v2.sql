-- Control observability v2: one canonical event contract for Worker requests,
-- Worker domain events (audited mutations, paid media, AI decisions), Core job
-- and capability events, and future OpenTelemetry/Logpush ingestion.
-- Additive over 20261005071308_control_observability_events_v1: rows written by
-- the v1 Worker stay valid (new columns default), and request rows keep their
-- one-row-per-request guarantee.

alter table public.control_observability_events
  add column if not exists event_name text,
  add column if not exists span_id uuid,
  add column if not exists occurred_at timestamptz,
  add column if not exists outcome text,
  add column if not exists source text not null default 'worker';

update public.control_observability_events
   set occurred_at = created_at
 where occurred_at is null;

alter table public.control_observability_events
  alter column occurred_at set default now(),
  alter column occurred_at set not null;

alter table public.control_observability_events
  drop constraint if exists control_observability_events_event_kind_check;
alter table public.control_observability_events
  add constraint control_observability_events_event_kind_check
  check (event_kind in ('request','job','scheduled','dependency','incident','domain','capability'));

alter table public.control_observability_events
  drop constraint if exists control_observability_events_event_name_check;
alter table public.control_observability_events
  add constraint control_observability_events_event_name_check
  check (event_name is null or event_name ~ '^[a-z][a-z0-9_.:-]{0,119}$');

alter table public.control_observability_events
  drop constraint if exists control_observability_events_outcome_check;
alter table public.control_observability_events
  add constraint control_observability_events_outcome_check
  check (outcome is null or outcome in ('ok','error','refused','retry','pending','cancelled'));

alter table public.control_observability_events
  drop constraint if exists control_observability_events_source_check;
alter table public.control_observability_events
  add constraint control_observability_events_source_check
  check (source in ('worker','core','supabase','provider','browser','otel','logpush'));

-- An event is evidence, not storage: structured detail stays small.
alter table public.control_observability_events
  drop constraint if exists control_observability_events_detail_size_check;
alter table public.control_observability_events
  add constraint control_observability_events_detail_size_check
  check (pg_column_size(detail) <= 16384);

alter table public.control_observability_events
  drop constraint if exists control_observability_events_text_bounds_check;
alter table public.control_observability_events
  add constraint control_observability_events_text_bounds_check
  check (
    char_length(route) <= 500
    and (message is null or char_length(message) <= 2000)
    and (resource_type is null or char_length(resource_type) <= 64)
    and (resource_id is null or char_length(resource_id) <= 200)
    and char_length(service) <= 64
  );

-- v1 allowed one row per (org, request). Domain and Core events share their
-- request's id, so uniqueness now applies to request rows only; every other
-- event is made idempotent by its own span id.
alter table public.control_observability_events
  drop constraint if exists control_observability_events_org_id_request_id_key;
create unique index if not exists control_observability_events_request_row_uidx
  on public.control_observability_events(org_id, request_id)
  where event_kind = 'request';
create unique index if not exists control_observability_events_span_uidx
  on public.control_observability_events(org_id, span_id)
  where span_id is not null;

create index if not exists control_observability_events_request_idx
  on public.control_observability_events(org_id, request_id, created_at asc, id asc);
create index if not exists control_observability_events_resource_idx
  on public.control_observability_events(org_id, resource_type, resource_id, created_at desc, id desc)
  where resource_id is not null;
create index if not exists control_observability_events_name_idx
  on public.control_observability_events(org_id, event_name, created_at desc)
  where event_name is not null;
-- Retention deletes by age across orgs.
create index if not exists control_observability_events_retention_idx
  on public.control_observability_events(level, created_at);

comment on table public.control_observability_events is
  'Canonical org-scoped observability events: Worker requests (written only after verifying the claimed workspace membership), server-emitted domain events, Core job/capability events, and future OTel/Logpush ingestion. Browser roles have no direct access; Control reads through the owner-gated GET /v1/observability/events. Retained 14 days (info) / 90 days (warn, error) by the Worker cron.';
comment on column public.control_observability_events.source is
  'Provenance of the record: worker, core, supabase, provider, browser, otel or logpush.';
comment on column public.control_observability_events.occurred_at is
  'When the observed thing happened; created_at is when the row was stored.';
