-- kb_search learns whose knowledge base it is searching.
--
-- Without this the retrieval is the hole every other policy in 0026 was
-- written to close: the function runs on the service role, so RLS does not
-- constrain it, and a question asked in one customer's inbox would have
-- been answered out of another customer's documents. Not a leak of rows —
-- a leak of SENTENCES, spoken aloud to a stranger, in the wrong company's
-- name. The org is a required argument for exactly that reason.

drop function if exists public.kb_search(text, vector, int, int);

create or replace function public.kb_search(
  p_org       uuid,
  q           text,
  q_embedding vector(1024) default null,
  match_count int default 8,
  rrf_k       int default 60
)
returns table (
  chunk_id uuid, document_id uuid, title text, url text, kind text,
  body text, fts_rank int, vec_rank int, score double precision
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
    where d.org_id = p_org and d.enabled and t.tq is not null and c.fts @@ t.tq
    limit greatest(match_count * 4, 40)
  ),
  vec as (
    select c.id, row_number() over (order by c.embedding <=> q_embedding) as rank
    from public.kb_chunks c
    join public.kb_documents d on d.id = c.document_id
    where d.org_id = p_org and q_embedding is not null and c.embedding is not null and d.enabled
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

revoke all on function public.kb_search(uuid, text, vector, int, int) from public, anon, authenticated;

comment on function public.kb_search(uuid, text, vector, int, int) is
  'Hybrid keyword+vector retrieval within ONE org. p_org is first and required: a default would be a default answer out of somebody else''s documents.';

-- The identity of a document is per tenant too. Two customers may both
-- have a page called "Pricing", and before this the second one silently
-- collided with the first.
drop index if exists kb_documents_ident;
create unique index if not exists kb_documents_ident
  on public.kb_documents (org_id, kind, coalesce(url, title));

-- Same for what is true right now: "hours" belongs to a business.
alter table public.memory_shared drop constraint if exists memory_shared_key_key;
create unique index if not exists memory_shared_ident
  on public.memory_shared (org_id, key);
