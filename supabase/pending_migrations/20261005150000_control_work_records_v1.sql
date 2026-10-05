-- CONTROL WORK RECORDS v1 — the canonical stores behind Control · Work.
--
-- Closes docs/control-plane/CONTROL-ROOM-BACKEND-GAPS.md items 1, 2, 3 and 6:
-- companies, tasks, orders and bookings become real, org-scoped records
-- instead of strings on a lead, implied next actions, or lead lanes.
--
-- Pending: the owner applies it, then moves it to supabase/migrations/ and
-- records it in supabase/production-ledger.json. Until it is applied the
-- /v1/work/* routes answer 503 "not provisioned" and Control says so.
--
-- Authority: every write goes through Worker `mccluster` (/v1/work/*), which
-- checks org membership and writes control_audit. RLS is on with no browser
-- policies, so anon and authenticated keys can neither read nor write these
-- tables directly; only the service role used by the Worker can.
--
-- Not a second commerce system: print_orders, shake_orders, music_orders,
-- l3_orders and rental_bookings stay the fulfilment records of their own
-- products. work_orders / work_bookings are the operator's record of a deal
-- the owner is running from Control, linked to the lead it came from, and
-- may point at a product record through source_table / source_id.

create table if not exists public.work_companies (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 200),
  domain      text check (domain is null or domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  note        text check (note is null or length(note) <= 4000),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists work_companies_org_name_key
  on public.work_companies (org_id, lower(btrim(name)));

alter table public.leads
  add column if not exists company_id uuid references public.work_companies(id) on delete set null;
create index if not exists leads_company_id_idx on public.leads (company_id) where company_id is not null;

create table if not exists public.work_tasks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  title         text not null check (length(btrim(title)) between 1 and 300),
  detail        text check (detail is null or length(detail) <= 4000),
  state         text not null default 'open' check (state in ('open', 'doing', 'done')),
  assignee      uuid,
  due_at        timestamptz,
  related_type  text check (related_type in ('lead', 'company', 'order', 'booking')),
  related_id    uuid,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  check ((related_type is null) = (related_id is null)),
  check ((state = 'done') = (completed_at is not null))
);
create index if not exists work_tasks_org_state_idx on public.work_tasks (org_id, state, due_at);

create table if not exists public.work_orders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete set null,
  company_id    uuid references public.work_companies(id) on delete set null,
  title         text not null check (length(btrim(title)) between 1 and 300),
  state         text not null default 'open'
                check (state in ('open', 'paid', 'in_production', 'fulfilled', 'cancelled')),
  amount_cents  integer check (amount_cents is null or amount_cents >= 0),
  currency      text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  items         jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  source_table  text check (source_table in ('print_orders', 'shake_orders', 'music_orders', 'l3_orders')),
  source_id     text,
  placed_at     timestamptz not null default now(),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists work_orders_org_state_idx on public.work_orders (org_id, state, placed_at desc);

create table if not exists public.work_bookings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  lead_id     uuid references public.leads(id) on delete set null,
  company_id  uuid references public.work_companies(id) on delete set null,
  title       text not null check (length(btrim(title)) between 1 and 300),
  state       text not null default 'proposed'
              check (state in ('proposed', 'confirmed', 'completed', 'cancelled')),
  starts_at   timestamptz,
  ends_at     timestamptz,
  location    text check (location is null or length(location) <= 300),
  note        text check (note is null or length(note) <= 4000),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index if not exists work_bookings_org_starts_idx on public.work_bookings (org_id, starts_at);

create or replace function public.work_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['work_companies', 'work_tasks', 'work_orders', 'work_bookings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.work_touch_updated_at()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end;
$$;

comment on table public.work_companies is 'Control · Work companies. Written only by Worker mccluster /v1/work/companies (membership-checked, audited).';
comment on table public.work_tasks     is 'Control · Work human task list. Not ops_agent_jobs (the autonomous queue). Written only via /v1/work/tasks.';
comment on table public.work_orders    is 'Control · Work operator order record, linked to a lead; product fulfilment tables stay authoritative for their products.';
comment on table public.work_bookings  is 'Control · Work booking record with a scheduled slot, linked to a lead. Written only via /v1/work/bookings.';
