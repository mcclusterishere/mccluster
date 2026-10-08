-- Refresh the commercial text-to-video catalog with currently verified fal routes.
-- Pricing/schema references verified against fal.ai on 2026-09-27.
-- This is catalog data only: it does not submit provider work or spend money.

insert into public.media_models (
  provider,provider_model_id,display_name,capability,modality_in,modality_out,
  commercial_use,supports_queue,supports_webhook,supports_reference_images,
  supports_first_last_frame,supports_native_audio,max_duration_seconds,
  cost_hint,quality_profile,parameter_schema,enabled,health_state,updated_at
)
values
(
  'fal','fal-ai/kling-video/v3/standard/text-to-video','Kling 3.0 Standard Text to Video',
  'text-to-video',array['text'],array['video/mp4'],true,true,true,false,false,true,15,
  jsonb_build_object(
    'kind','per_second',
    'duration_field','duration',
    'default_duration_seconds',5,
    'rate_selector','audio',
    'audio_field','generate_audio',
    'default_audio_enabled',true,
    'voice_field','voice_ids',
    'rates_cents_per_second',jsonb_build_object(
      'audio_off',8.4,'audio_on',12.6,'voice_control',15.4
    ),
    'source','https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video',
    'verified_at','2026-09-27'
  ),
  jsonb_build_object(
    'tier','high',
    'generation','3.0',
    'strength','cinematic motion, native audio and multi-shot',
    'target','fast production-quality previews'
  ),
  jsonb_build_object(
    'type','object',
    'required',jsonb_build_array('prompt'),
    'properties',jsonb_build_object(
      'prompt',jsonb_build_object('type','string','maxLength',2500),
      'duration',jsonb_build_object('enum',jsonb_build_array('3','4','5','6','7','8','9','10','11','12','13','14','15')),
      'aspect_ratio',jsonb_build_object('enum',jsonb_build_array('16:9','9:16','1:1')),
      'generate_audio',jsonb_build_object('type','boolean')
    ),
    'additionalProperties',true
  ),
  true,'unknown',now()
),
(
  'fal','fal-ai/kling-video/v3/pro/text-to-video','Kling 3.0 Pro Text to Video',
  'text-to-video',array['text'],array['video/mp4'],true,true,true,false,false,true,15,
  jsonb_build_object(
    'kind','per_second',
    'duration_field','duration',
    'default_duration_seconds',5,
    'rate_selector','audio',
    'audio_field','generate_audio',
    'default_audio_enabled',true,
    'voice_field','voice_ids',
    'rates_cents_per_second',jsonb_build_object(
      'audio_off',11.2,'audio_on',16.8,'voice_control',19.6
    ),
    'source','https://fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video',
    'verified_at','2026-09-27'
  ),
  jsonb_build_object(
    'tier','premium',
    'generation','3.0',
    'strength','top-tier cinematic visuals, fluid motion, native audio and multi-shot',
    'target','hero shots and final-quality video candidates'
  ),
  jsonb_build_object(
    'type','object',
    'required',jsonb_build_array('prompt'),
    'properties',jsonb_build_object(
      'prompt',jsonb_build_object('type','string','maxLength',2500),
      'duration',jsonb_build_object('enum',jsonb_build_array('3','4','5','6','7','8','9','10','11','12','13','14','15')),
      'aspect_ratio',jsonb_build_object('enum',jsonb_build_array('16:9','9:16','1:1')),
      'generate_audio',jsonb_build_object('type','boolean')
    ),
    'additionalProperties',true
  ),
  true,'unknown',now()
),
(
  'fal','alibaba/wan-3.0-prime/text-to-video','Wan 3.0 Prime Text to Video',
  'text-to-video',array['text'],array['video/mp4'],true,true,true,false,false,true,30,
  jsonb_build_object(
    'kind','per_second',
    'duration_field','duration',
    'default_duration_seconds',5,
    'rate_selector','field',
    'rate_field','resolution',
    'default_rate_key','1080p',
    'rates_cents_per_second',jsonb_build_object(
      '480p',6.8,'720p',14.0,'1080p',28.0
    ),
    'source','https://fal.ai/models/alibaba/wan-3.0-prime/text-to-video',
    'verified_at','2026-09-27'
  ),
  jsonb_build_object(
    'tier','premium',
    'generation','3.0-prime',
    'strength','long coherent cinematic takes with native audio',
    'target','long-form or high-fidelity video candidates'
  ),
  jsonb_build_object(
    'type','object',
    'required',jsonb_build_array('prompt'),
    'properties',jsonb_build_object(
      'prompt',jsonb_build_object('type','string','maxLength',4000),
      'resolution',jsonb_build_object('enum',jsonb_build_array('480p','720p','1080p')),
      'aspect_ratio',jsonb_build_object('enum',jsonb_build_array('adaptive','16:9','4:3','1:1','3:4','9:16')),
      'duration',jsonb_build_object('type','integer','minimum',2,'maximum',30),
      'audio',jsonb_build_object('type','boolean'),
      'enable_thinking',jsonb_build_object('type','boolean')
    ),
    'additionalProperties',true
  ),
  true,'unknown',now()
)
on conflict (provider,provider_model_id) do update set
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
  max_duration_seconds=excluded.max_duration_seconds,
  cost_hint=excluded.cost_hint,
  quality_profile=excluded.quality_profile,
  parameter_schema=excluded.parameter_schema,
  enabled=true,
  updated_at=now();
