import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONTROL_TOOLS } from '../src/tools/control.mjs';
import { previewConfigured } from '../src/preview-policy.mjs';
import { researchWeb } from '../src/tools/research.mjs';

const names = new Set(CONTROL_TOOLS.map((tool) => tool.name));

test('Core exposes repository objective code game world and web-research tools', () => {
  for (const name of ['core.repo.inspect', 'core.objective.plan', 'core.code.build', 'core.game.build', 'core.world.generate', 'core.research.web']) {
    assert.ok(names.has(name), `missing ${name}`);
  }
});

test('objective planning tool remains bounded to safe unattended child work', async () => {
  const source = await readFile(new URL('../src/tools/control.mjs', import.meta.url), 'utf8');
  assert.match(source, /jobType: 'objective_plan'/);
  assert.match(source, /child_job_types: \['repo_health', 'local_analysis'\]/);
  assert.match(source, /production_mutation: false/);
});

test('preview tool is advertised only when the owned preview gateway is configured', () => {
  assert.equal(names.has('core.deploy.preview'), previewConfigured());
});

test('web research fails closed before network access when objective is missing', async () => {
  await assert.rejects(() => researchWeb({}), /objective is required/);
});

test('preview executor is non-production by construction', async () => {
  const source = await readFile(new URL('../src/executors/preview-deploy.mjs', import.meta.url), 'utf8');
  assert.match(source, /production: false/);
  assert.doesNotMatch(source, /--prod(?:uction)?\b/);
  assert.doesNotMatch(source, /VERCEL_TOKEN/);
  assert.match(source, /previewConfigured/);
});

test('production capability catalog contains no planned lifecycle entries', async () => {
  const catalog = JSON.parse(await readFile(new URL('../capabilities/catalog.json', import.meta.url), 'utf8'));
  const planned = catalog.capabilities.filter((capability) => capability.lifecycle === 'planned').map((capability) => capability.id);
  assert.deepEqual(planned, []);
  const required = ['image.generate', 'video.generate', 'audio.generate', 'model3d.generate', 'world.generate', 'research.web', 'repo.inspect', 'code.build', 'game.build', 'deploy.preview'];
  for (const id of required) {
    assert.equal(catalog.capabilities.find((capability) => capability.id === id)?.lifecycle, 'active', `${id} must be active`);
    assert.ok(catalog.bindings.some((binding) => binding.capability === id && binding.status === 'active'), `${id} must have an active binding`);
  }
  assert.equal(catalog.bindings.find((binding) => binding.capability === 'deploy.preview').economics.hosting, 'owned');
});
