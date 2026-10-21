/* MEDIA INPUT CONTRACT — reject malformed paid requests before reservation.

   Catalog-declared JSON-schema constraints are authoritative where present.
   Empty legacy schemas get a capability floor so arbitrary structured objects
   cannot be mistaken for valid provider input. */

const VISUAL_CAPABILITIES = new Set(['image-to-image', 'image-to-video', 'upscale']);

function invalid(message, detail) {
  return Object.assign(new Error(message), { status: 422, detail });
}

function blank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function isMediaRef(value) {
  return typeof value === 'string'
    && /^(https?:\/\/|data:)/i.test(value.trim())
    && value.trim().length > 8;
}

function valuesForMediaField(value) {
  if (isMediaRef(value)) return [value];
  if (Array.isArray(value)) return value.filter(isMediaRef);
  return [];
}

function mediaReferences(input) {
  const refs = [];
  for (const [key, value] of Object.entries(input || {})) {
    if (!/_urls?$/i.test(key)) continue;
    for (const ref of valuesForMediaField(value)) refs.push({ key, value: ref });
  }
  return refs;
}

function refKind(key) {
  const name = String(key || '').toLowerCase();
  if (/(audio|sound|voice|speech|music)/.test(name)) return 'audio';
  if (/(image|video|avatar|face|visual|frame|photo|picture|source|reference|input)/.test(name)) return 'visual';
  return 'other';
}

function typeMatches(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'null') return value === null;
  return true;
}

function validateRule(field, value, rule, base) {
  if (!rule || typeof rule !== 'object' || value === undefined || value === null) return;
  const types = Array.isArray(rule.type) ? rule.type : (rule.type ? [rule.type] : []);
  if (types.length && !types.some((type) => typeMatches(value, type))) {
    throw invalid(`Media model input ${field} has the wrong type`, {
      ...base, field, expected_type: rule.type, received_type: Array.isArray(value) ? 'array' : typeof value
    });
  }
  if (Array.isArray(rule.enum) && !rule.enum.some((allowed) => Object.is(allowed, value))) {
    throw invalid(`Media model input ${field} is not an allowed value`, {
      ...base, field, allowed: rule.enum, received: value
    });
  }
  if (typeof value === 'string') {
    if (typeof rule.minLength === 'number' && value.length < rule.minLength) {
      throw invalid(`Media model input ${field} is too short`, { ...base, field, min_length: rule.minLength, length: value.length });
    }
    if (typeof rule.maxLength === 'number' && value.length > rule.maxLength) {
      throw invalid(`Media model input ${field} is too long`, { ...base, field, max_length: rule.maxLength, length: value.length });
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof rule.minimum === 'number' && value < rule.minimum) {
      throw invalid(`Media model input ${field} is below the minimum`, { ...base, field, minimum: rule.minimum, received: value });
    }
    if (typeof rule.maximum === 'number' && value > rule.maximum) {
      throw invalid(`Media model input ${field} exceeds the maximum`, { ...base, field, maximum: rule.maximum, received: value });
    }
  }
}

export function isPromptCapability(capability) {
  return String(capability || '').toLowerCase().startsWith('text-to-');
}

export function validateModelInput(model, input) {
  const capability = String(model?.capability || '').toLowerCase();
  const schema = model?.parameter_schema && typeof model.parameter_schema === 'object' && !Array.isArray(model.parameter_schema)
    ? model.parameter_schema
    : {};
  const base = {
    model_id: model?.id,
    provider_model_id: model?.provider_model_id,
    capability: model?.capability
  };

  const required = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter((field) => blank(input?.[field]));
  if (missing.length) {
    throw invalid('Media model input is missing required fields', { ...base, missing_fields: missing });
  }

  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties
    : null;
  if (properties && schema.additionalProperties === false) {
    const unknown = Object.keys(input || {}).filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
    if (unknown.length) {
      throw invalid('Media model input has fields this model does not accept', {
        ...base, unknown_fields: unknown, accepted_fields: Object.keys(properties)
      });
    }
  }
  for (const [field, rule] of Object.entries(properties || {})) {
    validateRule(field, input?.[field], rule, base);
  }

  if (isPromptCapability(capability)) {
    if (blank(input?.prompt) || typeof input.prompt !== 'string') {
      throw invalid('This model generates from a non-empty text prompt', { ...base, missing_fields: ['prompt'] });
    }
    return;
  }

  const refs = mediaReferences(input);
  if (capability === 'lip-sync') {
    const visual = refs.filter((ref) => refKind(ref.key) === 'visual');
    const audio = refs.filter((ref) => refKind(ref.key) === 'audio');
    if (!visual.length || !audio.length) {
      throw invalid('Lip-sync requires both visual reference media and audio reference media', {
        ...base,
        visual_reference_fields: visual.map((ref) => ref.key),
        audio_reference_fields: audio.map((ref) => ref.key),
        required_action: 'supply a visual *_url field such as image_url/video_url and an audio *_url field such as audio_url'
      });
    }
    return;
  }

  if (VISUAL_CAPABILITIES.has(capability)) {
    const visual = refs.filter((ref) => refKind(ref.key) === 'visual');
    if (!visual.length) {
      throw invalid('This media model requires structured media input with real visual reference media, not an arbitrary object', {
        ...base,
        reference_media_supplied: refs.map((ref) => ref.key),
        required_action: 'supply an image/video/reference *_url field or choose a text-to-* model'
      });
    }
    return;
  }

  if (!refs.length) {
    throw invalid('This media model requires structured media input with real reference media, not an arbitrary object', {
      ...base,
      required_action: 'supply provider reference media in *_url/*_urls fields or choose a text-to-* model'
    });
  }
}

export function validateBakeoff(models, input) {
  const capabilities = [...new Set(models.map((m) => String(m?.capability || '').toLowerCase()))];
  if (capabilities.length !== 1) {
    throw invalid('Bakeoff models must share one capability so the comparison is meaningful', {
      capabilities: models.map((m) => ({ model_id: m?.id, capability: m?.capability }))
    });
  }
  const failures = [];
  for (const model of models) {
    try {
      validateModelInput(model, input);
    } catch (error) {
      if (error?.status !== 422) throw error;
      failures.push({ model_id: model?.id, error: error.message, detail: error.detail });
    }
  }
  if (failures.length) {
    throw invalid('Bakeoff input is not valid for every model; nothing was submitted', { failures });
  }
}
