function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = asFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function imageMegapixels(input, hint) {
  const size = input?.[hint.image_size_field || 'image_size'];
  if (size && typeof size === 'object') {
    const width = positive(size.width);
    const height = positive(size.height);
    if (width && height) return (width * height) / 1_000_000;
  }

  const width = positive(input?.[hint.width_field || 'width']);
  const height = positive(input?.[hint.height_field || 'height']);
  if (width && height) return (width * height) / 1_000_000;

  if (typeof size === 'string' && hint.preset_megapixels && hint.preset_megapixels[size] !== undefined) {
    return positive(hint.preset_megapixels[size]);
  }

  return positive(hint.default_output_megapixels);
}

function durationSeconds(input, hint) {
  const field = hint.duration_field || 'duration';
  return positive(input?.[field] ?? hint.default_duration_seconds);
}

function perSecondRate(input, hint) {
  if (hint.rate_selector === 'audio') {
    const audioField = hint.audio_field || 'generate_audio';
    const audioEnabled = input?.[audioField] ?? hint.default_audio_enabled ?? false;
    const voiceField = hint.voice_field || 'voice_ids';
    const voice = input?.[voiceField];
    const hasVoice = Array.isArray(voice) ? voice.length > 0 : Boolean(voice);
    if (audioEnabled && hasVoice && hint.rates_cents_per_second?.voice_control !== undefined) {
      return positive(hint.rates_cents_per_second.voice_control);
    }
    const key = audioEnabled ? 'audio_on' : 'audio_off';
    return positive(hint.rates_cents_per_second?.[key]);
  }

  if (hint.rate_selector === 'field') {
    const field = hint.rate_field;
    const key = String(input?.[field] ?? hint.default_rate_key ?? '');
    return positive(hint.rates_cents_per_second?.[key]);
  }

  return positive(hint.cents_per_second);
}

function money(centsExact, detail = {}) {
  if (!Number.isFinite(centsExact) || centsExact < 0) return null;
  return {
    estimated_cost_cents: Math.ceil(centsExact),
    estimated_cost_cents_exact: centsExact,
    ...detail
  };
}

export function estimateModelCost(model, input = {}) {
  const hint = model?.cost_hint;
  if (!hint || typeof hint !== 'object' || !hint.kind) {
    return { available: false, reason: 'model_pricing_not_configured', pricing_snapshot: hint || {} };
  }

  const pricingSnapshot = {
    ...hint,
    provider: model.provider,
    provider_model_id: model.provider_model_id,
    model_id: model.id,
    captured_at: new Date().toISOString()
  };

  if (hint.preflight === 'unavailable') {
    return { available: false, reason: hint.unavailable_reason || 'provider_pricing_not_preflightable', pricing_snapshot: pricingSnapshot };
  }

  if (hint.kind === 'fixed') {
    const cents = positive(hint.cents_per_generation);
    const result = cents === null ? null : money(cents, { units: 1, unit: 'generation' });
    return result ? { available: true, ...result, pricing_snapshot: pricingSnapshot } : { available: false, reason: 'invalid_fixed_price', pricing_snapshot: pricingSnapshot };
  }

  if (hint.kind === 'per_second') {
    const seconds = durationSeconds(input, hint);
    const rate = perSecondRate(input, hint);
    if (seconds === null || rate === null) {
      return { available: false, reason: 'pricing_requires_duration_or_rate_selector', pricing_snapshot: pricingSnapshot };
    }
    return { available: true, ...money(seconds * rate, { units: seconds, unit: 'second', unit_price_cents: rate }), pricing_snapshot: pricingSnapshot };
  }

  if (hint.kind === 'per_output_megapixel') {
    const megapixels = imageMegapixels(input, hint);
    const rate = positive(hint.cents_per_megapixel);
    if (megapixels === null || rate === null) {
      return { available: false, reason: 'pricing_requires_output_dimensions', pricing_snapshot: pricingSnapshot };
    }
    const billedMegapixels = hint.round_megapixels === 'ceil' ? Math.ceil(megapixels) : megapixels;
    return { available: true, ...money(billedMegapixels * rate, { units: billedMegapixels, unit: 'output_megapixel', unit_price_cents: rate }), pricing_snapshot: pricingSnapshot };
  }

  if (hint.kind === 'tiered_output_megapixel') {
    const megapixels = imageMegapixels(input, hint);
    const first = positive(hint.first_megapixel_cents);
    const additional = positive(hint.additional_megapixel_cents);
    if (megapixels === null || first === null || additional === null) {
      return { available: false, reason: 'pricing_requires_output_dimensions', pricing_snapshot: pricingSnapshot };
    }
    const billed = Math.max(1, Math.ceil(megapixels));
    const centsExact = first + Math.max(0, billed - 1) * additional;
    return { available: true, ...money(centsExact, { units: billed, unit: 'output_megapixel' }), pricing_snapshot: pricingSnapshot };
  }

  return { available: false, reason: 'unsupported_pricing_formula', pricing_snapshot: pricingSnapshot };
}
