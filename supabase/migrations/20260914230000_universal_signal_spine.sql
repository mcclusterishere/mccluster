-- Universal McCluster signal spine.
-- Extends the original outreach-oriented ops_signals table without breaking its CRM columns.

alter table public.ops_signals
  add column if not exists fingerprint text,
  add column if not exists status text not null default 'new',
  add column if not exists processed_at timestamptz,
  add column if not exists objective_id uuid references public.ops_objectives(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.ops_signals
  drop constraint if exists ops_signals_status_check;
alter table public.ops_signals
  add constraint ops_signals_status_check
  check (status in ('new','queued','consumed','ignored','failed'));

alter table public.ops_signals
  drop constraint if exists ops_signals_severity_check;
alter table public.ops_signals
  add constraint ops_signals_severity_check check (severity between 0 and 100);

alter table public.ops_signals
  drop constraint if exists ops_signals_confidence_check;
alter table public.ops_signals
  add constraint ops_signals_confidence_check check (confidence between 0 and 1);

create unique index if not exists ops_signals_org_fingerprint_uq
  on public.ops_signals(org_id, fingerprint)
  where fingerprint is not null;
create index if not exists ops_signals_intake_idx
  on public.ops_signals(org_id, status, severity desc, observed_at desc);
create index if not exists ops_signals_source_idx
  on public.ops_signals(org_id, source, source_ref)
  where source_ref is not null;
create index if not exists ops_signals_objective_idx
  on public.ops_signals(objective_id)
  where objective_id is not null;

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
