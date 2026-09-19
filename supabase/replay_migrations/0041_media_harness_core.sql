-- Recovered media harness core.
--
-- Production contains the media harness migrations `add_media_harness_core`
-- and `extend_media_harness_memory`, but those migration files were never
-- committed to this repository. As a result, a clean reset reached 0052 and
-- failed because media_jobs/media_models did not exist. This migration
-- restores the canonical base schema before the later cost-control and social
-- migrations run.

create extension if not exists pgcrypto;

create table if not exists public.media_models (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_model_id text not null,
  display_name text not null,
  capability text not null,
  modality_in text[] not null default '{}',
  modality_out text[] not null default '{}',
  commercial_use boolean,
  supports_queue boolean not null default true,
  supports_webhook boolean not null default true,
  supports_reference_images boolean not null default false,
  supports_first_last_frame boolean not null default false,
  supports_native_audio boolean not null default false,
  max_duration_seconds numeric,
  max_resolution text,
  cost_hint jsonb not null default '{}'::jsonb,
  quality_profile jsonb not null default '{}'::jsonb,
  parameter_schema jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  health_state text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_model_id)
);
create index if not exists media_models_capability_idx on public.media_models(capability, enabled);

create table if not exists public.media_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  created_by uuid,
  provider text not null,
  provider_model_id text not null,
  capability text not null,
  status text not null default 'queued',
  prompt text,
  input jsonb not null default '{}'::jsonb,
  routing jsonb not null default '{}'::jsonb,
  provider_request_id text,
  provider_status jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error jsonb not null default '{}'::jsonb,
  estimated_cost_cents integer,
  actual_cost_cents integer,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists media_jobs_org_created_idx on public.media_jobs(org_id, created_at desc);
create index if not exists media_jobs_provider_req_idx on public.media_jobs(provider, provider_request_id);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  job_id uuid references public.media_jobs(id) on delete set null,
  asset_type text not null,
  role text,
  url text,
  storage_path text,
  mime_type text,
  width integer,
  height integer,
  duration_seconds numeric,
  sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists media_assets_job_idx on public.media_assets(job_id);

create table if not exists public.media_feedback (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  job_id uuid references public.media_jobs(id) on delete cascade,
  asset_id uuid references public.media_assets(id) on delete cascade,
  actor_type text not null,
  actor_id text,
  verdict text,
  score numeric,
  reasons jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists media_feedback_job_idx on public.media_feedback(job_id, created_at desc);

create table if not exists public.media_presets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  preset_type text not null,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, preset_type, name)
);
create index if not exists media_presets_org_type_idx on public.media_presets(org_id, preset_type, active);

create table if not exists public.media_entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  entity_type text not null,
  name text not null,
  slug text not null,
  description text,
  canonical_prompt text,
  negative_prompt text,
  attributes jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, slug)
);
create index if not exists media_entities_org_type_idx on public.media_entities(org_id, entity_type, active);

create table if not exists public.media_entity_refs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  entity_id uuid not null references public.media_entities(id) on delete cascade,
  asset_id uuid references public.media_assets(id) on delete set null,
  ref_type text not null default 'visual',
  url text,
  weight numeric not null default 1.0,
  approved boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists media_entity_refs_entity_idx on public.media_entity_refs(entity_id, approved desc);

create table if not exists public.media_workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  created_by uuid,
  name text not null,
  objective text,
  status text not null default 'draft',
  budget_cents integer,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_workflow_nodes (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.media_workflows(id) on delete cascade,
  node_key text not null,
  node_type text not null,
  depends_on text[] not null default '{}',
  status text not null default 'pending',
  job_id uuid references public.media_jobs(id) on delete set null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workflow_id, node_key)
);

-- The Worker is the mutation boundary. RLS is enabled even though the service
-- role is the expected caller; no permissive browser policies are created here.
do $$
declare t text;
begin
  foreach t in array array[
    'media_models','media_jobs','media_assets','media_feedback','media_presets',
    'media_entities','media_entity_refs','media_workflows','media_workflow_nodes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Restore the production model catalogue. 0052+ owns pricing/cost_hint and
-- deliberately updates those fields later in the chain.
insert into public.media_models (
  provider, provider_model_id, display_name, capability, modality_in, modality_out,
  commercial_use, supports_queue, supports_webhook, supports_reference_images,
  supports_first_last_frame, supports_native_audio, quality_profile, parameter_schema,
  enabled, health_state
)
values
  ('fal','fal-ai/esrgan','ESRGAN Upscale','upscale',array['image'],array['image'],true,true,true,true,false,false,'{"tier":"utility"}'::jsonb,'{}'::jsonb,true,'unknown'),
  ('fal','fal-ai/flux-2','FLUX 2','text-to-image',array['text'],array['image'],true,true,true,false,false,false,'{"tier":"high","notes":"broad image default"}'::jsonb,'{}'::jsonb,true,'unknown'),
  ('fal','fal-ai/flux-2-max/edit','FLUX 2 Max Edit','image-to-image',array['text','image'],array['image'],true,true,true,true,false,false,'{"tier":"premium","strength":"editing"}'::jsonb,'{}'::jsonb,true,'unknown'),
  ('fal','fal-ai/flux-2-pro','FLUX 2 Pro','text-to-image',array['text'],array['image'],true,true,true,false,false,false,'{"tier":"premium"}'::jsonb,'{}'::jsonb,true,'unknown'),
  ('fal','fal-ai/kling-video/v3/standard/image-to-video','Kling 3.0 Standard I2V','image-to-video',array['text','image'],array['video','audio'],true,true,true,true,false,true,'{"tier":"high","strength":"cinematic motion"}'::jsonb,'{}'::jsonb,true,'unknown'),
  ('fal','fal-ai/ovi/image-to-video','Ovi I2V','image-to-video',array['text','image'],array['video','audio'],true,true,true,true,false,true,'{"tier":"high","strength":"video with audio"}'::jsonb,'{}'::jsonb,true,'unknown'),
  ('fal','fal-ai/stable-audio','Stable Audio Open','text-to-audio',array['text'],array['audio'],true,true,true,false,false,false,'{"tier":"standard"}'::jsonb,'{}'::jsonb,true,'unknown'),
  ('fal','fal-ai/sync-lipsync/v3/image-to-video','Sync 3 Avatar','lip-sync',array['image','audio'],array['video'],true,true,true,true,false,false,'{"tier":"high","strength":"avatar lip sync"}'::jsonb,'{}'::jsonb,true,'unknown'),
  ('fal','fal-ai/wan/v2.7/image-to-video','Wan 2.7 I2V','image-to-video',array['text','image','audio'],array['video','audio'],true,true,true,true,true,true,'{"tier":"high","strength":"first-last-frame and continuation"}'::jsonb,'{}'::jsonb,true,'unknown')
on conflict (provider, provider_model_id) do update set
  display_name=excluded.display_name,
  capability=excluded.capability,
  modality_in=excluded.modality_in,
  modality_out=excluded.modality_out,
  commercial_use=excluded.commercial_use,
  supports_queue=excluded.supports_queue,
  supports_webhook=excluded.supports_webhook,
  supports_reference_images=excluded.supports_reference_images,
  supports_first_last_frame=excluded.supports_first_last_frame,
  supports_native_audio=excluded.supports_native_audio,
  quality_profile=excluded.quality_profile,
  parameter_schema=excluded.parameter_schema,
  enabled=excluded.enabled,
  updated_at=now();
