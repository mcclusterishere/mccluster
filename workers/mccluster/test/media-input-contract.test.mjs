/* The media input contract: a malformed paid request is refused with a 422
   before any budget reservation (media_create_budgeted_job_v2) or provider
   submission (fal). Rebuilt from PR #268 on current main.

   Fixtures mirror the live catalog (2026-10-05): six enabled specialized
   models (image-to-image, three image-to-video, lip-sync, upscale) with empty
   parameter_schema, and two text models that declare required/enum/
   maxLength/additionalProperties. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createGeneration } from '../src/media/router.js';
import { createBakeoff } from '../src/media/orchestrator.js';
import { validateModelInput, validateBakeoff } from '../src/media/input-contract.js';
import { __resetCapabilityCache } from '../src/lib/capabilities.js';

const ORG_ID = '123e4567-e89b-42d3-a456-426614174000';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role', FAL_KEY: 'test' };
const MATRIX = [{ role: 'owner', capability: 'media.generate', allowed: true }];

const MODELS = {
  i2v: { id: 'i2v', provider: 'fal', provider_model_id: 'fal-ai/kling-video/v3/standard/image-to-video', capability: 'image-to-video', parameter_schema: {}, cost_hint: {}, enabled: true },
  i2v2: { id: 'i2v2', provider: 'fal', provider_model_id: 'fal-ai/wan/v2.7/image-to-video', capability: 'image-to-video', parameter_schema: {}, cost_hint: {}, enabled: true },
  lipsync: { id: 'lipsync', provider: 'fal', provider_model_id: 'fal-ai/sync-lipsync/v3/image-to-video', capability: 'lip-sync', parameter_schema: {}, cost_hint: {}, enabled: true },
  t2i: { id: 't2i', provider: 'fal', provider_model_id: 'fal-ai/flux-2', capability: 'text-to-image', parameter_schema: {}, cost_hint: {}, enabled: true },
  t2v: {
    id: 't2v', provider: 'fal', provider_model_id: 'fal-ai/kling-video/v2.6/pro/text-to-video', capability: 'text-to-video', cost_hint: {}, enabled: true,
    parameter_schema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string', maxLength: 4000 }, duration: { enum: ['5', '10'] }, aspect_ratio: { enum: ['16:9', '9:16', '1:1'] } }, additionalProperties: false }
  }
};

function request(path, body) {
  return new Request(`https://api.mccluster.org${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ org_id: ORG_ID, ...body }) });
}

/* Answers membership, grants and the catalog; any spend-side call is
   recorded so a test can prove it never happened. */
function withPlane(fn) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.includes('/rest/v1/org_members?')) return Response.json([{ org_id: ORG_ID, role: 'owner' }]);
    if (href.includes('/rest/v1/control_role_capabilities?')) return Response.json(MATRIX);
    if (href.includes('/rest/v1/media_models?')) {
      const id = decodeURIComponent((href.match(/id=eq\.([^&]+)/) || [])[1] || '');
      return Response.json(MODELS[id] ? [MODELS[id]] : []);
    }
    throw new Error(`spend-side call reached: ${href}`);
  };
  __resetCapabilityCache();
  const spent = () => seen.some((h) => h.includes('media_create_budgeted_job') || h.includes('fal.run') || h.includes('queue.fal'));
  return Promise.resolve().then(() => fn(spent)).finally(() => { globalThis.fetch = original; __resetCapabilityCache(); });
}

const refused422 = (pattern) => (error) => error.status === 422 && pattern.test(error.message);

test('a prompt-only request to an image-to-video model is refused before any spend', () => withPlane(async (spent) => {
  await assert.rejects(createGeneration(request('/v1/media/generate', { model_id: 'i2v', prompt: 'a car at night' }), env, { id: 'u' }), refused422(/needs reference media/));
  assert.equal(spent(), false);
}));

test('an arbitrary structured input does not count as reference media', () => withPlane(async (spent) => {
  await assert.rejects(createGeneration(request('/v1/media/generate', { model_id: 'i2v', prompt: 'x', input: { foo: 1, image_url: 'not-a-url' } }), env, { id: 'u' }), refused422(/needs reference media/));
  assert.equal(spent(), false);
}));

test('lip-sync needs two pieces of reference media, the face and the audio', () => {
  assert.throws(() => validateModelInput(MODELS.lipsync, { image_url: 'https://cdn.example/face.png' }), refused422(/needs reference media/));
  assert.doesNotThrow(() => validateModelInput(MODELS.lipsync, { image_url: 'https://cdn.example/face.png', audio_url: 'https://cdn.example/voice.mp3' }));
});

test('reference media as an https URL, a data URI or a *_urls list is accepted', () => {
  assert.doesNotThrow(() => validateModelInput(MODELS.i2v, { image_url: 'https://cdn.example/frame.png', prompt: 'slow push in' }));
  assert.doesNotThrow(() => validateModelInput(MODELS.i2v, { image_url: 'data:image/png;base64,iVBORw0KGgo=' }));
  assert.doesNotThrow(() => validateModelInput({ ...MODELS.i2v, capability: 'image-to-image' }, { image_urls: ['https://cdn.example/a.png'] }));
});

test('catalog-declared schema is enforced: required, enum, maxLength, unknown fields', () => {
  assert.throws(() => validateModelInput(MODELS.t2v, { duration: '5' }), (e) => e.status === 422 && e.detail.missing_fields.includes('prompt'));
  assert.throws(() => validateModelInput(MODELS.t2v, { prompt: 'x', duration: '7' }), (e) => e.status === 422 && e.detail.field === 'duration');
  assert.throws(() => validateModelInput(MODELS.t2v, { prompt: 'x'.repeat(4001) }), (e) => e.status === 422 && e.detail.max_length === 4000);
  assert.throws(() => validateModelInput(MODELS.t2v, { prompt: 'x', image_url: 'https://cdn.example/a.png' }), (e) => e.status === 422 && e.detail.unknown_fields.includes('image_url'));
  assert.doesNotThrow(() => validateModelInput(MODELS.t2v, { prompt: 'a skyline', duration: '10', aspect_ratio: '9:16' }));
});

test('a text-to-* model with no prompt is refused even when its schema is empty', () => {
  assert.throws(() => validateModelInput(MODELS.t2i, { seed: 4 }), refused422(/prompt is empty/));
  assert.doesNotThrow(() => validateModelInput(MODELS.t2i, { prompt: 'a red door' }));
});

test('a bakeoff across capabilities is refused whole, before any submission', () => withPlane(async (spent) => {
  await assert.rejects(createBakeoff(request('/v1/media/bakeoff', { model_ids: ['t2i', 't2v'], prompt: 'a skyline' }), env, { id: 'u' }), refused422(/share one capability/));
  assert.equal(spent(), false);
}));

test('a bakeoff where one model cannot take the input submits nothing', () => withPlane(async (spent) => {
  /* Same capability, but the prompt alone is not reference media for either. */
  await assert.rejects(createBakeoff(request('/v1/media/bakeoff', { model_ids: ['i2v', 'i2v2'], prompt: 'motion' }), env, { id: 'u' }), refused422(/nothing was submitted/));
  assert.equal(spent(), false);
}));

test('a bakeoff naming an unknown model submits nothing', () => withPlane(async (spent) => {
  await assert.rejects(createBakeoff(request('/v1/media/bakeoff', { model_ids: ['t2i', 'gone'], prompt: 'x' }), env, { id: 'u' }), (e) => e.status === 404);
  assert.equal(spent(), false);
}));

test('validateBakeoff accepts a same-capability set that every model can take', () => {
  assert.doesNotThrow(() => validateBakeoff([MODELS.i2v, MODELS.i2v2], { image_url: 'https://cdn.example/frame.png' }));
});
