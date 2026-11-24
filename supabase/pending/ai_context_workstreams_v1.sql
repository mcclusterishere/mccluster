-- AI CONTEXT WORKSTREAMS v1 (migration name ai_context_workstreams_v1): durable workstream checkpoints in the
-- private ai_context plane, so where the work stands survives any model's context window.
-- PENDING ONLY. Never applied to production. Owner approval required before any apply.
-- Contract: docs/control-plane/WORKSTREAM-CHECKPOINTS.md. Order and procedure: supabase/pending/PROMOTION-ORDER.md,
-- section "AI context workstream checkpoints". Rollback: ai_context_workstreams_v1.rollback.sql.
-- Proof before apply (disposable database only): scripts/ai-context-workstreams-sql-check.mjs.
--
-- What it creates, all additive:
--   ai_context.workstreams        one row per (org, workstream key): where a line of work stands. Mutable, last
--                                 writer recorded, links to public.ops_objectives / public.ops_agent_jobs by id only.
--   ai_context.workstream_events  append-only log (decision | done | verified | blocker | unblocked | note | open),
--                                 one row per (org, operation key). UPDATE, DELETE and TRUNCATE are refused by trigger.
--   ai_context.workstream_*       private helpers (text bounds, credential and transcript refusal, json shapes).
--   public.ops_ai_workstream_upsert / _event_append / _checkpoint / _resume
--                                 SECURITY DEFINER, search_path pinned, EXECUTE for service_role only. They are the
--                                 only way in: no role but the owner holds any privilege on the two tables, and RLS
--                                 is enabled with no policy, like every other ai_context table.
-- It changes no existing object. An owner decision recorded through _event_append may INSERT one row into the
-- existing ai_context.decisions (status 'proposed', never approved here: approval stays with context-decision).
-- The record shape is mccluster-workstream/1, the shape the local reference store writes, so those files ingest
-- unchanged. One transaction, safe to run twice.
--
-- What the database decides for itself, whatever the caller (Core, or anything else holding service_role) says:
--   * an actor of kind 'owner' must be an owner member of the house organization (public.org_members);
--   * a writer reads back and changes only what its own sensitivity ceiling allows (owner: restricted;
--     agent and service: internal), and only the owner lowers a sensitivity or reads above internal;
--   * order is the plane's own append order (workstream_events.seq), never a clock the writer supplied;
--   * one operation key is one checkpoint: a replay changes nothing, the workstream's own fields included;
--   * volume is bounded per organization (workstreams, events per day, proposed decisions per day).
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if to_regnamespace('ai_context') is null or to_regclass('ai_context.decisions') is null
     or to_regclass('public.orgs') is null or to_regclass('public.org_members') is null
     or to_regclass('public.ops_objectives') is null or to_regclass('public.ops_agent_jobs') is null then
    raise exception 'ai_context_workstreams_v1 needs schema ai_context, ai_context.decisions, public.orgs, public.org_members, public.ops_objectives and public.ops_agent_jobs; nothing changed' using errcode = '55000';
  end if;
end $guard$;

-- ---------------------------------------------------------------- helpers

-- Every credential shape .github/workflows/secret-scan.yml refuses in Git (scripts/test/workstream-sync.test.mjs
-- reads that workflow and fails if one is missing here or in core/src/workstream-contract.mjs), plus more
-- prefixes and three shapes matched whatever their letter case: a private key header, a bearer token and a URL
-- with an inline password. core/src/workstream-contract.mjs carries the same two lists; the SQL check and the
-- Core test run the same samples through both. A pattern check is best effort: see "Honest limits" in the
-- contract for what it cannot see (an encoded, split or unfamiliar secret).
create or replace function ai_context.workstream_looks_secret(p_value text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_value, '') ~ (
    '-----BEGIN [A-Z ]*PRIVATE KEY-----'
    || '|gh[pousr]_[A-Za-z0-9_]{20,}'
    || '|github_pat_[A-Za-z0-9_]{20,}'
    || '|sk-ant-[A-Za-z0-9_-]{20,}'
    || '|sk-proj-[A-Za-z0-9_-]{20,}'
    || '|(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9]{32,}'
    || '|sb_secret_[A-Za-z0-9_-]{10,}'
    || '|sbp_[A-Za-z0-9]{20,}'
    || '|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
    || '|mcen1_[A-Za-z0-9_-]{16,}'
    || '|(^|[^A-Za-z0-9_])(sk|rk)_(live|test)_[A-Za-z0-9]{16,}'
    || '|whsec_[A-Za-z0-9]{16,}'
    || '|AKIA[0-9A-Z]{16}'
    || '|(^|[^A-Za-z0-9])AC[0-9a-f]{32}([^A-Za-z0-9]|$)'
    || '|xox[baprs]-[A-Za-z0-9-]{10,}'
    || '|AIza[0-9A-Za-z_-]{35}'
  ) or coalesce(p_value, '') ~* (
    '-----begin [a-z ]*private key-----'
    || '|bearer\s+[a-z0-9._~+/=-]{20,}'
    || '|[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@'
  );
$$;

-- A checkpoint is a fact, a decision or a reference, never a conversation. Three or more speaker-prefixed
-- lines is a pasted transcript, with or without Markdown around the speaker ("**User**:", "> assistant:",
-- "Me:" / "Claude:"); raw transcripts belong to context-ingest (ai_context.messages), not here.
create or replace function ai_context.workstream_looks_transcript(p_value text)
returns boolean language sql immutable set search_path = '' as $$
  select (select count(*) from regexp_matches(coalesce(p_value, ''),
    '(^|\n)[ \t>*_#\[-]*(user|assistant|human|system|ai|me|claude|chatgpt|gpt|gemini|grok|copilot|codex)[ \t\]*_]*:', 'gi')) >= 3;
$$;

-- Trim, bound and refuse. Every text that reaches either table goes through here. The trim removes every
-- white-space character JavaScript's String.trim removes (tabs and line breaks included), so a value of only
-- line breaks is empty here exactly as it is in Core.
create or replace function ai_context.workstream_text(p_field text, p_value text, p_max integer, p_required boolean default false)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(regexp_replace(coalesce(p_value, ''),
    '^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'), '');
begin
  if v is null then
    if p_required then raise exception '% is required', p_field using errcode = '22023'; end if;
    return null;
  end if;
  if length(v) > p_max then
    raise exception '% exceeds % characters', p_field, p_max using errcode = '22001';
  end if;
  if ai_context.workstream_looks_secret(v) then
    raise exception 'refusing to checkpoint text that looks like a credential (%)', p_field using errcode = '22023';
  end if;
  if ai_context.workstream_looks_transcript(v) then
    raise exception 'refusing to checkpoint text that looks like a raw transcript (%)', p_field using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function ai_context.workstream_sensitivity_rank(p_value text)
returns integer language plpgsql immutable set search_path = '' as $$
begin
  return case p_value when 'public' then 0 when 'internal' then 1 when 'confidential' then 2 when 'restricted' then 3 end;
end;
$$;

-- Core's authority is the house organization, the same rule public.ops_ai_context_search applies.
create or replace function ai_context.workstream_require_house(p_org uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  if p_org is null or not exists (select 1 from public.orgs o where o.id = p_org and o.slug = 'mccluster' and o.enabled = true) then
    raise exception 'organization outside Core authority' using errcode = '42501';
  end if;
end;
$$;

create or replace function ai_context.workstream_uuid(p_field text, p_value text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  if p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception '% must be a UUID', p_field using errcode = '22023';
  end if;
  return p_value::uuid;
end;
$$;

-- A client timestamp is evidence, not authority: it must parse and may not be meaningfully in the future.
create or replace function ai_context.workstream_time(p_field text, p_value text)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v timestamptz;
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  -- ISO 8601 with an explicit zone only: 'yesterday' and a zoneless time are valid timestamptz input, and neither
  -- says when something happened.
  if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,9})?)?(Z|[+-][0-9]{2}:?[0-9]{2})$' then
    raise exception '% is not an ISO timestamp', p_field using errcode = '22007';
  end if;
  begin
    v := p_value::timestamptz;
  exception when others then
    raise exception '% is not an ISO timestamp', p_field using errcode = '22007';
  end;
  if v > now() + interval '5 minutes' then
    raise exception '% is in the future', p_field using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Who wrote this: the actor Core was handed, plus what the harness says about itself. The database does not
-- take "owner" on trust: an owner actor must be an owner member of this organization, so a caller that holds
-- the service key or the broker credential cannot attribute a write to an owner who does not exist.
create or replace function ai_context.workstream_provenance(p_org uuid, p_provenance jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  p jsonb := coalesce(p_provenance, '{}'::jsonb);
  v_kind text;
  v_actor text;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'provenance must be an object' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_object_keys(p) k
              where k not in ('actor_kind', 'actor_id', 'actor_source', 'harness', 'model_id', 'session_id', 'device')) then
    raise exception 'provenance carries an unknown field' using errcode = '22023';
  end if;
  v_kind := ai_context.workstream_text('provenance.actor_kind', p->>'actor_kind', 20, true);
  if v_kind not in ('owner', 'agent', 'service') then
    raise exception 'provenance.actor_kind must be owner, agent or service' using errcode = '22023';
  end if;
  v_actor := ai_context.workstream_text('provenance.actor_id', p->>'actor_id', 200, true);
  if v_kind = 'owner' and not exists (
       select 1 from public.org_members m
        where m.org_id = p_org and m.role = 'owner'
          and m.profile_id = ai_context.workstream_uuid('provenance.actor_id', v_actor)) then
    raise exception 'provenance.actor_id is not an owner of this organization' using errcode = '42501';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'actor_kind', v_kind,
    'actor_id', case when v_kind = 'owner' then lower(v_actor) else v_actor end,
    'actor_source', ai_context.workstream_text('provenance.actor_source', p->>'actor_source', 80),
    'harness', ai_context.workstream_text('provenance.harness', p->>'harness', 80),
    'model_id', ai_context.workstream_text('provenance.model_id', p->>'model_id', 120),
    'session_id', ai_context.workstream_text('provenance.session_id', p->>'session_id', 200),
    'device', ai_context.workstream_text('provenance.device', p->>'device', 120)
  ));
end;
$$;

-- The highest sensitivity a writer may read back, change or assign: everything for a verified owner, internal
-- for an agent or a service. A write is a read too (it returns the row), so the ceiling applies to both.
create or replace function ai_context.workstream_ceiling(p_provenance jsonb)
returns integer language sql immutable set search_path = '' as $$
  select case when p_provenance->>'actor_kind' = 'owner' then 3 else 1 end;
$$;

-- Volume bounds per organization. A checkpoint is a fact about a line of work, not a stream: these are far
-- above honest use and stop a looping or hostile writer from filling the append-only log or the decision queue.
create or replace function ai_context.workstream_limit(p_name text)
returns integer language sql immutable set search_path = '' as $$
  select case p_name when 'workstreams' then 500 when 'events_per_day' then 5000 when 'decisions_per_day' then 200 end;
$$;

-- ---------------------------------------------------------------- tables

create table if not exists ai_context.workstreams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workstream_key text not null check (workstream_key ~ '^[a-z0-9][a-z0-9-]{1,62}$' and not ai_context.workstream_looks_secret(workstream_key)),
  title text not null check (length(title) between 1 and 200 and title ~ '\S' and not ai_context.workstream_looks_secret(title)),
  goal text not null check (length(goal) between 1 and 2000 and goal ~ '\S' and not ai_context.workstream_looks_secret(goal)),
  status text not null default 'active' check (status in ('active', 'blocked', 'done', 'parked')),
  branch text check (length(branch) <= 200 and not ai_context.workstream_looks_secret(branch)),
  head text check (length(head) <= 80 and not ai_context.workstream_looks_secret(head)),
  pr text check (length(pr) <= 300 and not ai_context.workstream_looks_secret(pr)),
  worktree text check (length(worktree) <= 300 and not ai_context.workstream_looks_secret(worktree)),
  next_step text check (length(next_step) <= 2000 and not ai_context.workstream_looks_secret(next_step)),
  -- Links, never copies: the objective and the jobs keep their own state in their own tables.
  objective_id uuid references public.ops_objectives(id) on delete set null,
  job_ids uuid[] not null default '{}'::uuid[] check (cardinality(job_ids) <= 20),
  sensitivity text not null default 'internal' check (sensitivity in ('public', 'internal', 'confidential', 'restricted')),
  last_provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(last_provenance) = 'object' and pg_column_size(last_provenance) <= 4096
                                                            and not ai_context.workstream_looks_secret(last_provenance::text)),
  source_created_at timestamptz not null default now(),
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, workstream_key)
);
create index if not exists ai_context_workstreams_resume_idx
  on ai_context.workstreams (org_id, status, source_updated_at desc);

create table if not exists ai_context.workstream_events (
  id uuid primary key default gen_random_uuid(),
  -- The plane's own append order. Which blocker an "unblocked" clears and which events are "the last N" are
  -- decided by this, never by occurred_at: that is the writer's clock, and it is evidence, not authority.
  seq bigint generated always as identity,
  org_id uuid not null,
  workstream_id uuid not null references ai_context.workstreams(id) on delete restrict,
  operation_key text not null check (operation_key ~ '^[A-Za-z0-9._:-]{1,200}$' and not ai_context.workstream_looks_secret(operation_key)),
  kind text not null check (kind in ('decision', 'done', 'verified', 'blocker', 'unblocked', 'note', 'open')),
  body text not null check (length(body) between 1 and 4000 and body ~ '\S' and not ai_context.workstream_looks_secret(body)),
  evidence text check (length(evidence) <= 1000 and not ai_context.workstream_looks_secret(evidence)),
  recorded_by text check (length(recorded_by) <= 200 and not ai_context.workstream_looks_secret(recorded_by)),
  occurred_at timestamptz not null,
  sensitivity text not null default 'internal' check (sensitivity in ('public', 'internal', 'confidential', 'restricted')),
  actor_kind text not null check (actor_kind in ('owner', 'agent', 'service')),
  actor_id text not null check (length(actor_id) between 1 and 200 and not ai_context.workstream_looks_secret(actor_id)),
  actor_source text check (length(actor_source) <= 80 and not ai_context.workstream_looks_secret(actor_source)),
  harness text check (length(harness) <= 80 and not ai_context.workstream_looks_secret(harness)),
  model_id text check (length(model_id) <= 120 and not ai_context.workstream_looks_secret(model_id)),
  session_id text check (length(session_id) <= 200 and not ai_context.workstream_looks_secret(session_id)),
  device text check (length(device) <= 120 and not ai_context.workstream_looks_secret(device)),
  -- Verified to exist for this organization when written. No foreign key: this row can never be updated, so
  -- an ON DELETE action here would either block deleting a job or break the append-only rule.
  objective_id uuid,
  job_id uuid,
  decision_id uuid,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (org_id, operation_key)
);
create index if not exists ai_context_workstream_events_resume_idx
  on ai_context.workstream_events (workstream_id, kind, seq desc);
create index if not exists ai_context_workstream_events_quota_idx
  on ai_context.workstream_events (org_id, created_at desc);

alter table ai_context.workstreams enable row level security;
alter table ai_context.workstream_events enable row level security;

create or replace function ai_context.workstream_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'ai_context.workstream_events is append-only: % refused', tg_op using errcode = '55000';
end;
$$;

drop trigger if exists workstream_events_append_only on ai_context.workstream_events;
create trigger workstream_events_append_only
  before update or delete on ai_context.workstream_events
  for each row execute function ai_context.workstream_events_append_only();
drop trigger if exists workstream_events_no_truncate on ai_context.workstream_events;
create trigger workstream_events_no_truncate
  before truncate on ai_context.workstream_events
  for each statement execute function ai_context.workstream_events_append_only();

-- ---------------------------------------------------------------- json shapes

-- mccluster-workstream/1: the local file's fields under the local file's names, then what only the plane knows.
create or replace function ai_context.workstream_json(p_row ai_context.workstreams)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'schema', 'mccluster-workstream/1',
    'id', p_row.workstream_key,
    'title', p_row.title,
    'goal', p_row.goal,
    'status', p_row.status,
    'branch', p_row.branch,
    'head', p_row.head,
    'pr', p_row.pr,
    'worktree', p_row.worktree,
    'next', p_row.next_step,
    'created_at', p_row.source_created_at,
    'updated_at', p_row.source_updated_at,
    'workstream_id', p_row.id,
    'objective_id', p_row.objective_id,
    'sensitivity', p_row.sensitivity,
    'recorded_at', p_row.updated_at
  )) || jsonb_build_object('job_ids', to_jsonb(p_row.job_ids), 'provenance', p_row.last_provenance);
$$;

create or replace function ai_context.workstream_event_json(p_row ai_context.workstream_events, p_text_max integer default 4000)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'at', p_row.occurred_at,
    'kind', p_row.kind,
    'text', left(p_row.body, greatest(1, p_text_max)),
    'text_truncated', case when length(p_row.body) > greatest(1, p_text_max) then true end,
    'evidence', p_row.evidence,
    'by', p_row.recorded_by,
    'operation_key', p_row.operation_key,
    'event_id', p_row.id,
    'seq', p_row.seq,
    'sensitivity', p_row.sensitivity,
    'objective_id', p_row.objective_id,
    'job_id', p_row.job_id,
    'decision_id', p_row.decision_id,
    'recorded_at', p_row.created_at,
    'provenance', jsonb_strip_nulls(jsonb_build_object(
      'actor_kind', p_row.actor_kind, 'actor_id', p_row.actor_id, 'actor_source', p_row.actor_source,
      'harness', p_row.harness, 'model_id', p_row.model_id, 'session_id', p_row.session_id, 'device', p_row.device))
  ));
$$;

-- The events a resume packet carries, in the reference store's proportions: an open workstream keeps its last
-- 8 decisions, 6 verified, 8 open questions, 5 done and the blockers nothing has cleared (last 6); a finished one
-- keeps one decision, one verified and one done. Text is cut for the packet, never in the table.
-- "Last", "cleared" and the order returned are the log's append order (seq), exactly as the reference store
-- walks its file: a blocker is cleared by an "unblocked" appended after it, whatever either one's clock said.
-- An event's own time (at) is shown, and decides nothing.
create or replace function ai_context.workstream_resume_events(p_workstream uuid, p_status text, p_rank integer)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(ai_context.workstream_event_json(e.ev, 1200) order by e.seq), '[]'::jsonb)
  from (
    select x as ev, x.seq, x.kind,
           row_number() over (partition by x.kind order by x.seq desc) as rn
    from ai_context.workstream_events x
    where x.workstream_id = p_workstream
      and ai_context.workstream_sensitivity_rank(x.sensitivity) <= p_rank
      and x.kind in ('decision', 'verified', 'open', 'blocker', 'done')
      and (x.kind <> 'blocker' or x.seq > coalesce((
            select max(u.seq) from ai_context.workstream_events u
             where u.workstream_id = p_workstream and u.kind = 'unblocked'), 0))
  ) e
  where e.rn <= case
    when p_status = 'done' then case e.kind when 'decision' then 1 when 'verified' then 1 when 'done' then 1 else 0 end
    else case e.kind when 'decision' then 8 when 'verified' then 6 when 'open' then 8 when 'blocker' then 6 when 'done' then 5 else 0 end
  end;
$$;

-- ---------------------------------------------------------------- RPCs

-- Create or merge one workstream. A field that is absent keeps its value; an empty string clears an optional one.
-- updated_at, when the caller sends it (a local file being ingested), is compared with what the plane already
-- holds: an older file never overwrites a newer checkpoint, and says so (applied false, stale true).
-- Every path returns the row, so every path is a read: a workstream above the writer's ceiling is refused
-- (42501) before anything about it is returned or changed, a writer cannot classify above its own ceiling,
-- and only the owner lowers a sensitivity.
create or replace function public.ops_ai_workstream_upsert(p_org uuid, p_workstream jsonb, p_provenance jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w jsonb := coalesce(p_workstream, '{}'::jsonb);
  v_prov jsonb;
  v_ceiling integer;
  v_key text;
  v_row ai_context.workstreams%rowtype;
  v_claim timestamptz;
  v_created_claim timestamptz;
  v_status text;
  v_sensitivity text;
  v_objective uuid;
  v_jobs uuid[];
  v_job text;
begin
  perform ai_context.workstream_require_house(p_org);
  -- All write RPCs take this organization lock before any workstream or operation-key lock.
  -- It makes the organization-wide volume checks atomic across distinct keys and keeps a
  -- workstream's classification stable until every read or write in the checkpoint finishes.
  perform pg_advisory_xact_lock(hashtextextended('ai_context.workstream_write:' || p_org::text, 0));
  if jsonb_typeof(w) <> 'object' then raise exception 'workstream must be an object' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_object_keys(w) k
              where k not in ('schema', 'id', 'title', 'goal', 'status', 'branch', 'head', 'pr', 'worktree', 'next',
                              'created_at', 'updated_at', 'objective_id', 'job_ids', 'sensitivity')) then
    raise exception 'workstream carries an unknown field' using errcode = '22023';
  end if;
  if w ? 'schema' and w->>'schema' is distinct from 'mccluster-workstream/1' then
    raise exception 'workstream schema must be mccluster-workstream/1' using errcode = '22023';
  end if;
  v_key := w->>'id';
  if v_key is null or v_key !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'workstream id must match ^[a-z0-9][a-z0-9-]{1,62}$' using errcode = '22023';
  end if;
  if ai_context.workstream_looks_secret(v_key) then
    raise exception 'refusing to checkpoint text that looks like a credential (workstream.id)' using errcode = '22023';
  end if;
  v_prov := ai_context.workstream_provenance(p_org, p_provenance);
  v_ceiling := ai_context.workstream_ceiling(v_prov);
  v_claim := ai_context.workstream_time('workstream.updated_at', w->>'updated_at');
  v_created_claim := ai_context.workstream_time('workstream.created_at', w->>'created_at');
  v_status := w->>'status';
  if v_status is not null and v_status not in ('active', 'blocked', 'done', 'parked') then
    raise exception 'workstream status must be active, blocked, done or parked' using errcode = '22023';
  end if;
  v_sensitivity := w->>'sensitivity';
  if v_sensitivity is not null and ai_context.workstream_sensitivity_rank(v_sensitivity) is null then
    raise exception 'sensitivity must be public, internal, confidential or restricted' using errcode = '22023';
  end if;
  if v_sensitivity is not null and ai_context.workstream_sensitivity_rank(v_sensitivity) > v_ceiling then
    raise exception 'workstream.sensitivity is above this writer''s sensitivity ceiling' using errcode = '42501';
  end if;
  if w ? 'objective_id' then
    v_objective := ai_context.workstream_uuid('workstream.objective_id', w->>'objective_id');
    if v_objective is not null and not exists (select 1 from public.ops_objectives o where o.id = v_objective and o.org_id = p_org) then
      raise exception 'workstream.objective_id is not an objective of this organization' using errcode = '23503';
    end if;
  end if;
  if w ? 'job_ids' then
    if jsonb_typeof(w->'job_ids') <> 'array' or jsonb_array_length(w->'job_ids') > 20 then
      raise exception 'workstream.job_ids must be an array of at most 20 job ids' using errcode = '22023';
    end if;
    v_jobs := '{}'::uuid[];
    for v_job in select jsonb_array_elements_text(w->'job_ids') loop
      v_jobs := v_jobs || ai_context.workstream_uuid('workstream.job_ids', v_job);
      if not exists (select 1 from public.ops_agent_jobs j where j.id = v_jobs[cardinality(v_jobs)] and j.org_id = p_org) then
        raise exception 'workstream.job_ids names a job this organization does not have' using errcode = '23503';
      end if;
    end loop;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_context.workstream:' || p_org::text || ':' || v_key, 0));
  select * into v_row from ai_context.workstreams where org_id = p_org and workstream_key = v_key for update;

  if not found then
    if (select count(*) from ai_context.workstreams t where t.org_id = p_org) >= ai_context.workstream_limit('workstreams') then
      raise exception 'this organization already has % workstreams; finish or reuse one instead of opening another', ai_context.workstream_limit('workstreams') using errcode = '54000';
    end if;
    insert into ai_context.workstreams (org_id, workstream_key, title, goal, status, branch, head, pr, worktree, next_step,
                                        objective_id, job_ids, sensitivity, last_provenance, source_created_at, source_updated_at)
    values (p_org, v_key,
            ai_context.workstream_text('workstream.title', w->>'title', 200, true),
            ai_context.workstream_text('workstream.goal', w->>'goal', 2000, true),
            coalesce(v_status, 'active'),
            ai_context.workstream_text('workstream.branch', w->>'branch', 200),
            ai_context.workstream_text('workstream.head', w->>'head', 80),
            ai_context.workstream_text('workstream.pr', w->>'pr', 300),
            ai_context.workstream_text('workstream.worktree', w->>'worktree', 300),
            ai_context.workstream_text('workstream.next', w->>'next', 2000),
            v_objective, coalesce(v_jobs, '{}'::uuid[]), coalesce(v_sensitivity, 'internal'), v_prov,
            coalesce(v_created_claim, v_claim, now()), coalesce(v_claim, now()))
    on conflict (org_id, workstream_key) do nothing
    returning * into v_row;
    if v_row.id is null then
      raise exception 'concurrent checkpoint of workstream %; retry', v_key using errcode = '40001';
    end if;
    return jsonb_build_object('applied', true, 'created', true, 'stale', false, 'workstream', ai_context.workstream_json(v_row));
  end if;

  -- Before anything about the stored row is returned (the stale and the name-only answers below return it too).
  if ai_context.workstream_sensitivity_rank(v_row.sensitivity) > v_ceiling then
    raise exception 'workstream % is above this writer''s sensitivity ceiling; nothing was read or changed', v_key using errcode = '42501';
  end if;
  if v_sensitivity is not null and v_prov->>'actor_kind' <> 'owner'
     and ai_context.workstream_sensitivity_rank(v_sensitivity) < ai_context.workstream_sensitivity_rank(v_row.sensitivity) then
    raise exception 'only the owner may lower a workstream''s sensitivity' using errcode = '42501';
  end if;

  if v_claim is not null and v_claim < v_row.source_updated_at then
    return jsonb_build_object('applied', false, 'created', false, 'stale', true, 'workstream', ai_context.workstream_json(v_row));
  end if;
  -- Naming a workstream is not changing it: a checkpoint that carries only the id (an event for an existing
  -- workstream) writes nothing here, so replaying events never moves a workstream's own time.
  if not exists (select 1 from jsonb_object_keys(w) k where k not in ('schema', 'id')) then
    return jsonb_build_object('applied', false, 'created', false, 'stale', false, 'workstream', ai_context.workstream_json(v_row));
  end if;

  update ai_context.workstreams t set
    title = case when w ? 'title' then ai_context.workstream_text('workstream.title', w->>'title', 200, true) else t.title end,
    goal = case when w ? 'goal' then ai_context.workstream_text('workstream.goal', w->>'goal', 2000, true) else t.goal end,
    status = coalesce(v_status, t.status),
    branch = case when w ? 'branch' then ai_context.workstream_text('workstream.branch', w->>'branch', 200) else t.branch end,
    head = case when w ? 'head' then ai_context.workstream_text('workstream.head', w->>'head', 80) else t.head end,
    pr = case when w ? 'pr' then ai_context.workstream_text('workstream.pr', w->>'pr', 300) else t.pr end,
    worktree = case when w ? 'worktree' then ai_context.workstream_text('workstream.worktree', w->>'worktree', 300) else t.worktree end,
    next_step = case when w ? 'next' then ai_context.workstream_text('workstream.next', w->>'next', 2000) else t.next_step end,
    objective_id = case when w ? 'objective_id' then v_objective else t.objective_id end,
    job_ids = case when w ? 'job_ids' then v_jobs else t.job_ids end,
    sensitivity = coalesce(v_sensitivity, t.sensitivity),
    last_provenance = v_prov,
    source_updated_at = greatest(t.source_updated_at, coalesce(v_claim, now())),
    updated_at = now()
  where t.id = v_row.id
  returning * into v_row;
  return jsonb_build_object('applied', true, 'created', false, 'stale', false, 'workstream', ai_context.workstream_json(v_row));
end;
$$;

-- Append one event, exactly once per operation key. A replay with the same content returns the stored event
-- (replayed true); the same key with different content is refused (23505). "Content" is everything the caller
-- said: workstream, kind, text, evidence, by, at, sensitivity, objective_id, job_id, decision_id and the
-- decision object. An owner decision either names an existing ai_context.decisions row (decision_id) or asks
-- for one to be proposed (decision {...}); this function never approves one.
create or replace function public.ops_ai_workstream_event_append(p_org uuid, p_workstream_key text, p_operation_key text, p_event jsonb, p_provenance jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e jsonb := coalesce(p_event, '{}'::jsonb);
  d jsonb;
  v_prov jsonb;
  v_ws ai_context.workstreams%rowtype;
  v_existing ai_context.workstream_events%rowtype;
  v_row ai_context.workstream_events%rowtype;
  v_kind text;
  v_body text;
  v_evidence text;
  v_by text;
  v_at timestamptz;
  v_sensitivity text;
  v_objective uuid;
  v_job uuid;
  v_decision uuid;
  v_decision_created boolean := false;
  v_hash text;
  v_risk text;
  v_idem text;
  v_ceiling integer;
  v_decision_said jsonb;
begin
  perform ai_context.workstream_require_house(p_org);
  perform pg_advisory_xact_lock(hashtextextended('ai_context.workstream_write:' || p_org::text, 0));
  if p_operation_key is null or p_operation_key !~ '^[A-Za-z0-9._:-]{1,200}$' then
    raise exception 'operation_key must match ^[A-Za-z0-9._:-]{1,200}$' using errcode = '22023';
  end if;
  -- The key is stored, echoed back and copied into ai_context.decisions.metadata: it is text like any other.
  if ai_context.workstream_looks_secret(p_operation_key) then
    raise exception 'refusing to checkpoint text that looks like a credential (operation_key)' using errcode = '22023';
  end if;
  if jsonb_typeof(e) <> 'object' then raise exception 'event must be an object' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_object_keys(e) k
              where k not in ('at', 'kind', 'text', 'evidence', 'by', 'sensitivity', 'objective_id', 'job_id', 'decision_id', 'decision')) then
    raise exception 'event carries an unknown field' using errcode = '22023';
  end if;
  v_prov := ai_context.workstream_provenance(p_org, p_provenance);
  v_ceiling := ai_context.workstream_ceiling(v_prov);
  v_kind := e->>'kind';
  if v_kind is null or v_kind not in ('decision', 'done', 'verified', 'blocker', 'unblocked', 'note', 'open') then
    raise exception 'event kind must be decision, done, verified, blocker, unblocked, note or open' using errcode = '22023';
  end if;
  v_body := ai_context.workstream_text('event.text', e->>'text', 4000, true);
  v_evidence := ai_context.workstream_text('event.evidence', e->>'evidence', 1000);
  v_by := ai_context.workstream_text('event.by', e->>'by', 200);
  v_at := ai_context.workstream_time('event.at', e->>'at');
  v_sensitivity := e->>'sensitivity';
  if v_sensitivity is not null and ai_context.workstream_sensitivity_rank(v_sensitivity) is null then
    raise exception 'sensitivity must be public, internal, confidential or restricted' using errcode = '22023';
  end if;
  if (e ? 'decision_id' or e ? 'decision') and v_kind <> 'decision' then
    raise exception 'only a decision event may reference or propose an ai_context decision' using errcode = '22023';
  end if;
  if e ? 'decision_id' and e ? 'decision' then
    raise exception 'send decision_id or decision, not both' using errcode = '22023';
  end if;
  -- Shapes first, existence later: everything the caller said is parsed here so that all of it is part of
  -- what "the same checkpoint" means below.
  v_objective := ai_context.workstream_uuid('event.objective_id', e->>'objective_id');
  v_job := ai_context.workstream_uuid('event.job_id', e->>'job_id');
  if e ? 'decision_id' then
    v_decision := ai_context.workstream_uuid('event.decision_id', e->>'decision_id');
    if v_decision is null then
      raise exception 'event.decision_id is not a decision of this organization' using errcode = '23503';
    end if;
  elsif e ? 'decision' then
    d := e->'decision';
    if jsonb_typeof(d) <> 'object' then raise exception 'event.decision must be an object' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_object_keys(d) k where k not in ('title', 'decision', 'rationale_summary', 'risk_class')) then
      raise exception 'event.decision carries an unknown field' using errcode = '22023';
    end if;
    v_risk := coalesce(d->>'risk_class', 'low');
    if v_risk not in ('low', 'medium', 'high', 'critical') then
      raise exception 'event.decision.risk_class must be low, medium, high or critical' using errcode = '22023';
    end if;
    v_decision_said := jsonb_strip_nulls(jsonb_build_object(
      'title', ai_context.workstream_text('event.decision.title', d->>'title', 200, true),
      'decision', ai_context.workstream_text('event.decision.decision', d->>'decision', 4000),
      'rationale_summary', ai_context.workstream_text('event.decision.rationale_summary', d->>'rationale_summary', 2000),
      'risk_class', v_risk));
  end if;

  select * into v_ws from ai_context.workstreams where org_id = p_org and workstream_key = p_workstream_key;
  if not found then
    raise exception 'unknown workstream %; checkpoint the workstream first', coalesce(p_workstream_key, '(null)') using errcode = 'P0002';
  end if;
  -- A replay returns the stored event, so the ceiling is checked before the replay answer, not after it.
  if ai_context.workstream_sensitivity_rank(v_ws.sensitivity) > v_ceiling then
    raise exception 'workstream % is above this writer''s sensitivity ceiling; nothing was read or changed', v_ws.workstream_key using errcode = '42501';
  end if;
  if v_sensitivity is not null and ai_context.workstream_sensitivity_rank(v_sensitivity) > v_ceiling then
    raise exception 'event.sensitivity is above this writer''s sensitivity ceiling' using errcode = '42501';
  end if;

  -- What makes two sends "the same": everything the caller said, as the caller said it. A server-assigned
  -- time and an inherited sensitivity are not part of it; a sensitivity, a link or a decision the caller
  -- named is, so a retry that changes one of them is refused instead of being reported as recorded.
  v_hash := encode(sha256(convert_to(jsonb_build_array(
    v_ws.workstream_key, v_kind, v_body, v_evidence, v_by, coalesce(to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
    coalesce(v_sensitivity, ''), coalesce(v_objective::text, ''), coalesce(v_job::text, ''),
    coalesce(v_decision::text, ''), coalesce(v_decision_said, '{}'::jsonb)
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('ai_context.workstream_event:' || p_org::text || ':' || p_operation_key, 0));
  select * into v_existing from ai_context.workstream_events where org_id = p_org and operation_key = p_operation_key;
  if found then
    -- Events keep their original classification even when the owner later lowers the
    -- workstream's. A replay is a read of this stored event, not a new inherited event.
    if ai_context.workstream_sensitivity_rank(v_existing.sensitivity) > v_ceiling then
      raise exception 'stored event is above this writer''s sensitivity ceiling; nothing was read or changed' using errcode = '42501';
    end if;
    if v_existing.content_hash <> v_hash or v_existing.workstream_id <> v_ws.id then
      raise exception 'operation_key % was already used for a different checkpoint', p_operation_key using errcode = '23505';
    end if;
    return jsonb_build_object('appended', false, 'replayed', true, 'decision_created', false,
                              'event', ai_context.workstream_event_json(v_existing));
  end if;

  if v_objective is not null and not exists (select 1 from public.ops_objectives o where o.id = v_objective and o.org_id = p_org) then
    raise exception 'event.objective_id is not an objective of this organization' using errcode = '23503';
  end if;
  if v_job is not null and not exists (select 1 from public.ops_agent_jobs j where j.id = v_job and j.org_id = p_org) then
    raise exception 'event.job_id is not a job of this organization' using errcode = '23503';
  end if;
  if (select count(*) from ai_context.workstream_events c where c.org_id = p_org and c.created_at > now() - interval '24 hours')
     >= ai_context.workstream_limit('events_per_day') then
    raise exception 'this organization has appended % checkpoint events in the last 24 hours; nothing was written', ai_context.workstream_limit('events_per_day') using errcode = '54000';
  end if;

  if e ? 'decision_id' then
    if not exists (select 1 from ai_context.decisions x where x.id = v_decision and x.org_id = p_org) then
      raise exception 'event.decision_id is not a decision of this organization' using errcode = '23503';
    end if;
  elsif e ? 'decision' then
    v_idem := 'workstream:' || p_operation_key;
    select x.id into v_decision from ai_context.decisions x
     where x.org_id = p_org and x.proposed_by = v_prov->>'actor_id' and x.metadata->>'idempotency_key' = v_idem
     limit 1;
    if v_decision is null then
      if (select count(*) from ai_context.decisions x
           where x.org_id = p_org and x.metadata->>'ingress' = 'workstream-checkpoint' and x.created_at > now() - interval '24 hours')
         >= ai_context.workstream_limit('decisions_per_day') then
        raise exception 'this organization has proposed % decisions through checkpoints in the last 24 hours; nothing was written', ai_context.workstream_limit('decisions_per_day') using errcode = '54000';
      end if;
      insert into ai_context.decisions (org_id, title, decision, rationale_summary, risk_class, status, proposed_by, metadata)
      values (p_org,
              v_decision_said->>'title',
              coalesce(v_decision_said->>'decision', v_body),
              v_decision_said->>'rationale_summary',
              v_risk, 'proposed', v_prov->>'actor_id',
              jsonb_build_object('ingress', 'workstream-checkpoint', 'idempotency_key', v_idem,
                                 'workstream_key', v_ws.workstream_key, 'operation_key', p_operation_key, 'provenance', v_prov))
      returning id into v_decision;
      v_decision_created := true;
    end if;
  end if;

  insert into ai_context.workstream_events (org_id, workstream_id, operation_key, kind, body, evidence, recorded_by, occurred_at,
                                            sensitivity, actor_kind, actor_id, actor_source, harness, model_id, session_id, device,
                                            objective_id, job_id, decision_id, content_hash)
  values (p_org, v_ws.id, p_operation_key, v_kind, v_body, v_evidence, v_by, coalesce(v_at, now()),
          coalesce(v_sensitivity, v_ws.sensitivity), v_prov->>'actor_kind', v_prov->>'actor_id', v_prov->>'actor_source',
          v_prov->>'harness', v_prov->>'model_id', v_prov->>'session_id', v_prov->>'device',
          v_objective, v_job, v_decision, v_hash)
  on conflict (org_id, operation_key) do nothing
  returning * into v_row;
  if v_row.id is null then
    raise exception 'concurrent checkpoint with operation_key %; retry', p_operation_key using errcode = '40001';
  end if;

  update ai_context.workstreams t
     set source_updated_at = greatest(t.source_updated_at, v_row.occurred_at), updated_at = now(), last_provenance = v_prov
   where t.id = v_ws.id;

  return jsonb_build_object('appended', true, 'replayed', false, 'decision_created', v_decision_created,
                            'event', ai_context.workstream_event_json(v_row));
end;
$$;

-- What a harness calls: the workstream's state and, optionally, one event, in one transaction. Either both land
-- or neither does.
-- The operation key covers the whole call, not only the event. A checkpoint whose key is already recorded is a
-- replay: the event is answered from the log (or refused, 23505, if its content differs) and the workstream's
-- own fields are NOT applied again, so a late retry of an old checkpoint can never rewind branch, head, pr or
-- next to what they were when it was first sent. A checkpoint with no event has no key: it is protected by
-- updated_at when the writer sends one (stale), and is otherwise a plain last-writer-wins merge.
create or replace function public.ops_ai_workstream_checkpoint(p_org uuid, p_workstream jsonb, p_operation_key text default null, p_event jsonb default null, p_provenance jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_set jsonb;
  v_event jsonb;
  v_has_event boolean := p_event is not null and jsonb_typeof(p_event) <> 'null';
begin
  perform ai_context.workstream_require_house(p_org);
  -- Take the shared write lock before the replay lock; nested RPCs re-enter it in this transaction.
  perform pg_advisory_xact_lock(hashtextextended('ai_context.workstream_write:' || p_org::text, 0));
  if v_has_event and p_operation_key is not null then
    -- The same lock _event_append takes (re-entrant in this transaction), taken before the workstream is
    -- touched so two sends of one key cannot both see "not recorded yet".
    perform pg_advisory_xact_lock(hashtextextended('ai_context.workstream_event:' || p_org::text || ':' || p_operation_key, 0));
    if exists (select 1 from ai_context.workstream_events x where x.org_id = p_org and x.operation_key = p_operation_key) then
      -- Validates the provenance, the ceiling and that the content is the same; raises otherwise.
      v_event := public.ops_ai_workstream_event_append(p_org, p_workstream->>'id', p_operation_key, p_event, p_provenance);
      select jsonb_build_object('applied', false, 'created', false, 'stale', false, 'replayed', true,
                                'workstream', ai_context.workstream_json(t)) into v_set
        from ai_context.workstreams t where t.org_id = p_org and t.workstream_key = p_workstream->>'id';
      return jsonb_build_object('schema', 'mccluster-workstream-checkpoint/1', 'workstream', v_set, 'event', v_event, 'observed_at', now());
    end if;
  end if;
  v_set := public.ops_ai_workstream_upsert(p_org, p_workstream, p_provenance);
  if v_has_event then
    v_event := public.ops_ai_workstream_event_append(p_org, p_workstream->>'id', p_operation_key, p_event, p_provenance);
    select jsonb_set(v_set, '{workstream}', ai_context.workstream_json(t)) into v_set
      from ai_context.workstreams t where t.org_id = p_org and t.workstream_key = p_workstream->>'id';
  end if;
  return jsonb_build_object('schema', 'mccluster-workstream-checkpoint/1', 'workstream', v_set, 'event', v_event, 'observed_at', now());
end;
$$;

-- The resume read: one row per workstream, active first, then blocked, parked, done; newest first inside each.
-- Bounded (1..50 rows, the event selection above, text cut to 1200 characters). A workstream above the caller's
-- sensitivity ceiling is returned as a stub (withheld true) rather than dropped, so a withheld workstream never
-- reads as "no workstream". Zero rows means there genuinely are none.
-- Reading above internal needs p_actor_id to be an owner member of the organization: the ceiling is decided
-- here, not by whichever caller chose p_max_sensitivity.
create or replace function public.ops_ai_workstream_resume(p_org uuid, p_limit integer default 20, p_max_sensitivity text default 'internal', p_workstream_key text default null, p_actor_id uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  n integer := least(50, greatest(1, coalesce(p_limit, 20)));
  v_rank integer := ai_context.workstream_sensitivity_rank(coalesce(p_max_sensitivity, 'internal'));
begin
  perform ai_context.workstream_require_house(p_org);
  if v_rank is null then
    raise exception 'sensitivity must be public, internal, confidential or restricted' using errcode = '22023';
  end if;
  if v_rank > 1 and not exists (
       select 1 from public.org_members m where m.org_id = p_org and m.role = 'owner' and m.profile_id = p_actor_id) then
    raise exception 'reading above internal sensitivity needs an owner of this organization' using errcode = '42501';
  end if;
  if p_workstream_key is not null and p_workstream_key !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'workstream id must match ^[a-z0-9][a-z0-9-]{1,62}$' using errcode = '22023';
  end if;
  return query
  select case
    when ai_context.workstream_sensitivity_rank(s.sensitivity) > v_rank then jsonb_build_object(
      'schema', 'mccluster-workstream/1', 'id', s.workstream_key, 'status', s.status, 'sensitivity', s.sensitivity,
      'withheld', true, 'updated_at', s.source_updated_at, 'total', s.total)
    else ai_context.workstream_json(s.w) || jsonb_build_object(
      'withheld', false,
      'events', ai_context.workstream_resume_events(s.id, s.status, v_rank),
      'event_count', (select count(*) from ai_context.workstream_events c where c.workstream_id = s.id),
      'events_withheld', (select count(*) from ai_context.workstream_events c
                           where c.workstream_id = s.id and ai_context.workstream_sensitivity_rank(c.sensitivity) > v_rank),
      'total', s.total)
  end
  from (
    select t as w, t.id, t.workstream_key, t.status, t.sensitivity, t.source_updated_at, count(*) over () as total
    from ai_context.workstreams t
    where t.org_id = p_org and (p_workstream_key is null or t.workstream_key = p_workstream_key)
    order by case t.status when 'active' then 0 when 'blocked' then 1 when 'parked' then 2 else 3 end,
             t.source_updated_at desc, t.workstream_key
    limit n
  ) s
  order by case s.status when 'active' then 0 when 'blocked' then 1 when 'parked' then 2 else 3 end,
           s.source_updated_at desc, s.workstream_key;
end;
$$;

-- ---------------------------------------------------------------- privileges

revoke all on ai_context.workstreams, ai_context.workstream_events from public, anon, authenticated, service_role;

revoke all on function ai_context.workstream_looks_secret(text) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_looks_transcript(text) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_text(text, text, integer, boolean) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_sensitivity_rank(text) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_require_house(uuid) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_uuid(text, text) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_time(text, text) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_provenance(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_ceiling(jsonb) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_limit(text) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_events_append_only() from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_json(ai_context.workstreams) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_event_json(ai_context.workstream_events, integer) from public, anon, authenticated, service_role;
revoke all on function ai_context.workstream_resume_events(uuid, text, integer) from public, anon, authenticated, service_role;

revoke all on function public.ops_ai_workstream_upsert(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.ops_ai_workstream_event_append(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.ops_ai_workstream_checkpoint(uuid, jsonb, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.ops_ai_workstream_resume(uuid, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.ops_ai_workstream_upsert(uuid, jsonb, jsonb) to service_role;
grant execute on function public.ops_ai_workstream_event_append(uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function public.ops_ai_workstream_checkpoint(uuid, jsonb, text, jsonb, jsonb) to service_role;
grant execute on function public.ops_ai_workstream_resume(uuid, integer, text, text, uuid) to service_role;

comment on table ai_context.workstreams is 'Private. Where each line of work stands (mccluster-workstream/1). Written only through public.ops_ai_workstream_* by service_role. docs/control-plane/WORKSTREAM-CHECKPOINTS.md';
comment on table ai_context.workstream_events is 'Private, append-only checkpoint log, one row per (org, operation key), ordered by seq. Known credential shapes and pasted transcripts are refused by pattern (best effort, not a guarantee). docs/control-plane/WORKSTREAM-CHECKPOINTS.md';

commit;
