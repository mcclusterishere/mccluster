-- Disposable CI database only. Relevant table contract verified against the
-- production Here information_schema/pg_constraint on 2026-10-18.
-- This is not a full schema replay: do not run against any live database.
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.m_people (
 id uuid primary key,
 status text not null default 'active'
);
create function public.current_m_uid() returns uuid language sql stable
 as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.orgs (
 id uuid primary key,
 slug text not null unique,
 name text not null,
 enabled boolean not null default true
);
create table public.media_jobs (
 id uuid primary key default gen_random_uuid(),
 org_id uuid,
 created_by uuid,
 provider text not null,
 provider_model_id text not null,
 capability text not null,
 status text not null default 'queued',
 input jsonb not null default '{}'::jsonb,
 routing jsonb not null default '{}'::jsonb,
 result jsonb not null default '{}'::jsonb,
 error jsonb not null default '{}'::jsonb,
 completed_at timestamptz,
 updated_at timestamptz not null default now()
);
create table public.media_assets (
 id uuid primary key default gen_random_uuid(),
 org_id uuid,
 job_id uuid references public.media_jobs(id) on delete set null,
 asset_type text not null,
 role text,
 storage_path text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table public.creator_published_sites (
 org_id uuid primary key references public.orgs(id) on delete cascade,
 slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
 title text not null check (char_length(title) between 1 and 120),
 tagline text not null default '' check (char_length(tagline) <= 300),
 bio text not null default '' check (char_length(bio) <= 4000),
 published_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create function public.media_create_budgeted_job_v2(uuid,uuid,text,text,text,text,jsonb,jsonb,bigint,integer,jsonb,jsonb)
 returns public.media_jobs language plpgsql as $$
declare j public.media_jobs;
begin
 insert into public.media_jobs(org_id,created_by,provider,provider_model_id,capability,input,routing)
 values($1,$2,$3,$4,$5,$7,$8) returning * into j;
 return j;
end $$;
create function public.compute_enqueue_task(uuid,text,text,jsonb,jsonb,integer,timestamptz,integer,jsonb,text)
 returns jsonb language sql as $$ select '{}'::jsonb $$;
grant usage on schema public to anon,authenticated,service_role;
grant all on all tables in schema public to service_role;
grant execute on function public.current_m_uid() to authenticated;
