-- Verified public pricing snapshots for economics tests only.
-- All third-party routes remain disabled until contractual/reseller/BYOK clearance and credentials exist.

insert into public.compute_models(provider_key,model_key,display_name,capability,billing_unit,upstream_input_microusd_per_unit,upstream_output_microusd_per_unit,target_margin_bps,enabled,quality_tier,latency_tier,price_verified_at,metadata)
values
 ('openai','gpt-5.6-terra','GPT-5.6 Terra','reasoning','token',2,12,2000,false,92,70,now(),jsonb_build_object('pricing_basis','official public API price snapshot','commercial_execution','contract_or_BYOK_required')),
 ('anthropic','claude-sonnet-5','Claude Sonnet 5','reasoning','token',2,10,2000,false,94,70,now(),jsonb_build_object('pricing_basis','official public API price snapshot','commercial_execution','contract_or_BYOK_required')),
 ('fireworks','minimax-m3','MiniMax M3','text','token',0.30,1.20,2500,false,70,88,now(),jsonb_build_object('pricing_basis','official public API price snapshot','commercial_execution','contract_or_BYOK_required')),
 ('fal','minimax-h3-480p','MiniMax H3 480p video','video','second',0,0,2500,false,80,60,now(),jsonb_build_object('pricing_basis','official public API price snapshot','commercial_execution','contract_or_BYOK_required'))
on conflict(provider_key,model_key) do update set
 upstream_input_microusd_per_unit=excluded.upstream_input_microusd_per_unit,
 upstream_output_microusd_per_unit=excluded.upstream_output_microusd_per_unit,
 target_margin_bps=excluded.target_margin_bps,
 price_verified_at=excluded.price_verified_at,
 metadata=excluded.metadata;

update public.compute_models set upstream_flat_microusd=50000 where provider_key='fal' and model_key='minimax-h3-480p';

insert into public.compute_model_price_history(model_id,upstream_input_microusd_per_unit,upstream_output_microusd_per_unit,upstream_flat_microusd,billing_unit,source_url,source_type,verified_at,metadata)
select id,upstream_input_microusd_per_unit,upstream_output_microusd_per_unit,upstream_flat_microusd,billing_unit,
 case provider_key
  when 'openai' then 'https://openai.com/api/pricing/'
  when 'anthropic' then 'https://platform.claude.com/docs/en/about-claude/pricing'
  when 'fireworks' then 'https://fireworks.ai/pricing'
  when 'fal' then 'https://fal.ai/pricing'
 end,
 'official',now(),jsonb_build_object('snapshot_date','2026-09-13')
from public.compute_models m
where (m.provider_key,m.model_key) in (
 ('openai','gpt-5.6-terra'),
 ('anthropic','claude-sonnet-5'),
 ('fireworks','minimax-m3'),
 ('fal','minimax-h3-480p')
)
and not exists(
 select 1 from public.compute_model_price_history h
 where h.model_id=m.id and h.metadata->>'snapshot_date'='2026-09-13'
);
