-- Candidate workspace and transparent, evidence-based news ownership graph.
-- No campaign targeting, voter profiling, or automated persuasion.
create table if not exists public.civic_candidate_profiles(
 id uuid primary key default gen_random_uuid(),
 m_uid uuid not null unique references public.m_people(id) on delete cascade,
 intended_office_id uuid references public.civic_offices(id),
 intended_jurisdiction_id uuid references public.civic_jurisdictions(id),
 campaign_name text, public_statement text,
 status text not null default 'exploring' check(status in ('exploring','declared','filed','withdrawn','elected','ended')),
 filing_source_url text, filing_verified_at timestamptz,
 public_visible boolean not null default false,
 created_at timestamptz not null default now(),
 check(not public_visible or public_statement is not null)
);
create table if not exists public.civic_candidate_cohorts(
 id uuid primary key default gen_random_uuid(), name text not null,
 jurisdiction_id uuid references public.civic_jurisdictions(id),
 description text, public_visible boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.civic_candidate_cohort_members(
 cohort_id uuid not null references public.civic_candidate_cohorts(id) on delete cascade,
 candidate_id uuid not null references public.civic_candidate_profiles(id) on delete cascade,
 role text not null default 'participant' check(role in ('participant','facilitator')),
 joined_at timestamptz not null default now(), primary key(cohort_id,candidate_id)
);
create table if not exists public.civic_policy_lab_projects(
 id uuid primary key default gen_random_uuid(),
 cohort_id uuid references public.civic_candidate_cohorts(id),
 candidate_id uuid references public.civic_candidate_profiles(id),
 title text not null, research_question text not null,
 jurisdiction_id uuid references public.civic_jurisdictions(id),
 visibility text not null default 'private' check(visibility in ('private','public')),
 created_at timestamptz not null default now(),
 check(cohort_id is not null or candidate_id is not null)
);
create table if not exists public.media_entities(
 id uuid primary key default gen_random_uuid(), name text not null,
 entity_type text not null check(entity_type in ('publisher','corporation','nonprofit','government','investment_fund','individual','other')),
 country_code text, official_url text, wikidata_id text unique,
 created_at timestamptz not null default now()
);
create table if not exists public.media_relationships(
 id uuid primary key default gen_random_uuid(),
 from_entity_id uuid not null references public.media_entities(id),
 to_entity_id uuid not null references public.media_entities(id),
 relation_type text not null check(relation_type in ('owns','invests_in','funds','subsidiary_of','affiliated_with','controls')),
 ownership_percent numeric(6,3) check(ownership_percent between 0 and 100),
 valid_from date, valid_to date, evidence_url text not null,
 evidence_note text, verified_at timestamptz, created_at timestamptz not null default now(),
 check(from_entity_id<>to_entity_id)
);
create index if not exists media_relationships_from_idx on public.media_relationships(from_entity_id);
create index if not exists media_relationships_to_idx on public.media_relationships(to_entity_id);
create table if not exists public.media_outlets(
 id uuid primary key default gen_random_uuid(),
 entity_id uuid not null unique references public.media_entities(id),
 domain text not null unique, feed_url text, language_code text,
 country_code text, source_url text, verified_at timestamptz
);
create table if not exists public.media_articles(
 id uuid primary key default gen_random_uuid(),
 outlet_id uuid not null references public.media_outlets(id),
 canonical_url text not null unique, title text not null,
 published_at timestamptz, language_code text,
 topic_keys text[] not null default '{}', region_keys text[] not null default '{}',
 imported_at timestamptz not null default now()
);
create index if not exists media_articles_published_idx on public.media_articles(published_at desc);
create index if not exists media_articles_topics_idx on public.media_articles using gin(topic_keys);
create table if not exists public.media_story_clusters(
 id uuid primary key default gen_random_uuid(), label text not null,
 clustering_method text not null default 'manual' check(clustering_method in ('manual','canonical_url','deterministic')),
 reviewed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.media_story_articles(
 cluster_id uuid not null references public.media_story_clusters(id) on delete cascade,
 article_id uuid not null unique references public.media_articles(id) on delete cascade,
 primary key(cluster_id,article_id)
);
create table if not exists public.media_source_assessments(
 id uuid primary key default gen_random_uuid(),
 outlet_id uuid not null references public.media_outlets(id),
 dimension text not null check(dimension in ('ownership_disclosure','corrections_policy','primary_source_links','editorial_transparency')),
 observed_value text not null check(observed_value in ('documented','not_documented','unknown')),
 methodology_version text not null, evidence_url text not null,
 assessed_at timestamptz not null default now(),
 unique(outlet_id,dimension,methodology_version)
);
-- All writes require privileged server review. No public candidate profile or cohort membership policy yet.
do $$ declare t text; begin foreach t in array array[
 'civic_candidate_profiles','civic_candidate_cohorts','civic_candidate_cohort_members','civic_policy_lab_projects',
 'media_entities','media_relationships','media_outlets','media_articles','media_story_clusters','media_story_articles','media_source_assessments'
 ] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop; end $$;
-- Public news metadata is source-linked; graph edges and assessments require verification.
grant select on public.media_entities,public.media_relationships,public.media_outlets,public.media_articles,public.media_story_clusters,public.media_story_articles,public.media_source_assessments to anon,authenticated;
create policy media_public_entities on public.media_entities for select to anon,authenticated using(true);
create policy media_public_relationships on public.media_relationships for select to anon,authenticated using(verified_at is not null);
create policy media_public_outlets on public.media_outlets for select to anon,authenticated using(verified_at is not null);
create policy media_public_articles on public.media_articles for select to anon,authenticated using(exists(select 1 from public.media_outlets o where o.id=outlet_id and o.verified_at is not null));
create policy media_public_clusters on public.media_story_clusters for select to anon,authenticated using(reviewed_at is not null);
create policy media_public_story_articles on public.media_story_articles for select to anon,authenticated using(exists(select 1 from public.media_story_clusters c where c.id=cluster_id and c.reviewed_at is not null));
create policy media_public_assessments on public.media_source_assessments for select to anon,authenticated using(exists(select 1 from public.media_outlets o where o.id=outlet_id and o.verified_at is not null));
