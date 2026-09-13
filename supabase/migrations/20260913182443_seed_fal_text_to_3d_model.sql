-- Activate a bounded, budget-preflightable text-to-3D route for PRIM3.
-- Provider pricing/default behavior verified against fal.ai on 2026-09-13.
insert into public.media_models (
  provider,
  provider_model_id,
  display_name,
  capability,
  modality_in,
  modality_out,
  commercial_use,
  supports_queue,
  supports_webhook,
  supports_reference_images,
  supports_first_last_frame,
  supports_native_audio,
  cost_hint,
  quality_profile,
  parameter_schema,
  enabled,
  health_state,
  updated_at
)
values (
  'fal',
  'fal-ai/hunyuan3d-v3/text-to-3d',
  'Hunyuan3D V3 Text to 3D',
  'text-to-3d',
  array['text'],
  array['model/glb','image/png'],
  true,
  true,
  true,
  false,
  false,
  false,
  jsonb_build_object(
    'kind','fixed',
    'cents_per_generation',37.5,
    'source','fal-public-pricing-2026-09-13',
    'bounded_input','prompt-only-default-profile'
  ),
  jsonb_build_object(
    'tier','high',
    'strength','fully textured GLB assets for game-engine import',
    'target','PRIM3 production assets'
  ),
  jsonb_build_object(
    'type','object',
    'required',jsonb_build_array('prompt'),
    'properties',jsonb_build_object(
      'prompt',jsonb_build_object('type','string','maxLength',4000)
    ),
    'additionalProperties',false
  ),
  true,
  'unknown',
  now()
)
on conflict (provider, provider_model_id) do update set
  display_name = excluded.display_name,
  capability = excluded.capability,
  modality_in = excluded.modality_in,
  modality_out = excluded.modality_out,
  commercial_use = excluded.commercial_use,
  cost_hint = excluded.cost_hint,
  quality_profile = excluded.quality_profile,
  parameter_schema = excluded.parameter_schema,
  enabled = true,
  updated_at = now();
