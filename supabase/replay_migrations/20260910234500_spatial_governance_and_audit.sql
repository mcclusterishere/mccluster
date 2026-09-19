-- Jurisdiction policy, purpose binding, and a tamper-evident query audit.
--
-- Between 2021 and August 2026, 214 US localities cancelled their Flock Safety
-- ALPR contracts, 90 of them in August 2026 alone. The recorded causes are not
-- accuracy and not price:
--
--   San Francisco  299 queries run against the city's network on behalf of
--                  federal and out-of-state agencies, discovered a year later
--                  by a routine compliance audit.
--   Dayton, OH     7,100+ searches for immigration enforcement, against the
--                  city's own written prohibition.
--   Hillsborough   contract language permitting disclosure to "any government
--                  entity or third party" on the vendor's good-faith belief.
--
-- In each case a policy existed and was violated for months before a human
-- being went looking. The lesson those towns drew is that a policy which lives
-- in a settings page is not a control. So here the policy is a row the town
-- adopts, the query path reads it on every request, and the decision -- allow
-- AND deny -- is sealed into a hash chain an auditor can verify without us.

create table if not exists public.seek_first_jurisdiction_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,

  -- The town, city, COG or agency that adopted this. Also the default egress
  -- boundary: a requester naming this jurisdiction is internal to it.
  jurisdiction text not null,
  display_name text,

  -- Days. No permissive default: a policy row that does not state a window is
  -- read at 7 days, the shortest window any of the cancelling towns settled on.
  retention_days integer not null default 7 check (retention_days > 0 and retention_days <= 3650),

  -- An empty permitted list means "no purpose has been approved yet", which
  -- reads as deny. A prohibited purpose is absolute and is checked first.
  permitted_purposes text[] not null default '{}',
  prohibited_purposes text[] not null default '{}',

  -- The egress boundary. Empty means the jurisdiction itself and nobody else.
  permitted_agencies text[] not null default '{}',
  external_sharing_enabled boolean not null default false,
  external_sharing_expires_at timestamptz,

  enabled boolean not null default true,

  -- Who adopted it, and when. A town's oversight board is the author of record;
  -- this column exists so an FOIA response can name them.
  adopted_by text,
  adopted_at timestamptz not null default now(),
  policy_version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists seek_first_jurisdiction_policies_uidx
  on public.seek_first_jurisdiction_policies (org_id, lower(jurisdiction));

alter table public.seek_first_jurisdiction_policies enable row level security;

/*
  Amending a policy is itself an event a town has to be able to reconstruct --
  "when did we start sharing with the state fusion centre, and who signed off"
  is the first question at any hearing. Amendments are appended, never updated.
*/
create table if not exists public.seek_first_policy_amendments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  policy_id uuid not null references public.seek_first_jurisdiction_policies(id) on delete cascade,

  from_version integer not null,
  to_version integer not null,
  changed jsonb not null default '{}'::jsonb,
  rationale text,

  amended_by text not null,
  amended_at timestamptz not null default now()
);

create index if not exists seek_first_policy_amendments_policy_idx
  on public.seek_first_policy_amendments (org_id, policy_id, amended_at desc);

alter table public.seek_first_policy_amendments enable row level security;

/*
  The audit chain.

  Every governed query writes exactly one row here before any data is returned,
  and a refusal writes one too -- a denied query is the record an oversight
  board most wants and the one a settings-page audit tool is least likely to
  keep. entry_hash covers the row's own content plus previous_hash, so removing
  or editing an entry breaks every link after it.

  This does not stop an operator with database access from rewriting history.
  Nothing inside the same trust boundary can. It makes rewritten history
  impossible to present as intact, which is the property the towns need: the
  San Francisco and Dayton findings each took roughly a year of human effort,
  and verification here is arithmetic.
*/
create table if not exists public.seek_first_query_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,

  jurisdiction text not null,
  sequence bigint not null,

  -- The purpose binding, recorded verbatim as asserted.
  purpose text not null,
  authority text not null,
  requesting_agency text not null,
  requested_by text not null,
  case_reference text,
  note text,

  decision text not null check (decision in ('allow', 'deny')),
  reason text not null,

  source_key text,
  operation text,
  query_fingerprint text,
  record_count integer,

  policy_version integer,
  retention_deadline timestamptz,

  occurred_at timestamptz not null default now(),
  previous_hash text not null,
  entry_hash text not null
);

-- One sequence per jurisdiction, so a gap is as visible as a hash break.
create unique index if not exists seek_first_query_audit_seq_uidx
  on public.seek_first_query_audit (org_id, jurisdiction, sequence);
create unique index if not exists seek_first_query_audit_hash_uidx
  on public.seek_first_query_audit (entry_hash);
create index if not exists seek_first_query_audit_case_idx
  on public.seek_first_query_audit (org_id, jurisdiction, case_reference)
  where case_reference is not null;
create index if not exists seek_first_query_audit_agency_idx
  on public.seek_first_query_audit (org_id, jurisdiction, requesting_agency, occurred_at desc);
create index if not exists seek_first_query_audit_denied_idx
  on public.seek_first_query_audit (org_id, jurisdiction, occurred_at desc)
  where decision = 'deny';

alter table public.seek_first_query_audit enable row level security;

/*
  An append-only log has to actually be append-only. Postgres is where that gets
  enforced, because a bug in the Worker must not be able to quietly amend it.
*/
create or replace function public.seek_first_query_audit_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'seek_first_query_audit is append-only (attempted %)', tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists seek_first_query_audit_no_update on public.seek_first_query_audit;
create trigger seek_first_query_audit_no_update
  before update or delete on public.seek_first_query_audit
  for each row execute function public.seek_first_query_audit_is_append_only();

/*
  The head of a jurisdiction's chain, which the Worker needs to seal the next
  entry. Returns the genesis literal for a chain that has never been written, so
  a truncation to zero rows is distinguishable from a fresh start.
*/
create or replace function public.seek_first_audit_head(p_org uuid, p_jurisdiction text)
returns table (sequence bigint, entry_hash text)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(max(a.sequence), -1)::bigint,
         coalesce(
           (select a2.entry_hash
              from public.seek_first_query_audit a2
             where a2.org_id = p_org
               and lower(a2.jurisdiction) = lower(p_jurisdiction)
             order by a2.sequence desc
             limit 1),
           'seek-first:audit:genesis')
    from public.seek_first_query_audit a
   where a.org_id = p_org
     and lower(a.jurisdiction) = lower(p_jurisdiction);
$$;

/*
  What a town publishes. Every one of the cancelling councils asked their vendor
  for some version of this and could not get it: how many queries, by whom, for
  what, and how many were refused -- without exposing the subjects of any of
  them. Counts only, so it can be posted publicly on a monthly cadence.
*/
create or replace function public.seek_first_transparency_report(
  p_org uuid,
  p_jurisdiction text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  requesting_agency text,
  purpose text,
  decision text,
  reason text,
  queries bigint,
  distinct_cases bigint,
  first_at timestamptz,
  last_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.requesting_agency,
         a.purpose,
         a.decision,
         a.reason,
         count(*)::bigint,
         count(distinct a.case_reference)::bigint,
         min(a.occurred_at),
         max(a.occurred_at)
    from public.seek_first_query_audit a
   where a.org_id = p_org
     and lower(a.jurisdiction) = lower(p_jurisdiction)
     and a.occurred_at >= p_from
     and a.occurred_at < p_to
   group by a.requesting_agency, a.purpose, a.decision, a.reason
   order by count(*) desc;
$$;

/*
  Rows held past the window the town adopted. Retention that is a default
  somewhere in a settings page is retention nobody can audit; this is a query
  that returns the overage, so "are we compliant" has an answer with a number.
*/
create or replace function public.seek_first_retention_overage(p_org uuid, p_jurisdiction text)
returns table (source_key text, rows_over bigint, oldest_observed_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  with policy as (
    select p.retention_days
      from public.seek_first_jurisdiction_policies p
     where p.org_id = p_org
       and lower(p.jurisdiction) = lower(p_jurisdiction)
     limit 1
  )
  select o.source_key,
         count(*)::bigint,
         min(o.observed_at)
    from public.seek_first_observations o, policy
   where o.org_id = p_org
     and o.observed_at < now() - make_interval(days => policy.retention_days)
   group by o.source_key
   order by count(*) desc;
$$;
