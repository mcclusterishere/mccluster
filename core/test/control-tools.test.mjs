import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONTROL_TOOLS, callControlTool } from '../src/tools/control.mjs';
import { previewConfigured } from '../src/preview-policy.mjs';
import { researchWeb } from '../src/tools/research.mjs';

const names = new Set(CONTROL_TOOLS.map((tool) => tool.name));

test('Core exposes repository objective code game world and web-research tools', () => {
  for (const name of ['core.compute.task.get', 'core.ai.turn.submit', 'core.ai.turn.get', 'core.repo.inspect', 'core.objective.plan', 'core.code.build', 'core.game.build', 'core.world.generate', 'core.research.web', 'core.ontology.schema', 'core.ontology.query', 'core.ontology.neighbors', 'core.ontology.action.apply', 'core.ingest.connectors', 'core.ingest.records', 'core.ingest.run.begin', 'core.ingest.record.write', 'core.ingest.run.finish', 'core.entity.aliases', 'core.entity.resolve', 'core.facts.query', 'core.facts.claim', 'core.workstream.checkpoint', 'core.workstream.list']) {
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
  const required = ['image.generate', 'video.generate', 'audio.generate', 'model3d.generate', 'world.generate', 'research.web', 'repo.inspect', 'code.build', 'game.build', 'deploy.preview', 'objective.plan', 'compute.task.get', 'ontology.schema', 'ontology.query', 'ontology.neighbors', 'ontology.action.apply', 'ingest.connectors', 'ingest.records', 'ingest.run.begin', 'ingest.record.write', 'ingest.run.finish', 'entity.aliases', 'entity.resolve', 'facts.query', 'facts.claim', 'workstream.checkpoint', 'workstream.list'];
  for (const id of required) {
    assert.equal(catalog.capabilities.find((capability) => capability.id === id)?.lifecycle, 'active', `${id} must be active`);
    assert.ok(catalog.bindings.some((binding) => binding.capability === id && binding.status === 'active'), `${id} must have an active binding`);
  }
  assert.equal(catalog.bindings.find((binding) => binding.capability === 'deploy.preview').economics.hosting, 'owned');
});


test('ontology mutation fails closed without signed actor context', async () => {
  await assert.rejects(
    () => callControlTool('core.ontology.action.apply', {
      org_id: '1c0733be-69b5-4e65-abe7-377b492c296b',
      action_key: 'object_tag',
      target_object_id: '123e4567-e89b-42d3-a456-426614174000',
      parameters: { tags: ['test'] }
    }),
    /authenticated actor user_id must be a UUID/
  );
});


test('entity resolution fails closed without authenticated actor context', async () => {
  await assert.rejects(
    () => callControlTool('core.entity.resolve', {
      org_id: '1c0733be-69b5-4e65-abe7-377b492c296b',
      namespace: 'email',
      alias_key: 'person@example.com',
      object_id: '123e4567-e89b-42d3-a456-426614174000'
    }),
    /authenticated actor user_id must be a UUID/
  );
});

test('the catalog advertises ai.chat images on messages[] with the shared bounds, and browser.act as an owner-only agent capability without a static binding', async () => {
  const catalog = JSON.parse(await readFile(new URL('../capabilities/catalog.json', import.meta.url), 'utf8'));
  const chat = catalog.capabilities.find((capability) => capability.id === 'ai.chat');
  const items = chat.inputSchema.properties.messages.items;
  assert.equal(chat.inputSchema.properties.messages.maxItems, 200);
  assert.deepEqual(items.required, ['role', 'content']);
  assert.deepEqual(items.properties.role.enum, ['system', 'user', 'assistant', 'tool']);
  assert.equal(items.properties.images.maxItems, 4);
  assert.equal(items.properties.images.items.maxLength, 266668);
  assert.equal(items.properties.images.items.contentEncoding, 'base64');
  assert.match(items.properties.images.description, /200000/);
  assert.match(chat.description, /AI_CHAT_NO_VISION_NODE/);
  const browser = catalog.capabilities.find((capability) => capability.id === 'browser.act');
  assert.ok(browser, 'browser.act is in the catalog');
  assert.equal(browser.lifecycle, 'active');
  assert.equal(browser.domain, 'compute');
  assert.equal(browser.execution, 'async');
  assert.equal(browser.risk, 'write');
  assert.equal(browser.approval, 'owner');
  assert.deepEqual(browser.interfaces, ['agent']);
  assert.match(browser.description, /owner-only/i);
  assert.match(browser.description, /never exposed over MCP/);
  assert.equal(browser.inputSchema.properties.actions.maxItems, 25);
  assert.deepEqual(browser.inputSchema.required, ['actions']);
  assert.equal(catalog.bindings.some((binding) => binding.capability === 'browser.act'), false, 'live binding from owned nodes only');
  assert.notEqual(catalog.catalogVersion, '2026-11-03.1', 'the catalog version moved with the schema');
});

test('core.ai.turn.submit accepts allow_browser only from an owner actor and bounds images to two', async () => {
  const submit = CONTROL_TOOLS.find((tool) => tool.name === 'core.ai.turn.submit');
  assert.equal(submit.inputSchema.properties.allow_browser.type, 'boolean');
  assert.equal(submit.inputSchema.properties.images.maxItems, 2);
  assert.equal(submit.inputSchema.properties.images.items.maxLength, 266668);
  const args = { org_id: '00000000-0000-4000-8000-000000000001', thread_id: '00000000-0000-4000-8000-000000000002', message_id: '00000000-0000-4000-8000-000000000003', content: 'open the docs', allow_browser: true };
  await assert.rejects(callControlTool('core.ai.turn.submit', args), (error) => error.code === 'BROWSER_OWNER_REQUIRED' && error.status === 403);
  await assert.rejects(callControlTool('core.ai.turn.submit', args, { actor: { user_id: '00000000-0000-4000-8000-000000000009', kind: 'member' } }), (error) => error.code === 'BROWSER_OWNER_REQUIRED');
  await assert.rejects(callControlTool('core.ai.turn.submit', args, { actor: { user_id: 'owner', kind: 'owner' } }), (error) => error.code === 'BROWSER_OWNER_REQUIRED', 'the actor id must be a UUID');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await assert.rejects(callControlTool('core.ai.turn.submit', { ...args, allow_browser: false, images: [png, png, png] }), (error) => error.code === 'AI_TURN_IMAGES_TOO_MANY' && error.status === 400);
  await assert.rejects(callControlTool('core.ai.turn.submit', { ...args, allow_browser: false, images: ['%%%'] }), (error) => error.code === 'AI_CHAT_IMAGE_INVALID');
});
