/* Control's Generate form collects a prompt and a budget only, so it must
   never offer a model that needs reference media, and a bakeoff must
   compare models of one capability. The Worker enforces the same rules
   (workers/mccluster/src/media/input-contract.js) before any spend; this
   pins the operator surface so it does not invite a refused request.
   Rebuilt from PR #268 on current main. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const media = read('js/control-room/media.js');
const router = read('workers/mccluster/src/media/router.js');
const orchestrator = read('workers/mccluster/src/media/orchestrator.js');

test('the prompt-only form offers prompt-ready (text-to-*) models only', () => {
  assert.match(media, /function isPromptModel\(m\) \{ return \/\^text-to-\/i/);
  assert.match(media, /function modelById\(id\) \{\s*return promptModels\(\)/, 'selection resolves only among prompt-ready models');
  assert.match(media, /need reference media \(image-to-video, edit, upscale, lip-sync\)/, 'hidden models are named, not silently dropped');
  assert.match(media, /Control will not submit an incomplete paid request/);
});

test('a Control bakeoff must share one capability before it is sent', () => {
  assert.match(media, /Bakeoff models must share one capability/);
  assert.match(media, /needs reference media this form does not collect/);
});

test('the Worker checks input before estimating, reserving or submitting', () => {
  const at = (needle) => router.indexOf(needle);
  assert.ok(at('validateModelInput(model, input);') > 0, 'createGeneration calls the input contract');
  assert.ok(at('validateModelInput(model, input);') < at('estimateModelCost(model, input)'), 'before the estimate');
  assert.ok(at('validateModelInput(model, input);') < at("rpc(env, 'media_create_budgeted_job_v2'"), 'before the budget reservation');
  assert.ok(orchestrator.indexOf('validateBakeoff(models, input)') < orchestrator.indexOf('Promise.allSettled'), 'a bakeoff is checked whole before any model is submitted');
});
