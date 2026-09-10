-- Bitemporal beliefs and cross-source entity resolution.
--
-- seek_first_entity_revisions answers "what changed". It cannot answer the
-- question an audit actually asks: "what did we BELIEVE at the time, using only
-- what we knew at the time." Those differ whenever a provider restates history
-- -- a vessel's track is corrected, a permit is backdated, an earthquake's
-- magnitude is revised -- and a single timestamp column cannot express the
-- difference. Replaying a decision against today's data is not a replay.
--
-- So two independent clocks:
--
--   VALID time       valid_from / valid_to
--                    when the fact was true in the world.
--   TRANSACTION time recorded_at / superseded_at
--                    when we learned it, and when a later record replaced our
--                    belief. Never mutated: a correction is a new row.
--
-- With both, "as of knowledge time K, about world time W" is a single query,
-- and the answer is stable forever regardless of what arrives later.

create table if not exists public.seek_first_beliefs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_id uuid references public.seek_first_entities(id) on delete cascade,

  source_key text not null,
  external_id text,
  predicate text not null,
  value jsonb not null default '{}'::jsonb,
  location extensions.geography(Point, 4326),

  -- World time.
  valid_from timestamptz not null,
  valid_to timestamptz,

  -- Knowledge time. Append-only.
  recorded_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references public.seek_first_beliefs(id) on delete set null,

  -- Provenance, closed all the way to the bytes. archive_key names the R2
  -- object the claim was parsed from, so a belief can be re-derived from the
  -- payload we actually held rather than from what the provider serves now.
  archive_key text,
  archive_sha256 text,
  source_url text,
  licence_id text,
  source_class text,
  provenance jsonb not null default '{}'::jsonb,

  constraint seek_first_beliefs_valid_order check (valid_to is null or valid_to > valid_from),
  constraint seek_first_beliefs_superseded_order check (superseded_at is null or superseded_at >= recorded_at),
  constraint seek_first_beliefs_sha check (archive_sha256 is null or archive_sha256 ~ '^[0-9a-f]{64}$')
);

-- The as-of query filters on both clocks at once, so they are indexed together.
create index if not exists seek_first_beliefs_bitemporal_idx
  on public.seek_first_beliefs (org_id, entity_id, recorded_at desc, valid_from desc);
create index if not exists seek_first_beliefs_current_idx
  on public.seek_first_beliefs (org_id, predicate, valid_from desc)
  where superseded_at is null;
create index if not exists seek_first_beliefs_location_gix
  on public.seek_first_beliefs using gist (location);
create index if not exists seek_first_beliefs_archive_idx
  on public.seek_first_beliefs (archive_key)
  where archive_key is not null;

alter table public.seek_first_beliefs enable row level security;

/*
  What we believed at knowledge time K about world time W.

  Defaulting both clocks to now() makes the ordinary "current state" read the
  same query as a historical replay, so there is no second code path that can
  drift from the audited one.
*/
create or replace function public.seek_first_as_of(
  p_org uuid,
  p_known_at timestamptz default now(),
  p_valid_at timestamptz default now(),
  p_entity uuid default null,
  p_predicate text default null,
  p_limit integer default 500
)
returns table (
  id uuid,
  entity_id uuid,
  source_key text,
  predicate text,
  value jsonb,
  valid_from timestamptz,
  valid_to timestamptz,
  recorded_at timestamptz,
  archive_key text,
  licence_id text,
  source_class text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.id, b.entity_id, b.source_key, b.predicate, b.value,
         b.valid_from, b.valid_to, b.recorded_at,
         b.archive_key, b.licence_id, b.source_class
    from public.seek_first_beliefs b
   where b.org_id = p_org
     -- knowledge clock: only what had been recorded, and not yet replaced, at K
     and b.recorded_at <= p_known_at
     and (b.superseded_at is null or b.superseded_at > p_known_at)
     -- world clock: only what was true at W
     and b.valid_from <= p_valid_at
     and (b.valid_to is null or b.valid_to > p_valid_at)
     and (p_entity is null or b.entity_id = p_entity)
     and (p_predicate is null or b.predicate = p_predicate)
   order by b.valid_from desc, b.recorded_at desc
   limit greatest(1, least(coalesce(p_limit, 500), 5000));
$$;

/*
  Correct a belief without destroying the earlier one. The old row is closed at
  the moment the correction was learned, not at the moment the world changed, so
  a replay from before the correction still returns the original answer.
*/
create or replace function public.seek_first_supersede_belief(
  p_belief uuid,
  p_replacement uuid,
  p_known_at timestamptz default now()
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.seek_first_beliefs
     set superseded_at = p_known_at,
         superseded_by = p_replacement
   where id = p_belief
     and superseded_at is null;
$$;

-- ── cross-source entity resolution ──────────────────────────────────────────
--
-- The same port appears as a Socrata row, a STAC scene footprint, an AIS track
-- and a federal contract. Those are four observations of one object. Links are
-- kept as evidence with a method and a confidence rather than by mutating the
-- entities into one, so a bad match is reversible and an analyst can see WHY
-- two records were joined.

create table if not exists public.seek_first_entity_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  canonical_entity_id uuid not null references public.seek_first_entities(id) on delete cascade,
  member_entity_id uuid not null references public.seek_first_entities(id) on delete cascade,

  match_method text not null check (match_method in (
    'exact_external_id', 'shared_identifier', 'spatial_temporal', 'name_similarity', 'manual'
  )),
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  evidence jsonb not null default '{}'::jsonb,

  decided_by text not null default 'system',
  decided_at timestamptz not null default now(),
  retracted_at timestamptz,

  constraint seek_first_entity_links_distinct check (canonical_entity_id <> member_entity_id)
);

-- One live link per pair; a retracted one may be superseded by a new decision.
create unique index if not exists seek_first_entity_links_live_uidx
  on public.seek_first_entity_links (org_id, canonical_entity_id, member_entity_id)
  where retracted_at is null;
create index if not exists seek_first_entity_links_member_idx
  on public.seek_first_entity_links (org_id, member_entity_id)
  where retracted_at is null;

alter table public.seek_first_entity_links enable row level security;

/*
  Every entity currently resolved to a canonical one, with the confidence and
  method that joined it. A manual decision outranks any automatic one, so a
  human correction is never re-litigated by the matcher.
*/
create or replace function public.seek_first_resolved_members(
  p_org uuid,
  p_canonical uuid,
  p_min_confidence numeric default 0.5
)
returns table (
  member_entity_id uuid,
  match_method text,
  confidence numeric,
  decided_by text,
  decided_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.member_entity_id, l.match_method, l.confidence, l.decided_by, l.decided_at
    from public.seek_first_entity_links l
   where l.org_id = p_org
     and l.canonical_entity_id = p_canonical
     and l.retracted_at is null
     and (l.match_method = 'manual' or l.confidence >= coalesce(p_min_confidence, 0.5))
   order by (l.match_method = 'manual') desc, l.confidence desc, l.decided_at desc;
$$;
