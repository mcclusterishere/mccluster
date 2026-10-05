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
    parameter_schema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', maxLength: 4000 },
        duration: { enum: ['5', '10'] },
        aspect_ratio: { enum: ['16:9', '9:16', '1:1'] }
      },
      additionalProperties: false
    }
  }
};

function request(path, body) {
  return new Request(`https://api.mccluster.org${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org_id: ORG_ID, ...body })
  });
}

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
  return Promise.resolve().then(() => fn(spent, seen)).finally(() => {
    globalThis.fetch = original;
    __resetCapabilityCache();
  });
}

const refused422 = (pattern) => (error) => error?.status === 422 && pattern.test(error.message);

test('arbitrary structured input cannot unlock a specialized paid model', () => withPlane(async (spent) => {
  await assert.rejects(
    createGeneration(request('/v1/media/generate', { model_id: 'i2v', prompt: 'x', input: { foo: 1 } }), env, { id: 'u' }),
    refused422(/visual reference media|real reference media/)
  );
  assert.equal(spent(), false);
}));

test('image-to-video requires a real visual URL, not any *_url field', () => {
  assert.throws(() => validateModelInput(MODELS.i2v, { audio_url: 'https://cdn.example/voice.mp3' }), refused422(/visual reference media/));
  assert.doesNotThrow(() => validateModelInput(MODELS.i2v, { image_url: 'https://cdn.example/frame.png' }));
});

test('lip-sync requires one visual reference and one audio reference', () => {
  assert.throws(
    () => validateModelInput(MODELS.lipsync, {
      image_url: 'https://cdn.example/face.png',
      video_url: 'https://cdn.example/face.mp4'
    }),
    refused422(/visual reference media and audio reference media/)
  );
  assert.throws(
    () => validateModelInput(MODELS.lipsync, {
      audio_url: 'https://cdn.example/a.mp3',
      voice_url: 'https://cdn.example/b.mp3'
    }),
    refused422(/visual reference media and audio reference media/)
  );
  assert.doesNotThrow(() => validateModelInput(MODELS.lipsync, {
    video_url: 'https://cdn.example/face.mp4',
    audio_url: 'https://cdn.example/voice.mp3'
  }));
});

test('declared enum values are type-strict', () => {
  assert.throws(
    () => validateModelInput(MODELS.t2v, { prompt: 'x', duration: 5 }),
    (error) => error?.status === 422 && error.detail?.field === 'duration'
  );
  assert.doesNotThrow(() => validateModelInput(MODELS.t2v, { prompt: 'x', duration: '5' }));
});

test('declared string type and non-empty prompt are enforced', () => {
  assert.throws(() => validateModelInput(MODELS.t2v, { prompt: {} }), (error) => error?.status === 422 && /wrong type/.test(error.message));
  assert.throws(() => validateModelInput(MODELS.t2v, { prompt: '   ' }), (error) => error?.status === 422);
  assert.throws(() => validateModelInput(MODELS.t2i, { prompt: {} }), refused422(/non-empty text prompt/));
});

test('additionalProperties false refuses unknown provider fields', () => {
  assert.throws(
    () => validateModelInput(MODELS.t2v, { prompt: 'x', foo: true }),
    (error) => error?.status === 422 && error.detail?.unknown_fields?.includes('foo')
  );
});

test('whole bakeoff rejects cross-capability comparison before any spend', () => withPlane(async (spent) => {
  await assert.rejects(
    createBakeoff(request('/v1/media/bakeoff', { model_ids: ['t2i', 't2v'], prompt: 'skyline' }), env, { id: 'u' }),
    refused422(/share one capability/)
  );
  assert.equal(spent(), false);
}));

test('whole bakeoff rejects invalid same-capability input before any spend', () => withPlane(async (spent) => {
  await assert.rejects(
    createBakeoff(request('/v1/media/bakeoff', { model_ids: ['i2v', 'i2v2'], input: { foo: 1 } }), env, { id: 'u' }),
    refused422(/nothing was submitted/)
  );
  assert.equal(spent(), false);
}));

test('whole bakeoff rejects an unknown model before any spend', () => withPlane(async (spent) => {
  await assert.rejects(
    createBakeoff(request('/v1/media/bakeoff', { model_ids: ['t2i', 'gone'], prompt: 'x' }), env, { id: 'u' }),
    (error) => error?.status === 404
  );
  assert.equal(spent(), false);
}));

test('valid like-for-like bakeoff preflight passes', () => {
  assert.doesNotThrow(() => validateBakeoff([MODELS.i2v, MODELS.i2v2], { image_url: 'https://cdn.example/frame.png' }));
});
