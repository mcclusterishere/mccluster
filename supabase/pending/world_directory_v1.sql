-- Pending review only. Explicit owner opt-in metadata for existing owned pages.
-- No seed, inferred coordinates, auth identity, new public grants, or production activation.
create table if not exists public.world_directory_listings (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references auth.users(id), m_uid uuid not null,
 source_kind text not null check(source_kind in ('front','project')),
 source_key text not null,
 entity_type text not null check(entity_type in ('business','service','project')),
 title text not null check(length(title) between 1 and 100),
 description text not null default '' check(length(description)<=500),
 category text not null check(category in ('creative','music','technology','education','home','professional','community','other')),
 online_only boolean not null default true,
 location_label text not null default '' check(length(location_label)<=100),
 service_area text not null default '' check(length(service_area)<=160),
 is_listed boolean not null default false,
 updated_at timestamptz not null default now(),
 search_document tsvector generated always as (to_tsvector('simple',title||' '||description||' '||category)) stored,
 location_search text generated always as (location_label||' '||service_area) stored,
 check((source_kind='front' and source_key='me') or (source_kind='project' and source_key ~ '^[a-z0-9][a-z0-9-]{2,39}$')),
 check((online_only and location_label='' and service_area='') or (not online_only and length(location_label)>0)),
 unique(owner_user_id,source_kind,source_key,entity_type)
);
create index if not exists world_directory_owner_idx on public.world_directory_listings(owner_user_id,m_uid);
create index if not exists world_directory_recent_idx on public.world_directory_listings(updated_at desc,id) where is_listed;
create index if not exists world_directory_search_idx on public.world_directory_listings using gin(search_document) where is_listed;
create index if not exists world_directory_filter_idx on public.world_directory_listings(entity_type,category,online_only,updated_at desc) where is_listed;
alter table public.world_directory_listings enable row level security;
alter table public.world_directory_listings force row level security;
revoke all on public.world_directory_listings from public,anon,authenticated;
grant select,insert,update,delete on public.world_directory_listings to service_role;
comment on table public.world_directory_listings is 'Owner-provided opt-in World listings; Worker rechecks ownership, source publication/removal and strictly public network profile on every public read. No private profile coordinates are collected or inferred.';
-- Rollback after preserving data: drop table public.world_directory_listings;
