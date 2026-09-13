-- Activate a budget-preflightable commercial text-to-video route.
insert into public.media_models (
  provider,provider_model_id,display_name,capability,modality_in,modality_out,
  commercial_use,supports_queue,supports_webhook,supports_reference_images,
  supports_first_last_frame,supports_native_audio,max_duration_seconds,
  cost_hint,quality_profile,parameter_schema,enabled,health_state,updated_at
)
values (
  'fal','fal-ai/kling-video/v2.6/pro/text-to-video','Kling Video 2.6 Pro Text to Video',
  'text-to-video',array['text'],array['video/mp4'],true,true,true,false,false,true,10,
  jsonb_build_object(
    'kind','per_second',
    'duration_field','duration',
    'default_duration_seconds',5,
    'cents_per_second',7,
    'source','fal-public-pricing-2026-09-13',
    'bounded_input','audio-off-default-profile'
  ),
  jsonb_build_object('tier','premium','strength','cinematic text-to-video','target','PRIM3 shots and previews'),
  jsonb_build_object(
    'type','object','required',jsonb_build_array('prompt'),
    'properties',jsonb_build_object(
      'prompt',jsonb_build_object('type','string','maxLength',4000),
      'duration',jsonb_build_object('enum',jsonb_build_array('5','10')),
      'aspect_ratio',jsonb_build_object('enum',jsonb_build_array('16:9','9:16','1:1'))
    ),
    'additionalProperties',false
  ),
  true,'unknown',now()
)
on conflict (provider,provider_model_id) do update set
  display_name=excluded.display_name,capability=excluded.capability,modality_in=excluded.modality_in,
  modality_out=excluded.modality_out,commercial_use=excluded.commercial_use,max_duration_seconds=excluded.max_duration_seconds,
  cost_hint=excluded.cost_hint,quality_profile=excluded.quality_profile,parameter_schema=excluded.parameter_schema,
  enabled=true,updated_at=now();
