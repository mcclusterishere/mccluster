import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONTROL_TOOLS } from '../src/tools/control.mjs';
import { researchWeb } from '../src/tools/research.mjs';

const names = new Set(CONTROL_TOOLS.map((tool) => tool.name));

test('Core exposes repository code game world and web-research tools', () => {
  for (const name of ['core.repo.inspect', 'core.code.build', 'core.game.build', 'core.world.generate', 'core.research.web']) {
    assert.ok(names.has(name), `missing ${name}`);
  }
});

test('preview tool is advertised only when deployment credentials exist', () => {
  assert.equal(names.has('core.deploy.preview'), Boolean(process.env.VERCEL_TOKEN));
});

test('web research fails closed before network access when objective is missing', async () => {
  await assert.rejects(() => researchWeb({}), /objective is required/);
});

test('preview executor is non-production by construction', async () => {
  const source = await readFile(new URL('../src/executors/preview-deploy.mjs', import.meta.url), 'utf8');
  assert.match(source, /production: false/);
  assert.doesNotMatch(source, /--prod(?:uction)?\b/);
  assert.match(source, /VERCEL_TOKEN/);
});
