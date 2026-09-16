import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONTROL_TOOLS } from '../src/tools/control.mjs';
import { researchWeb } from '../src/tools/research.mjs';

const names = new Set(CONTROL_TOOLS.map((tool) => tool.name));

test('Core exposes repository objective code game world web-research and preview tools', () => {
  for (const name of ['core.repo.inspect', 'core.objective.plan', 'core.code.build', 'core.game.build', 'core.world.generate', 'core.research.web', 'core.deploy.preview']) {
    assert.ok(names.has(name), `missing ${name}`);
  }
});

test('objective planning tool remains bounded to safe unattended child work', async () => {
  const source = await readFile(new URL('../src/tools/control.mjs', import.meta.url), 'utf8');
  assert.match(source, /jobType: 'objective_plan'/);
  assert.match(source, /child_job_types: \['repo_health', 'local_analysis'\]/);
  assert.match(source, /production_mutation: false/);
});

test('preview tool is always advertised without SaaS deployment credentials', async () => {
  assert.equal(names.has('core.deploy.preview'), true);
  const source = await readFile(new URL('../src/tools/control.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /VERCEL_TOKEN/);
  assert.match(source, /provider: 'mccluster-core'/);
  assert.match(source, /hosting: 'owned'/);
});

test('web research fails closed before network access when objective is missing', async () => {
  await assert.rejects(() => researchWeb({}), /objective is required/);
});

test('preview executor is self-hosted and non-production by construction', async () => {
  const source = await readFile(new URL('../src/executors/preview-deploy.mjs', import.meta.url), 'utf8');
  assert.match(source, /production: false/);
  assert.match(source, /hosting: 'owned'/);
  assert.match(source, /provider: 'mccluster-core'/);
  assert.match(source, /MCCLUSTER_PREVIEW_ROOT/);
  assert.match(source, /git', \['worktree', 'add'/);
  assert.doesNotMatch(source, /VERCEL_TOKEN|vercel\.app|\bvercel\b/i);
  assert.doesNotMatch(source, /--prod(?:uction)?\b/);
});

test('preview gateway is loopback-first and expires previews', async () => {
  const source = await readFile(new URL('../src/preview-gateway.mjs', import.meta.url), 'utf8');
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /MCCLUSTER_PREVIEW_ROOT/);
  assert.match(source, /Preview expired/);
  assert.match(source, /cleanupExpired/);
  assert.doesNotMatch(source, /VERCEL_TOKEN|vercel\.app|\bvercel\b/i);
});

test('production capability catalog contains no planned lifecycle entries and preview is owned', async () => {
  const catalog = JSON.parse(await readFile(new URL('../capabilities/catalog.json', import.meta.url), 'utf8'));
  const planned = catalog.capabilities.filter((capability) => capability.lifecycle === 'planned').map((capability) => capability.id);
  assert.deepEqual(planned, []);
  const required = ['image.generate', 'video.generate', 'audio.generate', 'model3d.generate', 'world.generate', 'research.web', 'repo.inspect', 'code.build', 'game.build', 'deploy.preview'];
  for (const id of required) {
    assert.equal(catalog.capabilities.find((capability) => capability.id === id)?.lifecycle, 'active', `${id} must be active`);
    assert.ok(catalog.bindings.some((binding) => binding.capability === id && binding.status === 'active'), `${id} must have an active binding`);
  }
  const preview = catalog.bindings.find((binding) => binding.capability === 'deploy.preview');
  assert.equal(preview.provider, 'mccluster-core');
  assert.equal(preview.economics.hosting, 'owned');
  assert.equal(preview.features.self_hosted, true);
  assert.equal(preview.features.third_party_deploy_provider, false);
  assert.doesNotMatch(JSON.stringify(catalog.capabilities.find((capability) => capability.id === 'deploy.preview')), /VERCEL|vercel/i);
});
