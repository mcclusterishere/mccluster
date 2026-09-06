-- Media gateway cost controls.
-- Supabase media_models is the sole pricing/model catalog. The Worker computes
-- an estimate from cost_hint; this RPC atomically creates the job and records
-- the reservation before any provider request can leave McCluster.

create table if not exists public.media_cost_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  job_id uuid not null references public.media_jobs(id) on delete cascade,
  event_type text not null check (event_type in ('reserved', 'released', 'actual')),
  amount_cents integer not null check (amount_cents >= 0),
  provider text,
  provider_request_id text,
  pricing_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (job_id, event_type)
);

create index if not exists media_cost_events_org_created_idx
  on public.media_cost_events (org_id, created_at desc);

alter table public.media_cost_events enable row level security;
revoke all on table public.media_cost_events from anon, authenticated;
grant select, insert, update on table public.media_cost_events to service_role;

create or replace function public.media_create_budgeted_job(
  p_org_id uuid,
  p_created_by uuid,
  p_provider text,
  p_provider_model_id text,
  p_capability text,
  p_prompt text,
  p_input jsonb,
  p_routing jsonb,
  p_estimated_cost_cents integer,
  p_budget_cents integer,
  p_pricing_snapshot jsonb
)
returns public.media_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.media_jobs;
begin
  if p_budget_cents is not null and p_budget_cents < 0 then
    raise exception using errcode = '22023', message = 'budget_cents cannot be negative';
  end if;

  if p_estimated_cost_cents is not null and p_estimated_cost_cents < 0 then
    raise exception using errcode = '22023', message = 'estimated_cost_cents cannot be negative';
  end if;

  if p_budget_cents is not null and p_estimated_cost_cents is null then
    raise exception using errcode = '22023', message = 'Budgeted media jobs require a preflight cost estimate';
  end if;

  if p_budget_cents is not null and p_estimated_cost_cents > p_budget_cents then
    raise exception using errcode = '22023', message = format(
      'Estimated media cost (%s cents) exceeds budget (%s cents)',
      p_estimated_cost_cents,
      p_budget_cents
    );
  end if;

  insert into public.media_jobs (
    org_id,
    created_by,
    provider,
    provider_model_id,
    capability,
    status,
    prompt,
    input,
    routing,
    estimated_cost_cents
  ) values (
    p_org_id,
    p_created_by,
    p_provider,
    p_provider_model_id,
    p_capability,
    'queued',
    p_prompt,
    coalesce(p_input, '{}'::jsonb),
    coalesce(p_routing, '{}'::jsonb) || jsonb_build_object(
      'budget_cents', p_budget_cents,
      'pricing_snapshot', coalesce(p_pricing_snapshot, '{}'::jsonb),
      'reservation_state', case when p_estimated_cost_cents is null then 'unmetered' else 'reserved' end
    ),
    p_estimated_cost_cents
  )
  returning * into v_job;

  if p_estimated_cost_cents is not null then
    insert into public.media_cost_events (
      org_id,
      job_id,
      event_type,
      amount_cents,
      provider,
      pricing_snapshot,
      metadata
    ) values (
      p_org_id,
      v_job.id,
      'reserved',
      p_estimated_cost_cents,
      p_provider,
      coalesce(p_pricing_snapshot, '{}'::jsonb),
      jsonb_build_object('budget_cents', p_budget_cents)
    );
  end if;

  return v_job;
end;
$$;

create or replace function public.media_release_cost_reservation(
  p_job_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.media_jobs;
  v_reserved public.media_cost_events;
begin
  select * into v_job from public.media_jobs where id = p_job_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Unknown media job';
  end if;

  select * into v_reserved
  from public.media_cost_events
  where job_id = p_job_id and event_type = 'reserved';

  if found then
    insert into public.media_cost_events (
      org_id, job_id, event_type, amount_cents, provider, provider_request_id, pricing_snapshot, metadata
    ) values (
      v_reserved.org_id,
      p_job_id,
      'released',
      v_reserved.amount_cents,
      v_reserved.provider,
      v_job.provider_request_id,
      v_reserved.pricing_snapshot,
      jsonb_build_object('reason', p_reason)
    ) on conflict (job_id, event_type) do nothing;

    update public.media_jobs
    set routing = coalesce(routing, '{}'::jsonb) || jsonb_build_object('reservation_state', 'released'),
        updated_at = now()
    where id = p_job_id;
  end if;
end;
$$;

create or replace function public.media_record_actual_cost(
  p_job_id uuid,
  p_actual_cost_cents integer,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.media_jobs;
begin
  if p_actual_cost_cents is null or p_actual_cost_cents < 0 then
    raise exception using errcode = '22023', message = 'actual_cost_cents must be zero or greater';
  end if;

  select * into v_job from public.media_jobs where id = p_job_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Unknown media job';
  end if;

  update public.media_jobs
  set actual_cost_cents = p_actual_cost_cents,
      routing = coalesce(routing, '{}'::jsonb) || jsonb_build_object('reservation_state', 'settled'),
      updated_at = now()
  where id = p_job_id;

  insert into public.media_cost_events (
    org_id, job_id, event_type, amount_cents, provider, provider_request_id, pricing_snapshot, metadata
  ) values (
    v_job.org_id,
    p_job_id,
    'actual',
    p_actual_cost_cents,
    v_job.provider,
    v_job.provider_request_id,
    coalesce(v_job.routing -> 'pricing_snapshot', '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (job_id, event_type) do update
  set amount_cents = excluded.amount_cents,
      provider_request_id = excluded.provider_request_id,
      metadata = excluded.metadata,
      created_at = now();
end;
$$;

revoke all on function public.media_create_budgeted_job(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.media_release_cost_reservation(uuid, text) from public, anon, authenticated;
revoke all on function public.media_record_actual_cost(uuid, integer, jsonb) from public, anon, authenticated;

grant execute on function public.media_create_budgeted_job(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, integer, jsonb) to service_role;
grant execute on function public.media_release_cost_reservation(uuid, text) to service_role;
grant execute on function public.media_record_actual_cost(uuid, integer, jsonb) to service_role;

-- Current prices verified against fal model pages on 2026-09-06. These values live
-- in the database so the Worker has one model/pricing truth instead of hardcoding it.
update public.media_models set cost_hint = jsonb_build_object(
  'kind', 'per_output_megapixel',
  'cents_per_megapixel', 1.2,
  'round_megapixels', 'none',
  'default_image_size', 'landscape_4_3',
  'count_field', 'num_images',
  'default_count', 1,
  'source', 'https://fal.ai/models/fal-ai/flux-2',
  'verified_at', '2026-09-06'
) where provider = 'fal' and provider_model_id = 'fal-ai/flux-2';

update public.media_models set cost_hint = jsonb_build_object(
  'kind', 'tiered_output_megapixel',
  'first_megapixel_cents', 3,
  'additional_megapixel_cents', 1.5,
  'default_image_size', 'landscape_4_3',
  'source', 'https://fal.ai/models/fal-ai/flux-2-pro',
  'verified_at', '2026-09-06'
) where provider = 'fal' and provider_model_id = 'fal-ai/flux-2-pro';

update public.media_models set cost_hint = jsonb_build_object(
  'kind', 'processed_megapixel',
  'preflight', 'unavailable',
  'unavailable_reason', 'input image dimensions must be measured server-side before safe budget enforcement',
  'first_megapixel_cents', 7,
  'additional_megapixel_cents', 3,
  'source', 'https://fal.ai/models/fal-ai/flux-2-max/edit',
  'verified_at', '2026-09-06'
) where provider = 'fal' and provider_model_id = 'fal-ai/flux-2-max/edit';

update public.media_models set cost_hint = jsonb_build_object(
  'kind', 'per_second',
  'duration_field', 'duration',
  'default_duration_seconds', 5,
  'rate_selector', 'audio',
  'audio_field', 'generate_audio',
  'default_audio_enabled', true,
  'voice_field', 'voice_ids',
  'rates_cents_per_second', jsonb_build_object('audio_off', 8.4, 'audio_on', 12.6, 'voice_control', 15.4),
  'source', 'https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video',
  'verified_at', '2026-09-06'
) where provider = 'fal' and provider_model_id = 'fal-ai/kling-video/v3/standard/image-to-video';

update public.media_models set cost_hint = jsonb_build_object(
  'kind', 'fixed',
  'cents_per_generation', 20,
  'source', 'https://fal.ai/models/fal-ai/ovi/image-to-video',
  'verified_at', '2026-09-06'
) where provider = 'fal' and provider_model_id = 'fal-ai/ovi/image-to-video';

update public.media_models set cost_hint = jsonb_build_object(
  'kind', 'per_second',
  'duration_field', 'duration',
  'default_duration_seconds', 5,
  'rate_selector', 'field',
  'rate_field', 'resolution',
  'default_rate_key', '1080p',
  'rates_cents_per_second', jsonb_build_object('720p', 10, '1080p', 15),
  'source', 'https://fal.ai/models/fal-ai/wan/v2.7/image-to-video',
  'verified_at', '2026-09-06'
) where provider = 'fal' and provider_model_id = 'fal-ai/wan/v2.7/image-to-video';

update public.media_models set cost_hint = jsonb_build_object(
  'kind', 'per_second',
  'preflight', 'unavailable',
  'unavailable_reason', 'output duration is driven by remote audio metadata and is not yet measured preflight',
  'cents_per_second', 13.33,
  'source', 'https://fal.ai/models/fal-ai/sync-lipsync/v3/image-to-video',
  'verified_at', '2026-09-06'
) where provider = 'fal' and provider_model_id = 'fal-ai/sync-lipsync/v3/image-to-video';

update public.media_models set cost_hint = jsonb_build_object(
  'kind', 'fixed',
  'cents_per_generation', 0,
  'source', 'https://fal.ai/models/fal-ai/stable-audio',
  'verified_at', '2026-09-06'
) where provider = 'fal' and provider_model_id = 'fal-ai/stable-audio';

update public.media_models set cost_hint = jsonb_build_object(
  'kind', 'compute_second',
  'preflight', 'unavailable',
  'unavailable_reason', 'provider bills by runtime compute seconds, which are unknown before execution',
  'cents_per_compute_second', 0.111,
  'source', 'https://fal.ai/models/fal-ai/esrgan',
  'verified_at', '2026-09-06'
) where provider = 'fal' and provider_model_id = 'fal-ai/esrgan';
