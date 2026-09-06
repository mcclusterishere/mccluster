const FAL_IMAGE_PRESET_MEGAPIXELS = Object.freeze({
  square_hd: (1024 * 1024) / 1_000_000,
  square: (512 * 512) / 1_000_000,
  portrait_4_3: (768 * 1024) / 1_000_000,
  portrait_16_9: (576 * 1024) / 1_000_000,
  landscape_4_3: (1024 * 768) / 1_000_000,
  landscape_16_9: (1024 * 576) / 1_000_000
});

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = asFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function outputCount(input, hint) {
  const field = hint.count_field;
  if (!field) return 1;
  const raw = positive(input?.[field] ?? hint.default_count ?? 1);
  if (raw === null || raw < 1) return null;
  return Math.ceil(raw);
}

function imageMegapixels(input, hint) {
  const imageSizeField = hint.image_size_field || 'image_size';
  const size = input?.[imageSizeField] ?? hint.default_image_size;
  if (size && typeof size === 'object') {
    const width = positive(size.width);
    const height = positive(size.height);
    if (width && height) return (width * height) / 1_000_000;
  }

  const width = positive(input?.[hint.width_field || 'width']);
  const height = positive(input?.[hint.height_field || 'height']);
  if (width && height) return (width * height) / 1_000_000;

  if (typeof size === 'string') {
    const customPresets = hint.preset_megapixels || {};
    if (customPresets[size] !== undefined) return positive(customPresets[size]);
    if (FAL_IMAGE_PRESET_MEGAPIXELS[size] !== undefined) return FAL_IMAGE_PRESET_MEGAPIXELS[size];
    return null;
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
    estimated_cost_usd_micros: Math.ceil(centsExact * 10_000),
    ...detail
  };
}

function unitPriceMicrosFromCents(cents) {
  const value = positive(cents);
  return value === null ? null : Math.ceil(value * 10_000);
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
    const result = cents === null ? null : money(cents, {
      units: 1,
      unit: 'generation',
      unit_price_usd_micros: unitPriceMicrosFromCents(cents)
    });
    return result ? { available: true, ...result, pricing_snapshot: pricingSnapshot } : { available: false, reason: 'invalid_fixed_price', pricing_snapshot: pricingSnapshot };
  }

  if (hint.kind === 'per_second') {
    const seconds = durationSeconds(input, hint);
    const rate = perSecondRate(input, hint);
    if (seconds === null || rate === null) {
      return { available: false, reason: 'pricing_requires_duration_or_rate_selector', pricing_snapshot: pricingSnapshot };
    }
    return {
      available: true,
      ...money(seconds * rate, {
        units: seconds,
        unit: 'second',
        unit_price_cents: rate,
        unit_price_usd_micros: unitPriceMicrosFromCents(rate)
      }),
      pricing_snapshot: pricingSnapshot
    };
  }

  if (hint.kind === 'per_output_megapixel') {
    const megapixels = imageMegapixels(input, hint);
    const count = outputCount(input, hint);
    const rate = positive(hint.cents_per_megapixel);
    if (megapixels === null || count === null || rate === null) {
      return { available: false, reason: 'pricing_requires_output_dimensions_or_count', pricing_snapshot: pricingSnapshot };
    }
    const megapixelsPerOutput = hint.round_megapixels === 'ceil' ? Math.ceil(megapixels) : megapixels;
    const billedMegapixels = megapixelsPerOutput * count;
    return {
      available: true,
      ...money(billedMegapixels * rate, {
        units: billedMegapixels,
        unit: 'output_megapixel',
        unit_price_cents: rate,
        unit_price_usd_micros: unitPriceMicrosFromCents(rate),
        output_count: count,
        megapixels_per_output: megapixelsPerOutput
      }),
      pricing_snapshot: pricingSnapshot
    };
  }

  if (hint.kind === 'tiered_output_megapixel') {
    const megapixels = imageMegapixels(input, hint);
    const count = outputCount(input, hint);
    const first = positive(hint.first_megapixel_cents);
    const additional = positive(hint.additional_megapixel_cents);
    if (megapixels === null || count === null || first === null || additional === null) {
      return { available: false, reason: 'pricing_requires_output_dimensions_or_count', pricing_snapshot: pricingSnapshot };
    }
    const billedPerOutput = Math.max(1, Math.ceil(megapixels));
    const centsPerOutput = first + Math.max(0, billedPerOutput - 1) * additional;
    return {
      available: true,
      ...money(centsPerOutput * count, {
        units: billedPerOutput * count,
        unit: 'output_megapixel',
        output_count: count,
        megapixels_per_output: billedPerOutput,
        pricing_formula: 'tiered'
      }),
      pricing_snapshot: pricingSnapshot
    };
  }

  return { available: false, reason: 'unsupported_pricing_formula', pricing_snapshot: pricingSnapshot };
}
