/* MEDIA INPUT CONTRACT — refuse a malformed paid request before it costs money.

   Every spending path (Control generate and bakeoff, media MCP tools, social
   variants) goes through createGeneration, and createGeneration calls this
   before it estimates, reserves budget, or submits to the provider. A request
   that fails here gets a 422 naming what is missing; nothing is spent.

   Two sources of truth, in order:
   1. The catalog row's parameter_schema, where it declares one: required
      fields, enum values, string maxLength, and additionalProperties:false.
   2. The capability itself, for the many rows whose schema is still empty:
      a text-to-* model needs a prompt; an image-to-image, image-to-video,
      upscale or lip-sync model needs real reference media (an http(s) or
      data: URL in a *_url / *_urls field; lip-sync needs two, the face and
      the audio). An arbitrary non-empty object is not enough: that is how a
      prompt-only caller used to reach a paid image-to-video model.
   Exact provider field names stay the provider's to check; this only refuses
   requests that cannot be valid. Origin: PR #268, rebuilt on current main. */

/* Reference-media minimums for capabilities whose catalog schema is empty. */
const MEDIA_MINIMUM = {
  'image-to-image': 1,
  'image-to-video': 1,
  upscale: 1,
  'lip-sync': 2
};

function invalid(message, detail) {
  return Object.assign(new Error(message), { status: 422, detail });
}

const isMediaRef = (value) => typeof value === 'string' && /^(https:\/\/|http:\/\/|data:)/i.test(value.trim()) && value.trim().length > 8;

/* Fields that carry reference media: *_url holds one, *_urls holds a list. */
function mediaFields(input) {
  const found = [];
  for (const [key, value] of Object.entries(input || {})) {
    if (/_url$/i.test(key) && isMediaRef(value)) found.push(key);
    else if (/_urls$/i.test(key) && Array.isArray(value) && value.some(isMediaRef)) found.push(key);
  }
  return found;
}

const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

export function isPromptCapability(capability) {
  return String(capability || '').toLowerCase().startsWith('text-to-');
}

export function validateModelInput(model, input) {
  const capability = String(model?.capability || '').toLowerCase();
  const schema = model?.parameter_schema && typeof model.parameter_schema === 'object' ? model.parameter_schema : {};
  const base = { model_id: model?.id, provider_model_id: model?.provider_model_id, capability: model?.capability };

  /* 1. What the catalog declares. */
  const required = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter((field) => isBlank(input?.[field]));
  if (missing.length) throw invalid('Media model input is missing required fields', { ...base, missing_fields: missing });

  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : null;
  if (properties && schema.additionalProperties === false) {
    const unknown = Object.keys(input || {}).filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
    if (unknown.length) throw invalid('Media model input has fields this model does not accept', { ...base, unknown_fields: unknown, accepted_fields: Object.keys(properties) });
  }
  for (const [field, rule] of Object.entries(properties || {})) {
    const value = input?.[field];
    if (value === undefined || value === null || !rule || typeof rule !== 'object') continue;
    if (Array.isArray(rule.enum) && !rule.enum.map(String).includes(String(value))) {
      throw invalid(`Media model input ${field} is not an allowed value`, { ...base, field, allowed: rule.enum, received: value });
    }
    if (typeof rule.maxLength === 'number' && typeof value === 'string' && value.length > rule.maxLength) {
      throw invalid(`Media model input ${field} is too long`, { ...base, field, max_length: rule.maxLength, length: value.length });
    }
  }

  /* 2. What the capability needs, whatever the schema says. */
  if (isPromptCapability(capability)) {
    if (isBlank(input?.prompt)) throw invalid('This model generates from a prompt; the prompt is empty', { ...base, missing_fields: ['prompt'] });
    return;
  }
  const needed = MEDIA_MINIMUM[capability] ?? 1;
  const supplied = mediaFields(input);
  if (supplied.length < needed) {
    throw invalid('This media model needs reference media, not a prompt-only request', {
      ...base,
      reference_media_required: needed,
      reference_media_supplied: supplied,
      required_action: 'supply the reference media as *_url fields in input, or choose a text-to-* model'
    });
  }
}

/* A bakeoff compares like with like and is checked whole before any model
   is submitted, so a mixed set cannot spend on the valid half and fail the
   rest. */
export function validateBakeoff(models, input) {
  const capabilities = [...new Set(models.map((m) => String(m?.capability || '').toLowerCase()))];
  if (capabilities.length !== 1) {
    throw invalid('Bakeoff models must share one capability so the comparison is meaningful', {
      capabilities: models.map((m) => ({ model_id: m?.id, capability: m?.capability }))
    });
  }
  const failures = [];
  for (const model of models) {
    try { validateModelInput(model, input); } catch (error) {
      if (error.status !== 422) throw error;
      failures.push({ model_id: model?.id, error: error.message, detail: error.detail });
    }
  }
  if (failures.length) throw invalid('Bakeoff input is not valid for every model; nothing was submitted', { failures });
}
