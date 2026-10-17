-- Disposable CI database only; representative existing schema, not production.
create role anon;create role authenticated;create role service_role bypassrls;
create table public.m_people(id uuid primary key,status text not null);
create function public.current_m_uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.orgs(id uuid primary key);
create table public.media_jobs(id uuid primary key default gen_random_uuid(),status text,result jsonb,error jsonb,completed_at timestamptz,updated_at timestamptz);
create table public.media_assets(id uuid primary key,asset_type text,role text,storage_path text,metadata jsonb);
create table public.creator_published_sites(org_id uuid primary key references orgs(id),slug text unique,title text,tagline text,bio text,published_at timestamptz default now(),updated_at timestamptz default now());
create function public.media_create_budgeted_job_v2(uuid,uuid,text,text,text,text,jsonb,jsonb,bigint,integer,jsonb,jsonb) returns public.media_jobs language plpgsql as $$ declare j public.media_jobs; begin insert into public.media_jobs(status)values('queued')returning * into j;return j;end $$;
create function public.compute_enqueue_task(uuid,text,text,jsonb,jsonb,integer,timestamptz,integer,jsonb,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
grant usage on schema public to anon,authenticated,service_role;
grant all on all tables in schema public to service_role;
grant execute on function public.current_m_uid() to authenticated;
