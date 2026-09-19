-- ============================================================
-- THE FIRST MONTH, AS A THING THE DATABASE KNOWS.
--
-- The management service opens with a free month delivered as four
-- weekly sprints: one module switched on per week, all four running by
-- the end of it, and then a decision. Keep it, and everything stays on.
-- Cruise, and the three automation modules switch off while the website
-- stays live.
--
-- That promise is only worth what the record behind it is worth. Copy on
-- a page cannot tell you whether a module is on today, when a free month
-- ends, or which of two clients decided what. So it lives here:
--
--   modules              what the four modules ARE (the catalogue)
--   engagements          one row per client engagement: when the free
--                        month started, when it ends, what they decided
--   engagement_modules   one row per module per engagement: which week
--                        it lands, when it went on, when it comes off
--
-- THE ONE RULE THAT MATTERS. modules.survives_cruise says whether a
-- module is switched off when somebody does not continue. The website is
-- the only true, and it is not a policy setting -- it is the difference
-- between "the automation stops" and "your site goes dark", and the
-- second one is not something this business does. The deactivation view
-- reads that column, so a module cannot be quietly reclassified without
-- somebody editing the catalogue on purpose.
--
-- All of it is owner-only. There is no anon read policy anywhere in this
-- file: a client's engagement, their decision and their dates are not
-- public the way a price is.
-- ============================================================

-- ---------- the catalogue: what a module is ----------
create table if not exists public.modules (
  id              text primary key,
  sprint_week     int  not null check (sprint_week between 1 and 12),
  name            text not null,
  what            text not null,
  survives_cruise boolean not null default false,
  created_at      timestamptz not null default now()
);

comment on table public.modules is
  'The activation modules, in the order they are switched on. Mirrors offers.activation.sprints in data/offers.json, which is what the website renders; this is what the service runs on.';
comment on column public.modules.survives_cruise is
  'true = still running after a client declines the upgrade. Only the website is true. The three automation modules are false, which is exactly what the page tells people before they start.';

insert into public.modules (id, sprint_week, name, what, survives_cruise) values
  ('website',  1, 'The website goes up',
   'Build, content, domain pointed, live and indexed. The room everything else sends people to.', true),
  ('inbound',  2, 'Inbound turned on',
   'Automation in the client backend working the traffic coming toward them: search surface, the paths people already take, and capture at the end of every one of them.', false),
  ('outbound', 3, 'Outbound turned on',
   'Automated reach-out and follow-up from the same backend, so nobody goes cold because a week got busy.', false),
  ('social',   4, 'Social activated',
   'The same tools pointed at their feeds: scheduling, posting, and the parts of being present online that eat an evening.', false)
on conflict (id) do nothing;

-- ---------- the engagement: one client, one free month, one decision ----------
create table if not exists public.engagements (
  id            uuid primary key default gen_random_uuid(),
  client_name   text not null,
  client_email  text,
  site_slug     text,
  offer_id      text not null default 'anti-social',
  mode          text not null default 'm' check (mode in ('m','equity')),
  started_on    date not null default current_date,
  -- the free month is a month, not "about a month": one calendar month
  -- from the start, computed rather than typed, so nobody has to
  -- remember to set it and nobody can set it wrong
  free_until    date generated always as (started_on + interval '1 month') stored,
  decision      text not null default 'undecided'
                check (decision in ('undecided','upgrade','cruise')),
  decided_at    timestamptz,
  note          text,
  created_at    timestamptz not null default now()
);

comment on column public.engagements.free_until is
  'Generated: one calendar month after the start. The free month ends on a date the record computes, so the client and the desk are never reading two different answers.';
comment on column public.engagements.decision is
  'undecided until they say. Nothing auto-upgrades: a silent customer cruises, which is the only default that is not a trap.';

-- decided_at and decision move together or neither moves
alter table public.engagements
  drop constraint if exists engagements_decided_together;
alter table public.engagements
  add constraint engagements_decided_together
  check ((decision = 'undecided' and decided_at is null)
      or (decision <> 'undecided' and decided_at is not null));

-- ---------- the modules of one engagement ----------
create table if not exists public.engagement_modules (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements (id) on delete cascade,
  module_id     text not null references public.modules (id),
  activated_at  timestamptz,
  stopped_at    timestamptz,
  note          text,
  unique (engagement_id, module_id)
);

create index if not exists em_by_engagement on public.engagement_modules (engagement_id);

-- every new engagement gets the whole catalogue, unactivated, so the
-- four weeks are on the record from day one rather than being remembered
create or replace function public.seed_engagement_modules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.engagement_modules (engagement_id, module_id)
  select new.id, m.id from public.modules m
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists engagements_seed_modules on public.engagements;
create trigger engagements_seed_modules
  after insert on public.engagements
  for each row execute function public.seed_engagement_modules();

-- ---------- what is actually on, right now ----------
-- The question the desk and the client both ask, answered in one place
-- instead of by reading three tables and a calendar.
create or replace view public.engagement_state as
select
  e.id            as engagement_id,
  e.client_name,
  e.site_slug,
  e.decision,
  e.started_on,
  e.free_until,
  (current_date <= e.free_until)                  as in_free_month,
  greatest(0, (e.free_until - current_date))      as days_left_free,
  m.id            as module_id,
  m.sprint_week,
  m.name          as module_name,
  m.survives_cruise,
  em.activated_at,
  em.stopped_at,
  case
    when em.stopped_at is not null                          then 'stopped'
    when em.activated_at is null                            then 'scheduled'
    when current_date <= e.free_until                       then 'active_free'
    when e.decision = 'upgrade'                             then 'active_paid'
    when m.survives_cruise                                  then 'active_kept'
    else                                                         'due_off'
  end as state
from public.engagements e
join public.engagement_modules em on em.engagement_id = e.id
join public.modules m             on m.id = em.module_id;

comment on view public.engagement_state is
  'One row per module per engagement with its live state. due_off means the free month is over, they did not upgrade, and this module should be switched off; it is deliberately not "off" because the record should say the work is owed, not pretend it is done.';

-- ---------- who can see any of this ----------
alter table public.modules            enable row level security;
alter table public.engagements        enable row level security;
alter table public.engagement_modules enable row level security;

-- the module catalogue is the only public part: it is the same four
-- descriptions the website already prints
drop policy if exists md_read on public.modules;
create policy md_read on public.modules for select to anon, authenticated using (true);
drop policy if exists md_admin on public.modules;
create policy md_admin on public.modules for all to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

drop policy if exists eng_admin on public.engagements;
create policy eng_admin on public.engagements for all to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

drop policy if exists engm_admin on public.engagement_modules;
create policy engm_admin on public.engagement_modules for all to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org')
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

grant select on public.modules to anon, authenticated;
grant all    on public.modules, public.engagements, public.engagement_modules to authenticated;
-- the view runs as its caller, so RLS on the tables underneath is what
-- actually decides who sees a client's dates
alter view public.engagement_state set (security_invoker = on);
grant select on public.engagement_state to authenticated;
