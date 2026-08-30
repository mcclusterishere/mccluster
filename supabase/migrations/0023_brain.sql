-- ============================================================
-- 0023 — THE BRAIN
--
-- 0021 gave the inbox a mouth and 0022 gave it hands. Neither gave it
-- anything to think with: every reply was a literal string somebody had
-- typed into a rule, so the bot could only answer questions that had already
-- been anticipated.
--
-- This adds the three things a chatbot actually is:
--
--   KNOWLEDGE   what it can look up          (L2 — RAG)
--   MEMORY      what it remembers about you  (L3 — four tiers)
--   JUDGEMENT   what it costs and how well   (L0 — routing + evals)
--
-- The stack is Postgres and nothing else. The reference architecture this
-- follows calls for Kubernetes, Kafka, Redis and a dedicated vector database;
-- at the volume of one artist's inbox those are four more things to operate
-- and none of them are faster than a table. pgvector is free on every
-- Supabase plan and does the same job here.
-- ============================================================

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ============================================================
-- L2 — KNOWLEDGE
-- ============================================================

-- One row per source: a page of the site, a track, a service, an FAQ entry.
create table if not exists public.kb_documents (
  id          uuid primary key default gen_random_uuid(),
  -- 'page' | 'track' | 'offering' | 'faq' | 'resolution'
  kind        text not null,
  url         text,
  title       text not null,
  body        text not null,
  -- everything needed to answer "why did it say that" without guessing
  source      text not null default 'site',
  -- sha256 of body: re-ingesting an unchanged page must not re-embed it,
  -- because embedding is the part that costs money
  content_hash text not null,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- a UNIQUE constraint cannot take an expression; a unique INDEX can
create unique index if not exists kb_documents_ident
  on public.kb_documents (kind, coalesce(url, title));

-- The retrievable unit. A whole page is too coarse to cite and a sentence is
-- too small to be meaningful, so text is chunked with overlap.
create table if not exists public.kb_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.kb_documents(id) on delete cascade,
  ordinal     int not null,
  -- the document's title, copied onto the chunk. Denormalised on purpose: a
  -- generated column cannot reach into another table, and a chunk that cannot
  -- be found by its own heading is a chunk nobody finds. "Do you take new
  -- website clients?" is the whole answer to that question and its body never
  -- repeats the words.
  heading     text not null default '',
  body        text not null,
  -- voyage-4 at output_dimension 1024 (its default; the family also offers
  -- 2048/512/256 and the embeddings are Matryoshka-nested, so a 1024 vector is
  -- the first 1024 entries of the 2048 one). Nullable: full-text retrieval
  -- works with no embedding provider configured at all, which means the
  -- knowledge base is useful before anyone has signed up for anything.
  embedding   vector(1024),
  embed_model text,
  -- the BM25 half of hybrid retrieval, maintained by Postgres itself
  -- title weighted above body: a heading match is a stronger signal than a
  -- passing mention in the text
  fts         tsvector generated always as (
                setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
                setweight(to_tsvector('english', body), 'B')
              ) stored,
  tokens      int,
  created_at  timestamptz not null default now(),
  unique (document_id, ordinal)
);

create index if not exists kb_chunks_fts on public.kb_chunks using gin (fts);
create index if not exists kb_chunks_trgm on public.kb_chunks using gin (body gin_trgm_ops);
-- No ANN index. At a few thousand chunks an exact scan is faster than an
-- approximate one and never wrong; add ivfflat/hnsw if this ever gets big.

comment on table public.kb_chunks is
  'Retrievable text. Hybrid: fts is always populated, embedding only when an embedding provider is configured.';

-- ------------------------------------------------------------
-- HYBRID RETRIEVAL
--
-- Reciprocal Rank Fusion. Two rankings — keyword and semantic — are merged by
-- 1/(k+rank) rather than by score, because the two scores are not on the same
-- scale and normalising them is a fiddle that RRF makes unnecessary.
--
-- With no embedding passed, this degrades to pure full-text and still works.
-- ------------------------------------------------------------
create or replace function public.kb_search(
  q text,
  q_embedding vector(1024) default null,
  match_count int default 8,
  rrf_k int default 60
)
returns table (
  chunk_id uuid, document_id uuid, title text, url text, kind text,
  body text, fts_rank int, vec_rank int, score double precision
)
language sql stable
security definer set search_path = public
as $$
  -- The query terms, ORed.
  --
  -- websearch_to_tsquery ANDs every term, which sounds right and is useless:
  -- "are you taking on new clients for a site" becomes
  -- 'take' & 'new' & 'client' & 'site', and a page that never says "client"
  -- scores zero however relevant it is. Real keyword retrieval ranks by how
  -- many terms match, it does not require all of them. So the query text is
  -- pushed through to_tsvector to get stemmed, stopword-free lexemes, and
  -- those are ORed. Going through to_tsvector also means no user text is ever
  -- concatenated into a tsquery, which is the injection-safe way to do this.
  with terms as (
    select nullif(array_to_string(tsvector_to_array(to_tsvector('english', q)), ' | '), '')::tsquery as tq
  ),
  kw as (
    select c.id, row_number() over (
             order by ts_rank_cd(c.fts, t.tq) desc
           ) as rank
    from public.kb_chunks c
    join public.kb_documents d on d.id = c.document_id
    cross join terms t
    where d.enabled and t.tq is not null and c.fts @@ t.tq
    limit greatest(match_count * 4, 40)
  ),
  vec as (
    select c.id, row_number() over (order by c.embedding <=> q_embedding) as rank
    from public.kb_chunks c
    join public.kb_documents d on d.id = c.document_id
    where q_embedding is not null and c.embedding is not null and d.enabled
    limit greatest(match_count * 4, 40)
  ),
  fused as (
    select coalesce(kw.id, vec.id) as id,
           kw.rank as fts_rank, vec.rank as vec_rank,
           coalesce(1.0 / (rrf_k + kw.rank), 0.0)
         + coalesce(1.0 / (rrf_k + vec.rank), 0.0) as score
    from kw full outer join vec on kw.id = vec.id
  )
  select c.id, c.document_id, d.title, d.url, d.kind, c.body,
         f.fts_rank::int, f.vec_rank::int, f.score
  from fused f
  join public.kb_chunks c on c.id = f.id
  join public.kb_documents d on d.id = c.document_id
  order by f.score desc
  limit match_count;
$$;

comment on function public.kb_search is
  'Hybrid retrieval by reciprocal rank fusion. Works with no embedding at all, in which case it is pure full-text.';

-- ============================================================
-- L3 — MEMORY, IN FOUR TIERS
--
-- Tier 1 (working) is the model's context window and lives nowhere.
-- Tier 2 (session) is inbox_messages, which already exists.
-- Tiers 3 and 4 are these.
-- ============================================================

-- TIER 3 — what is true about one person, across every conversation they
-- have ever had, on any channel.
create table if not exists public.memory_facts (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.inbox_contacts(id) on delete cascade,
  -- 'preference' | 'fact' | 'history' | 'style'
  kind        text not null default 'fact',
  key         text not null,
  value       text not null,
  -- 0..1. A thing someone said once is not a thing they believe.
  confidence  real not null default 0.6 check (confidence between 0 and 1),
  -- where this came from, so a wrong memory can be traced to the message
  -- that caused it rather than argued with
  source_message_id uuid references public.inbox_messages(id) on delete set null,
  -- contradiction handling: superseded rows are kept, not overwritten
  superseded_by uuid references public.memory_facts(id) on delete set null,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create unique index if not exists memory_facts_live
  on public.memory_facts (contact_id, key) where superseded_by is null;
create index if not exists memory_facts_contact on public.memory_facts (contact_id, last_seen desc);

comment on table public.memory_facts is
  'Tier 3. What is true about one person. Contradictions supersede rather than overwrite, so a wrong memory can be traced instead of argued with.';

-- TIER 4 — what is true about the house. Brand voice, standing answers, and
-- the resolutions worth reusing. Shared by every conversation.
create table if not exists public.memory_shared (
  id         uuid primary key default gen_random_uuid(),
  -- 'voice' | 'policy' | 'fact' | 'resolution'
  kind       text not null,
  key        text not null unique,
  value      text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.memory_shared is
  'Tier 4. What is true about the house rather than about one person: voice, policy, standing answers.';

-- ============================================================
-- L0 — WHAT IT COST AND WHETHER IT WAS ANY GOOD
-- ============================================================

-- One row per model call. Not per conversation: a single reply may take a
-- routing call, a retrieval and an answer, and "what did that reply cost" is
-- only answerable if each leg is recorded.
create table if not exists public.ai_calls (
  id           uuid primary key default gen_random_uuid(),
  conv_id      uuid references public.inbox_conversations(id) on delete set null,
  -- 'route' | 'answer' | 'extract' | 'verify' | 'embed'
  purpose      text not null,
  model        text not null,
  pattern      text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  -- micro-dollars: money in floats is a bug waiting to be argued about
  cost_micros  bigint not null default 0,
  latency_ms   int,
  ok           boolean not null default true,
  error        text,
  -- the retrieval that fed this call, so an answer can be traced to its source
  citations    jsonb not null default '[]'::jsonb,
  at           timestamptz not null default now()
);

create index if not exists ai_calls_conv on public.ai_calls (conv_id, at desc);
create index if not exists ai_calls_cost on public.ai_calls (at desc);

comment on column public.ai_calls.cost_micros is
  'Millionths of a dollar. Integer on purpose — floating-point money is a bug waiting to be argued about.';

-- Prices, so cost is computed from a table rather than hard-coded in a
-- function that nobody updates when a price changes.
create table if not exists public.ai_model_prices (
  model            text primary key,
  input_per_mtok   numeric(10,4) not null,
  output_per_mtok  numeric(10,4) not null,
  context_tokens   int,
  note             text,
  updated_at       timestamptz not null default now()
);

insert into public.ai_model_prices (model, input_per_mtok, output_per_mtok, context_tokens, note) values
  ('claude-opus-5',    5.00, 25.00, 1000000, 'default. 1M context'),
  ('claude-sonnet-5',  3.00, 15.00, 1000000, 'intro pricing 2.00/10.00 through 2026-08-31'),
  ('claude-haiku-4-5', 1.00,  5.00,  200000, 'routing, extraction, anything high-volume and cheap'),
  ('voyage-4',         0.06,  0.00,       0, 'embeddings, per 1M input tokens')
on conflict (model) do update
  set input_per_mtok = excluded.input_per_mtok,
      output_per_mtok = excluded.output_per_mtok,
      context_tokens = excluded.context_tokens,
      note = excluded.note,
      updated_at = now();

-- Did the answer hold up? Filled by a human at the desk or by an eval run.
create table if not exists public.ai_evals (
  id         uuid primary key default gen_random_uuid(),
  call_id    uuid references public.ai_calls(id) on delete cascade,
  -- 'grounded' | 'helpful' | 'in_voice' | 'safe'
  dimension  text not null,
  -- -1 bad, 0 unsure, 1 good
  verdict    int not null check (verdict between -1 and 1),
  note       text,
  by_staff   uuid references public.inbox_staff(profile_id),
  at         timestamptz not null default now()
);

-- ============================================================
-- LOCK IT DOWN
--
-- The knowledge base is the only thing here a browser has any business
-- reading, and even that is read-only and only what is enabled.
-- ============================================================
alter table public.kb_documents   enable row level security;
alter table public.kb_chunks      enable row level security;
alter table public.memory_facts   enable row level security;
alter table public.memory_shared  enable row level security;
alter table public.ai_calls       enable row level security;
alter table public.ai_model_prices enable row level security;
alter table public.ai_evals       enable row level security;

revoke all on public.kb_documents, public.kb_chunks, public.memory_facts,
                public.memory_shared, public.ai_calls, public.ai_model_prices,
                public.ai_evals
  from anon, authenticated;

-- No policies. RLS on with none denies everyone but the service role. The
-- memory tables hold what people told the bot in private; the ai_calls table
-- holds what it cost to answer them. Neither is a browser's business.
