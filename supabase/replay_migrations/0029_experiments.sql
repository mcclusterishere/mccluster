-- A/B: finding out whether a change actually helped.
--
-- The honest caveat first, because it belongs in the schema and not just
-- in a conversation: with twenty messages a day, a difference has to be
-- enormous before it means anything. This machinery does not create
-- evidence. It records what happened alongside which version happened,
-- so that when there IS enough traffic the question is answerable
-- instead of relitigated.
--
-- ---- WHAT IS ASSIGNED, AND TO WHAT --------------------------------
--
-- To the CONTACT, not to the message. A person who gets the warm voice
-- in one message and the terse one in the next has not been in an
-- experiment; they have been in a fault. Assignment is a hash of the
-- experiment id and the contact id — deterministic, no table lookup, and
-- stable across restarts, deploys and this function being rewritten.

create table if not exists public.ai_experiments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  key         text not null,
  note        text,
  -- what is being varied. 'voice' swaps the persona, 'model' pins a
  -- model per arm, 'effort' changes how hard it thinks.
  dimension   text not null check (dimension in ('voice', 'model', 'effort')),
  -- [{ "name": "control", "weight": 50, "value": "…" }, …]
  arms        jsonb not null,
  enabled     boolean not null default false,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  created_at  timestamptz not null default now(),
  unique (org_id, key),
  -- Two arms at least, and every weight a positive integer. A one-armed
  -- experiment is a deploy, and a zero-weight arm is a control that never
  -- ran, which is the shape of every experiment that "proved" something.
  constraint ai_experiments_needs_arms check (jsonb_array_length(arms) >= 2)
);

create index if not exists ai_experiments_live on public.ai_experiments (org_id) where enabled;

comment on column public.ai_experiments.arms is
  'Weighted variants. Assignment is deterministic on (experiment, contact), so a person stays in one arm for as long as the experiment runs.';

-- Which arm a call was in. On the call rather than in a join table,
-- because "what did this cost and was it any good" is one row's question
-- and it should not need three.
alter table public.ai_calls
  add column if not exists experiment text,
  add column if not exists arm text;

create index if not exists ai_calls_arm on public.ai_calls (org_id, experiment, arm)
  where experiment is not null;

-- ============================================================
-- THE SCOREBOARD
--
-- Cost, latency and verdicts per arm, and the count that says whether to
-- believe any of it. security_invoker so it can never show a caller more
-- than the RLS on ai_calls would.
-- ============================================================

create or replace view public.ai_arm_scores
  with (security_invoker = true) as
  select c.org_id,
         c.experiment,
         c.arm,
         count(*)::int                                    as calls,
         count(*) filter (where not c.ok)::int            as failures,
         round(avg(c.cost_micros))::bigint                as avg_cost_micros,
         round(avg(c.latency_ms))::int                    as avg_latency_ms,
         count(e.id)::int                                 as verdicts,
         count(e.id) filter (where e.verdict = 1)::int    as good,
         count(e.id) filter (where e.verdict = -1)::int   as bad
    from public.ai_calls c
    left join public.ai_evals e on e.call_id = c.id
   where c.experiment is not null
   group by c.org_id, c.experiment, c.arm;

revoke all on public.ai_arm_scores from anon, authenticated;

comment on view public.ai_arm_scores is
  'Per-arm cost, latency and verdicts. `verdicts` is the number to look at first: an arm with four of them has not told you anything.';

alter table public.ai_experiments enable row level security;

drop policy if exists ai_experiments_read on public.ai_experiments;
create policy ai_experiments_read on public.ai_experiments
  for select using (public.is_org_member(org_id));
drop policy if exists ai_experiments_owner on public.ai_experiments;
create policy ai_experiments_owner on public.ai_experiments
  for all using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

revoke all on public.ai_experiments from anon, authenticated;
grant select on public.ai_experiments to authenticated;
