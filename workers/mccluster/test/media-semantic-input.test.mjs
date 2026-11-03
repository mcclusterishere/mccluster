import test from 'node:test';
import assert from 'node:assert/strict';

import { providerInputForSemanticTool } from '../src/media/mcp.js';
import { validateModelInput } from '../src/media/input-contract.js';

const IMAGE_TO_3D = {
  id: 'm-i23d',
  provider_model_id: 'fal-ai/hunyuan3d-v3/image-to-3d',
  capability: 'image-to-3d',
  parameter_schema: {
    type: 'object',
    required: ['input_image_url'],
    additionalProperties: false,
    properties: {
      input_image_url: { type: 'string' },
      enable_pbr: { type: 'boolean', enum: [true] },
      face_count: { type: 'integer', enum: [40000] },
      generate_type: { type: 'string', enum: ['Normal'] }
    },
    'x-reference-field': 'input_image_url',
    'x-fixed-input': { enable_pbr: true, face_count: 40000, generate_type: 'Normal' }
  }
};

test('a catalog row names its reference field and fixed options, and the input validates', () => {
  const input = providerInputForSemanticTool('model3d.generate', { prompt: 'operator E', references: ['https://example.com/e.png'] }, IMAGE_TO_3D);
  assert.deepEqual(input, { input_image_url: 'https://example.com/e.png', enable_pbr: true, face_count: 40000, generate_type: 'Normal' });
  assert.doesNotThrow(() => validateModelInput(IMAGE_TO_3D, input));
});

test('a closed schema without a prompt field gets no prompt', () => {
  const input = providerInputForSemanticTool('model3d.generate', { prompt: 'x', references: [{ url: 'https://example.com/r.png' }] }, IMAGE_TO_3D);
  assert.equal('prompt' in input, false);
});

test('fixed options cannot be overridden by the caller', () => {
  const input = providerInputForSemanticTool('model3d.generate', { prompt: 'x', references: ['https://example.com/t.png'], face_count: 1500000 }, IMAGE_TO_3D);
  assert.equal(input.face_count, 40000);
});

test('rows without hints keep the old behaviour: prompt plus image_url', () => {
  assert.deepEqual(
    providerInputForSemanticTool('image.generate', { prompt: 'p', references: ['https://example.com/a.png'] }, { parameter_schema: {} }),
    { prompt: 'p', image_url: 'https://example.com/a.png' }
  );
  assert.deepEqual(providerInputForSemanticTool('model3d.generate', { prompt: 'p' }), { prompt: 'p' });
});

test('a malformed reference field hint falls back to image_url', () => {
  const model = { parameter_schema: { 'x-reference-field': 'evil; drop' } };
  assert.deepEqual(providerInputForSemanticTool('image.generate', { prompt: 'p', references: ['https://example.com/a.png'] }, model), { prompt: 'p', image_url: 'https://example.com/a.png' });
});
